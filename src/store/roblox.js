/**
 * Cek akun Roblox berdasarkan username (dengan retry + timeout).
 * Mengembalikan { id, name, displayName, created, avatar } atau null kalau tidak ditemukan.
 */
const DOMAIN = process.env.ROBLOX_DOMAIN || 'roblox.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, options = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < retries) await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

async function lookupRobloxUser(username) {
  const clean = String(username || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(clean)) return null;

  const found = await request(`https://users.${DOMAIN}/v1/usernames/users`, {
    method: 'POST',
    body: JSON.stringify({ usernames: [clean], excludeBannedUsers: true }),
  });
  const user = found?.data?.[0];
  if (!user) return null;

  const [detail, thumb] = await Promise.all([
    request(`https://users.${DOMAIN}/v1/users/${user.id}`).catch(() => null),
    request(
      `https://thumbnails.${DOMAIN}/v1/users/avatar-headshot?userIds=${user.id}&size=420x420&format=Png&isCircular=false`,
    ).catch(() => null),
  ]);

  return {
    id: String(user.id),
    name: user.name,
    displayName: user.displayName || user.name,
    created: detail?.created || null,
    avatar: thumb?.data?.[0]?.imageUrl || null,
  };
}

/** Ambil ID gamepass dari link (roblox.com/game-pass/123…, Creator Hub …/passes/123…) atau angka saja. */
function parseGamepassId(input) {
  const str = String(input || '').trim();
  const m = str.match(/(?:game-pass(?:es)?|passes)\/(\d{3,20})/i) || str.match(/^(\d{3,20})$/);
  return m ? m[1] : null;
}

/**
 * Cek detail gamepass di Roblox.
 * Mengembalikan { id, name, price, forSale, creatorId, creatorName, creatorType, icon }, null kalau tidak ada,
 * atau throw kalau server Roblox tidak bisa dihubungi.
 */
async function lookupGamepass(id) {
  let info = null;
  let lastErr = null;
  for (const url of [
    `https://apis.${DOMAIN}/game-passes/v1/game-passes/${id}/product-info`,
    `https://economy.${DOMAIN}/v1/game-pass/${id}/game-pass-product-info`,
  ]) {
    try {
      info = await request(url, {}, 1);
      if (info) break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!info) {
    if (lastErr) throw lastErr;
    return null;
  }
  const thumb = await request(
    `https://thumbnails.${DOMAIN}/v1/game-passes?gamePassIds=${id}&size=150x150&format=Png&isCircular=false`,
  ).catch(() => null);
  const c = info.Creator || {};
  const price = Number(info.PriceInRobux ?? info.priceInRobux ?? info.price);
  return {
    id: String(id),
    name: info.Name || info.name || `Gamepass ${id}`,
    price: Number.isFinite(price) && price > 0 ? price : null,
    forSale: Boolean(info.IsForSale ?? info.isForSale) && Number.isFinite(price) && price > 0,
    creatorId: String(c.CreatorTargetId ?? c.Id ?? ''),
    creatorAltId: String(c.Id ?? ''),
    creatorName: c.Name || null,
    creatorType: c.CreatorType || null,
    icon: thumb?.data?.[0]?.imageUrl || null,
  };
}

module.exports = { lookupRobloxUser, lookupGamepass, parseGamepassId };
