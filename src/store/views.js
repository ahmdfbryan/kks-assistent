const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { color, rupiah, num, fill, ts } = require('./config');
const { state } = require('./state');

const STATUS_LABEL = {
  open: '⏳ Menunggu Pembayaran / Proses',
  completed: '✅ Completed — Produk berhasil dikirim',
  cancelled: '❌ Cancelled — Dibatalkan',
  refund: '💸 Refund — Dana dikembalikan',
};
const STARS = (n) => '⭐'.repeat(n) + '☆'.repeat(5 - n);

function serverFooter(guild, text) {
  return { text: text || guild.name, iconURL: guild.iconURL({ extension: 'png', size: 128 }) || undefined };
}

function rateOf(cfg, product) {
  return Number(state.rates[product.id]) || Number(product.rate) || 0;
}

// ───────────────────────── Panel utama ─────────────────────────
function buildPanel(guild, cfg) {
  const p = cfg.panel || {};
  const open = state.open && state.stock > 0;
  const s = state.stats;
  const robuxProduct = (cfg.products || []).find((x) => x.type === 'robux');
  const avg = s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(1) : '-';

  const steps = (p.howToBuy || []).map((t, i) => `\`${i + 1}\` ${t}`).join('\n');
  const description = [
    fill(p.description, guild),
    steps ? `\n**📋 Tata Cara Pembelian**\n${steps}` : '',
    `\n${'━'.repeat(24)}\n${open ? p.statusOpen : p.statusClosed}\n${'━'.repeat(24)}`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(open ? color(cfg, 'open', 0x2ecc71) : color(cfg, 'closed', 0xe74c3c))
    .setTitle(fill(p.title, guild))
    .setDescription(description.slice(0, 4096))
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .addFields(
      {
        name: `${robuxProduct?.emoji || '💎'} Harga ${robuxProduct?.label || 'Robux'}`,
        value: robuxProduct ? `\`${rupiah(rateOf(cfg, robuxProduct))} / Robux\`` : '`-`',
        inline: true,
      },
      { name: '📦 Sisa Stock', value: `\`${num(state.stock)} Robux\``, inline: true },
      { name: '🏪 Status', value: open ? '`🟢 BUKA`' : '`🔴 TUTUP`', inline: true },
      { name: '🧾 Total Transaksi', value: `\`${num(s.transactions)} transaksi\``, inline: true },
      { name: '💎 Robux Terjual', value: `\`${num(s.robux)} Robux\``, inline: true },
      { name: '⭐ Rating Pembeli', value: `\`${avg} / 5 (${num(s.ratingCount)} ulasan)\``, inline: true },
    )
    .setFooter(serverFooter(guild, `${guild.name} • Terakhir diperbarui`))
    .setTimestamp(new Date());
  if (p.bannerImage) embed.setImage(p.bannerImage);

  const buttons = (cfg.products || []).slice(0, 5).map((prod) => {
    const soon = prod.type !== 'robux';
    return new ButtonBuilder()
      .setCustomId(`store:buy:${prod.id}`)
      .setLabel(prod.label)
      .setEmoji(prod.emoji || '🛒')
      .setStyle(soon ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(soon || !open);
  });
  return { embeds: [embed], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [] };
}

// ───────────────────────── Leaderboard ─────────────────────────
function buildLeaderboard(guild, cfg) {
  const medals = ['🥇', '🥈', '🥉'];
  const top = Object.entries(state.spenders)
    .sort((a, b) => b[1].robux - a[1].robux || b[1].revenue - a[1].revenue)
    .slice(0, 10);

  const lines = top.length
    ? top.map(([userId, d], i) => {
        const rank = medals[i] || `\`#${i + 1}\``;
        return `${rank} <@${userId}>\n┗ 💎 **${num(d.robux)} Robux** • ${rupiah(d.revenue)} • ${num(d.orders)} order`;
      })
    : ['_Belum ada transaksi. Jadilah spender pertama!_ 🚀'];

  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'gold', 0xf1c40f))
    .setTitle(`🏆 Top 10 Spender Leaderboard | ${guild.name} Robux`)
    .setDescription(lines.join('\n\n'))
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .addFields(
      { name: '🧾 Total Transaksi', value: `\`${num(state.stats.transactions)}\``, inline: true },
      { name: '💎 Total Robux', value: `\`${num(state.stats.robux)}\``, inline: true },
      { name: '👥 Total Pembeli', value: `\`${num(Object.keys(state.spenders).length)}\``, inline: true },
    )
    .setFooter(serverFooter(guild, `${guild.name} • Diperbarui otomatis`))
    .setTimestamp(new Date());
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// ───────────────────────── Konfirmasi akun Roblox ─────────────────────────
function buildConfirmAccount(cfg, roblox) {
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x7c5cff))
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
    .setColor(color(cfg, 'brand', 0x7c5cff))
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
  const statusColor = {
    open: color(cfg, 'brand', 0x7c5cff),
    completed: color(cfg, 'open', 0x2ecc71),
    cancelled: color(cfg, 'closed', 0xe74c3c),
    refund: color(cfg, 'refund', 0xe67e22),
  }[t.status];

  const info = new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`🧾 Detail Pesanan • ${t.id}`)
    .setDescription(`Halo <@${t.userId}>, terima kasih sudah berbelanja di **${guild.name}**! 💜`)
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
    .setFooter(serverFooter(guild, `${guild.name} • Ticket ${t.id}`))
    .setTimestamp(t.closedAt || t.createdAt);
  if (t.roblox.avatar) info.setThumbnail(t.roblox.avatar);
  if (t.closedAt) info.addFields({ name: '🔒 Ditutup', value: `${ts(t.closedAt, 'f')} oleh <@${t.closedBy}>`, inline: true });

  const embeds = [info];
  if (t.status === 'open') {
    const pay = new EmbedBuilder()
      .setColor(color(cfg, 'info', 0x3498db))
      .setTitle(cfg.payment?.title || '💳 Cara Pembayaran')
      .setDescription(fill(cfg.payment?.description || 'Silakan tunggu admin.', guild));
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
    .setColor(color(cfg, 'open', 0x2ecc71))
    .setTitle('🎫 Ticket Order Berhasil Dibuat')
    .setDescription(
      `Ticket order kamu di **${guild.name}** sudah berhasil dibuat.\n\n` +
        `Silakan lanjutkan ke channel ticket kamu untuk menyelesaikan pembayaran:\n${channelUrl}`,
    )
    .addFields(
      { name: '📦 Produk', value: `\`${t.productLabel} • ${num(t.amount)} Robux\``, inline: true },
      { name: '🎫 Ticket ID', value: `\`${t.id}\``, inline: true },
      { name: '💰 Total Bayar', value: `\`${rupiah(t.price)}\``, inline: true },
    )
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .setFooter(serverFooter(guild))
    .setTimestamp(new Date());
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Buka Ticket').setEmoji('🎫').setURL(channelUrl),
  );
  return { embeds: [embed], components: [row] };
}

function buildDmClosed(guild, cfg, t) {
  const titles = {
    completed: '✅ Pesanan Kamu Sudah Selesai',
    cancelled: '❌ Pesanan Kamu Dibatalkan',
    refund: '💸 Pesanan Kamu Di-refund',
  };
  const desc = {
    completed: `Robux kamu sudah berhasil dikirim. Terima kasih sudah berbelanja di **${guild.name}**! 💜\nJangan lupa beri testimoni di ticket kamu ya ⭐`,
    cancelled: `Pesanan kamu di **${guild.name}** telah dibatalkan.`,
    refund: `Dana pesanan kamu di **${guild.name}** telah dikembalikan.`,
  };
  const embed = new EmbedBuilder()
    .setColor(t.status === 'completed' ? color(cfg, 'open', 0x2ecc71) : color(cfg, 'refund', 0xe67e22))
    .setTitle(titles[t.status])
    .setDescription(desc[t.status] + (t.note ? `\n\n📝 Catatan admin: ${t.note}` : ''))
    .addFields(
      { name: '🎫 Ticket ID', value: `\`${t.id}\``, inline: true },
      { name: '📦 Produk', value: `\`${t.productLabel} • ${num(t.amount)} Robux\``, inline: true },
    )
    .setFooter(serverFooter(guild))
    .setTimestamp(new Date());
  if (t.proofUrl && t.status === 'completed') embed.setImage(t.proofUrl);
  return { embeds: [embed] };
}

// ───────────────────────── Testimoni ─────────────────────────
function buildTestimonyPrompt(guild, cfg, t) {
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'gold', 0xf1c40f))
    .setTitle('⭐ Bagaimana Pengalaman Belanjamu?')
    .setDescription(
      `<@${t.userId}>, pesananmu sudah selesai! 🎉\n\nBantu kami jadi lebih baik dengan memberikan **rating & testimoni** ` +
        `lewat tombol di bawah. Testimonimu akan ditampilkan di channel testimoni.`,
    )
    .setFooter(serverFooter(guild));
  if (t.proofUrl) embed.setImage(t.proofUrl);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`store:testi:${t.id}`).setLabel('Beri Testimoni').setEmoji('⭐').setStyle(ButtonStyle.Primary),
  );
  return { content: `<@${t.userId}>`, embeds: [embed], components: [row], allowedMentions: { users: [t.userId] } };
}

function buildTestimony(guild, cfg, t, buyer) {
  const r = t.testimony;
  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'gold', 0xf1c40f))
    .setAuthor({
      name: buyer ? `${buyer.displayName} (@${buyer.user.username})` : 'Pembeli',
      iconURL: buyer?.displayAvatarURL({ size: 128 }) || undefined,
    })
    .setTitle(r ? `${STARS(r.rating)}  ${r.rating}/5` : '✅ Transaksi Berhasil')
    .setDescription(r ? `>>> ${r.comment}` : '_Pembeli tidak memberikan ulasan._')
    .addFields(
      { name: '👤 Pembeli', value: `<@${t.userId}>`, inline: true },
      { name: '📦 Produk', value: `\`${t.productLabel}\``, inline: true },
      { name: '💎 Jumlah', value: `\`${num(t.amount)} Robux\``, inline: true },
      { name: '🎮 Roblox', value: `\`@${t.roblox.name}\``, inline: true },
      { name: '💰 Total', value: `\`${rupiah(t.price)}\``, inline: true },
      { name: '🎫 Ticket', value: `\`${t.id}\``, inline: true },
    )
    .setThumbnail(buyer?.displayAvatarURL({ extension: 'png', size: 256 }) || t.roblox.avatar || null)
    .setFooter(serverFooter(guild, `${guild.name} • Testimoni #${state.stats.testimonies}`))
    .setTimestamp(new Date());
  if (t.proofUrl) embed.setImage(t.proofUrl);
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// ───────────────────────── Pengumuman di channel stock ─────────────────────────
function buildStoreAnnouncement(guild, cfg, kind, extra = {}) {
  const panelLink = state.panel ? `https://discord.com/channels/${guild.id}/${state.panel.channelId}` : null;
  const product = (cfg.products || []).find((x) => x.type === 'robux');
  const rate = product ? rateOf(cfg, product) : 0;
  const e = new EmbedBuilder().setFooter(serverFooter(guild)).setTimestamp(new Date());

  if (kind === 'open') {
    e.setColor(color(cfg, 'open', 0x2ecc71))
      .setTitle('🟢 Toko Sudah Dibuka!')
      .setDescription(`**${guild.name} Store** sekarang **BUKA** dan siap menerima pesanan! 🎉${panelLink ? `\n\n🛒 Order sekarang: ${panelLink}` : ''}`)
      .addFields(
        { name: '📦 Stock Tersedia', value: `\`${num(state.stock)} Robux\``, inline: true },
        { name: '💱 Rate', value: `\`${rupiah(rate)} / Robux\``, inline: true },
      );
  } else if (kind === 'close') {
    e.setColor(color(cfg, 'closed', 0xe74c3c))
      .setTitle('🔴 Toko Ditutup')
      .setDescription(
        `${extra.reason || `**${guild.name} Store** saat ini **TUTUP** dan tidak menerima pesanan baru.`}\n\n` +
          'Pantau terus channel ini untuk info buka berikutnya. Terima kasih! 💜',
      )
      .addFields({ name: '📦 Sisa Stock', value: `\`${num(state.stock)} Robux\``, inline: true });
  } else if (kind === 'stock') {
    e.setColor(color(cfg, 'info', 0x3498db))
      .setTitle('📦 Update Stock Robux')
      .setDescription(extra.text || 'Stock Robux telah diperbarui.')
      .addFields(
        { name: '📦 Stock Sekarang', value: `\`${num(state.stock)} Robux\``, inline: true },
        { name: '🏪 Status Toko', value: state.open ? '`🟢 BUKA`' : '`🔴 TUTUP`', inline: true },
      );
  } else if (kind === 'returned') {
    const t = extra.ticket;
    e.setColor(color(cfg, 'refund', 0xe67e22))
      .setTitle(t.status === 'refund' ? '💸 Pesanan Di-refund — Stock Dikembalikan' : '❌ Pesanan Dibatalkan — Stock Dikembalikan')
      .setDescription(`Ticket **${t.id}** ditutup dengan status **${STATUS_LABEL[t.status]}**.`)
      .addFields(
        { name: '♻️ Stock Kembali', value: `\`+${num(t.amount)} Robux\``, inline: true },
        { name: '📦 Stock Sekarang', value: `\`${num(state.stock)} Robux\``, inline: true },
        { name: '🏪 Status Toko', value: state.open ? '`🟢 BUKA`' : '`🔴 TUTUP`', inline: true },
      );
  }
  return e;
}

module.exports = {
  STATUS_LABEL,
  rateOf,
  buildPanel,
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
