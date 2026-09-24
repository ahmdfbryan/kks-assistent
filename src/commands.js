const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const store = require('./store');
const { KINDS, runUpdate } = require('./updater');
const config = require('./config');
const { sendWelcome } = require('./welcome');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const NEEDED = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

/**
 * Membuat slash command dengan subcommand kirim / refresh / stop untuk satu jenis card.
 * /maps    → card map Roblox
 * /catalog → card item catalog
 */
function makeCardCommand({ name, kind, description }) {
  const label = KINDS[kind].label;

  const data = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('kirim')
        .setDescription(`Tampilkan card semua ${label} di channel ini (atau channel pilihan)`)
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel tujuan (default: channel ini)').addChannelTypes(...TEXT_CHANNELS),
        ),
    )
    .addSubcommand((s) =>
      s.setName('refresh').setDescription(`Perbarui value semua card ${label} sekarang juga`),
    )
    .addSubcommand((s) =>
      s
        .setName('stop')
        .setDescription(`Hapus card ${label} dan hentikan update otomatis di channel`)
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

    if (!store.get(kind, channel.id)) {
      store.set(kind, channel.id, { guildId: interaction.guildId, messageIds: [], lastUpdatedAt: 0 });
    }
    const res = await runUpdate(interaction.client, kind, { force: true, onlyChannelId: channel.id });
    if (!res.ok) return interaction.editReply(`❌ ${res.reason || res.results?.[0]?.reason || 'Gagal.'}`);

    const hours = config.updateIntervalMs / 3600000;
    return interaction.editReply(
      `✅ ${res.count} card ${label} ditampilkan di ${channel}. Value akan diperbarui otomatis setiap ${hours} jam.`,
    );
  }

  async function handleRefresh(interaction) {
    if (!store.all(kind).length) {
      return interaction.editReply(`Belum ada channel yang menampilkan card ${label}. Pakai \`/${name} kirim\` dulu.`);
    }
    const res = await runUpdate(interaction.client, kind, { force: true });
    if (!res.results) return interaction.editReply(`❌ ${res.reason}`);
    const failed = res.results.filter((r) => !r.ok);
    return interaction.editReply(
      `🔄 ${res.count} ${label} diperbarui di ${res.results.length - failed.length} channel.` +
        (failed.length ? `\n⚠️ ${failed.length} channel gagal: ${failed.map((f) => f.reason).join('; ')}` : ''),
    );
  }

  async function handleStop(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const saved = store.get(kind, channel.id);
    if (!saved) return interaction.editReply(`Tidak ada card ${label} yang aktif di ${channel}.`);

    for (const id of saved.messageIds || []) {
      await channel.messages.delete(id).catch(() => {});
    }
    store.remove(kind, channel.id);
    return interaction.editReply(`🗑️ Card ${label} di ${channel} dihapus dan update otomatis dihentikan.`);
  }

  async function execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (err) {
      if (err.code === 10062 || err.code === 40060) {
        console.warn(
          `[command] /${name} tidak sempat dijawab (kode ${err.code}). Biasanya karena ada 2 proses bot ` +
            'dengan token yang sama. Cek `pm2 list` / `ps aux | grep node` dan matikan proses lama.',
        );
        return;
      }
      throw err;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'kirim') return handleKirim(interaction);
    if (sub === 'refresh') return handleRefresh(interaction);
    if (sub === 'stop') return handleStop(interaction);
  }

  return { data, execute };
}

/** /welcome test → kirim contoh pesan welcome memakai akun kamu sendiri. */
const welcomeCommand = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Pesan welcome member baru')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Kirim contoh pesan welcome (pakai akun kamu) untuk cek tampilan')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Kirim contoh ke channel ini (default: channel welcome di welcome.json)')
            .addChannelTypes(...TEXT_CHANNELS),
        ),
    ),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const res = await sendWelcome(member, { channelOverride: interaction.options.getChannel('channel') });
    return interaction.editReply(res.ok ? `✅ Contoh welcome dikirim ke ${res.channel}.` : `❌ ${res.reason}`);
  },
};

const commands = [
  makeCardCommand({ name: 'maps', kind: 'maps', description: 'Card daftar map Roblox KokoKrunch Studios' }),
  makeCardCommand({ name: 'catalog', kind: 'catalog', description: 'Card item catalog KokoKrunch Studios' }),
  welcomeCommand,
];

module.exports = { commands };
