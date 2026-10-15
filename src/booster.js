const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  MessageType,
  Events,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require('discord.js');

/**
 * Booster (Components V2): ucapan terima kasih otomatis saat member mem-boost server.
 * Terdeteksi dari pesan sistem boost Discord + perubahan status booster member (tanpa dobel).
 * Member lain bisa klik "💖 Ucapkan Terima Kasih" di kartu. Teks di booster.json.
 */
const FILE = path.join(__dirname, '..', 'booster.json');
const DATA = path.join(__dirname, '..', 'data', 'boosters.json');
const V2 = MessageFlags.IsComponentsV2;
const EPH = MessageFlags.Ephemeral;
const BOOST_TYPES = [MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3];
const TIER_AT = [0, 2, 7, 14]; // jumlah boost minimal untuk Level 0/1/2/3
const DEDUPE_MS = 3 * 60 * 1000;
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));
const num = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
const ts = (ms, s = 'f') => `<t:${Math.floor(ms / 1000)}:${s}>`;
let client = null;

let warned = false;
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (!warned) console.error('[booster] booster.json tidak bisa dibaca:', err.message);
    warned = true;
    return {};
  }
}
function loadData() {
  try {
    return { seq: 0, records: {}, last: {}, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) };
  } catch {
    return { seq: 0, records: {}, last: {} };
  }
}
const data = loadData();
function save() {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(`${DATA}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${DATA}.tmp`, DATA);
}
const hex = (v, fb) => {
  const n = parseInt(String(v || '').replace('#', ''), 16);
  return Number.isNaN(n) ? fb : n;
};
const fill = (t, guild, member) =>
  String(t || '')
    .replace(/\{user\}/g, member ? `<@${member.id}>` : '')
    .replace(/\{name\}/g, member ? member.displayName || member.user?.username || '' : '')
    .replace(/\{server\}/g, guild.name);

// ───────────────────────── Tampilan (Components V2) ─────────────────────────
const text = (c) => new TextDisplayBuilder().setContent(String(c).slice(0, 4000));
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

function card({ color, header, thumb, image, blocks = [], footer, rows = [], top }) {
  const box = new ContainerBuilder().setAccentColor(color);
  if (thumb) box.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(header)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)));
  else box.addTextDisplayComponents(text(header));
  if (image) box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
  for (const b of blocks.filter(Boolean)) {
    box.addSeparatorComponents(line());
    box.addTextDisplayComponents(text(b));
  }
  if (footer) {
    box.addSeparatorComponents(line());
    box.addTextDisplayComponents(text(`-# ${footer}`));
  }
  for (const r of rows.filter(Boolean)) box.addActionRowComponents(r);
  return { components: top ? [text(top), box] : [box], flags: V2, allowedMentions: { parse: [] } };
}

/** Level boost server + progres ke level berikutnya. */
function levelBlock(guild, tierUp) {
  const count = guild.premiumSubscriptionCount || 0;
  const tier = Number(guild.premiumTier) || 0;
  const lines = [`🚀 **Total Boost:** \`${num(count)} boost\``, `🏆 **Level Server:** \`Level ${tier}\``];
  if (tier < 3) {
    const need = TIER_AT[tier + 1];
    const from = TIER_AT[tier];
    const pct = Math.max(0, Math.min(1, (count - from) / (need - from)));
    const filled = Math.round(pct * 10);
    lines.push(`🎯 **Menuju Level ${tier + 1}:** \`${num(Math.max(0, need - count))} boost lagi\``, `${'🟪'.repeat(filled)}${'⬛'.repeat(10 - filled)} \`${Math.round(pct * 100)}%\``);
  } else {
    lines.push('👑 **Level maksimal tercapai!** Terima kasih para booster! 💜');
  }
  return `### 📊 Status Boost Server${tierUp ? `\n🎉 **Server naik ke Level ${tier}!**` : ''}\n${lines.join('\n')}`;
}

function activeBoosters(guild) {
  return guild.members.cache.filter((m) => m.premiumSinceTimestamp).sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp);
}

/** Kartu ucapan terima kasih di channel booster. */
function buildThanks(guild, cfg, member, rec) {
  const since = member.premiumSinceTimestamp || rec.at;
  const userBoosts = Object.values(data.records).filter((r) => r.userId === member.id && !r.test && r.id <= rec.id).length;
  const info = [
    `👤 **Booster:** <@${member.id}> • \`@${member.user.username}\``,
    `🔢 **Boost ke:** \`#${num(rec.no)}\` di server${userBoosts > 1 ? ` • \`${num(userBoosts)}x\` dari member ini` : ''}`,
    `📅 **Boost sejak:** ${ts(since, 'D')} (${ts(since, 'R')})`,
  ];
  const thanks = rec.thanks?.length || 0;
  return card({
    color: hex(cfg.color, 0xf47fff),
    top: cfg.pingBooster !== false ? `💎 <@${member.id}>` : null,
    thumb: member.displayAvatarURL({ extension: 'png', size: 256 }),
    header: `# ${fill(cfg.title || '💎 Terima Kasih Sudah Boost!', guild, member)}\n${fill(cfg.message || 'Hai {user}, terima kasih telah mem-boost **{server}**! 🚀', guild, member)}`,
    image: cfg.bannerImage || null,
    blocks: [
      info.join('\n'),
      rec.tierUp ? `🎉 **Server naik ke Level ${Number(guild.premiumTier) || 0}!** Terima kasih atas dukunganmu! 💜` : null,
      `💖 **${num(thanks)} member** berterima kasih kepada <@${member.id}>`,
    ],
    footer: `💎 ${guild.name} • Server Booster • ${ts(rec.at, 'f')}`,
    rows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bs:thx:${rec.id}`)
          .setLabel(`${cfg.thanksButton || 'Ucapkan Terima Kasih'} (${num(thanks)})`)
          .setEmoji('💖')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

function buildDM(guild, cfg, member) {
  return card({
    color: hex(cfg.color, 0xf47fff),
    thumb: guild.iconURL({ extension: 'png', size: 256 }),
    header: `# ${fill(cfg.dmTitle || '💎 Terima Kasih, Booster!', guild, member)}\n${fill(cfg.dmMessage || 'Terima kasih sudah mem-boost **{server}**! 💖', guild, member)}`,
    footer: `💎 ${guild.name} • Server Booster • ${ts(Date.now(), 'f')}`,
  });
}

// ───────────────────────── Deteksi boost ─────────────────────────
async function onBoost(guild, member, { tierUp = false, source = 'event', test = false } = {}) {
  const cfg = loadConfig();
  if (!test) {
    // Pesan sistem & perubahan status bisa datang bersamaan → kirim 1x saja.
    const last = data.last[member.id] || 0;
    if (Date.now() - last < DEDUPE_MS) {
      const rec = Object.values(data.records).filter((r) => r.userId === member.id && !r.test).sort((a, b) => b.at - a.at)[0];
      if (tierUp && rec && !rec.tierUp) {
        rec.tierUp = true;
        save();
        await editThanks(guild, cfg, member, rec);
      }
      return null;
    }
    data.last[member.id] = Date.now();
  }
  const channel = isId(cfg.channelId) ? await guild.channels.fetch(cfg.channelId).catch(() => null) : null;
  if (!channel?.isTextBased()) {
    console.warn('[booster] channelId di booster.json belum benar.');
    return null;
  }
  // Tunggu sebentar supaya jumlah boost server sudah ter-update.
  if (!test) await new Promise((r) => setTimeout(r, 2500));
  const fresh = (await guild.fetch().catch(() => null)) || guild;
  data.seq = (data.seq || 0) + 1;
  const real = Object.values(data.records).filter((r) => !r.test).length;
  const rec = { id: data.seq, no: fresh.premiumSubscriptionCount || real + 1, userId: member.id, at: Date.now(), tierUp, source, thanks: [], channelId: channel.id, messageId: null, test };
  const payload = buildThanks(fresh, cfg, member, rec);
  if (cfg.pingBooster !== false) payload.allowedMentions = { users: [member.id] };
  const msg = await channel.send(payload).catch((e) => {
    console.error('[booster] gagal kirim ucapan:', e.message);
    return null;
  });
  if (!msg) return null;
  rec.messageId = msg.id;
  data.records[rec.id] = rec;
  save();
  if (!test) {
    if (isId(cfg.rewardRoleId)) await member.roles.add(cfg.rewardRoleId, 'Server Booster').catch((e) => console.warn('[booster] gagal beri role:', e.message));
    if (cfg.dmBooster !== false) await member.send(buildDM(fresh, cfg, member)).catch(() => {});
    console.log(`[booster] ${member.user.tag} mem-boost server (${source}).`);
  }
  return { rec, msg, channel };
}

async function editThanks(guild, cfg, member, rec) {
  const ch = await guild.channels.fetch(rec.channelId).catch(() => null);
  if (!ch) return;
  await ch.messages.edit(rec.messageId, { ...buildThanks(guild, cfg, member, rec), allowedMentions: { parse: [] } }).catch(() => {});
}

async function onUnboost(guild, member) {
  const cfg = loadConfig();
  if (isId(cfg.rewardRoleId)) await member.roles.remove(cfg.rewardRoleId, 'Boost berakhir').catch(() => {});
  if (!cfg.logUnboost || !isId(cfg.channelId)) return;
  const ch = await guild.channels.fetch(cfg.channelId).catch(() => null);
  await ch
    ?.send(
      card({
        color: 0x95a5a6,
        header: `### 💔 Boost Berakhir\n<@${member.id}> sudah tidak mem-boost server. Terima kasih atas dukunganmu selama ini! 💜`,
        footer: `${guild.name} • ${ts(Date.now(), 'f')}`,
      }),
    )
    .catch(() => {});
}

// ───────────────────────── Tombol ─────────────────────────
async function handleInteraction(interaction) {
  const id = interaction.customId;
  if (typeof id !== 'string' || !id.startsWith('bs:')) return false;
  const [, action, rid] = id.split(':');
  try {
    const rec = data.records[rid];
    if (action === 'thx') {
      if (!rec) return void (await interaction.reply({ content: '❌ Data ucapan tidak ditemukan.', flags: EPH }));
      if (interaction.user.id === rec.userId) {
        return void (await interaction.reply({ content: '💖 Ini ucapan untukmu! Terima kasih sudah boost server kami. 💎', flags: EPH }));
      }
      if (rec.thanks.includes(interaction.user.id)) {
        return void (await interaction.reply({ content: '💖 Kamu sudah mengucapkan terima kasih untuk booster ini.', flags: EPH }));
      }
      rec.thanks.push(interaction.user.id);
      save();
      const member = await interaction.guild.members.fetch(rec.userId).catch(() => null);
      if (member) await interaction.update(buildThanks(interaction.guild, loadConfig(), member, rec));
      else await interaction.reply({ content: '💖 Terima kasihmu sudah tercatat!', flags: EPH });
      return true;
    }
  } catch (err) {
    console.error('[booster] error:', err);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Terjadi kesalahan, coba lagi.', flags: EPH }).catch(() => {});
  }
  return true;
}

// ───────────────────────── Command /booster ─────────────────────────
const boosterCommand = {
  data: new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Ucapan terima kasih booster server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Kirim contoh ucapan terima kasih booster (cek tampilan)')
        .addUserOption((o) => o.setName('member').setDescription('Default: kamu sendiri')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Daftar member yang sedang mem-boost server'))
    .addSubcommand((s) =>
      s
        .setName('kirim')
        .setDescription('Kirim ucapan terima kasih manual untuk member yang boost')
        .addUserOption((o) => o.setName('member').setDescription('Member booster').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const cfg = loadConfig();

    if (sub === 'list') {
      await guild.members.fetch().catch(() => {});
      const list = [...activeBoosters(guild).values()];
      const shown = list.slice(0, 25).map((m, i) => `\`${i + 1}.\` <@${m.id}> • sejak ${ts(m.premiumSinceTimestamp, 'D')} (${ts(m.premiumSinceTimestamp, 'R')})`);
      return interaction.reply({
        ...card({
          color: hex(cfg.color, 0xf47fff),
          thumb: guild.iconURL({ extension: 'png', size: 256 }),
          header: `## 💎 Daftar Booster (${list.length})\nMember yang sedang mem-boost **${guild.name}**.`,
          blocks: [
            shown.length ? shown.join('\n') : '_Belum ada member yang mem-boost server._',
            list.length > 25 ? `-# …dan ${num(list.length - 25)} booster lainnya` : null,
            levelBlock(guild),
          ],
        }),
        flags: V2 | EPH,
      });
    }

    await interaction.deferReply({ flags: EPH });
    const user = interaction.options.getUser('member') || interaction.user;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.editReply('❌ Member tidak ditemukan di server.');

    if (sub === 'test') {
      const res = await onBoost(guild, member, { test: true, source: 'test' });
      return interaction.editReply(res ? `✅ Contoh ucapan booster dikirim ke ${res.channel}.` : '❌ Gagal mengirim. Cek `channelId` di booster.json & izin bot di channel itu.');
    }
    if (sub === 'kirim') {
      data.last[member.id] = 0; // lewati penyaring dobel
      const res = await onBoost(guild, member, { source: 'manual' });
      return interaction.editReply(res ? `✅ Ucapan terima kasih untuk ${member} dikirim ke ${res.channel}.` : '❌ Gagal mengirim. Cek `channelId` di booster.json & izin bot di channel itu.');
    }
  },
};

function registerBooster(c) {
  client = c;
  // 1) Pesan sistem boost Discord (paling akurat: setiap boost & naik level).
  c.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || !BOOST_TYPES.includes(msg.type)) return;
    const member = msg.member || (await msg.guild.members.fetch(msg.author.id).catch(() => null));
    if (member) onBoost(msg.guild, member, { tierUp: msg.type !== MessageType.GuildBoost, source: 'system' }).catch((e) => console.error('[booster]', e.message));
  });
  // 2) Status booster member berubah (cadangan kalau pesan sistem boost dimatikan).
  c.on(Events.GuildMemberUpdate, (oldM, newM) => {
    if (oldM.partial) return; // data lama tidak diketahui → jangan menebak
    const before = oldM.premiumSinceTimestamp;
    const after = newM.premiumSinceTimestamp;
    if (!before && after) onBoost(newM.guild, newM, { source: 'member' }).catch((e) => console.error('[booster]', e.message));
    else if (before && !after) onUnboost(newM.guild, newM).catch(() => {});
  });
}

module.exports = { boosterCommand, registerBooster, handleInteraction, buildThanks };
