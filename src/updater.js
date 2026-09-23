const { RESTJSONErrorCodes } = require('discord.js');
const config = require('./config');
const store = require('./store');
const { fetchGroupMaps } = require('./roblox');
const { fetchGroupCatalog } = require('./catalog');
const { buildMapCard, buildCatalogCard, buildEmptyCard } = require('./cards');

const CHANNEL_GONE = new Set([RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.MissingAccess]);

/**
 * Jenis card yang didukung. Tambah jenis baru cukup di sini.
 * layout = "sidik jari" tampilan: kalau berubah (setelah update kode/.env lalu restart),
 * card langsung diperbarui saat bot menyala tanpa menunggu 24 jam.
 * Naikkan angka pertama setiap mengubah tampilan card.
 */
const KINDS = {
  maps: {
    label: 'map',
    fetch: fetchGroupMaps,
    build: buildMapCard,
    empty: {
      title: '🗺️ Belum ada map publik',
      description: 'Map dari KokoKrunch Studios akan muncul di sini setelah dipublikasikan.',
    },
    layout: () =>
      JSON.stringify([3, config.sortBy, config.footerText, config.embedColor, config.excludeUniverseIds]),
  },
  catalog: {
    label: 'item catalog',
    fetch: fetchGroupCatalog,
    build: buildCatalogCard,
    empty: {
      title: '🛍️ Belum ada item catalog',
      description: 'Item catalog KokoKrunch Studios akan muncul di sini setelah dijual.',
    },
    layout: () =>
      JSON.stringify([
        2,
        config.catalogSortBy,
        config.catalogIncludeOffsale,
        config.catalogLimit,
        config.excludeCatalogIds,
        config.footerText,
        config.embedColor,
      ]),
  },
};

const running = new Set();

/**
 * Sinkronkan card di satu channel. Card disimpan per "slot" (urutan):
 * slot yang ada di-edit, slot baru dikirim, slot berlebih dihapus.
 */
async function syncChannel(client, kind, channelId, items) {
  const def = KINDS[kind];
  const saved = store.get(kind, channelId) || { messageIds: [] };

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err) {
    if (CHANNEL_GONE.has(err.code)) {
      console.warn(`[updater] channel ${channelId} tidak bisa diakses lagi → card ${kind} berhenti dilacak.`);
      store.remove(kind, channelId);
      return { ok: false, reason: 'Channel tidak ditemukan / bot tidak punya akses.' };
    }
    throw err;
  }
  if (!channel?.isTextBased()) {
    store.remove(kind, channelId);
    return { ok: false, reason: 'Channel bukan text channel.' };
  }

  // Logo server Discord untuk ikon footer (kosong kalau server belum punya logo).
  const footerIcon = channel.guild?.iconURL({ extension: 'png', size: 128 }) || null;
  const payloads = items.length
    ? items.map((it) => def.build(it, { footerIcon }))
    : [buildEmptyCard({ footerIcon, ...def.empty })];
  const oldIds = saved.messageIds || [];
  const newIds = [];

  for (let i = 0; i < payloads.length; i++) {
    let msg = null;
    if (oldIds[i]) {
      try {
        msg = await channel.messages.edit(oldIds[i], payloads[i]);
      } catch (err) {
        if (err.code !== RESTJSONErrorCodes.UnknownMessage) throw err;
        // Pesan dihapus manual → kirim ulang.
      }
    }
    if (!msg) msg = await channel.send(payloads[i]);
    newIds.push(msg.id);
  }

  for (const id of oldIds.slice(payloads.length)) {
    await channel.messages.delete(id).catch(() => {});
  }

  store.set(kind, channelId, {
    guildId: channel.guildId,
    messageIds: newIds,
    lastUpdatedAt: Date.now(),
    layout: def.layout(),
  });
  return { ok: true, count: items.length };
}

/** Update card satu jenis: channel yang jatuh tempo, semua (force), atau satu channel saja. */
async function runUpdate(client, kind, { force = false, onlyChannelId = null } = {}) {
  const def = KINDS[kind];
  if (running.has(kind)) return { ok: false, reason: 'Update lain sedang berjalan, coba lagi sebentar.' };

  const now = Date.now();
  const targets = store
    .all(kind)
    .filter((c) => (onlyChannelId ? c.channelId === onlyChannelId : true))
    .filter(
      (c) =>
        force || c.layout !== def.layout() || now - (c.lastUpdatedAt || 0) >= config.updateIntervalMs,
    );

  if (!targets.length) return { ok: true, count: 0, skipped: true };

  running.add(kind);
  try {
    const items = await def.fetch(); // ambil data Roblox sekali untuk semua channel
    const results = [];
    for (const t of targets) {
      try {
        results.push(await syncChannel(client, kind, t.channelId, items));
      } catch (err) {
        console.error(`[updater] gagal update ${kind} di channel ${t.channelId}:`, err.message);
        results.push({ ok: false, reason: err.message });
      }
    }
    console.log(`[updater] ${items.length} ${def.label} → ${targets.length} channel diperbarui.`);
    return { ok: results.every((r) => r.ok), count: items.length, results };
  } catch (err) {
    // Roblox API gagal → card lama dibiarkan, dicoba lagi di tick berikutnya.
    console.error(`[updater] gagal mengambil data ${kind} dari Roblox:`, err.message);
    return { ok: false, reason: `Gagal mengambil data Roblox: ${err.message}` };
  } finally {
    running.delete(kind);
  }
}

function startScheduler(client) {
  const tick = async () => {
    for (const kind of Object.keys(KINDS)) {
      await runUpdate(client, kind).catch((e) => console.error(`[scheduler] ${kind}:`, e));
    }
  };
  tick(); // cek langsung saat bot menyala (mis. setelah restart pm2)
  setInterval(tick, config.schedulerTickMs);
  console.log(
    `[scheduler] aktif — update tiap ${config.updateIntervalMs / 3600000} jam, cek tiap ${config.schedulerTickMs / 60000} menit.`,
  );
}

module.exports = { KINDS, runUpdate, syncChannel, startScheduler };
