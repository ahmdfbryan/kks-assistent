/**
 * Ambil seluruh daftar member (opcode 8) secara AMAN untuk semua fitur.
 * Discord membatasi permintaan ini (± 1x per 30 detik per server). Tanpa pengaman, beberapa fitur yang
 * memintanya bersamaan (invite log, statistik server, booster, verifikasi) akan kena "rate limited".
 * - Permintaan yang bersamaan digabung jadi 1.
 * - Setelah berhasil 1x, cache member tetap ter-update otomatis lewat event (GuildMembers intent),
 *   jadi tidak perlu diminta ulang kecuali cache jelas belum lengkap.
 * - Kena rate limit → tunggu sesuai "Retry after" lalu coba lagi (maks 3x), log hanya 1 baris.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const states = new Map(); // guildId → { promise, full, lastAt }

const isComplete = (guild) => guild.members.cache.size >= guild.memberCount * 0.98;

async function fetchAllMembers(guild, { force = false } = {}) {
  if (!guild) return false;
  const s = states.get(guild.id) || {};
  states.set(guild.id, s);
  if (!force && s.full && isComplete(guild)) return true;
  if (s.promise) return s.promise;
  s.promise = (async () => {
    let wait = Math.max(0, (s.lastAt || 0) + 31000 - Date.now());
    for (let attempt = 0; attempt < 3; attempt++) {
      if (wait) await sleep(wait);
      try {
        await guild.members.fetch({ time: 60000 });
        s.full = true;
        return true;
      } catch (e) {
        const m = /retry after ([\d.]+)/i.exec(e.message || '');
        if (m) {
          wait = (parseFloat(m[1]) + 1) * 1000;
          continue;
        }
        console.warn(`[members] gagal memuat daftar member ${guild.name}:`, e.message);
        return false;
      } finally {
        s.lastAt = Date.now();
      }
    }
    console.warn(`[members] daftar member ${guild.name} masih dibatasi Discord — dicoba lagi nanti.`);
    return false;
  })().finally(() => {
    s.promise = null;
  });
  return s.promise;
}

module.exports = { fetchAllMembers, isComplete };
