const { RESTJSONErrorCodes } = require('discord.js');
const config = require('./config');
const store = require('./store');
const { fetchGroupMaps } = require('./roblox');
const { buildMapCard, buildEmptyCard } = require('./cards');

const CHANNEL_GONE = new Set([RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.MissingAccess]);

let running = false;

/**
 * Sinkronkan card di satu channel dengan daftar map terbaru.
 * Card disimpan per "slot" (urutan). Slot yang ada di-edit, slot baru dikirim,
 * slot berlebih (map dihapus/diprivate) dihapus.
 */
async function syncChannel(client, channelId, maps) {
  const saved = store.getChannel(channelId) || { messageIds: [] };

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err) {
    if (CHANNEL_GONE.has(err.code)) {
      console.warn(`[updater] channel ${channelId} tidak bisa diakses lagi → berhenti dilacak.`);
      store.removeChannel(channelId);
      return { ok: false, reason: 'Channel tidak ditemukan / bot tidak punya akses.' };
    }
    throw err;
  }
  if (!channel?.isTextBased()) {
    store.removeChannel(channelId);
    return { ok: false, reason: 'Channel bukan text channel.' };
  }

  // Logo server Discord untuk ikon footer (kosong kalau server belum punya logo).
  const footerIcon = channel.guild?.iconURL({ extension: 'png', size: 128 }) || null;
  const payloads = maps.length
    ? maps.map((m) => buildMapCard(m, { footerIcon }))
    : [buildEmptyCard({ footerIcon })];
  const oldIds = saved.messageIds || [];
  const newIds = [];

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const existingId = oldIds[i];
    let msg = null;

    if (existingId) {
      try {
        msg = await channel.messages.edit(existingId, payload);
      } catch (err) {
        if (err.code !== RESTJSONErrorCodes.UnknownMessage) throw err;
        // Pesan dihapus manual → kirim ulang di bawah.
      }
    }
    if (!msg) msg = await channel.send(payload);
    newIds.push(msg.id);
  }

  // Hapus card berlebih (mis. map sudah tidak publik).
  for (const id of oldIds.slice(payloads.length)) {
    await channel.messages.delete(id).catch(() => {});
  }

  store.setChannel(channelId, {
    guildId: channel.guildId,
    messageIds: newIds,
    lastUpdatedAt: Date.now(),
  });
  return { ok: true, count: maps.length };
}

/**
 * Update channel yang sudah jatuh tempo (atau semua jika force / hanya channel tertentu).
 */
async function runUpdate(client, { force = false, onlyChannelId = null } = {}) {
  if (running) return { ok: false, reason: 'Update lain sedang berjalan, coba lagi sebentar.' };

  const now = Date.now();
  const targets = store
    .allChannels()
    .filter((c) => (onlyChannelId ? c.channelId === onlyChannelId : true))
    .filter((c) => force || now - (c.lastUpdatedAt || 0) >= config.updateIntervalMs);

  if (!targets.length) return { ok: true, count: 0, skipped: true };

  running = true;
  try {
    // Ambil data Roblox sekali, dipakai untuk semua channel.
    const maps = await fetchGroupMaps();
    const results = [];
    for (const t of targets) {
      try {
        results.push(await syncChannel(client, t.channelId, maps));
      } catch (err) {
        console.error(`[updater] gagal update channel ${t.channelId}:`, err.message);
        results.push({ ok: false, reason: err.message });
      }
    }
    console.log(`[updater] ${maps.length} map → ${targets.length} channel diperbarui.`);
    return { ok: results.every((r) => r.ok), count: maps.length, results };
  } catch (err) {
    // Roblox API gagal → card lama dibiarkan, dicoba lagi di tick berikutnya.
    console.error('[updater] gagal mengambil data Roblox:', err.message);
    return { ok: false, reason: `Gagal mengambil data Roblox: ${err.message}` };
  } finally {
    running = false;
  }
}

function startScheduler(client) {
  const tick = () => runUpdate(client).catch((e) => console.error('[scheduler]', e));
  tick(); // cek langsung saat bot menyala (mis. setelah restart pm2)
  setInterval(tick, config.schedulerTickMs);
  console.log(
    `[scheduler] aktif — update tiap ${config.updateIntervalMs / 3600000} jam, cek tiap ${config.schedulerTickMs / 60000} menit.`,
  );
}

module.exports = { runUpdate, syncChannel, startScheduler };
