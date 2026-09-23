const fs = require('fs');
const path = require('path');

/**
 * Penyimpanan sederhana berbasis file JSON (tanpa native module — aman di VPS mana pun).
 * Struktur:
 * {
 *   "channels": {
 *     "maps:<channelId>":    { "kind": "maps", "channelId": "...", "guildId": "...", "messageIds": [], "lastUpdatedAt": 0 },
 *     "catalog:<channelId>": { "kind": "catalog", ... }
 *   }
 * }
 * Data versi lama (key = channelId saja) otomatis dianggap card "maps".
 */
const FILE = path.join(__dirname, '..', 'data', 'state.json');

const keyOf = (kind, channelId) => `${kind}:${channelId}`;

function load() {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { channels: {} };
  }
  const channels = {};
  for (const [key, value] of Object.entries(data.channels || {})) {
    if (key.includes(':')) {
      channels[key] = value;
    } else {
      // migrasi format lama
      channels[keyOf('maps', key)] = { ...value, kind: 'maps', channelId: key };
    }
  }
  return { channels };
}

let state = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE); // atomic: file tidak rusak kalau bot mati saat menulis
}

module.exports = {
  all(kind = null) {
    return Object.values(state.channels).filter((c) => !kind || c.kind === kind);
  },
  get(kind, channelId) {
    return state.channels[keyOf(kind, channelId)] || null;
  },
  set(kind, channelId, data) {
    const key = keyOf(kind, channelId);
    state.channels[key] = { ...(state.channels[key] || {}), ...data, kind, channelId };
    save();
  },
  remove(kind, channelId) {
    delete state.channels[keyOf(kind, channelId)];
    save();
  },
};
