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

module.exports = { lookupRobloxUser };
