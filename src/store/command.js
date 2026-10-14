const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder } = require('discord.js');
const { loadConfig, isId, rupiah, num, color } = require('./config');
const { state, save, productState, isProductOpen } = require('./state');
const V = require('./views');
const H = require('./howto');
const { setProductsOpen, reopenIfAutoClosed, closeIfSoldOut, announce, refreshPanel } = require('./flow');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** Pilihan produk untuk /store buka & tutup (dibaca dari store.json saat npm run deploy). */
function productChoices() {
  const products = (loadConfig()?.products || []).filter((p) => p.type !== 'soon').slice(0, 24);
  return [{ name: '🏪 Semua Produk', value: 'all' }, ...products.map((p) => ({ name: `${p.emoji || '•'} ${p.label}`.slice(0, 100), value: p.id }))];
}
/** Pilihan produk yang punya harga per Robux (Robux Visend, Robux Gamepass, ...). */
function rateChoices() {
  return (loadConfig()?.products || [])
    .filter((p) => p.type === 'robux' || p.type === 'gamepass')
    .slice(0, 25)
    .map((p) => ({ name: `${p.emoji || '•'} ${p.label}`.slice(0, 100), value: p.id }));
}
const productOption = (o) =>
  o.setName('produk').setDescription('Produk yang dibuka / ditutup').setRequired(true).addChoices(...productChoices());

/** Kirim pesan baru ke channel & ganti pesan lama (panel / leaderboard). */
async function placeTracked(interaction, key, channel, build) {
  const cfg = loadConfig();
  const old = state[key];
  const msg = await channel.send(build(interaction.guild, cfg));
  state[key] = { channelId: channel.id, messageId: msg.id };
  save();
  if (old && old.messageId !== msg.id) {
    const oldCh = await interaction.guild.channels.fetch(old.channelId).catch(() => null);
    await oldCh?.messages.delete(old.messageId).catch(() => {});
  }
  return msg;
}

async function resolveChannel(interaction, configKey) {
  const picked = interaction.options.getChannel('channel');
  if (picked) return picked;
  const id = loadConfig()?.channels?.[configKey];
  return isId(id) ? interaction.guild.channels.fetch(id).catch(() => null) : interaction.channel;
}

const storeCommand = {
  data: new SlashCommandBuilder()
    .setName('store')
    .setDescription('Kelola toko (khusus Administrator)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('panel')
        .setDescription('Kirim / pindahkan panel store (otomatis ter-update)')
        .addChannelOption((o) => o.setName('channel').setDescription('Default: channel panel di store.json').addChannelTypes(...TEXT)),
    )
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Kirim / pindahkan Top 10 Spender Leaderboard (otomatis ter-update)')
        .addChannelOption((o) => o.setName('channel').setDescription('Default: channel leaderboard di store.json').addChannelTypes(...TEXT)),
    )
    .addSubcommand((s) =>
      s
        .setName('how-to-order')
        .setDescription('Kirim / pindahkan panel How to Order (panduan cara order + dropdown produk)')
        .addChannelOption((o) => o.setName('channel').setDescription('Default: channel howToOrder di store.json').addChannelTypes(...TEXT)),
    )
    .addSubcommand((s) => s.setName('buka').setDescription('Buka produk (pembeli bisa order)').addStringOption(productOption))
    .addSubcommand((s) =>
      s
        .setName('tutup')
        .setDescription('Tutup produk (tombol produk dinonaktifkan)')
        .addStringOption(productOption)
        .addStringOption((o) => o.setName('alasan').setDescription('Alasan tutup (opsional, ditampilkan di pengumuman)').setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s
        .setName('stok-set')
        .setDescription('Atur stock Robux (misal stock hari ini 5000)')
        .addIntegerOption((o) => o.setName('jumlah').setDescription('Jumlah stock Robux').setRequired(true).setMinValue(0).setMaxValue(10_000_000)),
    )
    .addSubcommand((s) =>
      s
        .setName('stok-tambah')
        .setDescription('Tambah / kurangi stock Robux (pakai angka minus untuk mengurangi)')
        .addIntegerOption((o) => o.setName('jumlah').setDescription('Contoh: 1000 atau -500').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('harga')
        .setDescription('Atur harga (rate) per 1 Robux')
        .addIntegerOption((o) => o.setName('rate').setDescription('Contoh: 145 (= Rp 145 / Robux)').setRequired(true).setMinValue(1).setMaxValue(100000))
        .addStringOption((o) => {
          o.setName('produk').setDescription('Produk yang diubah harganya (default: Robux Visend)');
          const choices = rateChoices();
          return choices.length ? o.addChoices(...choices) : o;
        }),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Lihat ringkasan toko')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cfg = loadConfig();
    if (!cfg) return interaction.editReply('❌ store.json tidak bisa dibaca (cek format JSON-nya).');
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const product = (cfg.products || []).find((p) => p.type === 'robux');

    if (sub === 'panel' || sub === 'leaderboard') {
      const channel = await resolveChannel(interaction, sub);
      if (!channel?.isTextBased()) return interaction.editReply('❌ Channel tidak ditemukan.');
      await placeTracked(interaction, sub, channel, sub === 'panel' ? V.buildPanel : V.buildLeaderboard);
      return interaction.editReply(`✅ ${sub === 'panel' ? 'Panel store' : 'Leaderboard'} dikirim ke ${channel} dan akan ter-update otomatis.`);
    }

    if (sub === 'how-to-order') {
      const channel = await resolveChannel(interaction, 'howToOrder');
      if (!channel?.isTextBased()) return interaction.editReply('❌ Channel tidak ditemukan.');
      await placeTracked(interaction, 'howto', channel, H.buildHowToPanel);
      return interaction.editReply(`✅ Panel **How to Order** dikirim ke ${channel} dan akan ter-update otomatis.`);
    }

    if (sub === 'buka' || sub === 'tutup') {
      const pick = interaction.options.getString('produk');
      const all = (cfg.products || []).filter((p) => p.type !== 'soon');
      const targets = pick === 'all' ? all : all.filter((p) => p.id === pick);
      if (!targets.length) return interaction.editReply('❌ Produk tidak ditemukan di store.json.');
      const open = sub === 'buka';
      const notes = [];
      const changed = targets.filter((p) => {
        if (open && p.type === 'robux' && state.stock <= 0) {
          notes.push(`⚠️ **${p.label}** tidak bisa dibuka — stock masih **0**. Atur dulu dengan \`/store stok-set\`.`);
          return false;
        }
        if (productState(p.id).open === open) {
          notes.push(`ℹ️ **${p.label}** sudah **${open ? 'BUKA' : 'TUTUP'}**.`);
          return false;
        }
        return true;
      });
      const alasan = interaction.options.getString('alasan');
      await setProductsOpen(guild, changed, open, { reason: alasan ? `📌 ${alasan}` : undefined });
      const done = changed.map((p) => `${open ? '🟢' : '🔴'} **${p.label}** ${open ? 'DIBUKA' : 'DITUTUP'}`);
      return interaction.editReply([...done, ...notes].join('\n') || 'Tidak ada perubahan.');
    }

    if (sub === 'stok-set' || sub === 'stok-tambah') {
      const n = interaction.options.getInteger('jumlah');
      const before = state.stock;
      state.stock = Math.max(0, sub === 'stok-set' ? n : state.stock + n);
      save();
      refreshPanel();
      await announce(guild, 'stock', {
        text: `Stock Robux diperbarui: **${num(before)} → ${num(state.stock)} Robux**.`,
      });
      await closeIfSoldOut(guild, `📦 **Stock Robux sudah HABIS!** ${product?.label || 'Robux'} otomatis ditutup.`);
      const reopened = await reopenIfAutoClosed(guild);
      return interaction.editReply(
        `📦 Stock: **${num(before)} → ${num(state.stock)} Robux**.` +
          (reopened ? `\n🟢 **${product.label}** otomatis **DIBUKA** lagi (sebelumnya tutup karena stock habis).` : '') +
          (product && !isProductOpen(product) && state.stock > 0
            ? `\n**${product.label}** masih TUTUP (ditutup manual) — buka dengan \`/store buka\`.`
            : ''),
      );
    }

    if (sub === 'harga') {
      const pick = interaction.options.getString('produk');
      const target = pick ? (cfg.products || []).find((p) => p.id === pick) : product;
      if (!target) return interaction.editReply('❌ Produk tidak ada di store.json.');
      const rate = interaction.options.getInteger('rate');
      state.rates[target.id] = rate;
      save();
      refreshPanel();
      const example =
        target.type === 'gamepass'
          ? `1.000 Robux diterima = gamepass ${num(V.gpBeforeTax(target, 1000))} Robux = ${rupiah(V.gpBeforeTax(target, 1000) * rate)}`
          : `100 Robux = ${rupiah(rate * 100)}`;
      return interaction.editReply(
        `💱 Harga **${target.label}** sekarang **${rupiah(rate)} / Robux** (${example}).\nTicket yang sudah berjalan tetap memakai harga lama.`,
      );
    }

    if (sub === 'status') {
      const active = Object.values(state.tickets).filter((t) => t.status === 'open');
      const reserved = active.filter((t) => !t.kind || t.kind === 'robux').reduce((a, t) => a + t.amount, 0);
      const s = state.stats;
      const productLines = (cfg.products || [])
        .filter((p) => p.type !== 'soon')
        .map((p) => `${isProductOpen(p) ? '🟢' : '🔴'} ${p.label}${p.type === 'robux' || p.type === 'gamepass' ? ` • ${rupiah(V.rateOf(cfg, p))}` : ''}`)
        .join('\n');
      const embed = new EmbedBuilder()
        .setColor(color(cfg, 'brand', 0x3498db))
        .setTitle('📊 Ringkasan Toko')
        .addFields(
          { name: '🏪 Status Produk', value: productLines || '-', inline: true },
          { name: '📦 Stock', value: `${num(state.stock)} Robux`, inline: true },
          { name: '💱 Rate', value: product ? `${rupiah(V.rateOf(cfg, product))} / Robux` : '-', inline: true },
          { name: '🎫 Ticket Berjalan', value: `${active.length} ticket (${num(reserved)} Robux tertahan)`, inline: true },
          { name: '🧾 Transaksi Selesai', value: `${num(s.transactions)}`, inline: true },
          { name: '💰 Omzet', value: rupiah(s.revenue), inline: true },
          { name: '🤝 Rekber Sukses', value: `${num(s.rekber)} (${rupiah(s.rekberVolume)})`, inline: true },
          {
            name: '📍 Panel / Leaderboard',
            value: `${state.panel ? `<#${state.panel.channelId}>` : '❌ belum dikirim'} / ${state.leaderboard ? `<#${state.leaderboard.channelId}>` : '❌ belum dikirim'}`,
          },
        );
      if (active.length) {
        embed.addFields({
          name: 'Daftar Ticket Berjalan',
          value: active
            .slice(0, 15)
            .map((t) =>
              t.kind === 'gamepass'
                ? `\`${t.id}\` <#${t.channelId}> • 🎟️ ${num(t.amount)} Robux (gamepass ${num(t.before)}) • <@${t.userId}>`
                : t.kind === 'rekber'
                ? `\`${t.id}\` <#${t.channelId}> • 🤝 ${rupiah(t.nominal)} • <@${t.buyerId}> ↔ <@${t.sellerId}>`
                : `\`${t.id}\` <#${t.channelId}> • ${num(t.amount)} Robux • <@${t.userId}>`,
            )
            .join('\n'),
        });
      }
      return interaction.editReply({ embeds: [embed] });
    }
  },
};

module.exports = { storeCommand };
