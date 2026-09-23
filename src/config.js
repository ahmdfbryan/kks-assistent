require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] ENV ${name} wajib diisi (lihat .env.example).`);
    process.exit(1);
  }
  return value;
}

function parseColor(value, fallback) {
  if (!value) return fallback;
  const n = parseInt(String(value).replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

function parseIdList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: process.env.GUILD_ID || null,

  groupId: process.env.ROBLOX_GROUP_ID || '625247444',
  robloxDomain: process.env.ROBLOX_DOMAIN || 'roblox.com',
  // Universe ID map yang tidak ingin ditampilkan (pisahkan dengan koma).
  excludeUniverseIds: parseIdList(process.env.EXCLUDE_UNIVERSE_IDS),
  // Urutan card: visits (terbanyak paling akhir) | created (map terlama duluan) | playing | name | updated
  sortBy: (process.env.SORT_BY || 'visits').toLowerCase(),

  // === Catalog ===
  // Urutan card catalog: favorit (terbanyak paling akhir) | terbaru (item terlama duluan) | harga | name
  catalogSortBy: (process.env.CATALOG_SORT_BY || 'favorit').toLowerCase(),
  // true = item yang tidak bisa dibeli (Off Sale / Limited habis) ikut ditampilkan
  catalogIncludeOffsale: /^(1|true|ya|yes)$/i.test(process.env.CATALOG_INCLUDE_OFFSALE || 'false'),
  // Batas jumlah card catalog (0 = semua). Kalau dibatasi, yang diambil item dengan favorit terbanyak.
  catalogLimit: Math.max(0, Number(process.env.CATALOG_LIMIT) || 0),
  excludeCatalogIds: parseIdList(process.env.EXCLUDE_CATALOG_IDS),

  embedColor: parseColor(process.env.EMBED_COLOR, 0xe53935),
  footerText: process.env.FOOTER_TEXT || 'Update setiap 1 hari • Made by KokoKrunch Studios',

  updateIntervalMs: Math.max(1, Number(process.env.UPDATE_INTERVAL_HOURS) || 24) * 60 * 60 * 1000,
  // Seberapa sering bot mengecek apakah sudah waktunya update (tahan restart pm2).
  schedulerTickMs: 10 * 60 * 1000,
};
