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
  UserSelectMenuBuilder,
  FileUploadBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  RESTJSONErrorCodes,
  Events,
} = require('discord.js');
const { loadConfig, isId, rupiah, num, getProduct } = require('./config');
const { state, save, productState, isProductOpen, kindOf, activeTicketOf, nextTicketId } = require('./state');
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

/**
 * Buka / tutup satu atau beberapa produk sekaligus (1 pengumuman gabungan).
 * auto = true → ditutup otomatis karena stock habis. Produk yang tutup otomatis akan BUKA LAGI
 * otomatis saat stock kembali (cancel / refund / stock ditambah). Produk yang ditutup manual
 * lewat /store tutup tetap tutup sampai admin membukanya.
 */
async function setProductsOpen(guild, products, open, { reason, auto = false } = {}) {
  const cfg = loadConfig();
  for (const p of products) {
    const ps = productState(p.id);
    ps.open = open;
    ps.autoClosed = !open && auto;
  }
  save();
  refreshPanel();
  if (products.length) {
    await announce(guild, open ? 'open' : 'close', { reason, products }, Boolean(cfg?.pingEveryone?.[open ? 'open' : 'close']));
  }
}

const robuxProduct = (cfg) => (cfg?.products || []).find((p) => p.type === 'robux') || null;

/** Stock kembali tersedia & Robux sebelumnya tutup karena stock habis → buka lagi otomatis. */
async function reopenIfAutoClosed(guild) {
  const product = robuxProduct(loadConfig());
  if (!product) return false;
  const ps = productState(product.id);
  if (!ps.open && ps.autoClosed && state.stock > 0) {
    await setProductsOpen(guild, [product], true);
    return true;
  }
  return false;
}

/** Stock habis & Robux masih buka → tutup otomatis. */
async function closeIfSoldOut(guild, reason) {
  const product = robuxProduct(loadConfig());
  if (product && state.stock <= 0 && productState(product.id).open) {
    await setProductsOpen(guild, [product], false, { reason, auto: true });
    return true;
  }
  return false;
}

// ══════════════════════ Log order (1 pesan per ticket, di-edit otomatis) ══════════════════════
const logQueues = new Map();

/**
 * Catat kejadian ke riwayat ticket & perbarui pesan log di channel log.
 * Antrian per ticket supaya pesan log tidak terkirim dobel saat kejadian beruntun.
 */
function logOrder(guild, t, text, { withProof = false } = {}) {
  if (text) {
    t.log = t.log || [];
    t.log.push({ at: Date.now(), text });
    save();
  }
  const prev = logQueues.get(t.id) || Promise.resolve();
  const next = prev
    .then(async () => {
      const cfg = loadConfig();
      if (!isId(cfg?.channels?.log) || !guild) return;
      const channel = await guild.channels.fetch(cfg.channels.log).catch(() => null);
      if (!channel?.isTextBased()) return;
      const proof = withProof ? proofAttachment(t) : { files: [], url: t.logProofUrl || null };
      if (withProof && proof.url) t.logProofUrl = proof.url;
      const payload = V.buildOrderLog(guild, cfg, t, proof.url || t.logProofUrl);
      if (proof.files.length) payload.files = proof.files;

      if (t.logMessageId) {
        try {
          await channel.messages.edit(t.logMessageId, payload);
          return;
        } catch (err) {
          if (err.code !== RESTJSONErrorCodes.UnknownMessage) throw err;
        }
      }
      const msg = await channel.send(payload);
      t.logMessageId = msg.id;
      save();
    })
    .catch((e) => console.error(`[store] log order ${t.id}:`, e.message));
  logQueues.set(t.id, next);
  return next;
}

// ══════════════════════ Kategori ticket (maks 50 channel / kategori) ══════════════════════
async function getTicketCategory(guild, cfg, base = cfg.ticket?.categoryName || '🎫 TICKET ORDER') {
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
  if (product?.type === 'rekber') return interaction.reply({ ...V.buildRekberInfo(interaction.guild, cfg, product), flags: EPH });
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
  if (product?.type === 'rekber') return onRekberStart(interaction, product);
  if (!product || product.type !== 'robux') {
    return interaction.reply({ content: '🔒 Produk ini **Coming Soon** — nantikan ya!', flags: EPH });
  }
  if (!isProductOpen(product)) {
    refreshPanel();
    return interaction.reply({ content: `🔴 **${product.label}** sedang **TUTUP**. Pantau channel stock untuk info buka berikutnya.`, flags: EPH });
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
  const cfg = loadConfig();
  const product = getProduct(cfg, session.productId);
  if (!isProductOpen(product)) {
    return interaction.update({ content: `🔴 Maaf, **${product?.label || 'produk ini'}** baru saja **TUTUP**.`, embeds: [], components: [] });
  }
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
  if (!isProductOpen(product)) return fail(`🔴 Maaf, **${product.label}** sedang **TUTUP** atau stock sudah habis.`);
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
    logOrder(guild, ticket, `🆕 Order dibuat oleh <@${ticket.userId}> • ${num(amount)} Robux`);

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
  await closeIfSoldOut(guild, `📦 **Stock Robux hari ini sudah HABIS!** ${product.label} otomatis ditutup.`);
}

// ══════════════════════ REKBER (rekening bersama) ══════════════════════
const rekberSessions = new Map(); // userId → { draft, expires }

/** Klik "Buat Ticket Rekber" → form isian rekber. */
async function onRekberStart(interaction, product) {
  if (!isProductOpen(product)) {
    refreshPanel();
    return interaction.reply({ content: `🔴 Layanan **${product.label}** sedang **TUTUP**.`, flags: EPH });
  }
  const active = activeTicketOf({ userId: interaction.user.id, kind: 'rekber' });
  if (active) {
    return interaction.reply({
      content: `⚠️ Kamu masih punya transaksi rekber yang sedang berjalan: <#${active.channelId}> (\`${active.id}\`).\nSelesaikan transaksi itu dulu sebelum membuat rekber baru.`,
      flags: EPH,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`store:rbmodal:${product.id}`)
    .setTitle('Buat Transaksi Rekber')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Pihak Lawan Transaksi')
        .setDescription('Ketik username Discord pihak yang bertransaksi denganmu.')
        .setUserSelectMenuComponent(
          new UserSelectMenuBuilder().setCustomId('partner').setPlaceholder('🔍 Cari username Discord...').setMinValues(1).setMaxValues(1).setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Peran Kamu')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('role')
            .setPlaceholder('Pilih peranmu dalam transaksi...')
            .setRequired(true)
            .addOptions(
              { label: 'Saya Pembeli', description: 'Saya yang membayar & menerima barang / jasa', value: 'buyer', emoji: '🛒' },
              { label: 'Saya Penjual', description: 'Saya yang mengirim barang / jasa & menerima dana', value: 'seller', emoji: '🏷️' },
            ),
        ),
      new LabelBuilder()
        .setLabel('Transaksi Untuk Apa?')
        .setDescription('Barang / jasa yang diperjualbelikan.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('item')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('contoh: Akun Roblox / Jasa joki / Item game')
            .setMinLength(3)
            .setMaxLength(100)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Nominal Transaksi (Rp)')
        .setDescription(`Minimal ${rupiah(product.minNominal || 0)} • maksimal ${rupiah(product.maxNominal || 0)}`)
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('nominal').setStyle(TextInputStyle.Short).setPlaceholder('contoh: 150000').setMaxLength(12).setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Detail Kesepakatan (opsional)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('detail')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('contoh: Akun level 50, include 3 gamepass, garansi 1x24 jam')
            .setMaxLength(500)
            .setRequired(false),
        ),
    );
  return interaction.showModal(modal);
}

/** Form rekber dikirim → validasi → tampilkan ringkasan untuk dikonfirmasi. */
async function onRekberModal(interaction, productId) {
  await interaction.deferReply({ flags: EPH });
  const cfg = loadConfig();
  const product = getProduct(cfg, productId);
  if (!product || product.type !== 'rekber') return interaction.editReply('❌ Layanan rekber tidak ditemukan.');
  if (!isProductOpen(product)) return interaction.editReply(`🔴 Layanan **${product.label}** sedang **TUTUP**.`);

  const partner = interaction.fields.getSelectedUsers('partner')?.first?.();
  const role = interaction.fields.getStringSelectValues('role')?.[0];
  const item = interaction.fields.getTextInputValue('item').trim();
  const detail = (interaction.fields.getTextInputValue('detail') || '').trim();
  const nominal = Number(interaction.fields.getTextInputValue('nominal').replace(/[^\d]/g, ''));

  if (!partner) return interaction.editReply('❌ Pilih pihak lawan transaksi.');
  if (partner.id === interaction.user.id) return interaction.editReply('❌ Pihak lawan transaksi tidak boleh dirimu sendiri.');
  if (partner.bot) return interaction.editReply('❌ Pihak lawan transaksi tidak boleh bot.');
  const partnerMember = await interaction.guild.members.fetch(partner.id).catch(() => null);
  if (!partnerMember) return interaction.editReply(`❌ ${partner} tidak ada di server ini.`);
  const min = Number(product.minNominal) || 0;
  const max = Number(product.maxNominal) || Infinity;
  if (!Number.isFinite(nominal) || nominal < min || nominal > max) {
    return interaction.editReply(`❌ Nominal tidak valid. Masukkan angka **${rupiah(min)} – ${rupiah(max)}**.`);
  }
  for (const uid of [interaction.user.id, partner.id]) {
    const active = activeTicketOf({ userId: uid, kind: 'rekber' });
    if (active) {
      return interaction.editReply(
        `⚠️ <@${uid}> masih punya transaksi rekber yang sedang berjalan (\`${active.id}\`). Selesaikan dulu sebelum membuat rekber baru.`,
      );
    }
  }

  const { fee, buyerPays, sellerGets, byBuyer } = V.rekberFee(product, nominal);
  if (sellerGets <= 0) return interaction.editReply('❌ Nominal terlalu kecil dibanding fee rekber.');
  const draft = {
    productId: product.id,
    partnerId: partner.id,
    buyerId: role === 'seller' ? partner.id : interaction.user.id,
    sellerId: role === 'seller' ? interaction.user.id : partner.id,
    item,
    detail: detail || null,
    nominal,
    fee,
    buyerPays,
    sellerGets,
    feeByBuyer: byBuyer,
  };
  rekberSessions.set(interaction.user.id, { draft, expires: Date.now() + SESSION_MS });
  return interaction.editReply(V.buildRekberConfirm(interaction.guild, cfg, draft));
}

/** Konfirmasi ringkasan → buat ticket rekber untuk kedua pihak. */
async function onRekberConfirm(interaction, yes) {
  const sess = rekberSessions.get(interaction.user.id);
  rekberSessions.delete(interaction.user.id);
  if (!yes) return interaction.update({ content: '✖️ Transaksi rekber dibatalkan.', embeds: [], components: [] });
  if (!sess || sess.expires < Date.now()) {
    return interaction.update({ content: '⌛ Sesi sudah berakhir. Silakan klik tombol Rekber lagi.', embeds: [], components: [] });
  }
  const cfg = loadConfig();
  const guild = interaction.guild;
  const d = sess.draft;
  const product = getProduct(cfg, d.productId);
  if (!isProductOpen(product)) return interaction.update({ content: '🔴 Layanan rekber baru saja **TUTUP**.', embeds: [], components: [] });
  for (const uid of [interaction.user.id, d.partnerId]) {
    if (activeTicketOf({ userId: uid, kind: 'rekber' })) {
      return interaction.update({ content: `⚠️ <@${uid}> masih punya transaksi rekber yang sedang berjalan.`, embeds: [], components: [] });
    }
  }

  const rc = cfg.rekberTicket || {};
  const id = nextTicketId(rc.idPrefix || 'RB', 'rekberSeq');
  const ticket = {
    id,
    kind: 'rekber',
    guildId: guild.id,
    userId: interaction.user.id,
    ...d,
    productLabel: product.label,
    stage: { agreed: false, funded: false, received: false },
    channelId: null,
    messageId: null,
    status: 'open',
    createdAt: Date.now(),
  };
  state.tickets[id] = ticket;
  save();
  await interaction.update({ content: '⏳ Sedang membuat ticket rekber...', embeds: [], components: [] });

  try {
    const category = await getTicketCategory(guild, cfg, rc.categoryName || '🤝 TICKET REKBER');
    const member = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
    ];
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: ticket.buyerId, allow: member },
      { id: ticket.sellerId, allow: member },
      { id: guild.members.me.id, allow: [...member, PermissionFlagsBits.ManageChannels] },
    ];
    if (isId(cfg.ticket?.staffRoleId)) {
      overwrites.push({ id: cfg.ticket.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }
    const slug = interaction.user.username.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    const channel = await guild.channels.create({
      name: `🤝・${id.toLowerCase()}-${slug}`,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Rekber ${id} • ${d.item} • ${rupiah(d.nominal)}`,
      permissionOverwrites: overwrites,
    });
    ticket.channelId = channel.id;

    const pings = [ticket.buyerId, ticket.sellerId];
    const msg = await channel.send({
      content: pings.map((u) => `<@${u}>`).join(' ') + (isId(cfg.ticket?.staffRoleId) ? ` <@&${cfg.ticket.staffRoleId}>` : ''),
      ...V.buildTicketMessage(guild, cfg, ticket),
      allowedMentions: { users: pings, roles: isId(cfg.ticket?.staffRoleId) ? [cfg.ticket.staffRoleId] : [] },
    });
    await msg.pin().catch(() => {});
    ticket.messageId = msg.id;
    save();
    logOrder(guild, ticket, `🆕 Rekber dibuat oleh <@${ticket.userId}> • ${rupiah(ticket.nominal)}`);

    await channel.send(V.buildRekberStep(guild, cfg, ticket, 'invite')).catch(() => {});

    const url = channelUrl(guild.id, channel.id);
    for (const uid of pings) {
      const user = await client.users.fetch(uid).catch(() => null);
      await user?.send(V.buildRekberDmCreated(guild, cfg, ticket, url, uid)).catch(() => {});
    }
    await interaction.editReply({
      content: `✅ **Ticket rekber berhasil dibuat!** Lanjutkan transaksi di ${channel}.`,
      components: [
        new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Buka Ticket Rekber').setEmoji('🤝').setURL(url)),
      ],
    });
  } catch (err) {
    console.error('[store] gagal membuat ticket rekber:', err);
    delete state.tickets[id];
    save();
    await interaction
      .editReply('❌ Gagal membuat ticket rekber. Pastikan bot punya izin **Manage Channels** & **Manage Roles**, lalu coba lagi.')
      .catch(() => {});
  }
}

/** Update tampilan ticket rekber + kirim log langkah di channel. */
const STEP_LOG = {
  agreed: (t) => `🤝 Disetujui oleh <@${t.partnerId}>`,
  funded: (t) => `💰 Dana ${rupiah(t.buyerPays)} dikonfirmasi oleh <@${t.stage.fundedBy}>`,
  received: (t) => `📦 Barang diterima — dikonfirmasi <@${t.buyerId}>`,
};

async function advanceRekber(interaction, t, step) {
  const cfg = loadConfig();
  save();
  logOrder(interaction.guild, t, STEP_LOG[step](t));
  await interaction.update(V.buildTicketMessage(interaction.guild, cfg, t));
  await interaction.channel.send(V.buildRekberStep(interaction.guild, cfg, t, step)).catch(() => {});
}

function rekberTicketFor(interaction, ticketId) {
  const t = state.tickets[ticketId];
  if (!t || kindOf(t) !== 'rekber' || t.status !== 'open') {
    interaction.reply({ content: 'Transaksi rekber ini sudah ditutup.', flags: EPH }).catch(() => {});
    return null;
  }
  return t;
}

/** Langkah 1: pihak lawan menyetujui transaksi. */
async function onRekberAgree(interaction, ticketId) {
  const t = rekberTicketFor(interaction, ticketId);
  if (!t) return;
  if (interaction.user.id !== t.partnerId) {
    return interaction.reply({ content: `⛔ Hanya <@${t.partnerId}> (pihak lawan transaksi) yang bisa menyetujui.`, flags: EPH });
  }
  t.stage.agreed = true;
  return advanceRekber(interaction, t, 'agreed');
}

/** Langkah 2: admin mengonfirmasi dana pembeli sudah masuk. */
async function onRekberFund(interaction, ticketId) {
  const t = rekberTicketFor(interaction, ticketId);
  if (!t) return;
  if (!isAdmin(interaction.member)) return interaction.reply({ content: '⛔ Hanya **Administrator** yang bisa mengonfirmasi dana.', flags: EPH });
  if (!t.stage.agreed) return interaction.reply({ content: 'Tunggu pihak lawan menyetujui transaksi dulu.', flags: EPH });
  t.stage.funded = true;
  t.stage.fundedBy = interaction.user.id;
  return advanceRekber(interaction, t, 'funded');
}

/** Langkah 3: pembeli mengonfirmasi barang / jasa sudah diterima. */
async function onRekberReceived(interaction, ticketId) {
  const t = rekberTicketFor(interaction, ticketId);
  if (!t) return;
  if (interaction.user.id !== t.buyerId) {
    return interaction.reply({ content: `⛔ Hanya <@${t.buyerId}> (pembeli) yang bisa mengonfirmasi barang diterima.`, flags: EPH });
  }
  if (!t.stage.funded) return interaction.reply({ content: 'Tunggu admin mengonfirmasi dana terlebih dahulu.', flags: EPH });
  t.stage.received = true;
  return advanceRekber(interaction, t, 'received');
}

// ══════════════════════ Tutup ticket (khusus Administrator) ══════════════════════
async function onCloseButton(interaction, ticketId) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ content: '⛔ Hanya **Administrator** yang bisa menutup ticket.', flags: EPH });
  }
  const t = state.tickets[ticketId];
  if (!t || t.status !== 'open') return interaction.reply({ content: 'Ticket ini sudah ditutup.', flags: EPH });
  const rekber = kindOf(t) === 'rekber';

  const modal = new ModalBuilder()
    .setCustomId(`store:closemodal:${ticketId}`)
    .setTitle(`Tutup Ticket ${ticketId}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(rekber ? 'Bukti Pencairan Dana' : 'Gambar Bukti / Testimoni')
        .setDescription(
          rekber
            ? 'Upload bukti transfer dana ke penjual (atau ke pembeli untuk refund). Wajib untuk Completed.'
            : 'Upload screenshot bukti pengiriman. Wajib untuk status Completed.',
        )
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('proof').setMinValues(0).setMaxValues(1).setRequired(false)),
      new LabelBuilder()
        .setLabel('Status Pesanan')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('status')
            .setPlaceholder('Pilih status pesanan...')
            .setRequired(true)
            .addOptions(
              {
                label: 'Completed',
                description: rekber ? 'Dana dicairkan ke penjual' : 'Produk berhasil dikirim',
                value: 'completed',
                emoji: '✅',
              },
              { label: 'Cancelled', description: 'Dibatalkan', value: 'cancelled', emoji: '❌' },
              {
                label: 'Refund',
                description: rekber ? 'Dana dikembalikan ke pembeli' : 'Dana dikembalikan',
                value: 'refund',
                emoji: '💸',
              },
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
  const rekber = kindOf(t) === 'rekber';

  if (rekber) {
    if (status === 'completed') {
      state.stats.rekber += 1;
      state.stats.rekberVolume += t.nominal;
      t.testimonyDeadline = Date.now() + (Number(cfg.ticket?.testimonyTimeoutHours) || 24) * 3600 * 1000;
    } else {
      t.deleteAt = Date.now() + (Number(cfg.ticket?.deleteAfterSeconds) || 15) * 1000;
    }
  } else if (status === 'completed') {
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
    state.stock += t.amount; // stock Robux dikembalikan
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
      `Ticket ini ditutup dengan status **${V.statusLabel(t)}**.${note ? `\n\n📝 Catatan: ${note}` : ''}\n\nChannel ini akan dihapus dalam **${secs} detik**.`,
    );
    if (proof.url) closedEmbed.setImage(proof.url);
    const mentionIds = rekber ? [t.buyerId, t.sellerId] : [t.userId];
    await channel.send({
      content: mentionIds.map((id) => `<@${id}>`).join(' '),
      embeds: [closedEmbed],
      files: proof.files,
      allowedMentions: { users: mentionIds },
    });
    if (!rekber) {
      await announce(guild, 'returned', { ticket: t });
      await reopenIfAutoClosed(guild);
    }
  }

  // DM pembeli (rekber: kedua pihak) soal hasil transaksinya.
  for (const uid of rekber ? [t.buyerId, t.sellerId] : [t.userId]) {
    const user = await client.users.fetch(uid).catch(() => null);
    if (!user) continue;
    const dm = V.buildDmClosed(guild, cfg, t);
    const dmProof = proofAttachment(t);
    if (status === 'completed' && dmProof.url) dm.embeds[0].setImage(dmProof.url);
    else dm.embeds[0].setImage(null);
    await user.send({ ...dm, files: status === 'completed' ? dmProof.files : [] }).catch(() => {});
  }

  logOrder(guild, t, `🔒 Ditutup oleh <@${t.closedBy}> — ${V.statusLabel(t)}`, { withProof: true });
  refreshPanel();
  refreshLeaderboard();
  return interaction.editReply(`✅ Ticket **${t.id}** ditutup sebagai **${V.statusLabel(t)}**.`);
}

// ══════════════════════ Testimoni pembeli ══════════════════════
async function onTestimonyButton(interaction, ticketId) {
  const t = state.tickets[ticketId];
  if (!t || t.status !== 'completed') return interaction.reply({ content: 'Ticket tidak ditemukan.', flags: EPH });
  if (interaction.user.id !== V.testimonyUserId(t)) {
    return interaction.reply({ content: '⛔ Hanya pembeli di ticket ini yang bisa memberi testimoni.', flags: EPH });
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
  const buyer = await guild.members.fetch(V.testimonyUserId(t)).catch(() => null);
  const proof = proofAttachment(t);
  t.proofUrl = proof.url;
  await channel.send({ ...V.buildTestimony(guild, cfg, t, buyer), files: proof.files });
  t.testimonyPosted = true;
  save();
}

async function onTestimonyModal(interaction, ticketId) {
  const t = state.tickets[ticketId];
  if (!t || interaction.user.id !== V.testimonyUserId(t) || t.testimony || t.testimonyPosted) {
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
  logOrder(interaction.guild, t, `⭐ Testimoni ${rating}/5 dari <@${V.testimonyUserId(t)}>`);
  await interaction.message?.edit({ components: [] }).catch(() => {});
  await interaction.channel
    .send(V.buildTestimonyThanks(interaction.guild, cfg, t, rating, Number(cfg.ticket?.deleteAfterSeconds) || 15))
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
        if (guild) logOrder(guild, t, '⏰ Batas waktu testimoni habis — tanpa ulasan');
      }
      // Hapus channel ticket yang sudah selesai.
      if (t.deleteAt && !t.deleted && t.deleteAt <= now) {
        t.deleted = true;
        save();
        const ch = await client.channels.fetch(t.channelId).catch(() => null);
        if (ch) await ch.delete(`Ticket ${t.id} selesai`).catch(() => {});
        const guild = client.guilds.cache.get(t.guildId);
        // Tunggu log selesai (gambar bukti sudah ter-upload) sebelum file bukti dihapus.
        if (guild) await logOrder(guild, t, '🗑️ Channel ticket dihapus otomatis');
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
    logOrder(channel.guild, t, '🗑️ Channel ticket dihapus manual — otomatis dibatalkan');
    if (kindOf(t) === 'rekber') {
      save();
    } else {
      state.stock += t.amount;
      save();
      await announce(channel.guild, 'returned', { ticket: t });
      await reopenIfAutoClosed(channel.guild);
    }
    refreshPanel();
  } else {
    save();
    logOrder(channel.guild, t, '🗑️ Channel ticket dihapus');
  }
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
      else if (action === 'rbconfirm') await onRekberConfirm(interaction, arg === 'yes');
      else if (action === 'rbagree') await onRekberAgree(interaction, arg);
      else if (action === 'rbfund') await onRekberFund(interaction, arg);
      else if (action === 'rbrecv') await onRekberReceived(interaction, arg);
    } else if (interaction.isStringSelectMenu()) {
      if (action === 'amount') await onAmountSelect(interaction, arg);
    } else if (interaction.isModalSubmit()) {
      if (action === 'rbxmodal') await onRobloxModal(interaction, arg);
      else if (action === 'amountmodal') await onAmountModal(interaction, arg);
      else if (action === 'closemodal') await onCloseModal(interaction, arg);
      else if (action === 'testimodal') await onTestimonyModal(interaction, arg);
      else if (action === 'rbmodal') await onRekberModal(interaction, arg);
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
  setProductsOpen,
  reopenIfAutoClosed,
  closeIfSoldOut,
  announce,
  refreshPanel,
  refreshLeaderboard,
};
