const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, Events } = require('discord.js');
const { state: storeState } = require('./store/state');

/**
 * Server Stats: kategori + voice channel terkunci yang namanya menampilkan angka terkini.
 * Members / Active Tickets / Total Orders. Teks di server-stats.json.
 * Discord membatasi ganti nama channel 2x per 10 menit → di-update tiap updateMinutes (min. 5) & hanya kalau angkanya berubah.
 */
const FILE = path.join(__dirname, '..', 'server-stats.json');
const DATA = path.join(__dirname, '..', 'data', 'server-stats.json');
const KEYS = ['members', 'tickets', 'orders'];
const DEFAULTS = {
  categoryName: '—・✦ Noname Studios Creative ✦・—',
  channels: { members: '👥 Members: {count}', tickets: '🎫 Active Tickets: {count}', orders: '✅ Total Orders: {count}' },
  countBots: false,
  formatNumber: false,
  updateMinutes: 5,
};

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...c, channels: { ...DEFAULTS.channels, ...(c.channels || {}) } };
  } catch {
    return DEFAULTS;
  }
}
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA, 'utf8'));
  } catch {
    return {};
  }
}
const data = loadData(); // { guildId, categoryId, channels: { members, tickets, orders }, lastNames: {} }
function save() {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(`${DATA}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${DATA}.tmp`, DATA);
}

/** Angka terkini untuk setiap channel. */
function values(guild, cfg) {
  const members = cfg.countBots ? guild.memberCount : guild.members.cache.filter((m) => !m.user.bot).size || guild.memberCount;
  const tickets = Object.values(storeState.tickets || {}).filter((t) => t.status === 'open').length;
  const orders = (storeState.stats?.transactions || 0) + (storeState.stats?.rekber || 0);
  return { members, tickets, orders };
}
function nameFor(key, value, cfg) {
  const n = cfg.formatNumber ? Number(value).toLocaleString('id-ID') : String(value);
  return String(cfg.channels[key] || `${key}: {count}`).replace(/\{count\}/g, n).slice(0, 100);
}

/** Izin: semua bisa melihat tapi tidak bisa masuk (gembok 🔒). */
function lockedOverwrites(guild) {
  return [
    { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
  ];
}

let busy = false;
/** Perbarui nama channel yang angkanya berubah. force = abaikan cek nama sama. */
async function update(client, { force = false } = {}) {
  if (busy || !data.guildId) return { ok: false, reason: 'belum di-setup' };
  busy = true;
  try {
    const guild = client.guilds.cache.get(data.guildId);
    if (!guild) return { ok: false, reason: 'server tidak ditemukan' };
    const cfg = loadConfig();
    const v = values(guild, cfg);
    let changed = 0;
    if (data.categoryId) {
      const cat = guild.channels.cache.get(data.categoryId) || (await guild.channels.fetch(data.categoryId).catch(() => null));
      if (cat && cat.name !== cfg.categoryName) await cat.setName(cfg.categoryName).catch(() => {});
    }
    for (const key of KEYS) {
      const id = data.channels?.[key];
      if (!id) continue;
      const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
      if (!ch) continue;
      const name = nameFor(key, v[key], cfg);
      if (!force && ch.name === name) continue;
      // Batas Discord: ganti nama channel 2x / 10 menit. Kalau kena batas, setName menunggu → beri batas waktu.
      await Promise.race([ch.setName(name, 'Server stats'), new Promise((r) => setTimeout(r, 15000))]).catch((e) =>
        console.warn(`[server-stats] gagal ganti nama ${key}:`, e.message),
      );
      changed += 1;
    }
    return { ok: true, changed, values: v };
  } finally {
    busy = false;
  }
}

const serverStatsCommand = {
  data: new SlashCommandBuilder()
    .setName('server-stats')
    .setDescription('Server stats (channel angka otomatis)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('setup').setDescription('Buat kategori & channel server stats di paling atas'))
    .addSubcommand((s) => s.setName('refresh').setDescription('Perbarui angka & nama channel sekarang'))
    .addSubcommand((s) => s.setName('hapus').setDescription('Hapus kategori & channel server stats')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const cfg = loadConfig();
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply('❌ Bot butuh izin **Manage Channels** untuk server stats.');
    }

    if (sub === 'setup') {
      // Hapus yang lama dulu kalau ada (supaya tidak dobel).
      await removeAll(guild);
      const v = values(guild, cfg);
      const category = await guild.channels.create({
        name: cfg.categoryName,
        type: ChannelType.GuildCategory,
        position: 0,
        permissionOverwrites: lockedOverwrites(guild),
      });
      data.guildId = guild.id;
      data.categoryId = category.id;
      data.channels = {};
      for (const key of KEYS) {
        const ch = await guild.channels.create({
          name: nameFor(key, v[key], cfg),
          type: ChannelType.GuildVoice,
          parent: category.id,
          permissionOverwrites: lockedOverwrites(guild),
        });
        data.channels[key] = ch.id;
      }
      save();
      await category.setPosition(0).catch(() => {});
      return interaction.editReply(
        `✅ Server stats dibuat di kategori **${cfg.categoryName}** (paling atas).\n` +
          `👥 ${v.members} • 🎫 ${v.tickets} • ✅ ${v.orders}\nAngka ter-update otomatis tiap ~${Math.max(5, Number(cfg.updateMinutes) || 5)} menit.`,
      );
    }

    if (sub === 'refresh') {
      if (!data.guildId) return interaction.editReply('❌ Server stats belum dibuat. Jalankan `/server-stats setup` dulu.');
      const res = await update(interaction.client, { force: true });
      if (!res.ok) return interaction.editReply(`❌ Gagal: ${res.reason}`);
      return interaction.editReply(
        `✅ Diperbarui: 👥 ${res.values.members} • 🎫 ${res.values.tickets} • ✅ ${res.values.orders}\n` +
          '_Catatan: Discord membatasi ganti nama channel 2x / 10 menit, jadi perubahan bisa tertunda._',
      );
    }

    if (sub === 'hapus') {
      const n = await removeAll(guild);
      return interaction.editReply(n ? '🗑️ Server stats dihapus.' : 'Server stats belum dibuat.');
    }
  },
};

async function removeAll(guild) {
  if (!data.categoryId && !data.channels) return 0;
  let n = 0;
  for (const id of [...Object.values(data.channels || {}), data.categoryId]) {
    if (!id) continue;
    const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
    if (ch) {
      await ch.delete('Server stats dihapus / dibuat ulang').catch(() => {});
      n += 1;
    }
  }
  delete data.categoryId;
  delete data.channels;
  delete data.guildId;
  save();
  return n;
}

function registerServerStats(client) {
  client.once(Events.ClientReady, () => {
    update(client).catch(() => {});
    const every = Math.max(5, Number(loadConfig().updateMinutes) || 5) * 60 * 1000;
    setInterval(() => update(client).catch((e) => console.warn('[server-stats]', e.message)), every);
  });
  // Channel stats dihapus manual → berhenti meng-update channel itu.
  client.on(Events.ChannelDelete, (ch) => {
    if (!data.channels) return;
    let hit = false;
    for (const k of KEYS) if (data.channels[k] === ch.id) (delete data.channels[k], (hit = true));
    if (data.categoryId === ch.id) (delete data.categoryId, (hit = true));
    if (hit) save();
  });
}

module.exports = { serverStatsCommand, registerServerStats, update };
