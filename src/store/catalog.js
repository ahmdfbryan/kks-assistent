const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { color, rupiah, num, fill } = require('./config');
const { state, isProductOpen, productStatsOf } = require('./state');
const V = require('./views');

/**
 * Channel Catalog: 1 kartu header + 1 kartu per produk (masing-masing dengan tombolnya sendiri).
 * Semua kartu ter-update otomatis (status, harga, stock, terjual, rating).
 * Teks diatur di store.json → catalog & products[].catalog
 */
const STARS = (avg) => {
  const full = Math.round(avg);
  return '⭐'.repeat(full) + '☆'.repeat(5 - full);
};
const bullets = (list) => (list || []).map((x) => `▸ ${x}`).join('\n');
const catalogProducts = (cfg) => (cfg.products || []).slice(0, 9);

function footer(guild, cfg) {
  return { text: V.storeName(cfg, guild), iconURL: guild.iconURL({ extension: 'png', size: 128 }) || undefined };
}

/** Rating rata-rata khusus satu produk (dari testimoni ticket produk tersebut). */
function productRating(productId) {
  const rated = Object.values(state.tickets).filter((t) => t.productId === productId && t.testimony);
  if (!rated.length) return null;
  return { avg: rated.reduce((a, t) => a + t.testimony.rating, 0) / rated.length, count: rated.length };
}

/** Tabel harga rata kanan di dalam code block. */
function priceTable(rows) {
  if (!rows.length) return null;
  const w = Math.max(...rows.map((r) => r[0].length));
  return '```\n' + rows.map(([a, b]) => `${a.padStart(w)}  ➜  ${b}`).join('\n') + '\n```';
}

function statusBadge(p) {
  if (p.type === 'soon') return '`🔒 SEGERA HADIR`';
  return isProductOpen(p) ? '`🟢 BUKA`' : '`🔴 TUTUP`';
}

// ───────────────────────── Kartu header ─────────────────────────
function buildCatalogHeader(guild, cfg) {
  const c = cfg.catalog || {};
  const name = { name: V.storeName(cfg, guild) };
  const s = state.stats;
  const avg = s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(1) : '-';
  const sellable = (cfg.products || []).filter((p) => p.type !== 'soon');
  const open = sellable.filter((p) => isProductOpen(p)).length;

  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(fill(c.title || '🛍️ Katalog Produk | {server}', name))
    .setDescription(fill(c.description || '', name).slice(0, 4096) || null)
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .addFields(
      { name: '🛒 Produk Buka', value: `\`${open} / ${sellable.length} produk\``, inline: true },
      { name: '🧾 Total Transaksi', value: `\`${num((s.transactions || 0) + (s.rekber || 0))} transaksi\``, inline: true },
      { name: '⭐ Rating Pembeli', value: `\`${avg} / 5 (${num(s.ratingCount)} ulasan)\``, inline: true },
    )
    .setFooter(footer(guild, cfg))
    .setTimestamp(new Date());
  if (c.bannerImage) embed.setImage(c.bannerImage);
  return { embeds: [embed], components: [] };
}

// ───────────────────────── Kartu produk ─────────────────────────
function buildCatalogCard(guild, cfg, p) {
  const cc = p.catalog || {};
  const name = { name: V.storeName(cfg, guild) };
  const open = isProductOpen(p);
  const ps = productStatsOf(p.id);
  const rating = productRating(p.id);
  const soon = p.type === 'soon';

  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(`${p.emoji || '🛒'} ${p.label}`)
    .setDescription(
      fill(cc.tagline || (soon ? 'Produk baru sedang kami siapkan. **Nantikan kejutannya!** 👀' : ''), name).slice(0, 4096) || null,
    )
    .setThumbnail(cc.thumbnail || guild.iconURL({ extension: 'png', size: 256 }) || null)
    .setFooter(footer(guild, cfg))
    .setTimestamp(new Date());

  if (p.type === 'robux') {
    const rate = V.rateOf(cfg, p);
    const list = (cc.priceList || (p.presets || []).filter((a) => [100, 500, 1000].includes(a))).slice(0, 8);
    embed.addFields(
      { name: '💱 Harga', value: `\`${rupiah(rate)} / Robux\``, inline: true },
      { name: '📦 Stock', value: `\`${num(state.stock)} Robux\``, inline: true },
      { name: '🏪 Status', value: statusBadge(p), inline: true },
    );
    const table = priceTable(list.map((a) => [`${num(a)} Robux`, rupiah(a * rate)]));
    if (table) embed.addFields({ name: '📊 Daftar Harga', value: table });
  } else if (p.type === 'gamepass') {
    const list = (cc.priceList || p.examples || []).slice(0, 8);
    embed.addFields(
      { name: '💱 Harga', value: `\`${rupiah(V.rateOf(cfg, p))} / Robux\``, inline: true },
      { name: '⏱️ Estimasi', value: `\`± ${num(p.pendingDays || 5)} hari\``, inline: true },
      { name: '🏪 Status', value: statusBadge(p), inline: true },
    );
    const table = priceTable(list.map((a) => [`${num(a)} Robux`, rupiah(V.gpQuote(cfg, p, V.gpBeforeTax(p, a)).price)]));
    if (table) embed.addFields({ name: '📊 Daftar Harga (After Tax)', value: table });
  } else if (p.type === 'rekber') {
    embed.addFields(
      { name: '💵 Nominal', value: `\`${rupiah(p.minNominal || 0)} – ${rupiah(p.maxNominal || 0)}\``, inline: true },
      { name: '💳 Fee', value: `\`Ditanggung ${(p.feePaidBy || 'pembeli') === 'penjual' ? 'penjual' : 'pembeli'}\``, inline: true },
      { name: '🏪 Status', value: statusBadge(p), inline: true },
    );
    const table = priceTable(
      (p.feeTiers || []).map((x) => [
        x.upTo == null ? 'Di atas itu' : `≤ ${rupiah(x.upTo)}`,
        x.percent != null ? `${x.percent}%` : rupiah(x.fee),
      ]),
    );
    if (table) embed.addFields({ name: '🧾 Fee Rekber', value: table });
  } else {
    embed.addFields({ name: '🏪 Status', value: statusBadge(p), inline: true });
  }

  if (cc.highlights?.length) embed.addFields({ name: '✨ Keunggulan', value: bullets(cc.highlights).slice(0, 1024) });

  if (!soon) {
    const sold =
      p.type === 'rekber'
        ? [
            { name: '🤝 Rekber Sukses', value: `\`${num(state.stats.rekber)} transaksi\``, inline: true },
            { name: '🛡️ Dana Diamankan', value: `\`${rupiah(state.stats.rekberVolume)}\``, inline: true },
          ]
        : [
            { name: '✅ Order Selesai', value: `\`${num(ps.orders)} order\``, inline: true },
            { name: '💎 Robux Terjual', value: `\`${num(ps.robux)} Robux\``, inline: true },
          ];
    embed.addFields(...sold, {
      name: '⭐ Rating',
      value: rating ? `${STARS(rating.avg)} \`${rating.avg.toFixed(1)}\` (${num(rating.count)})` : '`Belum ada ulasan`',
      inline: true,
    });
  }
  if (cc.image) embed.setImage(cc.image);

  // Tombol kartu
  const buttons = [];
  if (soon) {
    buttons.push(new ButtonBuilder().setCustomId(`store:buy:${p.id}`).setLabel('Segera Hadir').setEmoji('🔒').setStyle(ButtonStyle.Secondary).setDisabled(true));
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`store:buy:${p.id}`)
        .setLabel(open ? (p.type === 'rekber' ? 'Mulai Rekber' : 'Order Sekarang') : 'Sedang Tutup')
        .setEmoji(open ? '🛒' : '🔴')
        .setStyle(open ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!open),
    );
    if (p.howTo) buttons.push(new ButtonBuilder().setCustomId(`store:howtobtn:${p.id}`).setLabel('Cara Order').setEmoji('📖').setStyle(ButtonStyle.Primary));
    if (p.type === 'gamepass') {
      buttons.push(new ButtonBuilder().setCustomId(`store:gptax:${p.id}`).setLabel('Tax Calculator').setEmoji('🧮').setStyle(ButtonStyle.Primary));
    }
    if (p.terms?.description) {
      buttons.push(
        new ButtonBuilder().setCustomId(`store:terms:${p.id}`).setLabel(p.terms.button || 'Syarat').setEmoji('📌').setStyle(ButtonStyle.Secondary),
      );
    }
  }
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] };
}

module.exports = { buildCatalogHeader, buildCatalogCard, catalogProducts };
