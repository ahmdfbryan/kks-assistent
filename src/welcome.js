const fs = require('fs');
const path = require('path');
const {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const FILE = path.join(__dirname, '..', 'welcome.json');
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));

/** Dibaca ulang tiap dipakai → edit welcome.json tidak perlu restart bot. */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('[welcome] welcome.json tidak bisa dibaca:', err.message);
    return null;
  }
}

function parseColor(value) {
  const n = parseInt(String(value || '').replace('#', ''), 16);
  return Number.isNaN(n) ? 0xe53935 : n;
}

function fill(text, member) {
  return String(text || '')
    .replace(/\{name\}/g, member.displayName)
    .replace(/\{username\}/g, member.user.username)
    .replace(/\{mention\}/g, `<@${member.id}>`)
    .replace(/\{server\}/g, member.guild.name)
    .replace(/\{memberCount\}/g, String(member.guild.memberCount))
    .replace(/\{channel:(\d{17,20})\}/g, '<#$1>');
}

function thumbnailUrl(setting, member) {
  if (!setting || setting === 'avatar') return member.displayAvatarURL({ extension: 'png', size: 256 });
  if (setting === 'server') return member.guild.iconURL({ extension: 'png', size: 256 });
  return /^https?:\/\//.test(setting) ? setting : null;
}

function buttonUrl(btn, guildId) {
  if (btn.url && /^https?:\/\//.test(btn.url)) return btn.url;
  if (isId(btn.channelId)) return `https://discord.com/channels/${guildId}/${btn.channelId}`;
  return null;
}

/** Susun pesan welcome (2 kotak) untuk satu member. */
function buildWelcomeMessage(member, cfg) {
  const color = parseColor(cfg.accentColor);
  const components = [];

  if (cfg.mentionMember) {
    components.push(new TextDisplayBuilder().setContent(`<@${member.id}>`));
  }

  // Kotak 1 — Selamat datang (+ foto di kanan)
  const w = cfg.welcome || {};
  const welcomeText = new TextDisplayBuilder().setContent(
    `## ${fill(w.title, member)}\n${fill(w.description, member)}`.trim(),
  );
  const box1 = new ContainerBuilder().setAccentColor(color);
  const thumb = thumbnailUrl(w.thumbnail, member);
  if (thumb) {
    box1.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(welcomeText)
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)),
    );
  } else {
    box1.addTextDisplayComponents(welcomeText);
  }
  components.push(box1);

  // Kotak 2 — Rules & Guide Server (+ tombol, dipisah garis)
  const r = cfg.rules || {};
  const box2 = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${fill(r.title, member)}\n${fill(r.description, member)}`.trim()),
    );

  const buttons = (r.buttons || [])
    .map((b) => ({ label: b.label, url: buttonUrl(b, member.guild.id) }))
    .filter((b) => b.label && b.url);

  buttons.forEach((b, i) => {
    if (i > 0) box2.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    box2.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(b.label.slice(0, 80)).setURL(b.url),
      ),
    );
  });
  components.push(box2);

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: cfg.mentionMember ? [member.id] : [] },
  };
}

/** Kirim welcome ke channel yang diatur di welcome.json. */
async function sendWelcome(member, { channelOverride = null } = {}) {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, reason: 'welcome.json tidak bisa dibaca (cek format JSON-nya).' };
  if (!channelOverride && cfg.enabled === false) return { ok: false, reason: 'Welcome sedang dimatikan (enabled: false).' };

  let channel = channelOverride;
  if (!channel) {
    if (!isId(cfg.channelId)) return { ok: false, reason: 'channelId di welcome.json belum diisi.' };
    channel = await member.guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel?.isTextBased()) return { ok: false, reason: `Channel ${cfg.channelId} tidak ditemukan.` };
  }

  const perms = channel.permissionsFor(member.guild.members.me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    return { ok: false, reason: `Bot tidak punya izin kirim pesan di ${channel}.` };
  }

  await channel.send(buildWelcomeMessage(member, cfg));
  return { ok: true, channel };
}

/** Pasang listener member join. */
function registerWelcome(client) {
  client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    try {
      const res = await sendWelcome(member);
      if (!res.ok) console.warn(`[welcome] ${member.user.tag}: ${res.reason}`);
    } catch (err) {
      console.error(`[welcome] gagal kirim welcome untuk ${member.user.tag}:`, err.message);
    }
  });
}

module.exports = { registerWelcome, sendWelcome, buildWelcomeMessage, loadConfig };
