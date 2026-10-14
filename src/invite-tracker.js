const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  Events,
} = require('discord.js');

/**
 * Invite Log + Top 10 Inviter (sticky).
 * - Member masuk → log siapa yang mengundang (link siapa, kode, total undangan inviter).
 * - Member keluar → log + jumlah undangan inviter dikurangi.
 * - Leaderboard selalu dipindah ke pesan paling bawah setiap ada pesan baru di channel.
 * Setiap member hanya dihitung 1x per inviter (keluar-masuk tidak menggandakan hitungan).
 */
const FILE = path.join(__dirname, '..', 'invites.json');
const DATA = path.join(__dirname, '..', 'data', 'invites.json');
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));
const num = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
const ts = (ms, s = 'R') => `<t:${Math.floor(ms / 1000)}:${s}>`;

// Pengaturan bawaan kalau invites.json belum ada / rusak (supaya bot tetap jalan).
const DEFAULT_CONFIG = { channelId: '1559920442318258359', fakeDays: 7, stickyDelaySeconds: 4, colors: {}, leaderboard: {} };
let warned = false;
function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    warned = false;
    return { ...DEFAULT_CONFIG, ...cfg };
  } catch (err) {
    if (!warned) console.error('[invites] invites.json tidak bisa dibaca (pakai pengaturan bawaan):', err.message);
    warned = true; // cukup 1x, tidak spam log
    return DEFAULT_CONFIG;
  }
}
function loadData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    return { members: {}, leaderboard: null, ...d };
  } catch {
    return { members: {}, leaderboard: null };
  }
}
const data = loadData();
function save() {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(`${DATA}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${DATA}.tmp`, DATA);
}

const color = (cfg, key, fb) => {
  const n = parseInt(String(cfg.colors?.[key] || '').replace('#', ''), 16);
  return Number.isNaN(n) ? fb : n;
};
const fill = (t, guild) => String(t || '').replace(/\{server\}/g, guild.name);
const footer = (guild) => ({ text: guild.name, iconURL: guild.iconURL({ extension: 'png', size: 128 }) || undefined });

// ───────────────────────── Statistik ─────────────────────────
/** { inviterId: { total, left, fake, valid } } dihitung dari data member. */
function computeStats() {
  const stats = {};
  for (const m of Object.values(data.members)) {
    if (!m.inviterId || m.inviterId === 'vanity') continue;
    const s = (stats[m.inviterId] ||= { total: 0, left: 0, fake: 0, valid: 0 });
    s.total += 1;
    if (m.left) s.left += 1;
    else if (m.fake) s.fake += 1;
    else s.valid += 1;
  }
  return stats;
}
const statsOf = (userId) => computeStats()[userId] || { total: 0, left: 0, fake: 0, valid: 0 };

// ───────────────────────── Cache undangan ─────────────────────────
const cache = new Map(); // guildId → Map(code → { uses, inviterId, maxUses })
const vanityUses = new Map(); // guildId → uses
const queues = new Map(); // guildId → Promise (supaya join beruntun diproses berurutan)

async function snapshot(guild) {
  const invites = await guild.invites.fetch({ cache: false });
  const map = new Map();
  for (const inv of invites.values()) map.set(inv.code, { uses: inv.uses || 0, inviterId: inv.inviter?.id || inv.inviterId || null, maxUses: inv.maxUses || 0 });
  return map;
}
async function refreshCache(guild) {
  try {
    cache.set(guild.id, await snapshot(guild));
    if (guild.vanityURLCode) {
      const v = await guild.fetchVanityData().catch(() => null);
      if (v) vanityUses.set(guild.id, v.uses);
    }
  } catch (err) {
    console.warn(`[invites] gagal membaca undangan ${guild.name} (butuh izin Manage Server):`, err.message);
  }
}

/** Cari undangan yang dipakai member baru: { inviterId, code } | { inviterId: 'vanity' } | null */
async function detectInvite(guild) {
  const before = cache.get(guild.id) || new Map();
  let after;
  try {
    after = await snapshot(guild);
  } catch {
    return null;
  }
  cache.set(guild.id, after);
  for (const [code, inv] of after) {
    const old = before.get(code);
    if (inv.uses > (old?.uses || 0)) return { inviterId: inv.inviterId, code };
  }
  // Undangan sekali pakai / batas pemakaian habis → hilang dari daftar setelah dipakai.
  for (const [code, inv] of before) {
    if (!after.has(code) && inv.maxUses && inv.uses + 1 >= inv.maxUses) return { inviterId: inv.inviterId, code };
  }
  if (guild.vanityURLCode) {
    const v = await guild.fetchVanityData().catch(() => null);
    const prev = vanityUses.get(guild.id) ?? 0;
    if (v) vanityUses.set(guild.id, v.uses);
    if (v && v.uses > prev) return { inviterId: 'vanity', code: guild.vanityURLCode };
  }
  return null;
}

// ───────────────────────── Tampilan ─────────────────────────
function inviterText(rec) {
  if (!rec?.inviterId) return '`❔ Tidak diketahui`';
  if (rec.inviterId === 'vanity') return '`🔗 Vanity URL`';
  return `<@${rec.inviterId}>`;
}

function buildJoinLog(member, rec, cfg) {
  const guild = member.guild;
  const s = rec?.inviterId && rec.inviterId !== 'vanity' ? statsOf(rec.inviterId) : null;
  const e = new EmbedBuilder()
    .setColor(color(cfg, 'join', 0x2ecc71))
    .setAuthor({ name: '📥 Member Baru Bergabung', iconURL: member.user.displayAvatarURL({ size: 128 }) })
    .setDescription(`<@${member.id}> bergabung ke **${guild.name}**! 🎉`)
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      { name: '👤 Member', value: `\`${member.user.globalName || member.user.username}\`\n┗ @${member.user.username}`, inline: true },
      { name: '🎫 Diundang Oleh', value: inviterText(rec), inline: true },
      { name: '🔗 Kode Undangan', value: rec?.code ? `\`${rec.code}\`` : '`-`', inline: true },
      { name: '📅 Akun Dibuat', value: ts(member.user.createdTimestamp, 'R'), inline: true },
      { name: '🔢 Member Ke-', value: `\`#${num(guild.memberCount)}\``, inline: true },
    );
  if (s) e.addFields({ name: '📊 Undangan Inviter', value: `\`✅ ${num(s.valid)} valid\` • \`📥 ${num(s.total)} total\``, inline: true });
  if (rec?.fake) e.addFields({ name: '⚠️ Akun Baru', value: `Umur akun kurang dari **${num(cfg.fakeDays)} hari** — tidak dihitung di leaderboard.` });
  if (rec?.rejoin) e.addFields({ name: '🔁 Rejoin', value: 'Member ini pernah bergabung sebelumnya.' });
  return { embeds: [e.setFooter(footer(guild)).setTimestamp(new Date())], allowedMentions: { parse: [] } };
}

function buildLeaveLog(member, rec, cfg) {
  const guild = member.guild;
  const s = rec?.inviterId && rec.inviterId !== 'vanity' ? statsOf(rec.inviterId) : null;
  const e = new EmbedBuilder()
    .setColor(color(cfg, 'leave', 0xe74c3c))
    .setAuthor({ name: '📤 Member Keluar', iconURL: member.user.displayAvatarURL({ size: 128 }) })
    .setDescription(`<@${member.id}> telah meninggalkan **${guild.name}**.`)
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      { name: '👤 Member', value: `\`${member.user.globalName || member.user.username}\`\n┗ @${member.user.username}`, inline: true },
      { name: '🎫 Diundang Oleh', value: inviterText(rec), inline: true },
      { name: '⏳ Lama di Server', value: member.joinedTimestamp ? `\`${stay(Date.now() - member.joinedTimestamp)}\`` : '`-`', inline: true },
    );
  if (s) e.addFields({ name: '📊 Undangan Inviter', value: `\`✅ ${num(s.valid)} valid\` • \`📤 ${num(s.left)} keluar\``, inline: true });
  return { embeds: [e.setFooter(footer(guild)).setTimestamp(new Date())], allowedMentions: { parse: [] } };
}

function stay(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} hari` : `${Math.floor(d / 30)} bulan`;
}

function buildLeaderboard(guild, cfg) {
  const lb = cfg.leaderboard || {};
  const medals = ['🥇', '🥈', '🥉'];
  const stats = computeStats();
  const top = Object.entries(stats)
    .filter(([, s]) => s.total > 0)
    .sort((a, b) => b[1].valid - a[1].valid || b[1].total - a[1].total)
    .slice(0, 10);
  const lines = top.length
    ? top.map(([id, s], i) => {
        const rank = medals[i] || `\`#${i + 1}\``;
        const extra = [s.left ? `📤 ${num(s.left)} keluar` : null, s.fake ? `⚠️ ${num(s.fake)} fake` : null].filter(Boolean).join(' • ');
        return `${rank} <@${id}>\n┗ ✅ **${num(s.valid)} undangan**${extra ? ` • ${extra}` : ''}`;
      })
    : [lb.empty || '_Belum ada undangan._'];
  const all = Object.values(stats);
  const e = new EmbedBuilder()
    .setColor(color(cfg, 'brand', 0x3498db))
    .setTitle(fill(lb.title || '🏆 Top 10 Inviter | {server}', guild))
    .setDescription(`${fill(lb.description || '', guild)}\n​\n${lines.join('\n\n')}`.trim())
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
    .addFields(
      { name: '✅ Total Undangan Valid', value: `\`${num(all.reduce((a, s) => a + s.valid, 0))}\``, inline: true },
      { name: '🙋 Total Inviter', value: `\`${num(all.filter((s) => s.total > 0).length)}\``, inline: true },
    )
    .setFooter(footer(guild))
    .setTimestamp(new Date());
  return { embeds: [e], allowedMentions: { parse: [] } };
}

// ───────────────────────── Sticky leaderboard ─────────────────────────
let stickyTimer = null;
let posting = false;
const ownLeaderboards = new Set(); // ID pesan leaderboard yang dikirim bot sendiri
async function repostLeaderboard(client) {
  const loc = data.leaderboard;
  if (!loc || posting) return;
  posting = true;
  try {
    const channel = await client.channels.fetch(loc.channelId).catch(() => null);
    if (!channel) return;
    const sent = await channel.send(buildLeaderboard(channel.guild, loadConfig()));
    ownLeaderboards.add(sent.id);
    if (ownLeaderboards.size > 20) ownLeaderboards.delete(ownLeaderboards.values().next().value);
    const oldId = loc.messageId;
    data.leaderboard = { channelId: channel.id, messageId: sent.id };
    save();
    if (oldId) await channel.messages.delete(oldId).catch(() => {});
  } catch (err) {
    console.error('[invites] gagal memindahkan leaderboard:', err.message);
  } finally {
    posting = false;
  }
}
function scheduleSticky(client) {
  const delay = Math.max(2, Number(loadConfig().stickyDelaySeconds) || 4) * 1000;
  clearTimeout(stickyTimer);
  stickyTimer = setTimeout(() => repostLeaderboard(client), delay);
}

async function sendLog(guild, payload) {
  const cfg = loadConfig();
  if (!isId(cfg.channelId)) return;
  const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(payload).catch((e) => console.error('[invites] gagal kirim log:', e.message));
}

// ───────────────────────── Event ─────────────────────────
function registerInviteTracker(client) {
  client.once(Events.ClientReady, async () => {
    for (const guild of client.guilds.cache.values()) await refreshCache(guild);
    if (data.leaderboard) scheduleSticky(client);
  });
  client.on(Events.InviteCreate, (inv) => {
    const map = cache.get(inv.guild?.id);
    map?.set(inv.code, { uses: inv.uses || 0, inviterId: inv.inviter?.id || inv.inviterId || null, maxUses: inv.maxUses || 0 });
  });
  client.on(Events.InviteDelete, (inv) => {
    // Jangan langsung dihapus: dibutuhkan untuk mendeteksi undangan sekali pakai yang baru saja dipakai.
    setTimeout(() => cache.get(inv.guild?.id)?.delete(inv.code), 10000);
  });
  client.on(Events.GuildCreate, (guild) => refreshCache(guild));

  client.on(Events.GuildMemberAdd, (member) => {
    const prev = queues.get(member.guild.id) || Promise.resolve();
    const next = prev
      .then(async () => {
        const cfg = loadConfig();
        const found = member.user.bot ? null : await detectInvite(member.guild);
        const old = data.members[member.id];
        const fakeMs = (Number(cfg.fakeDays) || 0) * 86400000;
        const rec = {
          inviterId: found?.inviterId || null,
          code: found?.code || null,
          joinedAt: Date.now(),
          fake: Boolean(fakeMs && Date.now() - member.user.createdTimestamp < fakeMs),
          left: false,
          rejoin: Boolean(old),
          bot: member.user.bot || undefined,
        };
        // Undangan diri sendiri tidak dihitung.
        if (rec.inviterId === member.id) rec.inviterId = null;
        if (!member.user.bot) {
          data.members[member.id] = rec;
          save();
        }
        await sendLog(member.guild, buildJoinLog(member, rec, cfg));
      })
      .catch((e) => console.error('[invites] join:', e.message));
    queues.set(member.guild.id, next);
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    if (member.user?.bot) return;
    const rec = data.members[member.id];
    if (rec) {
      rec.left = true;
      rec.leftAt = Date.now();
      save();
    }
    await sendLog(member.guild, buildLeaveLog(member, rec, loadConfig())).catch(() => {});
  });

  // Sticky: setiap ada pesan baru di channel → leaderboard dipindah ke paling bawah.
  client.on(Events.MessageCreate, (message) => {
    const loc = data.leaderboard;
    if (!loc || message.channelId !== loc.channelId || message.id === loc.messageId) return;
    // Jangan bereaksi pada leaderboard yang dikirim bot sendiri (mencegah kirim ulang tanpa henti).
    if (ownLeaderboards.has(message.id)) return;
    if (message.author?.id === client.user?.id && (posting || message.embeds?.[0]?.title?.includes('Inviter'))) return;
    scheduleSticky(client);
  });
}

// ───────────────────────── Command ─────────────────────────
/** /invites [member] → statistik undangan (hanya terlihat yang memakai command). */
const invitesCommand = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Lihat jumlah undangan kamu / member lain')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Default: kamu sendiri')),
  async execute(interaction) {
    const cfg = loadConfig();
    const user = interaction.options.getUser('member') || interaction.user;
    const s = statsOf(user.id);
    const stats = computeStats();
    const rank = Object.entries(stats)
      .sort((a, b) => b[1].valid - a[1].valid || b[1].total - a[1].total)
      .findIndex(([id]) => id === user.id);
    const rec = data.members[user.id];
    const e = new EmbedBuilder()
      .setColor(color(cfg, 'brand', 0x3498db))
      .setAuthor({ name: `${user.globalName || user.username} • Statistik Undangan`, iconURL: user.displayAvatarURL({ size: 128 }) })
      .setThumbnail(user.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: '✅ Valid', value: `\`${num(s.valid)}\``, inline: true },
        { name: '📥 Total', value: `\`${num(s.total)}\``, inline: true },
        { name: '🏆 Peringkat', value: rank >= 0 && s.total ? `\`#${rank + 1}\`` : '`-`', inline: true },
        { name: '📤 Keluar', value: `\`${num(s.left)}\``, inline: true },
        { name: '⚠️ Fake', value: `\`${num(s.fake)}\``, inline: true },
        { name: '🎫 Diundang Oleh', value: inviterText(rec), inline: true },
      )
      .setFooter(footer(interaction.guild))
      .setTimestamp(new Date());
    return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};

/** /invite-log leaderboard [channel] → kirim / pindahkan Top 10 Inviter (sticky). */
const inviteLogCommand = {
  data: new SlashCommandBuilder()
    .setName('invite-log')
    .setDescription('Pengaturan invite log (khusus admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Kirim / pindahkan Top 10 Inviter (sticky di channel invite log)')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Default: channelId di invites.json').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    ),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cfg = loadConfig();
    const channel =
      interaction.options.getChannel('channel') ||
      (isId(cfg.channelId) ? await interaction.guild.channels.fetch(cfg.channelId).catch(() => null) : null) ||
      interaction.channel;
    if (!channel?.isTextBased()) return interaction.editReply('❌ Channel tidak ditemukan.');
    const old = data.leaderboard;
    posting = true;
    const sent = await channel.send(buildLeaderboard(interaction.guild, cfg)).finally(() => {
      posting = false;
    });
    ownLeaderboards.add(sent.id);
    data.leaderboard = { channelId: channel.id, messageId: sent.id };
    save();
    if (old && old.messageId !== sent.id) {
      const oldCh = await interaction.guild.channels.fetch(old.channelId).catch(() => null);
      await oldCh?.messages.delete(old.messageId).catch(() => {});
    }
    await refreshCache(interaction.guild);
    const canRead = cache.has(interaction.guild.id);
    return interaction.editReply(
      `✅ Top 10 Inviter dikirim ke ${channel} dan akan selalu pindah ke pesan paling bawah.` +
        (canRead ? '' : '\n⚠️ Bot belum bisa membaca daftar undangan — beri bot izin **Manage Server** supaya invite log berjalan.'),
    );
  },
};

module.exports = { registerInviteTracker, invitesCommand, inviteLogCommand, buildLeaderboard, computeStats };
