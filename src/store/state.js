const fs = require('fs');
const path = require('path');

/**
 * Data toko yang tersimpan permanen (tahan restart): status buka/tutup, stock, rate,
 * lokasi panel & leaderboard, semua ticket, statistik, dan data spender.
 */
const FILE = path.join(__dirname, '..', '..', 'data', 'store-state.json');

const DEFAULT = {
  open: false,
  autoClosed: false, // true = tutup otomatis karena stock habis (akan buka lagi saat stock kembali)
  stock: 0,
  rates: {}, // { productId: rate }
  panel: null, // { channelId, messageId }
  leaderboard: null, // { channelId, messageId }
  seq: 0,
  tickets: {},
  stats: { transactions: 0, robux: 0, revenue: 0, ratingSum: 0, ratingCount: 0, testimonies: 0 },
  spenders: {}, // { userId: { robux, revenue, orders } }
};

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULT, ...data, stats: { ...DEFAULT.stats, ...(data.stats || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
}

const state = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Ticket yang masih berjalan (belum ditutup admin). */
function activeTicketOf({ userId, robloxId }) {
  return (
    Object.values(state.tickets).find(
      (t) => t.status === 'open' && ((userId && t.userId === userId) || (robloxId && t.roblox?.id === robloxId)),
    ) || null
  );
}

function nextTicketId(prefix) {
  state.seq += 1;
  return `${prefix || 'NCS'}-${String(state.seq).padStart(4, '0')}`;
}

module.exports = { state, save, activeTicketOf, nextTicketId };
