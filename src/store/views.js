const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { color, rupiah, num, fill, ts } = require('./config');
const { state, productState, isProductOpen, kindOf } = require('./state');

const STATUS_LABEL = {
  open: '⏳ Menunggu Pembayaran / Proses',
  completed: '✅ Completed — Produk berhasil dikirim',
  cancelled: '❌ Cancelled — Dibatalkan',
  refund: '💸 Refund — Dana dikembalikan',
};
const REKBER_STATUS = {
  open: '🔄 Transaksi Sedang Berjalan',
  completed: '✅ Completed — Dana dicairkan ke penjual',
  cancelled: '❌ Cancelled — Transaksi dibatalkan',
  refund: '💸 Refund — Dana dikembalikan ke pembeli',
};
const statusLabel = (t) => (kindOf(t) === 'rekber' ? REKBER_STATUS : STATUS_LABEL)[t.status];
const STARS = (n) => '⭐'.repeat(n) + '☆'.repeat(5 - n);

/** Nama toko yang tampil di semua keterangan (store.json → storeName). */
function storeName(cfg, guild) {
  return cfg?.storeName || guild.name;
}

function serverFooter(guild, text) {
  return { text: text || guild.name, iconURL: guild.iconURL({ extension: 'png', size: 128 }) || undefined };
}

function rateOf(cfg, product) {
  return Number(state.rates[product.id]) || Number(product.rate) || 0;
}

// ───────────────────────── Panel utama ─────────────────────────
/** Panel di channel store: hanya judul, keterangan, logo server, dan tombol produk. */
function buildPanel(guild, cfg) {
  const p = cfg.panel || {};
  const name = { name: storeName(cfg, guild) };

  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(fill(p.title || '🛒 {server}', name))
    .setDescription(fill(p.description, name).slice(0, 4096) || null)
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null);
  if (p.bannerImage) embed.setImage(p.bannerImage);

  // Total transaksi & rating (ter-update otomatis setiap ada transaksi / testimoni baru).
  const s = state.stats;
  const avg = s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(1) : '-';
  embed.addFields(
    { name: '🧾 Total Transaksi', value: `\`${num(s.transactions)} transaksi\``, inline: true },
    { name: '🤝 Rekber Sukses', value: `\`${num(s.rekber)} transaksi\``, inline: true },
    { name: '⭐ Rating Pembeli', value: `\`${avg} / 5 (${num(s.ratingCount)} ulasan)\``, inline: true },
  );

  const styles = { robux: ButtonStyle.Success, rekber: ButtonStyle.Primary };
  const buttons = (cfg.products || []).slice(0, 5).map((prod) =>
    new ButtonBuilder()
      .setCustomId(`store:buy:${prod.id}`)
      .setLabel(prod.label)
      .setEmoji(prod.emoji || '🛒')
      .setStyle(styles[prod.type] || ButtonStyle.Secondary)
      .setDisabled(!isProductOpen(prod)),
  );
  return { embeds: [embed], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [] };
}

// ───────────────────────── Info produk (hanya terlihat pembeli) ─────────────────────────
function buildProductInfo(guild, cfg, product) {
  const open = isProductOpen(product);
  const s = state.stats;
  const avg = s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(1) : '-';
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(`${product.emoji || '💎'} ${product.label}`)
    .setDescription(fill(product.description || '', { name: storeName(cfg, guild) }) || null)
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .addFields(
      { name: `💎 Harga ${product.label}`, value: `\`${rupiah(rateOf(cfg, product))} / Robux\``, inline: true },
      { name: '📦 Sisa Stock', value: `\`${num(state.stock)} Robux\``, inline: true },
      { name: '🏪 Status', value: open ? '`🟢 BUKA`' : '`🔴 TUTUP`', inline: true },
      { name: '🧾 Total Transaksi', value: `\`${num(s.transactions)} transaksi\``, inline: true },
      { name: `💎 ${product.label} Terjual`, value: `\`${num(s.robux)} Robux\``, inline: true },
      { name: '⭐ Rating Pembeli', value: `\`${avg} / 5 (${num(s.ratingCount)} ulasan)\``, inline: true },
    );

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`store:order:${product.id}`)
      .setLabel(open ? 'Beli Sekarang' : 'Toko Sedang Tutup')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!open),
  ];
  if (product.terms?.description) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`store:terms:${product.id}`)
        .setLabel(product.terms.button || 'Syarat Pembelian')
        .setEmoji('📌')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
}

/** Syarat sebelum membeli produk (hanya terlihat pembeli). */
function buildProductTerms(guild, cfg, product) {
  const t = product.terms || {};
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color(cfg, 'brand', 0x3498db))
        .setTitle(t.title || `📌 Persyaratan ${product.label}`)
        .setDescription(fill(t.description || '-', { name: storeName(cfg, guild) }).slice(0, 4096)),
    ],
  };
}

// ───────────────────────── Leaderboard ─────────────────────────
function buildLeaderboard(guild, cfg) {
  const medals = ['🥇', '🥈', '🥉'];
  const top = Object.entries(state.spenders)
    .sort((a, b) => b[1].revenue - a[1].revenue || b[1].orders - a[1].orders)
    .slice(0, 10);

  const lines = top.length
    ? top.map(([userId, d], i) => {
        const rank = medals[i] || `\`#${i + 1}\``;
        return `${rank} <@${userId}>\n┗ 💰 **${rupiah(d.revenue)}** • ${num(d.orders)} order`;
      })
    : ['_Belum ada transaksi. Jadilah spender pertama!_ 🚀'];

  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(`🏆 Top 10 Spender Leaderboard | ${storeName(cfg, guild)}`)
    .setDescription(lines.join('\n\n'))
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .addFields(
      { name: '🧾 Total Transaksi', value: `\`${num(state.stats.transactions)}\``, inline: true },
      { name: '👥 Total Pembeli', value: `\`${num(Object.keys(state.spenders).length)}\``, inline: true },
    )
    .setFooter(serverFooter(guild, `${storeName(cfg, guild)} • Diperbarui otomatis`))
    .setTimestamp(new Date());
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// ───────────────────────── Konfirmasi akun Roblox ─────────────────────────
function buildConfirmAccount(cfg, roblox) {
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle('🔍 Confirm Your Roblox Account')
    .setDescription('Is this really your Roblox account?')
    .addFields(
      { name: '👤 Username', value: `\`${roblox.name}\``, inline: true },
      { name: '✨ Display Name', value: `\`${roblox.displayName}\``, inline: true },
      { name: '🆔 User ID', value: `\`${roblox.id}\``, inline: true },
    )
    .setURL(`https://www.roblox.com/users/${roblox.id}/profile`);
  if (roblox.created) embed.addFields({ name: '📅 Akun Dibuat', value: ts(Date.parse(roblox.created), 'D'), inline: true });
  if (roblox.avatar) embed.setThumbnail(roblox.avatar);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('store:confirm:yes').setLabel('Ya, Lanjutkan').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('store:confirm:no').setLabel('Tidak, Batalkan').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

// ───────────────────────── Pilih jumlah Robux ─────────────────────────
function buildAmountPicker(cfg, product, roblox) {
  const rate = rateOf(cfg, product);
  const max = Math.min(Number(product.maxAmount) || 5000, state.stock);
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(`${product.emoji || '💎'} Pilih Jumlah ${product.label}`)
    .setDescription(
      `Akun Roblox: **${roblox.displayName}** (\`@${roblox.name}\`)\n\n` +
        `💱 Rate: **${rupiah(rate)} / Robux**\n📦 Sisa stock: **${num(state.stock)} Robux**\n\n` +
        `Pilih jumlah di bawah, atau pilih **✏️ Jumlah Lain** untuk memasukkan jumlah sendiri ` +
        `(${num(product.minAmount || 1)} – ${num(Math.max(max, 0))} Robux).`,
    );
  if (roblox.avatar) embed.setThumbnail(roblox.avatar);

  const options = (product.presets || []).slice(0, 24).map((amount) => ({
    label: `${num(amount)} Robux`,
    description: `${rupiah(amount * rate)}${amount > state.stock ? ' • stock tidak cukup' : ''}`,
    value: String(amount),
    emoji: amount > state.stock ? '⛔' : '💎',
  }));
  options.push({ label: 'Jumlah Lain', description: `Maksimal ${num(product.maxAmount || 5000)} Robux`, value: 'custom', emoji: '✏️' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`store:amount:${product.id}`)
    .setPlaceholder('💎 Pilih jumlah Robux...')
    .addOptions(options);
  const cancel = new ButtonBuilder().setCustomId('store:confirm:no').setLabel('Batalkan').setEmoji('✖️').setStyle(ButtonStyle.Secondary);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(cancel)],
  };
}

// ───────────────────────── Isi ticket ─────────────────────────
function buildTicketMessage(guild, cfg, t) {
  if (kindOf(t) === 'rekber') return buildRekberTicket(guild, cfg, t);
  const statusColor = {
    open: color(cfg, 'brand', 0x3498db),
    completed: color(cfg, 'open', 0x2ecc71),
    cancelled: color(cfg, 'closed', 0xe74c3c),
    refund: color(cfg, 'refund', 0xe67e22),
  }[t.status];

  const info = new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`🧾 Detail Pesanan • ${t.id}`)
    .setDescription(`Halo <@${t.userId}>, terima kasih sudah berbelanja di **${storeName(cfg, guild)}**! 💜`)
    .addFields(
      { name: '👤 Pembeli', value: `<@${t.userId}>`, inline: true },
      {
        name: '🎮 Akun Roblox',
        value: `[${t.roblox.displayName}](https://www.roblox.com/users/${t.roblox.id}/profile)\n\`@${t.roblox.name}\``,
        inline: true,
      },
      { name: '🆔 Roblox ID', value: `\`${t.roblox.id}\``, inline: true },
      { name: '📦 Produk', value: `\`${t.productLabel}\``, inline: true },
      { name: '💎 Jumlah', value: `\`${num(t.amount)} Robux\``, inline: true },
      { name: '💱 Rate', value: `\`${rupiah(t.rate)} / Robux\``, inline: true },
      { name: '💰 Total Bayar', value: `## ${rupiah(t.price)}`, inline: false },
      { name: '📌 Status', value: `**${STATUS_LABEL[t.status]}**`, inline: true },
      { name: '🕒 Dibuat', value: ts(t.createdAt, 'f'), inline: true },
    )
    .setFooter(serverFooter(guild, `${storeName(cfg, guild)} • Ticket ${t.id}`))
    .setTimestamp(t.closedAt || t.createdAt);
  if (t.roblox.avatar) info.setThumbnail(t.roblox.avatar);
  if (t.closedAt) info.addFields({ name: '🔒 Ditutup', value: `${ts(t.closedAt, 'f')} oleh <@${t.closedBy}>`, inline: true });

  const embeds = [info];
  if (t.status === 'open') {
    const pay = new EmbedBuilder()
      .setColor(color(cfg, 'brand', 0x3498db))
      .setTitle(cfg.payment?.title || '💳 Cara Pembayaran')
      .setDescription(fill(cfg.payment?.description || 'Silakan tunggu admin.', { name: storeName(cfg, guild) }));
    if (cfg.payment?.image) pay.setImage(cfg.payment.image);
    embeds.push(pay);
  }

  const components =
    t.status === 'open'
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`store:close:${t.id}`)
              .setLabel('Tutup Ticket')
              .setEmoji('🔒')
              .setStyle(ButtonStyle.Danger),
          ),
        ]
      : [];
  return { embeds, components };
}

// ───────────────────────── DM ke pembeli ─────────────────────────
function buildDmCreated(guild, cfg, t, channelUrl) {
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle('🎫 Ticket Order Berhasil Dibuat')
    .setDescription(
      `Ticket order kamu di **${storeName(cfg, guild)}** sudah berhasil dibuat.\n\n` +
        `Silakan lanjutkan ke channel ticket kamu untuk menyelesaikan pembayaran:\n${channelUrl}`,
    )
    .addFields(
      { name: '📦 Produk', value: `\`${t.productLabel} • ${num(t.amount)} Robux\``, inline: true },
      { name: '🎫 Ticket ID', value: `\`${t.id}\``, inline: true },
      { name: '💰 Total Bayar', value: `\`${rupiah(t.price)}\``, inline: true },
    )
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .setFooter(serverFooter(guild, storeName(cfg, guild)))
    .setTimestamp(new Date());
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Buka Ticket').setEmoji('🎫').setURL(channelUrl),
  );
  return { embeds: [embed], components: [row] };
}

function buildDmClosed(guild, cfg, t) {
  if (kindOf(t) === 'rekber') return buildRekberDmClosed(guild, cfg, t);
  const titles = {
    completed: '✅ Pesanan Kamu Sudah Selesai',
    cancelled: '❌ Pesanan Kamu Dibatalkan',
    refund: '💸 Pesanan Kamu Di-refund',
  };
  const desc = {
    completed: `Robux kamu sudah berhasil dikirim. Terima kasih sudah berbelanja di **${storeName(cfg, guild)}**! 💜\nJangan lupa beri testimoni di ticket kamu ya ⭐`,
    cancelled: `Pesanan kamu di **${storeName(cfg, guild)}** telah dibatalkan.`,
    refund: `Dana pesanan kamu di **${storeName(cfg, guild)}** telah dikembalikan.`,
  };
  const embed = new EmbedBuilder()
    .setColor(t.status === 'completed' ? color(cfg, 'open', 0x2ecc71) : color(cfg, 'refund', 0xe67e22))
    .setTitle(titles[t.status])
    .setDescription(desc[t.status] + (t.note ? `\n\n📝 Catatan admin: ${t.note}` : ''))
    .addFields(
      { name: '🎫 Ticket ID', value: `\`${t.id}\``, inline: true },
      { name: '📦 Produk', value: `\`${t.productLabel} • ${num(t.amount)} Robux\``, inline: true },
    )
    .setFooter(serverFooter(guild, storeName(cfg, guild)))
    .setTimestamp(new Date());
  if (t.proofUrl && t.status === 'completed') embed.setImage(t.proofUrl);
  return { embeds: [embed] };
}

// ───────────────────────── Testimoni ─────────────────────────
/** Siapa yang diminta memberi testimoni: pembeli Robux / pihak pembeli di rekber. */
const testimonyUserId = (t) => (kindOf(t) === 'rekber' ? t.buyerId : t.userId);

function buildTestimonyPrompt(guild, cfg, t) {
  if (kindOf(t) === 'rekber') return buildRekberTestimonyPrompt(guild, cfg, t);
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle('⭐ Bagaimana Pengalaman Belanjamu?')
    .setDescription(
      `<@${t.userId}>, pesananmu sudah selesai! 🎉\n\nBantu kami jadi lebih baik dengan memberikan **rating & testimoni** ` +
        `lewat tombol di bawah. Testimonimu akan ditampilkan di channel testimoni.`,
    )
    .setFooter(serverFooter(guild, storeName(cfg, guild)));
  if (t.proofUrl) embed.setImage(t.proofUrl);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`store:testi:${t.id}`).setLabel('Beri Testimoni').setEmoji('⭐').setStyle(ButtonStyle.Primary),
  );
  return { content: `<@${t.userId}>`, embeds: [embed], components: [row], allowedMentions: { users: [t.userId] } };
}

function buildTestimony(guild, cfg, t, buyer) {
  if (kindOf(t) === 'rekber') return buildRekberTestimony(guild, cfg, t, buyer);
  const r = t.testimony;
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(`🧾 Testimoni #${String(state.stats.testimonies).padStart(4, '0')}`)
    .setDescription(
      r
        ? `**Rating:** ${STARS(r.rating)}  **${r.rating}/5**\n\n>>> ${r.comment}`
        : '✅ **Transaksi Berhasil**\n\n_Pembeli tidak memberikan ulasan._',
    )
    .addFields(
      { name: '👤 Pembeli', value: `<@${t.userId}>`, inline: true },
      { name: '📦 Produk', value: `\`${t.productLabel}\``, inline: true },
      { name: '💎 Jumlah', value: `\`${num(t.amount)} Robux\``, inline: true },
      { name: '🎮 Roblox', value: `\`@${t.roblox.name}\``, inline: true },
      { name: '💰 Total', value: `\`${rupiah(t.price)}\``, inline: true },
      { name: '🎫 Ticket', value: `\`${t.id}\``, inline: true },
    )
    .setThumbnail(buyer?.displayAvatarURL({ extension: 'png', size: 256 }) || t.roblox.avatar || null)
    .setFooter(serverFooter(guild, storeName(cfg, guild)))
    .setTimestamp(new Date());
  if (t.proofUrl) embed.setImage(t.proofUrl);
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// ───────────────────────── Pengumuman di channel stock ─────────────────────────
/**
 * kind: 'open' | 'close' → extra.products = daftar produk yang dibuka / ditutup.
 *       'stock' | 'returned' → khusus Robux.
 */
function buildStoreAnnouncement(guild, cfg, kind, extra = {}) {
  const panelLink = state.panel ? `https://discord.com/channels/${guild.id}/${state.panel.channelId}` : null;
  const robux = (cfg.products || []).find((x) => x.type === 'robux');
  const rate = robux ? rateOf(cfg, robux) : 0;
  const name = storeName(cfg, guild);
  const e = new EmbedBuilder().setFooter(serverFooter(guild, name)).setTimestamp(new Date());
  const products = extra.products || [];
  const single = products.length === 1 ? products[0] : null;
  const label = single ? single.label : name;
  const listText = products.map((p) => `${p.emoji || '•'} **${p.label}**`).join('\n');
  const robuxIncluded = products.some((p) => p.type === 'robux');

  if (kind === 'open') {
    e.setColor(color(cfg, 'open', 0x2ecc71))
      .setTitle(`🟢 ${label} Sudah Dibuka!`)
      .setDescription(
        (single
          ? `**${single.label}** di **${name}** sekarang **BUKA** dan siap menerima pesanan! 🎉`
          : `**${name}** sekarang **BUKA** dan siap menerima pesanan! 🎉\n\n${listText}`) +
          (panelLink ? `\n\n🛒 Order sekarang: ${panelLink}` : ''),
      );
    if (robuxIncluded) {
      e.addFields(
        { name: '📦 Stock Robux', value: `\`${num(state.stock)} Robux\``, inline: true },
        { name: '💱 Rate', value: `\`${rupiah(rate)} / Robux\``, inline: true },
      );
    }
  } else if (kind === 'close') {
    e.setColor(color(cfg, 'closed', 0xe74c3c))
      .setTitle(`🔴 ${label} Ditutup`)
      .setDescription(
        `${extra.reason || (single ? `**${single.label}** di **${name}** saat ini **TUTUP** dan tidak menerima pesanan baru.` : `**${name}** saat ini **TUTUP** dan tidak menerima pesanan baru.\n\n${listText}`)}\n\n` +
          'Pantau terus channel ini untuk info buka berikutnya. Terima kasih! 💜',
      );
    if (robuxIncluded) e.addFields({ name: '📦 Sisa Stock Robux', value: `\`${num(state.stock)} Robux\``, inline: true });
  } else if (kind === 'stock') {
    e.setColor(color(cfg, 'brand', 0x3498db))
      .setTitle('📦 Update Stock Robux')
      .setDescription(extra.text || 'Stock Robux telah diperbarui.')
      .addFields(
        { name: '📦 Stock Sekarang', value: `\`${num(state.stock)} Robux\``, inline: true },
        { name: '🏪 Status', value: robux && isProductOpen(robux) ? '`🟢 BUKA`' : '`🔴 TUTUP`', inline: true },
      );
  } else if (kind === 'returned') {
    const t = extra.ticket;
    e.setColor(color(cfg, 'refund', 0xe67e22))
      .setTitle(t.status === 'refund' ? '💸 Pesanan Di-refund — Stock Dikembalikan' : '❌ Pesanan Dibatalkan — Stock Dikembalikan')
      .setDescription(`Ticket **${t.id}** ditutup dengan status **${STATUS_LABEL[t.status]}**.`)
      .addFields(
        { name: '♻️ Stock Kembali', value: `\`+${num(t.amount)} Robux\``, inline: true },
        { name: '📦 Stock Sekarang', value: `\`${num(state.stock)} Robux\``, inline: true },
        { name: '🏪 Status', value: robux && isProductOpen(robux) ? '`🟢 BUKA`' : '`🔴 TUTUP`', inline: true },
      );
  }
  return e;
}

// ═════════════════════════════════════ REKBER ═════════════════════════════════════
/** Hitung fee rekber dari tabel fee di store.json. */
function rekberFee(product, nominal) {
  const tiers = product.feeTiers || [];
  const tier = tiers.find((x) => x.upTo == null || nominal <= x.upTo) || tiers.at(-1) || { fee: 0 };
  const fee = tier.percent != null ? Math.ceil((nominal * tier.percent) / 100) : Number(tier.fee) || 0;
  const byBuyer = (product.feePaidBy || 'pembeli') !== 'penjual';
  return { fee, buyerPays: byBuyer ? nominal + fee : nominal, sellerGets: byBuyer ? nominal : nominal - fee, byBuyer };
}

function feeTable(product) {
  return (product.feeTiers || [])
    .map((x) => {
      const range = x.upTo == null ? 'Di atas itu' : `≤ ${rupiah(x.upTo)}`;
      const fee = x.percent != null ? `${x.percent}% dari nominal` : rupiah(x.fee);
      return `▸ ${range} — **${fee}**`;
    })
    .join('\n');
}

function buildRekberInfo(guild, cfg, product) {
  const open = isProductOpen(product);
  const s = state.stats;
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(`${product.emoji || '🤝'} ${product.label} — Rekening Bersama`)
    .setDescription(fill(product.description || '', { name: storeName(cfg, guild) }) || null)
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .addFields(
      { name: '🧾 Fee Rekber', value: feeTable(product) || '-', inline: false },
      {
        name: '💵 Nominal Transaksi',
        value: `\`${rupiah(product.minNominal || 0)} – ${rupiah(product.maxNominal || 0)}\``,
        inline: true,
      },
      { name: '💳 Fee Ditanggung', value: `\`${(product.feePaidBy || 'pembeli') === 'penjual' ? 'Penjual' : 'Pembeli'}\``, inline: true },
      { name: '🏪 Status', value: open ? '`🟢 BUKA`' : '`🔴 TUTUP`', inline: true },
      { name: '🤝 Rekber Sukses', value: `\`${num(s.rekber)} transaksi\``, inline: true },
      { name: '🛡️ Dana Diamankan', value: `\`${rupiah(s.rekberVolume)}\``, inline: true },
    );

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`store:order:${product.id}`)
      .setLabel(open ? 'Buat Ticket Rekber' : 'Rekber Sedang Tutup')
      .setEmoji('🤝')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!open),
  ];
  if (product.terms?.description) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`store:terms:${product.id}`)
        .setLabel(product.terms.button || 'Syarat & Ketentuan')
        .setEmoji('📌')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
}

function rekberMoneyFields(t) {
  return [
    { name: '💵 Nominal Transaksi', value: `\`${rupiah(t.nominal)}\``, inline: true },
    { name: '🧾 Fee Rekber', value: `\`${rupiah(t.fee)}\`\n┗ ditanggung ${t.feeByBuyer ? 'pembeli' : 'penjual'}`, inline: true },
    { name: '\u200b', value: '\u200b', inline: true },
    { name: '💳 Transfer Pembeli ke Admin', value: `## ${rupiah(t.buyerPays)}`, inline: true },
    { name: '💰 Dana Diterima Penjual', value: `## ${rupiah(t.sellerGets)}`, inline: true },
  ];
}

/** Ringkasan sebelum ticket rekber dibuat (hanya terlihat pembuat). */
function buildRekberConfirm(guild, cfg, d) {
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle('🤝 Konfirmasi Transaksi Rekber')
    .setDescription('Periksa kembali detail transaksi di bawah. Pastikan **pihak lawan** dan **nominal** sudah benar sebelum membuat ticket.')
    .addFields(
      { name: '🛒 Pembeli', value: `<@${d.buyerId}>`, inline: true },
      { name: '🏷️ Penjual', value: `<@${d.sellerId}>`, inline: true },
      { name: '📦 Objek Transaksi', value: d.item.slice(0, 1024), inline: false },
      ...rekberMoneyFields(d),
    );
  if (d.detail) embed.addFields({ name: '📝 Detail', value: d.detail.slice(0, 1024) });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('store:rbconfirm:yes').setLabel('Ya, Buat Ticket Rekber').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('store:rbconfirm:no').setLabel('Batalkan').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function rekberSteps(t) {
  const st = t.stage || {};
  const done = t.status === 'completed';
  const mark = (ok, current) => (ok ? '✅' : current ? '⏳' : '▫️');
  const rows = [
    [st.agreed, `<@${t.partnerId}> menyetujui transaksi`],
    [st.funded, `Pembeli transfer **${rupiah(t.buyerPays)}** ke admin & admin konfirmasi dana`],
    [st.received, 'Penjual mengirim barang / jasa & pembeli konfirmasi sudah diterima'],
    [done, `Admin mencairkan **${rupiah(t.sellerGets)}** ke penjual`],
  ];
  const currentIdx = rows.findIndex((r) => !r[0]);
  return rows.map((r, i) => `${mark(r[0], t.status === 'open' && i === currentIdx)} \`${i + 1}\` ${r[1]}`).join('\n');
}

function buildRekberTicket(guild, cfg, t) {
  const product = (cfg.products || []).find((p) => p.id === t.productId) || {};
  const st = t.stage || {};
  const statusColor = {
    open: color(cfg, 'brand', 0x3498db),
    completed: color(cfg, 'open', 0x2ecc71),
    cancelled: color(cfg, 'closed', 0xe74c3c),
    refund: color(cfg, 'refund', 0xe67e22),
  }[t.status];

  const main = new EmbedBuilder()
    .setColor(statusColor)
    .setAuthor({ name: `${storeName(cfg, guild)} • Rekening Bersama`, iconURL: guild.iconURL({ size: 128 }) || undefined })
    .setTitle(`🤝 Ticket Rekber • ${t.id}`)
    .setDescription(
      `Transaksi antara <@${t.buyerId}> dan <@${t.sellerId}> kini **diamankan oleh ${storeName(cfg, guild)}**. 🛡️\n` +
        'Dana pembeli ditahan admin dan **baru diteruskan ke penjual setelah barang / jasa diterima**.',
    )
    .addFields(
      { name: '🛒 Pembeli', value: `<@${t.buyerId}>`, inline: true },
      { name: '🏷️ Penjual', value: `<@${t.sellerId}>`, inline: true },
      { name: '🙋 Dibuat oleh', value: `<@${t.userId}>`, inline: true },
      { name: '📦 Objek Transaksi', value: t.item.slice(0, 1024), inline: false },
    );
  if (t.detail) main.addFields({ name: '📝 Detail', value: t.detail.slice(0, 1024), inline: false });
  main
    .addFields(...rekberMoneyFields(t))
    .addFields(
      { name: '📍 Progress Transaksi', value: rekberSteps(t), inline: false },
      { name: '📌 Status', value: `**${REKBER_STATUS[t.status]}**`, inline: true },
      { name: '🕒 Dibuat', value: ts(t.createdAt, 'f'), inline: true },
    )
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .setFooter(serverFooter(guild, `${storeName(cfg, guild)} • Rekber ${t.id}`))
    .setTimestamp(t.closedAt || t.createdAt);
  if (t.closedAt) main.addFields({ name: '🔒 Ditutup', value: `${ts(t.closedAt, 'f')} oleh <@${t.closedBy}>`, inline: true });

  const embeds = [main];
  if (t.status === 'open' && product.guide) {
    embeds.push(
      new EmbedBuilder()
        .setColor(color(cfg, 'brand', 0x3498db))
        .setTitle(product.guideTitle || '🛡️ Alur Rekber')
        .setDescription(fill(product.guide, { name: storeName(cfg, guild) }).slice(0, 4096)),
    );
  }

  const components =
    t.status === 'open'
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`store:rbagree:${t.id}`)
              .setLabel(st.agreed ? 'Disetujui' : 'Setujui Transaksi')
              .setEmoji('🤝')
              .setStyle(ButtonStyle.Success)
              .setDisabled(Boolean(st.agreed)),
            new ButtonBuilder()
              .setCustomId(`store:rbfund:${t.id}`)
              .setLabel(st.funded ? 'Dana Diterima' : 'Konfirmasi Dana (Admin)')
              .setEmoji('💰')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(!st.agreed || Boolean(st.funded)),
            new ButtonBuilder()
              .setCustomId(`store:rbrecv:${t.id}`)
              .setLabel(st.received ? 'Barang Diterima' : 'Barang Sudah Diterima')
              .setEmoji('📦')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(!st.funded || Boolean(st.received)),
            new ButtonBuilder().setCustomId(`store:close:${t.id}`).setLabel('Tutup Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
          ),
        ]
      : [];
  return { embeds, components };
}

function buildRekberDmCreated(guild, cfg, t, channelUrl, forUserId) {
  const role = forUserId === t.buyerId ? 'Pembeli' : 'Penjual';
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle('🤝 Ticket Rekber Berhasil Dibuat')
    .setDescription(
      `Kamu terdaftar sebagai **${role}** dalam transaksi rekber di **${storeName(cfg, guild)}**.\n\n` +
        `Silakan lanjutkan ke channel ticket rekber untuk memproses transaksi:\n${channelUrl}`,
    )
    .addFields(
      { name: '🤝 Ticket ID', value: `\`${t.id}\``, inline: true },
      { name: '📦 Objek', value: `\`${t.item.slice(0, 80)}\``, inline: true },
      { name: '💵 Nominal', value: `\`${rupiah(t.nominal)}\``, inline: true },
    )
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .setFooter(serverFooter(guild, storeName(cfg, guild)))
    .setTimestamp(new Date());
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Buka Ticket Rekber').setEmoji('🤝').setURL(channelUrl),
  );
  return { embeds: [embed], components: [row] };
}

function buildRekberDmClosed(guild, cfg, t) {
  const name = storeName(cfg, guild);
  const titles = {
    completed: '✅ Transaksi Rekber Selesai',
    cancelled: '❌ Transaksi Rekber Dibatalkan',
    refund: '💸 Transaksi Rekber Di-refund',
  };
  const desc = {
    completed: `Transaksi rekber **${t.id}** telah selesai dan dana sudah dicairkan ke penjual. Terima kasih telah mempercayakan transaksimu kepada **${name}**! 🛡️`,
    cancelled: `Transaksi rekber **${t.id}** di **${name}** telah dibatalkan.`,
    refund: `Transaksi rekber **${t.id}** di-refund — dana telah dikembalikan ke pembeli.`,
  };
  const embed = new EmbedBuilder()
    .setColor(t.status === 'completed' ? color(cfg, 'open', 0x2ecc71) : color(cfg, 'refund', 0xe67e22))
    .setTitle(titles[t.status])
    .setDescription(desc[t.status] + (t.note ? `\n\n📝 Catatan admin: ${t.note}` : ''))
    .addFields(
      { name: '🤝 Ticket ID', value: `\`${t.id}\``, inline: true },
      { name: '📦 Objek', value: `\`${t.item.slice(0, 80)}\``, inline: true },
      { name: '💵 Nominal', value: `\`${rupiah(t.nominal)}\``, inline: true },
    )
    .setFooter(serverFooter(guild, name))
    .setTimestamp(new Date());
  if (t.proofUrl && t.status === 'completed') embed.setImage(t.proofUrl);
  return { embeds: [embed] };
}

function buildRekberTestimonyPrompt(guild, cfg, t) {
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle('⭐ Bagaimana Pengalaman Rekber-mu?')
    .setDescription(
      `<@${t.buyerId}>, transaksi rekber **${t.id}** sudah selesai! 🎉\n\n` +
        'Bantu kami jadi lebih baik dengan memberikan **rating & testimoni** lewat tombol di bawah.',
    )
    .setFooter(serverFooter(guild, storeName(cfg, guild)));
  if (t.proofUrl) embed.setImage(t.proofUrl);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`store:testi:${t.id}`).setLabel('Beri Testimoni').setEmoji('⭐').setStyle(ButtonStyle.Primary),
  );
  return { content: `<@${t.buyerId}>`, embeds: [embed], components: [row], allowedMentions: { users: [t.buyerId] } };
}

function buildRekberTestimony(guild, cfg, t, buyer) {
  const r = t.testimony;
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(`🧾 Testimoni #${String(state.stats.testimonies).padStart(4, '0')}`)
    .setDescription(
      r
        ? `**Rating:** ${STARS(r.rating)}  **${r.rating}/5**\n\n>>> ${r.comment}`
        : '✅ **Rekber Berhasil**\n\n_Pembeli tidak memberikan ulasan._',
    )
    .addFields(
      { name: '🤝 Layanan', value: '`Rekber`', inline: true },
      { name: '🛒 Pembeli', value: `<@${t.buyerId}>`, inline: true },
      { name: '🏷️ Penjual', value: `<@${t.sellerId}>`, inline: true },
      { name: '📦 Objek', value: `\`${t.item.slice(0, 100)}\``, inline: true },
      { name: '💵 Nominal', value: `\`${rupiah(t.nominal)}\``, inline: true },
      { name: '🎫 Ticket', value: `\`${t.id}\``, inline: true },
    )
    .setThumbnail(buyer?.displayAvatarURL({ extension: 'png', size: 256 }) || null)
    .setFooter(serverFooter(guild, storeName(cfg, guild)))
    .setTimestamp(new Date());
  if (t.proofUrl) embed.setImage(t.proofUrl);
  return { embeds: [embed], allowedMentions: { parse: [] } };
}


/**
 * Embed pemberitahuan setiap langkah rekber (dikirim di dalam ticket).
 * step: 'invite' | 'agreed' | 'funded' | 'received'
 */
function buildRekberStep(guild, cfg, t, step) {
  const name = storeName(cfg, guild);
  const e = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setFooter(serverFooter(guild, `${name} • Rekber ${t.id}`))
    .setTimestamp(new Date());
  let ping = [];

  if (step === 'invite') {
    const role = t.partnerId === t.buyerId ? '🛒 Pembeli' : '🏷️ Penjual';
    ping = [t.partnerId];
    e.setTitle('📨 Undangan Transaksi Rekber')
      .setDescription(
        `Halo <@${t.partnerId}>, kamu diundang oleh <@${t.userId}> untuk melakukan transaksi melalui layanan **Rekber ${name}**. 🛡️\n\n` +
          'Mohon periksa kembali seluruh detail transaksi di atas dengan teliti. Apabila semuanya sudah **sesuai kesepakatan**, ' +
          'klik **🤝 Setujui Transaksi** untuk memulai proses rekber.',
      )
      .addFields(
        { name: '🎭 Peranmu', value: `\`${role.replace(/^\S+\s/, '')}\``, inline: true },
        { name: '📦 Objek', value: `\`${t.item.slice(0, 80)}\``, inline: true },
        { name: '💵 Nominal', value: `\`${rupiah(t.nominal)}\``, inline: true },
        { name: '⏭️ Langkah Selanjutnya', value: `<@${t.partnerId}> menyetujui transaksi.` },
      );
  } else if (step === 'agreed') {
    ping = [t.buyerId];
    e.setTitle('🤝 Transaksi Resmi Disetujui')
      .setDescription(
        `<@${t.partnerId}> telah **menyetujui** transaksi ini. Kesepakatan kini **resmi berjalan** dan diawasi penuh oleh **${name}**. ✨`,
      )
      .addFields(
        { name: '📍 Progress', value: '`✅ Disetujui` ➜ `⏳ Pembayaran` ➜ `▫️ Pengiriman` ➜ `▫️ Pencairan`' },
        {
          name: '💳 Langkah Selanjutnya — Pembeli',
          value:
            `<@${t.buyerId}>, silakan transfer sebesar **${rupiah(t.buyerPays)}** ke rekening admin sesuai instruksi, ` +
            'lalu kirimkan **bukti transfer** di ticket ini.',
        },
        { name: '⚠️ Penting', value: '**Jangan** mentransfer dana langsung ke penjual. Seluruh dana wajib melalui admin.' },
      );
  } else if (step === 'funded') {
    ping = [t.sellerId, t.buyerId];
    e.setTitle('💰 Dana Telah Diamankan')
      .setDescription(
        `Admin <@${t.stage.fundedBy}> telah mengonfirmasi bahwa dana sebesar **${rupiah(t.buyerPays)}** dari <@${t.buyerId}> ` +
          `**sudah diterima** dan kini **ditahan dengan aman** oleh **${name}**. 🛡️`,
      )
      .addFields(
        { name: '📍 Progress', value: '`✅ Disetujui` ➜ `✅ Pembayaran` ➜ `⏳ Pengiriman` ➜ `▫️ Pencairan`' },
        {
          name: '📦 Langkah Selanjutnya — Penjual',
          value: `<@${t.sellerId}>, silakan kirimkan barang / jasa kepada pembeli sesuai kesepakatan dan lampirkan **bukti pengiriman** di ticket ini.`,
        },
        {
          name: '🔔 Untuk Pembeli',
          value: `<@${t.buyerId}>, klik **📦 Barang Sudah Diterima** hanya setelah barang / jasa **benar-benar kamu terima** dan sesuai kesepakatan.`,
        },
      );
  } else if (step === 'received') {
    ping = [t.sellerId];
    e.setColor(color(cfg, 'open', 0x2ecc71))
      .setTitle('📦 Barang Telah Diterima')
      .setDescription(
        `<@${t.buyerId}> telah mengonfirmasi bahwa barang / jasa **diterima dengan baik** dan sesuai kesepakatan. 🎉`,
      )
      .addFields(
        { name: '📍 Progress', value: '`✅ Disetujui` ➜ `✅ Pembayaran` ➜ `✅ Pengiriman` ➜ `⏳ Pencairan`' },
        {
          name: '🏦 Langkah Terakhir — Admin',
          value: `Admin akan segera mencairkan dana sebesar **${rupiah(t.sellerGets)}** kepada <@${t.sellerId}>, lalu menutup ticket ini.`,
        },
      );
  }
  return {
    content: ping.map((id) => `<@${id}>`).join(' ') || undefined,
    embeds: [e],
    allowedMentions: { users: ping },
  };
}

/** Ucapan terima kasih setelah pembeli memberi testimoni. */
function buildTestimonyThanks(guild, cfg, t, rating, seconds) {
  const uid = testimonyUserId(t);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color(cfg, 'brand', 0x3498db))
        .setTitle('💜 Terima Kasih atas Testimonimu!')
        .setDescription(
          `<@${uid}>, rating ${STARS(rating)} **${rating}/5** darimu sudah kami terima dan kini tampil di channel testimoni.\n\n` +
            `Dukunganmu sangat berarti bagi **${storeName(cfg, guild)}**. Sampai jumpa di transaksi berikutnya! ✨`,
        )
        .addFields({ name: '🔒 Ticket Ditutup Otomatis', value: `Channel ini akan dihapus dalam **${seconds} detik**.` })
        .setFooter(serverFooter(guild, storeName(cfg, guild)))
        .setTimestamp(new Date()),
    ],
    allowedMentions: { parse: [] },
  };
}


// ───────────────────────── Log order (channel log admin) ─────────────────────────
function duration(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam ${m % 60} menit`;
  return `${Math.floor(h / 24)} hari ${h % 24} jam`;
}

/** Samarkan username Roblox untuk log publik: Builderman → Bu******an */
function maskName(n) {
  const str = String(n || '');
  if (str.length <= 4) return `${str[0] || ''}${'*'.repeat(Math.max(str.length - 1, 0))}`;
  return `${str.slice(0, 2)}${'*'.repeat(str.length - 4)}${str.slice(-2)}`;
}

const PUBLIC_STATUS = {
  robux: { open: '⏳ Sedang Diproses', completed: '✅ Selesai', cancelled: '❌ Dibatalkan', refund: '💸 Refund' },
  rekber: { open: '🔄 Sedang Berjalan', completed: '✅ Selesai', cancelled: '❌ Dibatalkan', refund: '💸 Refund' },
};

/**
 * Log order PUBLIK — 1 pesan per ticket, di-edit otomatis setiap ada perubahan.
 * Tidak menampilkan catatan admin, nama admin, maupun link ticket. Detail sensitif bisa diatur
 * lewat store.json → publicLog.
 */
function buildOrderLog(guild, cfg, t) {
  const rekber = kindOf(t) === 'rekber';
  const pl = { showBuyer: true, maskRoblox: true, showPrice: true, showRekberItem: false, ...(cfg.publicLog || {}) };
  const statusColor = {
    open: color(cfg, 'brand', 0x3498db),
    completed: color(cfg, 'open', 0x2ecc71),
    cancelled: color(cfg, 'closed', 0xe74c3c),
    refund: color(cfg, 'refund', 0xe67e22),
  }[t.status];
  const name = storeName(cfg, guild);
  const pub = PUBLIC_STATUS[rekber ? 'rekber' : 'robux'][t.status];

  const e = new EmbedBuilder()
    .setColor(statusColor)
    .setAuthor({ name: `${name} • ${rekber ? 'Rekber Log' : 'Order Log'}`, iconURL: guild.iconURL({ size: 128 }) || undefined })
    .setTitle(`${rekber ? '🤝' : '🧾'} ${t.id}  •  ${pub}`)
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .setFooter(serverFooter(guild, name))
    .setTimestamp(t.closedAt || t.createdAt);

  if (rekber) {
    if (pl.showBuyer) {
      e.addFields(
        { name: '🛒 Pembeli', value: `<@${t.buyerId}>`, inline: true },
        { name: '🏷️ Penjual', value: `<@${t.sellerId}>`, inline: true },
      );
    }
    e.addFields({ name: '🛡️ Layanan', value: '`Rekber`', inline: true });
    if (pl.showRekberItem) e.addFields({ name: '📦 Objek', value: `\`${t.item.slice(0, 100)}\``, inline: true });
    if (pl.showPrice) e.addFields({ name: '💵 Nominal', value: `\`${rupiah(t.nominal)}\``, inline: true });
  } else {
    if (pl.showBuyer) e.addFields({ name: '👤 Pembeli', value: `<@${t.userId}>`, inline: true });
    e.addFields(
      { name: '📦 Produk', value: `\`${t.productLabel}\``, inline: true },
      { name: '💎 Jumlah', value: `\`${num(t.amount)} Robux\``, inline: true },
      { name: '💱 Rate', value: `\`${rupiah(t.rate)} / Robux\``, inline: true },
    );
    if (pl.showPrice) e.addFields({ name: '💰 Total', value: `\`${rupiah(t.price)}\``, inline: true });
    e.addFields({ name: '🎮 Akun Roblox', value: `\`@${pl.maskRoblox ? maskName(t.roblox.name) : t.roblox.name}\``, inline: true });
  }

  e.addFields({ name: '📌 Status', value: `**${pub}**`, inline: false }, { name: '🕒 Order Masuk', value: ts(t.createdAt, 'f'), inline: true });
  if (t.closedAt) {
    e.addFields(
      { name: t.status === 'completed' ? '✅ Selesai Pada' : '🔒 Ditutup Pada', value: ts(t.closedAt, 'f'), inline: true },
      { name: '⚡ Waktu Proses', value: `\`${duration(t.closedAt - t.createdAt)}\``, inline: true },
    );
  }
  if (t.testimony) e.addFields({ name: '⭐ Rating Pembeli', value: `${STARS(t.testimony.rating)}  **${t.testimony.rating}/5**` });

  const timeline = (t.log || []).slice(-10).map((x) => `${ts(x.at, 't')} ┃ ${x.text}`).join('\n');
  if (timeline) e.addFields({ name: '🗂️ Progress', value: timeline.slice(0, 1024) });

  return { embeds: [e], components: [], allowedMentions: { parse: [] } };
}

module.exports = {
  STATUS_LABEL,
  REKBER_STATUS,
  statusLabel,
  testimonyUserId,
  rekberFee,
  buildRekberInfo,
  buildRekberConfirm,
  buildRekberDmCreated,
  buildRekberStep,
  buildOrderLog,
  buildTestimonyThanks,
  rateOf,
  buildPanel,
  buildProductInfo,
  buildProductTerms,
  storeName,
  buildLeaderboard,
  buildConfirmAccount,
  buildAmountPicker,
  buildTicketMessage,
  buildDmCreated,
  buildDmClosed,
  buildTestimonyPrompt,
  buildTestimony,
  buildStoreAnnouncement,
};
