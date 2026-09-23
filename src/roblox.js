const config = require('./config');

const API = (sub) => `https://${sub}.${config.robloxDomain}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch JSON dengan timeout + retry (backoff) — tahan error jaringan VPS & rate limit 429.
 */
async function getJson(url, { retries = 4, timeoutMs = 15000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'KKS-MapCardBot/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        throw Object.assign(new Error(`HTTP ${res.status}`), { retryable: true, status: res.status });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`HTTP ${res.status} ${body.slice(0, 200)}`), { retryable: false });
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.retryable === false || attempt === retries) break;
      const wait = Math.min(30000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 500);
      console.warn(`[roblox] ${err.message} → retry ${attempt + 1}/${retries} dalam ${wait}ms (${url})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Semua game publik milik grup → [{ universeId, name, rootPlaceId }] */
async function getGroupGames(groupId) {
  const games = [];
  let cursor = '';
  do {
    const url =
      `${API('games')}/v2/groups/${groupId}/games?accessFilter=Public&limit=50&sortOrder=Asc` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const json = await getJson(url);
    for (const g of json.data || []) {
      games.push({ universeId: g.id, name: g.name, rootPlaceId: g.rootPlace?.id ?? null });
    }
    cursor = json.nextPageCursor || '';
  } while (cursor);
  return games;
}

/** Detail (playing, visits, price, dll) untuk banyak universe sekaligus. */
async function getGameDetails(universeIds) {
  const map = new Map();
  for (const ids of chunk(universeIds, 50)) {
    const json = await getJson(`${API('games')}/v1/games?universeIds=${ids.join(',')}`);
    for (const g of json.data || []) map.set(g.id, g);
  }
  return map;
}

/** Gambar thumbnail (16:9) pertama tiap universe. */
async function getThumbnails(universeIds) {
  const map = new Map();
  for (const ids of chunk(universeIds, 25)) {
    const url =
      `${API('thumbnails')}/v1/games/multiget/thumbnails?universeIds=${ids.join(',')}` +
      '&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false';
    const json = await getJson(url);
    for (const item of json.data || []) {
      const t = (item.thumbnails || []).find((x) => x.state === 'Completed' && x.imageUrl);
      if (t) map.set(item.universeId, t.imageUrl);
    }
  }
  return map;
}

/** Icon game (untuk ikon kecil di footer). */
async function getIcons(universeIds) {
  const map = new Map();
  for (const ids of chunk(universeIds, 50)) {
    const url =
      `${API('thumbnails')}/v1/games/icons?universeIds=${ids.join(',')}` +
      '&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false';
    const json = await getJson(url);
    for (const item of json.data || []) {
      if (item.state === 'Completed' && item.imageUrl) map.set(item.targetId, item.imageUrl);
    }
  }
  return map;
}

const SORTERS = {
  visits: (a, b) => b.visits - a.visits,
  playing: (a, b) => b.playing - a.playing || b.visits - a.visits,
  name: (a, b) => a.name.localeCompare(b.name, 'id'),
  updated: (a, b) => new Date(b.updated) - new Date(a.updated),
};

/**
 * Ambil semua map grup lengkap dengan statistiknya.
 * Thumbnail/icon bersifat opsional — kalau gagal, card tetap tampil tanpa gambar.
 */
async function fetchGroupMaps() {
  const games = (await getGroupGames(config.groupId)).filter(
    (g) => !config.excludeUniverseIds.includes(String(g.universeId)),
  );
  if (!games.length) return [];

  const ids = games.map((g) => g.universeId);
  const details = await getGameDetails(ids);
  const [thumbs, icons] = await Promise.all([
    getThumbnails(ids).catch((e) => (console.warn('[roblox] thumbnail gagal:', e.message), new Map())),
    getIcons(ids).catch((e) => (console.warn('[roblox] icon gagal:', e.message), new Map())),
  ]);

  const maps = games.map((g) => {
    const d = details.get(g.universeId) || {};
    const placeId = d.rootPlaceId || g.rootPlaceId;
    return {
      universeId: g.universeId,
      placeId,
      name: d.name || g.name,
      playing: Number(d.playing) || 0,
      visits: Number(d.visits) || 0,
      price: d.price ?? null,
      updated: d.updated || null,
      thumbnail: thumbs.get(g.universeId) || null,
      icon: icons.get(g.universeId) || null,
      url: `https://www.roblox.com/games/${placeId}`,
    };
  });

  return maps.sort(SORTERS[config.sortBy] || SORTERS.visits);
}

module.exports = { fetchGroupMaps };
