const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  StringSelectMenuBuilder,
  FileUploadBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  RESTJSONErrorCodes,
  Events,
} = require('discord.js');
const { loadConfig, isId, rupiah, num, getProduct } = require('./config');
const { state, save, activeTicketOf, nextTicketId } = require('./state');
const { lookupRobloxUser } = require('./roblox');
const V = require('./views');

const PROOF_DIR = path.join(__dirname, '..', '..', 'data', 'proofs');
const SESSION_MS = 10 * 60 * 1000;
const sessions = new Map(); // userId → { productId, roblox, expires }
let client = null;

const EPH = MessageFlags.Ephemeral;
const isAdmin = (member) => member?.permissions?.has(PermissionFlagsBits.Administrator);
const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

function getSession(userId) {
  const s = sessions.get(userId);
  if (!s || s.expires < Date.now()) {
    sessions.delete(userId);
    return null;
  }
  return s;
}

// ══════════════════════ Refresh panel & leaderboard (otomatis) ══════════════════════
const refreshTimers = {};
function debounce(key, fn, ms = 1500) {
  clearTimeout(refreshTimers[key]);
  refreshTimers[key] = setTimeout(() => fn().catch((e) => console.error(`[store] refresh ${key}:`, e.message)), ms);
}

async function editTracked(key, build) {
  const loc = state[key];
  if (!client || !loc) return;
  const channel = await client.channels.fetch(loc.channelId).catch(() => null);
  if (!channel) return;
  const cfg = loadConfig();
  if (!cfg) return;
  try {
    await channel.messages.edit(loc.messageId, build(channel.guild, cfg));
  } catch (err) {
    if (err.code === RESTJSONErrorCodes.UnknownMessage) {
      state[key] = null; // pesan dihapus manual → berhenti di-update
      save();
    } else throw err;
  }
}

const refreshPanel = () => debounce('panel', () => editTracked('panel', V.buildPanel));
const refreshLeaderboard = () => debounce('leaderboard', () => editTracked('leaderboard', V.buildLeaderboard));

// ══════════════════════ Pengumuman di channel stock ══════════════════════
async function announce(guild, kind, extra = {}, ping = false) {
  const cfg = loadConfig();
  if (!isId(cfg?.channels?.stock)) return;
  const channel = await guild.channels.fetch(cfg.channels.stock).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel
    .send({
      content: ping ? '@everyone' : undefined,
      embeds: [V.buildStoreAnnouncement(guild, cfg, kind, extra)],
      allowedMentions: { parse: ping ? ['everyone'] : [] },
    })
    .catch((e) => console.error('[store] gagal kirim pengumuman:', e.message));
}

async function setStoreOpen(guild, open, reason) {
  const cfg = loadConfig();
  state.open = open;
  save();
  refreshPanel();
  await announce(guild, open ? 'open' : 'close', { reason }, Boolean(cfg?.pingEveryone?.[open ? 'open' : 'close']));
}

// ══════════════════════ Kategori ticket (maks 50 channel / kategori) ══════════════════════
async function getTicketCategory(guild, cfg) {
  const base = cfg.ticket?.categoryName || '🎫 TICKET ORDER';
  const max = Math.min(Number(cfg.ticket?.maxPerCategory) || 50, 50);
  await guild.channels.fetch();
  const categories = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory && c.name.startsWith(base))
    .sort((a, b) => a.position - b.position);

  for (const cat of categories.values()) {
    const children = guild.channels.cache.filter((c) => c.parentId === cat.id).size;
    if (children < max) return cat;
  }
  const name = categories.size ? `${base} ${categories.size + 1}` : base;
  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
  });
}

// ══════════════════════ Langkah 1: klik produk di panel → info produk ══════════════════════
async function onProductInfo(interaction, productId) {
  const cfg = loadConfig();
  const product = getProduct(cfg, productId);
  if (!product || product.type !== 'robux') {
    return interaction.reply({ content: '🔒 Produk ini **Coming Soon** — nantikan ya!', flags: EPH });
  }
  return interaction.reply({ ...V.buildProductInfo(interaction.guild, cfg, product), flags: EPH });
}

/** Tombol "Syarat Pembelian" di info produk. */
async function onTerms(interaction, productId) {
  const cfg = loadConfig();
  const product = getProduct(cfg, productId);
  if (!product?.terms?.description) return interaction.reply({ content: 'Tidak ada syarat khusus untuk produk ini.', flags: EPH });
  return interaction.reply({ ...V.buildProductTerms(interaction.guild, cfg, product), flags: EPH });
}

// ══════════════════════ Langkah 1b: klik "Beli Sekarang" → form username ══════════════════════
async function onBuy(interaction, productId) {
  const cfg = loadConfig();
  const product = getProduct(cfg, productId);
  if (!product || product.type !== 'robux') {
    return interaction.reply({ content: '🔒 Produk ini **Coming Soon** — nantikan ya!', flags: EPH });
  }
  if (!state.open || state.stock <= 0) {
    refreshPanel();
    return interaction.reply({ content: '🔴 Toko sedang **TUTUP**. Pantau channel stock untuk info buka berikutnya.', flags: EPH });
  }
  const active = activeTicketOf({ userId: interaction.user.id });
  if (active) {
    return interaction.reply({
      content: `⚠️ Kamu masih punya ticket yang sedang berjalan: <#${active.channelId}> (\`${active.id}\`).\nTunggu ticket itu ditutup admin sebelum membuat pesanan baru.`,
      flags: EPH,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`store:rbxmodal:${product.id}`)
    .setTitle(`${product.label} — Akun Roblox`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Username Roblox')
        .setDescription('Masukkan username (bukan display name) akun Roblox penerima.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('username')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('contoh: Builderman')
            .setMinLength(3)
            .setMaxLength(20)
            .setRequired(true),
        ),
    );
  return interaction.showModal(modal);
}

// ══════════════════════ Langkah 2: cek username Roblox ══════════════════════
async function onRobloxModal(interaction, productId) {
  await interaction.deferReply({ flags: EPH });
  const cfg = loadConfig();
  const username = interaction.fields.getTextInputValue('username');

  let roblox;
  try {
    roblox = await lookupRobloxUser(username);
  } catch (err) {
    console.error('[store] cek Roblox gagal:', err.message);
    return interaction.editReply('⚠️ Gagal menghubungi server Roblox. Coba lagi beberapa saat lagi.');
  }
  if (!roblox) {
    return interaction.editReply(`❌ Username Roblox \`${username}\` tidak ditemukan. Pastikan ejaannya benar (pakai **username**, bukan display name).`);
  }

  const active = activeTicketOf({ robloxId: roblox.id });
  if (active) {
    return interaction.editReply(
      `⚠️ Akun Roblox \`@${roblox.name}\` masih punya ticket yang sedang berjalan (\`${active.id}\`).\nTunggu ticket itu ditutup sebelum membuat pesanan baru.`,
    );
  }

  sessions.set(interaction.user.id, { productId, roblox, expires: Date.now() + SESSION_MS });
  return interaction.editReply(V.buildConfirmAccount(cfg, roblox));
}

// ══════════════════════ Langkah 3: konfirmasi akun ══════════════════════
async function onConfirm(interaction, yes) {
  if (!yes) {
    sessions.delete(interaction.user.id);
    return interaction.update({ content: '✖️ Pesanan dibatalkan.', embeds: [], components: [] });
  }
  const session = getSession(interaction.user.id);
  if (!session) {
    return interaction.update({ content: '⌛ Sesi sudah berakhir. Silakan klik tombol produk lagi.', embeds: [], components: [] });
  }
  if (!state.open || state.stock <= 0) {
    return interaction.update({ content: '🔴 Maaf, toko baru saja **TUTUP**.', embeds: [], components: [] });
  }
  const cfg = loadConfig();
  const product = getProduct(cfg, session.productId);
  return interaction.update({ content: null, ...V.buildAmountPicker(cfg, product, session.roblox) });
}

// ══════════════════════ Langkah 4: pilih jumlah ══════════════════════
async function onAmountSelect(interaction, productId) {
  const value = interaction.values[0];
  if (value === 'custom') {
    const product = getProduct(loadConfig(), productId);
    const max = Number(product?.maxAmount) || 5000;
    const modal = new ModalBuilder()
      .setCustomId(`store:amountmodal:${productId}`)
      .setTitle('Jumlah Robux')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Jumlah Robux')
          .setDescription(`Minimal ${num(product?.minAmount || 1)}, maksimal ${num(max)} Robux. Sisa stock: ${num(state.stock)}.`)
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('amount')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder(`contoh: 1500`)
              .setMinLength(1)
              .setMaxLength(6)
              .setRequired(true),
          ),
      );
    return interaction.showModal(modal);
  }
  return createOrder(interaction, productId, Number(value));
}

async function onAmountModal(interaction, productId) {
  const raw = interaction.fields.getTextInputValue('amount').replace(/[.,\s]/g, '');
  return createOrder(interaction, productId, Number(raw));
}

// ══════════════════════ Langkah 5: buat ticket ══════════════════════
async function createOrder(interaction, productId, amount) {
  const cfg = loadConfig();
  const product = getProduct(cfg, productId);
  const session = getSession(interaction.user.id);
  const guild = interaction.guild;

  const fail = (content, keepPicker = false) =>
    interaction.update(
      keepPicker && session ? { content, ...V.buildAmountPicker(cfg, product, session.roblox) } : { content, embeds: [], components: [] },
    );

  if (!session || !product) return fail('⌛ Sesi sudah berakhir. Silakan klik tombol produk lagi.');
  const min = Number(product.minAmount) || 1;
  const max = Number(product.maxAmount) || 5000;
  if (!Number.isInteger(amount) || amount < min || amount > max) {
    return fail(`❌ Jumlah tidak valid. Masukkan angka **${num(min)} – ${num(max)}** Robux.`, true);
  }
  if (!state.open || state.stock <= 0) return fail('🔴 Maaf, toko sedang **TUTUP** atau stock sudah habis.');
  if (amount > state.stock) {
    return fail(
      `⚠️ **Stock tidak mencukupi.** Sisa stock saat ini hanya **${num(state.stock)} Robux**.\nSilakan pilih jumlah **maksimal ${num(state.stock)} Robux**.`,
      true,
    );
  }
  if (activeTicketOf({ userId: interaction.user.id }) || activeTicketOf({ robloxId: session.roblox.id })) {
    return fail('⚠️ Kamu / akun Roblox ini masih punya ticket yang sedang berjalan. Tunggu ticket itu ditutup dulu.');
  }

  // Kunci stock SEKARANG (sebelum proses async) supaya tidak bisa terjual dobel.
  const rate = V.rateOf(cfg, product);
  const id = nextTicketId(cfg.ticket?.idPrefix);
  state.stock -= amount;
  const ticket = {
    id,
    guildId: guild.id,
    userId: interaction.user.id,
    channelId: null,
    messageId: null,
    roblox: session.roblox,
    productId: product.id,
    productLabel: product.label,
    amount,
    rate,
    price: amount * rate,
    status: 'open',
    createdAt: Date.now(),
  };
  state.tickets[id] = ticket;
  save();
  sessions.delete(interaction.user.id);

  await interaction.update({ content: '⏳ Sedang membuat ticket kamu...', embeds: [], components: [] });

  try {
    const category = await getTicketCategory(guild, cfg);
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ];
    if (isId(cfg.ticket?.staffRoleId)) {
      overwrites.push({
        id: cfg.ticket.staffRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }
    const slug = session.roblox.name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    const channel = await guild.channels.create({
      name: `🎫・${id.toLowerCase()}-${slug}`,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `${id} • ${product.label} ${num(amount)} Robux • ${interaction.user.tag} • Roblox @${session.roblox.name}`,
      permissionOverwrites: overwrites,
    });
    ticket.channelId = channel.id;

    const msg = await channel.send({
      content: `<@${interaction.user.id}>${isId(cfg.ticket?.staffRoleId) ? ` <@&${cfg.ticket.staffRoleId}>` : ''}`,
      ...V.buildTicketMessage(guild, cfg, ticket),
      allowedMentions: { users: [interaction.user.id], roles: isId(cfg.ticket?.staffRoleId) ? [cfg.ticket.staffRoleId] : [] },
    });
    await msg.pin().catch(() => {});
    ticket.messageId = msg.id;
    save();

    const url = channelUrl(guild.id, channel.id);
    const dmOk = await interaction.user
      .send(V.buildDmCreated(guild, cfg, ticket, url))
      .then(() => true)
      .catch(() => false);
    if (!dmOk) {
      channel.send('ℹ️ Bot tidak bisa mengirim DM ke kamu (DM tertutup). Semua info pesanan ada di ticket ini.').catch(() => {});
    }

    await interaction.editReply({
      content: `✅ **Ticket berhasil dibuat!** Lanjutkan pembayaran di ${channel}.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Buka Ticket').setEmoji('🎫').setURL(url),
        ),
      ],
    });
  } catch (err) {
    // Gagal membuat ticket → kembalikan stock & hapus data ticket.
    console.error('[store] gagal membuat ticket:', err);
    state.stock += amount;
    delete state.tickets[id];
    save();
    await interaction
      .editReply('❌ Gagal membuat ticket. Pastikan bot punya izin **Manage Channels** & **Manage Roles**, lalu coba lagi.')
      .catch(() => {});
    refreshPanel();
    return;
  }

  refreshPanel();
  if (state.stock <= 0 && state.open) {
    await setStoreOpen(guild, false, `📦 **Stock Robux hari ini sudah HABIS!** Toko otomatis ditutup.`);
  }
}

// ══════════════════════ Tutup ticket (khusus Administrator) ══════════════════════
async function onCloseButton(interaction, ticketId) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ content: '⛔ Hanya **Administrator** yang bisa menutup ticket.', flags: EPH });
  }
  const t = state.tickets[ticketId];
  if (!t || t.status !== 'open') return interaction.reply({ content: 'Ticket ini sudah ditutup.', flags: EPH });

  const modal = new ModalBuilder()
    .setCustomId(`store:closemodal:${ticketId}`)
    .setTitle(`Tutup Ticket ${ticketId}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Gambar Bukti / Testimoni')
        .setDescription('Upload screenshot bukti pengiriman. Wajib untuk status Completed.')
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('proof').setMinValues(0).setMaxValues(1).setRequired(false)),
      new LabelBuilder()
        .setLabel('Status Pesanan')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('status')
            .setPlaceholder('Pilih status pesanan...')
            .setRequired(true)
            .addOptions(
              { label: 'Completed', description: 'Produk berhasil dikirim', value: 'completed', emoji: '✅' },
              { label: 'Cancelled', description: 'Dibatalkan', value: 'cancelled', emoji: '❌' },
              { label: 'Refund', description: 'Dana dikembalikan', value: 'refund', emoji: '💸' },
            ),
        ),
      new LabelBuilder()
        .setLabel('Catatan (opsional)')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('note').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false),
        ),
    );
  return interaction.showModal(modal);
}

async function saveProof(attachment, ticketId) {
  if (!attachment) return null;
  if (attachment.contentType && !attachment.contentType.startsWith('image/')) return null;
  const ext = (path.extname((attachment.name || '').split('?')[0]) || '.png').toLowerCase();
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(attachment.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.mkdirSync(PROOF_DIR, { recursive: true });
      const file = path.join(PROOF_DIR, `${ticketId}${ext}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return file;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1))); // jaga-jaga DNS VPS sedang bermasalah
    }
  }
  throw new Error(`download bukti gagal: ${lastErr?.cause?.code || lastErr?.message}`);
}

/** Lampiran bukti (dari disk) untuk dikirim bersama embed. */
function proofAttachment(t) {
  // Fallback: file gagal di-download ke VPS → pakai link gambar asli dari Discord.
  if (!t.proofFile || !fs.existsSync(t.proofFile)) return { files: [], url: t.proofRemoteUrl || null };
  const name = `bukti-${t.id}${path.extname(t.proofFile)}`;
  return { files: [{ attachment: t.proofFile, name }], url: `attachment://${name}` };
}

async function onCloseModal(interaction, ticketId) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ content: '⛔ Hanya **Administrator** yang bisa menutup ticket.', flags: EPH });
  }
  await interaction.deferReply({ flags: EPH });
  const cfg = loadConfig();
  const guild = interaction.guild;
  const t = state.tickets[ticketId];
  if (!t || t.status !== 'open') return interaction.editReply('Ticket ini sudah ditutup.');

  const status = interaction.fields.getStringSelectValues('status')?.[0];
  const upload = interaction.fields.getUploadedFiles('proof')?.first?.() || null;
  const note = (interaction.fields.getTextInputValue('note') || '').trim();
  if (!['completed', 'cancelled', 'refund'].includes(status)) return interaction.editReply('❌ Pilih status pesanan.');
  if (status === 'completed' && !upload) {
    return interaction.editReply('📸 Untuk status **Completed**, wajib upload **gambar bukti / testimoni**. Klik Tutup Ticket lagi.');
  }

  if (upload && upload.contentType && !upload.contentType.startsWith('image/')) {
    return interaction.editReply('❌ File bukti harus berupa **gambar** (PNG / JPG / WEBP).');
  }
  try {
    t.proofFile = await saveProof(upload, t.id);
  } catch (err) {
    // Tidak menggagalkan penutupan ticket: gambar tetap ditampilkan lewat link aslinya.
    console.warn(`[store] ${err.message} → pakai link gambar asli.`);
    t.proofFile = null;
    t.proofRemoteUrl = upload?.url || null;
  }

  t.status = status;
  t.closedAt = Date.now();
  t.closedBy = interaction.user.id;
  t.note = note || null;

  const channel = interaction.channel;
  const proof = proofAttachment(t);
  t.proofUrl = proof.url;

  if (status === 'completed') {
    state.stats.transactions += 1;
    state.stats.robux += t.amount;
    state.stats.revenue += t.price;
    const sp = state.spenders[t.userId] || { robux: 0, revenue: 0, orders: 0 };
    sp.robux += t.amount;
    sp.revenue += t.price;
    sp.orders += 1;
    state.spenders[t.userId] = sp;
    t.testimonyDeadline = Date.now() + (Number(cfg.ticket?.testimonyTimeoutHours) || 24) * 3600 * 1000;
  } else {
    state.stock += t.amount; // stock dikembalikan
    t.deleteAt = Date.now() + (Number(cfg.ticket?.deleteAfterSeconds) || 15) * 1000;
  }
  save();

  // Refresh pesan detail ticket (status berubah, tombol hilang).
  if (t.messageId) channel.messages.edit(t.messageId, V.buildTicketMessage(guild, cfg, t)).catch(() => {});

  if (status === 'completed') {
    await channel.send({ ...V.buildTestimonyPrompt(guild, cfg, t), files: proof.files });
  } else {
    const secs = Number(cfg.ticket?.deleteAfterSeconds) || 15;
    const closedEmbed = V.buildDmClosed(guild, cfg, t).embeds[0].setDescription(
      `Ticket ini ditutup dengan status **${V.STATUS_LABEL[status]}**.${note ? `\n\n📝 Catatan: ${note}` : ''}\n\nChannel ini akan dihapus dalam **${secs} detik**.`,
    );
    if (proof.url) closedEmbed.setImage(proof.url);
    await channel.send({
      content: `<@${t.userId}>`,
      embeds: [closedEmbed],
      files: proof.files,
      allowedMentions: { users: [t.userId] },
    });
    await announce(guild, 'returned', { ticket: t });
  }

  // DM pembeli soal hasil pesanannya.
  const buyer = await client.users.fetch(t.userId).catch(() => null);
  if (buyer) {
    const dm = V.buildDmClosed(guild, cfg, t);
    const dmProof = proofAttachment(t);
    if (status === 'completed' && dmProof.url) dm.embeds[0].setImage(dmProof.url);
    else dm.embeds[0].setImage(null);
    await buyer.send({ ...dm, files: status === 'completed' ? dmProof.files : [] }).catch(() => {});
  }

  refreshPanel();
  refreshLeaderboard();
  return interaction.editReply(`✅ Ticket **${t.id}** ditutup sebagai **${V.STATUS_LABEL[status]}**.`);
}

// ══════════════════════ Testimoni pembeli ══════════════════════
async function onTestimonyButton(interaction, ticketId) {
  const t = state.tickets[ticketId];
  if (!t || t.status !== 'completed') return interaction.reply({ content: 'Ticket tidak ditemukan.', flags: EPH });
  if (interaction.user.id !== t.userId) {
    return interaction.reply({ content: '⛔ Hanya pembeli ticket ini yang bisa memberi testimoni.', flags: EPH });
  }
  if (t.testimony || t.testimonyPosted) return interaction.reply({ content: '✅ Kamu sudah memberi testimoni. Terima kasih!', flags: EPH });

  const modal = new ModalBuilder()
    .setCustomId(`store:testimodal:${ticketId}`)
    .setTitle('Beri Testimoni')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Rating')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('rating')
            .setPlaceholder('Pilih bintang...')
            .setRequired(true)
            .addOptions(
              { label: '⭐⭐⭐⭐⭐  Sangat Puas', value: '5' },
              { label: '⭐⭐⭐⭐  Puas', value: '4' },
              { label: '⭐⭐⭐  Cukup', value: '3' },
              { label: '⭐⭐  Kurang', value: '2' },
              { label: '⭐  Kecewa', value: '1' },
            ),
        ),
      new LabelBuilder()
        .setLabel('Komentar')
        .setDescription('Ceritakan pengalaman belanjamu.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('comment')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('contoh: Prosesnya cepat banget, admin ramah! 🔥')
            .setMinLength(3)
            .setMaxLength(500)
            .setRequired(true),
        ),
    );
  return interaction.showModal(modal);
}

async function postTestimony(guild, t) {
  const cfg = loadConfig();
  if (!isId(cfg?.channels?.testimoni)) return;
  const channel = await guild.channels.fetch(cfg.channels.testimoni).catch(() => null);
  if (!channel?.isTextBased()) return;
  state.stats.testimonies += 1;
  const buyer = await guild.members.fetch(t.userId).catch(() => null);
  const proof = proofAttachment(t);
  t.proofUrl = proof.url;
  await channel.send({ ...V.buildTestimony(guild, cfg, t, buyer), files: proof.files });
  t.testimonyPosted = true;
  save();
}

async function onTestimonyModal(interaction, ticketId) {
  const t = state.tickets[ticketId];
  if (!t || interaction.user.id !== t.userId || t.testimony || t.testimonyPosted) {
    return interaction.reply({ content: 'Testimoni tidak bisa dikirim.', flags: EPH });
  }
  await interaction.deferUpdate();
  const cfg = loadConfig();
  const rating = Math.min(5, Math.max(1, Number(interaction.fields.getStringSelectValues('rating')?.[0]) || 5));
  const comment = interaction.fields.getTextInputValue('comment').trim();

  t.testimony = { rating, comment, at: Date.now() };
  state.stats.ratingSum += rating;
  state.stats.ratingCount += 1;
  t.deleteAt = Date.now() + (Number(cfg.ticket?.deleteAfterSeconds) || 15) * 1000;
  save();

  await postTestimony(interaction.guild, t);
  await interaction.message?.edit({ components: [] }).catch(() => {});
  await interaction.channel
    .send(`💜 Terima kasih <@${t.userId}> atas testimoninya (${'⭐'.repeat(rating)})! Ticket ini akan dihapus dalam **${Number(cfg.ticket?.deleteAfterSeconds) || 15} detik**.`)
    .catch(() => {});
  refreshPanel();
}

// ══════════════════════ Tugas berkala: batas testimoni & hapus channel ══════════════════════
async function housekeeping() {
  if (!client) return;
  const cfg = loadConfig();
  const now = Date.now();
  for (const t of Object.values(state.tickets)) {
    try {
      // Pembeli tidak memberi testimoni sampai batas waktu.
      if (t.status === 'completed' && !t.testimony && !t.testimonyPosted && !t.deleted && t.testimonyDeadline < now) {
        const guild = client.guilds.cache.get(t.guildId) || client.guilds.cache.first();
        if (cfg?.ticket?.postWithoutReview !== false && guild) await postTestimony(guild, t);
        t.testimonyPosted = true;
        t.deleteAt = now;
        save();
      }
      // Hapus channel ticket yang sudah selesai.
      if (t.deleteAt && !t.deleted && t.deleteAt <= now) {
        t.deleted = true;
        save();
        const ch = await client.channels.fetch(t.channelId).catch(() => null);
        if (ch) await ch.delete(`Ticket ${t.id} selesai`).catch(() => {});
        if (t.proofFile) fs.rm(t.proofFile, { force: true }, () => {});
      }
    } catch (err) {
      console.error(`[store] housekeeping ${t.id}:`, err.message);
    }
  }
}

/** Channel ticket dihapus manual saat masih berjalan → anggap batal & kembalikan stock. */
async function onChannelDelete(channel) {
  const t = Object.values(state.tickets).find((x) => x.channelId === channel.id && !x.deleted);
  if (!t) return;
  t.deleted = true;
  if (t.status === 'open') {
    t.status = 'cancelled';
    t.closedAt = Date.now();
    t.closedBy = client.user.id;
    t.note = 'Channel ticket dihapus manual';
    state.stock += t.amount;
    save();
    await announce(channel.guild, 'returned', { ticket: t });
    refreshPanel();
  } else save();
}

// ══════════════════════ Router interaksi ══════════════════════
async function handleInteraction(interaction) {
  const id = interaction.customId;
  if (typeof id !== 'string' || !id.startsWith('store:')) return false;
  const [, action, arg] = id.split(':');

  try {
    if (interaction.isButton()) {
      if (action === 'buy') await onProductInfo(interaction, arg);
      else if (action === 'order') await onBuy(interaction, arg);
      else if (action === 'terms') await onTerms(interaction, arg);
      else if (action === 'confirm') await onConfirm(interaction, arg === 'yes');
      else if (action === 'close') await onCloseButton(interaction, arg);
      else if (action === 'testi') await onTestimonyButton(interaction, arg);
    } else if (interaction.isStringSelectMenu()) {
      if (action === 'amount') await onAmountSelect(interaction, arg);
    } else if (interaction.isModalSubmit()) {
      if (action === 'rbxmodal') await onRobloxModal(interaction, arg);
      else if (action === 'amountmodal') await onAmountModal(interaction, arg);
      else if (action === 'closemodal') await onCloseModal(interaction, arg);
      else if (action === 'testimodal') await onTestimonyModal(interaction, arg);
    }
  } catch (err) {
    console.error(`[store] error (${id}):`, err);
    const msg = { content: '❌ Terjadi kesalahan, coba lagi.', flags: EPH };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
  return true;
}

function registerStore(c) {
  client = c;
  c.on('channelDelete', (ch) => onChannelDelete(ch).catch((e) => console.error('[store] channelDelete:', e.message)));
  c.once(Events.ClientReady, () => {
    housekeeping();
    setInterval(housekeeping, 30 * 1000);
    refreshPanel();
    refreshLeaderboard();
  });
}

module.exports = {
  handleInteraction,
  registerStore,
  setStoreOpen,
  announce,
  refreshPanel,
  refreshLeaderboard,
};
