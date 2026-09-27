const fs = require('fs');
const path = require('path');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
} = require('discord.js');

const FILE = path.join(__dirname, '..', 'rules.json');
const TRANSLATE_BUTTON = 'rules:en';

// Discord membatasi total teks 4000 karakter per pesan (Components V2) → sisakan ruang aman.
const MAX_CHARS_PER_MESSAGE = 3800;
const MAX_COMPONENTS_PER_MESSAGE = 35;
const NO_PINGS = { parse: [] }; // @everyone/@here di teks rules tidak mem-ping siapa pun

/** Dibaca ulang tiap dipakai → edit rules.json tidak perlu restart bot. */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('[rules] rules.json tidak bisa dibaca:', err.message);
    return null;
  }
}

function parseColor(value) {
  const n = parseInt(String(value || '').replace('#', ''), 16);
  return Number.isNaN(n) ? 0x5865f2 : n;
}

/**
 * Ubah daftar section menjadi beberapa pesan (masing-masing ≤ batas Discord).
 * Satu section = satu kotak berwarna; kalau section terlalu panjang, dipecah jadi
 * beberapa kotak dengan warna sama di pesan berikutnya.
 */
function buildMessages(sections) {
  const messages = [];
  let current = null; // { containers: [], chars, count }

  const newMessage = () => {
    current = { containers: [], chars: 0, count: 0 };
    messages.push(current);
  };
  newMessage();

  for (const section of sections || []) {
    const color = parseColor(section.color);
    let box = null;

    for (const raw of section.texts || []) {
      const text = String(raw).slice(0, MAX_CHARS_PER_MESSAGE);
      const needed = text.length;
      const overflow =
        current.chars + needed > MAX_CHARS_PER_MESSAGE || current.count + 3 > MAX_COMPONENTS_PER_MESSAGE;

      if (overflow && current.count > 0) {
        newMessage();
        box = null;
      }
      if (!box) {
        box = new ContainerBuilder().setAccentColor(color);
        current.containers.push(box);
        current.count += 1;
      } else {
        box.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Large));
        current.count += 1;
      }
      box.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      current.chars += needed;
      current.count += 1;
    }
  }
  return messages.filter((m) => m.containers.length);
}

function translateRow(cfg) {
  const b = cfg.translateButton || {};
  const button = new ButtonBuilder()
    .setCustomId(TRANSLATE_BUTTON)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(b.label || 'Bahasa Inggris');
  if (b.emoji) button.setEmoji(b.emoji);
  return new ActionRowBuilder().addComponents(button);
}

/** Payload pesan untuk satu bahasa. withButton → tombol terjemahan di pesan terakhir. */
function buildPayloads(cfg, lang, { withButton = false, ephemeral = false } = {}) {
  const messages = buildMessages(cfg.languages?.[lang]);
  return messages.map((m, i) => {
    const components = [...m.containers];
    if (withButton && i === messages.length - 1) components.push(translateRow(cfg));
    let flags = MessageFlags.IsComponentsV2;
    if (ephemeral) flags |= MessageFlags.Ephemeral;
    return { components, flags, allowedMentions: NO_PINGS };
  });
}

/** Tombol "Bahasa Inggris": tampilkan versi Inggris khusus untuk yang klik. */
async function handleTranslateButton(interaction) {
  const cfg = loadConfig();
  const payloads = cfg ? buildPayloads(cfg, 'en', { ephemeral: true }) : [];
  if (!payloads.length) {
    return interaction.reply({ content: '❌ English version is not available yet.', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply(payloads[0]);
  for (const p of payloads.slice(1)) await interaction.followUp(p);
}

/** /rules [channel] → kirim rules versi Indonesia + tombol Bahasa Inggris. */
const rulesCommand = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Kirim rules / community guidelines server')
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
    const cfg = loadConfig();
    if (!cfg) return interaction.editReply('❌ rules.json tidak bisa dibaca (cek format JSON-nya).');

    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return interaction.editReply(`❌ Bot tidak punya izin kirim pesan di ${channel}.`);
    }

    const payloads = buildPayloads(cfg, 'id', { withButton: true });
    if (!payloads.length) return interaction.editReply('❌ Isi rules (languages.id) di rules.json masih kosong.');

    for (const p of payloads) await channel.send(p);
    return interaction.editReply(`✅ Rules dikirim ke ${channel} (${payloads.length} pesan).`);
  },
};

module.exports = { rulesCommand, handleTranslateButton, TRANSLATE_BUTTON, buildPayloads, loadConfig };
