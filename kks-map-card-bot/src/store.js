const fs = require('fs');
const path = require('path');

/**
 * Penyimpanan sederhana berbasis file JSON (tanpa native module — aman di VPS mana pun).
 * Struktur:
 * {
 *   "channels": {
 *     "<channelId>": { "guildId": "...", "messageIds": ["..."], "lastUpdatedAt": 0 }
 *   }
 * }
 */
const FILE = path.join(__dirname, '..', 'data', 'state.json');

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { channels: data.channels || {} };
  } catch {
    return { channels: {} };
  }
}

let state = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE); // atomic: file tidak rusak kalau bot mati saat menulis
}

module.exports = {
  allChannels() {
    return Object.entries(state.channels).map(([channelId, v]) => ({ channelId, ...v }));
  },
  getChannel(channelId) {
    return state.channels[channelId] || null;
  },
  setChannel(channelId, data) {
    state.channels[channelId] = { ...(state.channels[channelId] || {}), ...data };
    save();
  },
  removeChannel(channelId) {
    delete state.channels[channelId];
    save();
  },
};
