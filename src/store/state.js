const fs = require('fs');
const path = require('path');

/**
 * Data toko yang tersimpan permanen (tahan restart): status buka/tutup per produk, stock, rate,
 * lokasi panel & leaderboard, semua ticket, statistik, dan data spender.
 */
const FILE = path.join(__dirname, '..', '..', 'data', 'store-state.json');

const DEFAULT = {
  products: {}, // { productId: { open, autoClosed } } — autoClosed = tutup otomatis karena stock habis
  stock: 0, // stock Robux
  rates: {}, // { productId: rate }
  panel: null, // { channelId, messageId }
  leaderboard: null, // { channelId, messageId }
  seq: 0,
  rekberSeq: 0,
  tickets: {},
  stats: { transactions: 0, robux: 0, revenue: 0, ratingSum: 0, ratingCount: 0, testimonies: 0, rekber: 0, rekberVolume: 0 },
  spenders: {}, // { userId: { robux, revenue, orders } }
};

function load() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  // Migrasi data versi lama (status buka/tutup masih 1 untuk seluruh toko → jadi milik Robux Visend).
  if (!data.products && 'open' in data) {
    data.products = { 'robux-visend': { open: Boolean(data.open), autoClosed: Boolean(data.autoClosed) } };
  }
  delete data.open;
  delete data.autoClosed;
  return { ...DEFAULT, ...data, stats: { ...DEFAULT.stats, ...(data.stats || {}) } };
}

const state = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Status buka/tutup satu produk. */
function productState(productId) {
  if (!state.products[productId]) state.products[productId] = { open: false, autoClosed: false };
  return state.products[productId];
}

/** Produk bisa dipesan sekarang? (Robux juga butuh stock > 0, Coming Soon selalu tidak.) */
function isProductOpen(product) {
  if (!product || product.type === 'soon') return false;
  const open = productState(product.id).open;
  return product.type === 'robux' ? open && state.stock > 0 : open;
}

const kindOf = (t) => t.kind || 'robux';

/**
 * Ticket yang masih berjalan.
 * - kind 'robux'  → cocok berdasarkan pembeli Discord / akun Roblox.
 * - kind 'rekber' → cocok kalau user adalah salah satu pihak rekber.
 */
function activeTicketOf({ userId, robloxId, kind = 'robux' }) {
  return (
    Object.values(state.tickets).find((t) => {
      if (t.status !== 'open' || kindOf(t) !== kind) return false;
      if (kind === 'rekber') return userId && (t.userId === userId || t.partnerId === userId);
      return (userId && t.userId === userId) || (robloxId && t.roblox?.id === robloxId);
    }) || null
  );
}

function nextTicketId(prefix, key = 'seq') {
  state[key] = (state[key] || 0) + 1;
  return `${prefix || 'NCS'}-${String(state[key]).padStart(4, '0')}`;
}

module.exports = { state, save, productState, isProductOpen, kindOf, activeTicketOf, nextTicketId };
