const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
} = require('discord.js');

const FILE = path.join(__dirname, '..', 'voice-finder.json');
const OPEN_BUTTON = 'vf:open';
const MODAL_ID = 'vf:modal';
const INPUT_ID = 'vf:query';
const MAX_RESULTS = 5;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('[voice-finder] voice-finder.json tidak bisa dibaca:', err.message);
    return {};
  }
}

function parseColor(value, fallback) {
  const n = parseInt(String(value || '').replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

const norm = (s) => String(s || '').toLowerCase().replace(/^@/, '').trim();

/** Skor kecocokan: 3 = sama persis, 2 = diawali, 1 = mengandung, 0 = tidak cocok. */
function matchScore(member, query) {
  const names = [member.user.username, member.user.globalName, member.displayName, member.nickname].map(norm);
  let best = 0;
  for (const n of names) {
    if (!n) continue;
    if (n === query) return 3;
    if (n.startsWith(query)) best = Math.max(best, 2);
    else if (n.includes(query)) best = Math.max(best, 1);
  }
  return best;
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

/** Panel: embed + tombol "Cari Username". */
function buildPanel(guild, cfg) {
  const p = cfg.panel || {};
  const icon = guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.color, 0x5865f2))
    .setTitle(p.title || '🔎 Cari Teman di Voice')
    .setDescription(p.description || 'Klik tombol di bawah untuk mencari member di voice.')
    .setFooter({ text: p.footer || guild.name, iconURL: icon })
    .setTimestamp(new Date());
  if (icon) embed.setThumbnail(icon);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(OPEN_BUTTON)
      .setStyle(ButtonStyle.Primary)
      .setLabel(p.button || 'Cari Username')
      .setEmoji('🔍'),
  );
  return { embeds: [embed], components: [row] };
}

/** Klik "Cari Username" → munculkan form. */
async function handleOpenButton(interaction) {
  const m = loadConfig().modal || {};
  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle((m.title || 'Cari Member di Voice').slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_ID)
          .setLabel((m.label || 'Username / nama member').slice(0, 45))
          .setPlaceholder((m.placeholder || 'contoh: andiraharja').slice(0, 100))
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true),
      ),
    );
  return interaction.showModal(modal);
}

/** Form dikirim → cari member di semua voice channel. */
async function handleSearchModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const cfg = loadConfig();
  const query = norm(interaction.fields.getTextInputValue(INPUT_ID));
  const guild = interaction.guild;
  const searcher = interaction.member;

  // Kandidat = semua orang yang sedang di voice DAN voice-nya boleh dilihat oleh si pencari.
  const matches = [];
  for (const vs of guild.voiceStates.cache.values()) {
    if (!vs.channelId || !vs.member || vs.member.user.bot) continue;
    const channel = vs.channel;
    if (!channel?.permissionsFor(searcher)?.has(PermissionFlagsBits.ViewChannel)) continue;
    const score = matchScore(vs.member, query);
    if (score > 0) matches.push({ vs, member: vs.member, channel, score });
  }
  matches.sort((a, b) => b.score - a.score || a.member.displayName.localeCompare(b.member.displayName));

  if (!matches.length) {
    // Cek apakah orangnya ada di server tapi tidak sedang di voice.
    const found = await guild.members.search({ query, limit: 1 }).catch(() => null);
    const who = found?.first();
    const embed = new EmbedBuilder()
      .setColor(parseColor(cfg.notFoundColor, 0xed4245))
      .setTitle('❌ Tidak ditemukan di voice')
      .setDescription(
        who
          ? `${who} (\`${who.user.username}\`) sedang **tidak berada di voice channel** mana pun.`
          : `Tidak ada member dengan nama \`${query}\` yang sedang berada di voice.\nPastikan ejaan username-nya benar.`,
      );
    return interaction.editReply({ embeds: [embed] });
  }

  const top = matches.slice(0, MAX_RESULTS);
  const embeds = top.map(({ vs, member, channel }) => {
    const limit = channel.userLimit ? `/${channel.userLimit}` : '';
    return new EmbedBuilder()
      .setColor(parseColor(cfg.foundColor, 0x43b581))
      .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL({ size: 128 }) })
      .setTitle('🔊 Sedang di voice')
      .setThumbnail(member.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: 'Member', value: `${member}\n\`${member.user.username}\``, inline: true },
        { name: 'Voice Channel', value: `${channel}`, inline: true },
        { name: 'Isi Voice', value: `👥 ${channel.members.size}${limit} orang`, inline: true },
        { name: 'Status', value: statusText(vs), inline: false },
      );
  });

  const buttons = top.map(({ channel }) =>
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(`Join ${channel.name}`.slice(0, 80))
      .setEmoji('🔊')
      .setURL(`https://discord.com/channels/${guild.id}/${channel.id}`),
  );
  // Satu tombol per voice channel (hindari tombol dobel kalau beberapa hasil di voice yang sama).
  const seen = new Set();
  const unique = buttons.filter((b, i) => {
    const id = top[i].channel.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const extra = matches.length > MAX_RESULTS ? `Ditemukan ${matches.length} member, menampilkan ${MAX_RESULTS} teratas. Ketik username lebih lengkap untuk hasil lebih tepat.` : null;
  return interaction.editReply({
    content: extra,
    embeds,
    components: [new ActionRowBuilder().addComponents(unique)],
  });
}

/** /cari-voice [channel] → kirim panel. */
const voiceFinderCommand = {
  data: new SlashCommandBuilder()
    .setName('cari-voice')
    .setDescription('Kirim panel untuk mencari member yang sedang di voice')
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
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return interaction.editReply(`❌ Bot butuh izin View Channel, Send Messages, dan Embed Links di ${channel}.`);
    }
    await channel.send(buildPanel(interaction.guild, loadConfig()));
    return interaction.editReply(`✅ Panel cari voice dikirim ke ${channel}.`);
  },
};

module.exports = { voiceFinderCommand, handleOpenButton, handleSearchModal, OPEN_BUTTON, MODAL_ID };
