const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
} = require('discord.js');

const FILE = path.join(__dirname, '..', 'voice-finder.json');
const VERIFY_FILE = path.join(__dirname, '..', 'verify.json');
const PANEL_FILE = path.join(__dirname, '..', 'data', 'voice-finder-panel.json');
const SELECT_ID = 'vf:select';
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
const loadConfig = () => readJson(FILE, {});

function parseColor(value, fallback) {
  const n = parseInt(String(value || '').replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

// ---------- Lokasi panel (untuk sticky) ----------
let panels = readJson(PANEL_FILE, {}); // { "<channelId>": "<messageId>" }
function savePanels() {
  fs.mkdirSync(path.dirname(PANEL_FILE), { recursive: true });
  fs.writeFileSync(PANEL_FILE, JSON.stringify(panels, null, 2));
}

// ---------- Tampilan ----------
function buildPanel(guild, cfg) {
  const p = cfg.panel || {};
  const icon = guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.color, 0x5865f2))
    .setTitle(p.title || '🔎 Cari Teman di Voice')
    .setDescription(p.description || 'Pilih member di bawah untuk melihat dia sedang di voice mana.')
    .setFooter({ text: p.footer || guild.name, iconURL: icon });
  if (icon) embed.setThumbnail(icon);

  const select = new UserSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder(p.placeholder || '🔍 Ketik username / nama member...')
    .setMinValues(1)
    .setMaxValues(1);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

function statusText(vs) {
  const s = [];
  if (vs.selfDeaf || vs.serverDeaf) s.push('🔇 Deafen');
  else if (vs.selfMute || vs.serverMute) s.push('🎙️ Mute');
  else s.push('🎙️ Aktif');
  if (vs.streaming) s.push('🔴 Live');
  if (vs.selfVideo) s.push('📷 Kamera');
  return s.join(' • ');
}

/**
 * Role yang dipakai untuk menilai "voice ini boleh diumumkan ke publik?".
 * Pakai role verifikasi dari verify.json kalau ada, kalau tidak pakai @everyone.
 */
function publicRole(guild) {
  const roleId = readJson(VERIFY_FILE, {}).roleId;
  return (isId(roleId) && guild.roles.cache.get(roleId)) || guild.roles.everyone;
}

// ---------- Saat member dipilih ----------
async function handleSelect(interaction) {
  const cfg = loadConfig();
  const guild = interaction.guild;
  const userId = interaction.values[0];
  const member = await guild.members.fetch(userId).catch(() => null);
  const vs = guild.voiceStates.cache.get(userId);
  const channel = vs?.channel;

  // Tidak di voice / voice tidak bisa dilihat pencari → balasan pribadi saja.
  const canSee = channel?.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ViewChannel);
  if (!member || member.user.bot || !channel || !canSee) {
    const embed = new EmbedBuilder()
      .setColor(parseColor(cfg.notFoundColor, 0xed4245))
      .setTitle('❌ Tidak sedang di voice')
      .setDescription(
        member
          ? `${member} (\`${member.user.username}\`) sedang **tidak berada di voice channel** mana pun.`
          : 'Member tidak ditemukan di server ini.',
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const limit = channel.userLimit ? `/${channel.userLimit}` : '';
  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.foundColor, 0x43b581))
    .setAuthor({ name: `Dicari oleh ${interaction.member.displayName}`, iconURL: interaction.user.displayAvatarURL({ size: 64 }) })
    .setTitle(`🔊 ${member.displayName} sedang di voice`)
    .setThumbnail(member.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      { name: 'Member', value: `${member}\n\`${member.user.username}\``, inline: true },
      { name: 'Voice Channel', value: `${channel}`, inline: true },
      { name: 'Isi Voice', value: `👥 ${channel.members.size}${limit} orang`, inline: true },
      { name: 'Status', value: statusText(vs), inline: false },
    )
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(`Join ${channel.name}`.slice(0, 80))
      .setEmoji('🔊')
      .setURL(`https://discord.com/channels/${guild.id}/${channel.id}`),
  );

  // Voice private (tidak bisa dilihat member biasa) → jangan diumumkan ke publik.
  const isPublicVoice = channel.permissionsFor(publicRole(guild))?.has(PermissionFlagsBits.ViewChannel);
  const payload = { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
  if (!isPublicVoice) payload.flags = MessageFlags.Ephemeral;

  await interaction.reply(payload);

  // Hapus hasil publik otomatis setelah X menit (0 = tidak dihapus).
  const minutes = Number(cfg.deleteResultAfterMinutes) || 0;
  if (isPublicVoice && minutes > 0) {
    setTimeout(() => interaction.deleteReply().catch(() => {}), minutes * 60 * 1000);
  }
}

// ---------- Sticky panel ----------
const timers = new Map();
const busy = new Set();

async function repostPanel(channel) {
  if (busy.has(channel.id)) return;
  busy.add(channel.id);
  try {
    const oldId = panels[channel.id];
    const sent = await channel.send(buildPanel(channel.guild, loadConfig()));
    panels[channel.id] = sent.id;
    savePanels();
    if (oldId) await channel.messages.delete(oldId).catch(() => {});
  } catch (err) {
    console.error(`[voice-finder] gagal memindahkan panel di #${channel.name}:`, err.message);
  } finally {
    busy.delete(channel.id);
  }
}

/** Setiap ada pesan baru di channel panel → panel dipindah ke paling bawah (jeda singkat supaya tidak spam). */
function registerStickyPanel(client) {
  client.on('messageCreate', (message) => {
    const panelId = panels[message.channelId];
    if (!panelId || message.id === panelId) return;
    // Abaikan panel yang baru dikirim bot sendiri.
    const isPanel =
      message.author.id === client.user.id &&
      message.components?.some((row) => row.components?.some((c) => c.customId === SELECT_ID));
    if (isPanel) return;

    const delay = Math.max(2, Number(loadConfig().stickyDelaySeconds) || 5) * 1000;
    clearTimeout(timers.get(message.channelId));
    timers.set(
      message.channelId,
      setTimeout(() => {
        timers.delete(message.channelId);
        repostPanel(message.channel);
      }, delay),
    );
  });

  client.on('channelDelete', (ch) => {
    if (panels[ch.id]) {
      delete panels[ch.id];
      savePanels();
    }
  });
}

// ---------- /cari-voice ----------
const voiceFinderCommand = {
  data: new SlashCommandBuilder()
    .setName('cari-voice')
    .setDescription('Kirim panel (sticky) untuk mencari member yang sedang di voice')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel tujuan (default: channel ini)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const perms = channel.permissionsFor(interaction.guild.members.me);
    const needed = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
    ];
    if (!perms?.has(needed)) {
      return interaction.editReply(
        `❌ Bot butuh izin View Channel, Send Messages, Embed Links, dan Read Message History di ${channel}.`,
      );
    }
    await repostPanel(channel); // kirim panel baru + hapus panel lama di channel ini
    return interaction.editReply(`✅ Panel cari voice dikirim ke ${channel} dan akan selalu berada di paling bawah.`);
  },
};

module.exports = { voiceFinderCommand, handleSelect, registerStickyPanel, SELECT_ID };
