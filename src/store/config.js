const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'store.json');

/** Dibaca ulang tiap dipakai → edit store.json tidak perlu restart bot. */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('[store] store.json tidak bisa dibaca:', err.message);
    return null;
  }
}

function color(cfg, key, fallback) {
  const n = parseInt(String(cfg?.colors?.[key] || '').replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

const isId = (v) => /^\d{17,20}$/.test(String(v || ''));
const rupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
const num = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
const fill = (text, guild) => String(text || '').replace(/\{server\}/g, guild?.name || 'Server');
const ts = (ms, style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function getProduct(cfg, id) {
  return (cfg?.products || []).find((p) => p.id === id) || null;
}

module.exports = { loadConfig, color, isId, rupiah, num, fill, ts, getProduct };
