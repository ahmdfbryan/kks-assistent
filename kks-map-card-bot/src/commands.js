const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const store = require('./store');
const { runUpdate } = require('./updater');
const config = require('./config');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const NEEDED = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

const data = new SlashCommandBuilder()
  .setName('maps')
  .setDescription('Card daftar map Roblox KokoKrunch Studios')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('kirim')
      .setDescription('Tampilkan card semua map di channel ini (atau channel pilihan)')
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Channel tujuan (default: channel ini)').addChannelTypes(...TEXT_CHANNELS),
      ),
  )
  .addSubcommand((s) =>
    s.setName('refresh').setDescription('Perbarui value semua card sekarang juga (tanpa menunggu jadwal harian)'),
  )
  .addSubcommand((s) =>
    s
      .setName('stop')
      .setDescription('Hapus card dan hentikan update otomatis di channel')
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Channel (default: channel ini)').addChannelTypes(...TEXT_CHANNELS),
      ),
  );

async function handleKirim(interaction) {
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  const perms = channel.permissionsFor(interaction.client.user);
  if (!perms?.has(NEEDED)) {
    return interaction.editReply(
      `❌ Bot butuh izin **View Channel**, **Send Messages**, dan **Embed Links** di ${channel}.`,
    );
  }

  if (!store.getChannel(channel.id)) {
    store.setChannel(channel.id, { guildId: interaction.guildId, messageIds: [], lastUpdatedAt: 0 });
  }
  const res = await runUpdate(interaction.client, { force: true, onlyChannelId: channel.id });
  if (!res.ok) return interaction.editReply(`❌ ${res.reason || res.results?.[0]?.reason || 'Gagal.'}`);

  const hours = config.updateIntervalMs / 3600000;
  return interaction.editReply(
    `✅ ${res.count} card map ditampilkan di ${channel}. Value akan diperbarui otomatis setiap ${hours} jam.`,
  );
}

async function handleRefresh(interaction) {
  if (!store.allChannels().length) {
    return interaction.editReply('Belum ada channel yang menampilkan card. Pakai `/maps kirim` dulu.');
  }
  const res = await runUpdate(interaction.client, { force: true });
  if (!res.ok && !res.results) return interaction.editReply(`❌ ${res.reason}`);
  const failed = (res.results || []).filter((r) => !r.ok);
  return interaction.editReply(
    `🔄 ${res.count} map diperbarui di ${res.results.length - failed.length} channel.` +
      (failed.length ? `\n⚠️ ${failed.length} channel gagal: ${failed.map((f) => f.reason).join('; ')}` : ''),
  );
}

async function handleStop(interaction) {
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  const saved = store.getChannel(channel.id);
  if (!saved) return interaction.editReply(`Tidak ada card map yang aktif di ${channel}.`);

  for (const id of saved.messageIds || []) {
    await channel.messages.delete(id).catch(() => {});
  }
  store.removeChannel(channel.id);
  return interaction.editReply(`🗑️ Card map di ${channel} dihapus dan update otomatis dihentikan.`);
}

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  if (sub === 'kirim') return handleKirim(interaction);
  if (sub === 'refresh') return handleRefresh(interaction);
  if (sub === 'stop') return handleStop(interaction);
}

module.exports = { data, execute };
