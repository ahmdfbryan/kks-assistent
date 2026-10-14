const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { color, rupiah, num, fill } = require('./config');
const { state, isProductOpen, stockOf, stockUnit } = require('./state');
const V = require('./views');

/**
 * Channel "How to Order": panel dengan dropdown produk.
 * Pilih produk → panduan lengkap muncul (hanya terlihat yang memilih).
 * Isi teks diatur di store.json → howToOrder & products[].howTo
 */
// Garis pemisah: cukup pendek supaya tetap 1 baris di HP maupun laptop (bisa diganti lewat store.json → howToOrder.divider).
const DIVIDER = '━━━━━━━━━━━━━━━━━━';
const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const steps = (list) => (list || []).map((x, i) => `${KEYCAPS[i] || `\`${i + 1}\``} ${x}`).join('\n');
const bullets = (list) => (list || []).map((x) => `▸ ${x}`).join('\n');
const guideProducts = (cfg) => (cfg.products || []).filter((p) => p.type !== 'soon' && p.howTo);

function footer(guild, cfg) {
  return { text: V.storeName(cfg, guild), iconURL: guild.iconURL({ extension: 'png', size: 128 }) || undefined };
}
const panelUrl = (guild) =>
  state.panel ? `https://discord.com/channels/${guild.id}/${state.panel.channelId}/${state.panel.messageId}` : null;

function storeLinkButton(guild, label = 'Order di Store') {
  const url = panelUrl(guild);
  return url ? new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setEmoji('🛒').setURL(url) : null;
}

/** Ringkasan singkat produk (tampil di dropdown & panel). */
function productSummary(cfg, p) {
  if (p.type === 'robux') return `${rupiah(V.rateOf(cfg, p))}/Robux • Stock ${num(state.stock)}`;
  if (p.type === 'gamepass') return `${rupiah(V.rateOf(cfg, p))}/Robux • ± ${num(p.pendingDays || 5)} hari`;
  if (p.type === 'rekber') return `Mulai ${rupiah(p.minNominal || 0)} • Dana aman`;
  if (p.type === 'canva') return `Mulai ${rupiah(V.minPlanPrice(p))} • Slot ${num(stockOf(p))}`;
  return p.howTo?.short || '';
}

// ───────────────────────── Panel utama ─────────────────────────
function buildHowToPanel(guild, cfg) {
  const h = cfg.howToOrder || {};
  const name = { name: V.storeName(cfg, guild) };
  const products = guideProducts(cfg);

  const embed = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(fill(h.title || '📖 How to Order', name))
    .setDescription(fill(h.description || '', name).slice(0, 4096) || null)
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null);

  // Garis pemisah di bawah alur order (daftar produk ada di channel Catalog).
  if (h.flow) {
    embed.addFields({ name: '⚡ Alur Order Singkat', value: h.flow + (h.divider === '' ? '' : `\n${h.divider || DIVIDER}`) });
  }
  if (h.whyUs?.length) embed.addFields({ name: `🛡️ Kenapa ${V.storeName(cfg, guild)}?`, value: bullets(h.whyUs).slice(0, 1024) });
  embed.addFields({ name: '👇 Pilih Panduan', value: h.pickText || 'Pilih produk di menu bawah untuk melihat **cara order lengkap**. Panduan hanya terlihat olehmu.' });
  if (h.bannerImage) embed.setImage(h.bannerImage);
  embed.setFooter(footer(guild, cfg)).setTimestamp(new Date());

  const options = products.slice(0, 22).map((p) => ({
    label: `Cara Order ${p.label}`.slice(0, 100),
    description: productSummary(cfg, p).slice(0, 100) || undefined,
    value: p.id,
    emoji: p.emoji || '🛒',
  }));
  options.push({ label: 'Metode Pembayaran', description: 'Cara bayar & konfirmasi pembayaran', value: '_pay', emoji: '💳' });
  if (h.faq?.length) options.push({ label: 'FAQ — Pertanyaan Umum', description: 'Jawaban pertanyaan yang sering ditanyakan', value: '_faq', emoji: '❓' });

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('store:howto').setPlaceholder('📖 Pilih produk untuk melihat cara order...').addOptions(options),
    ),
  ];
  const link = storeLinkButton(guild, 'Buka Store');
  if (link) components.push(new ActionRowBuilder().addComponents(link));
  return { embeds: [embed], components };
}

// ───────────────────────── Panduan per produk (ephemeral) ─────────────────────────
function buildHowToGuide(guild, cfg, value) {
  const name = { name: V.storeName(cfg, guild) };
  const base = new EmbedBuilder().setColor(color(cfg, 'brand', 0x3498db)).setFooter(footer(guild, cfg)).setTimestamp(new Date());
  const link = storeLinkButton(guild);

  if (value === '_pay') {
    const pay = cfg.payment || {};
    const h = cfg.howToOrder || {};
    base
      .setTitle('💳 Metode Pembayaran')
      .setDescription(fill(h.paymentIntro || 'Semua pembayaran dilakukan **di dalam ticket** setelah ticket order dibuat.', name))
      .addFields({
        name: '🧾 Langkah Pembayaran',
        value: (h.paymentSteps?.length ? steps(h.paymentSteps) : fill(pay.description || '-', name)).slice(0, 1024),
      });
    if (h.paymentMethods?.length) base.addFields({ name: '🏦 Metode Tersedia', value: bullets(h.paymentMethods).slice(0, 1024) });
    if (pay.image) base.setImage(pay.image);
    return { embeds: [base], components: link ? [new ActionRowBuilder().addComponents(link)] : [] };
  }

  if (value === '_faq') {
    base.setTitle('❓ FAQ — Pertanyaan Umum').setDescription(`Pertanyaan yang paling sering ditanyakan pembeli **${name.name}**:`);
    for (const f of (cfg.howToOrder?.faq || []).slice(0, 20)) {
      base.addFields({ name: `💬 ${f.q}`.slice(0, 256), value: fill(f.a, name).slice(0, 1024) });
    }
    return { embeds: [base], components: link ? [new ActionRowBuilder().addComponents(link)] : [] };
  }

  const p = (cfg.products || []).find((x) => x.id === value);
  if (!p?.howTo) return { content: 'Panduan untuk produk ini belum tersedia.' };
  const ht = p.howTo;
  const open = isProductOpen(p);

  base
    .setTitle(`${p.emoji || '🛒'} Cara Order ${p.label}`)
    .setDescription(fill(ht.intro || '', name).slice(0, 4096) || null)
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null);

  // Info singkat (live dari data toko)
  const info = [{ name: '🏪 Status', value: open ? '`🟢 BUKA`' : '`🔴 TUTUP`', inline: true }];
  if (p.type === 'robux') {
    info.push(
      { name: '💱 Rate', value: `\`${rupiah(V.rateOf(cfg, p))} / Robux\``, inline: true },
      { name: '📦 Stock', value: `\`${num(state.stock)} Robux\``, inline: true },
    );
  } else if (p.type === 'gamepass') {
    info.push(
      { name: '💱 Rate', value: `\`${rupiah(V.rateOf(cfg, p))} / Robux\``, inline: true },
      { name: '⏱️ Estimasi', value: `\`± ${num(p.pendingDays || 5)} hari\``, inline: true },
    );
  } else if (p.type === 'canva') {
    info.push(
      { name: '💱 Harga', value: `\`Mulai ${rupiah(V.minPlanPrice(p))}\``, inline: true },
      { name: '🎟️ Sisa Slot', value: `\`${num(stockOf(p))} ${stockUnit(p)}\``, inline: true },
    );
  } else if (p.type === 'rekber') {
    info.push(
      { name: '💵 Nominal', value: `\`${rupiah(p.minNominal || 0)} – ${rupiah(p.maxNominal || 0)}\``, inline: true },
      { name: '💳 Fee', value: `\`Ditanggung ${(p.feePaidBy || 'pembeli') === 'penjual' ? 'penjual' : 'pembeli'}\``, inline: true },
    );
  }
  base.addFields(...info);

  if (ht.requirements?.length) base.addFields({ name: '📋 Yang Perlu Disiapkan', value: bullets(ht.requirements).slice(0, 1024) });
  if (ht.steps?.length) base.addFields({ name: '🧭 Langkah Order', value: steps(ht.steps).slice(0, 1024) });
  if (ht.tips?.length) base.addFields({ name: '💡 Tips', value: bullets(ht.tips).slice(0, 1024) });
  if (ht.image) base.setImage(ht.image);

  const buttons = [];
  if (link) buttons.push(link);
  if (p.type === 'gamepass') {
    buttons.push(
      new ButtonBuilder().setCustomId(`store:gpprice:${p.id}`).setLabel('Cek Harga').setEmoji('💰').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`store:gptax:${p.id}`).setLabel('Tax Calculator').setEmoji('🧮').setStyle(ButtonStyle.Primary),
    );
  }
  if (p.terms?.description) {
    buttons.push(
      new ButtonBuilder().setCustomId(`store:terms:${p.id}`).setLabel(p.terms.button || 'Syarat').setEmoji('📌').setStyle(ButtonStyle.Secondary),
    );
  }
  return { embeds: [base], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] : [] };
}

module.exports = { buildHowToPanel, buildHowToGuide };
