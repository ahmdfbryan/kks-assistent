const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder } = require('discord.js');
const { loadConfig, isId, rupiah, num, color } = require('./config');
const { state, save } = require('./state');
const V = require('./views');
const { setStoreOpen, announce, refreshPanel, refreshLeaderboard } = require('./flow');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

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
    .addSubcommand((s) => s.setName('buka').setDescription('Buka toko (pembeli bisa order)'))
    .addSubcommand((s) =>
      s
        .setName('tutup')
        .setDescription('Tutup toko (tombol produk dinonaktifkan)')
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
        .addIntegerOption((o) => o.setName('rate').setDescription('Contoh: 145 (= Rp 145 / Robux)').setRequired(true).setMinValue(1).setMaxValue(100000)),
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

    if (sub === 'buka') {
      if (state.stock <= 0) return interaction.editReply('❌ Stock masih **0**. Atur dulu dengan `/store stok-set`.');
      if (state.open) return interaction.editReply('ℹ️ Toko sudah **BUKA**.');
      await setStoreOpen(guild, true);
      return interaction.editReply(`🟢 Toko **DIBUKA**. Stock: **${num(state.stock)} Robux**.`);
    }

    if (sub === 'tutup') {
      if (!state.open) return interaction.editReply('ℹ️ Toko sudah **TUTUP**.');
      const alasan = interaction.options.getString('alasan');
      await setStoreOpen(guild, false, alasan ? `📌 ${alasan}` : undefined);
      return interaction.editReply('🔴 Toko **DITUTUP**.');
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
      if (state.stock <= 0 && state.open) {
        await setStoreOpen(guild, false, '📦 **Stock Robux sudah HABIS!** Toko otomatis ditutup.');
      }
      return interaction.editReply(
        `📦 Stock: **${num(before)} → ${num(state.stock)} Robux**.${!state.open && state.stock > 0 ? '\nToko masih TUTUP — buka dengan `/store buka`.' : ''}`,
      );
    }

    if (sub === 'harga') {
      if (!product) return interaction.editReply('❌ Produk Robux tidak ada di store.json.');
      const rate = interaction.options.getInteger('rate');
      state.rates[product.id] = rate;
      save();
      refreshPanel();
      return interaction.editReply(
        `💱 Harga **${product.label}** sekarang **${rupiah(rate)} / Robux** (100 Robux = ${rupiah(rate * 100)}).\nTicket yang sudah berjalan tetap memakai harga lama.`,
      );
    }

    if (sub === 'status') {
      const active = Object.values(state.tickets).filter((t) => t.status === 'open');
      const reserved = active.reduce((a, t) => a + t.amount, 0);
      const s = state.stats;
      const embed = new EmbedBuilder()
        .setColor(state.open ? color(cfg, 'open', 0x2ecc71) : color(cfg, 'closed', 0xe74c3c))
        .setTitle('📊 Ringkasan Toko')
        .addFields(
          { name: '🏪 Status', value: state.open ? '🟢 BUKA' : '🔴 TUTUP', inline: true },
          { name: '📦 Stock', value: `${num(state.stock)} Robux`, inline: true },
          { name: '💱 Rate', value: product ? `${rupiah(V.rateOf(cfg, product))} / Robux` : '-', inline: true },
          { name: '🎫 Ticket Berjalan', value: `${active.length} ticket (${num(reserved)} Robux)`, inline: true },
          { name: '🧾 Transaksi Selesai', value: `${num(s.transactions)}`, inline: true },
          { name: '💰 Omzet', value: rupiah(s.revenue), inline: true },
          {
            name: '📍 Panel / Leaderboard',
            value: `${state.panel ? `<#${state.panel.channelId}>` : '❌ belum dikirim'} / ${state.leaderboard ? `<#${state.leaderboard.channelId}>` : '❌ belum dikirim'}`,
          },
        );
      if (active.length) {
        embed.addFields({
          name: 'Daftar Ticket Berjalan',
          value: active.slice(0, 15).map((t) => `\`${t.id}\` <#${t.channelId}> • ${num(t.amount)} Robux • <@${t.userId}>`).join('\n'),
        });
      }
      return interaction.editReply({ embeds: [embed] });
    }
  },
};

module.exports = { storeCommand };
