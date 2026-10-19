/**
 * Konfigurasi pm2 (opsional). Jalankan dengan: pm2 start ecosystem.config.js
 * - kill_timeout 5 detik: memberi waktu bot menyimpan data (XP leveling, dll) sebelum dimatikan.
 * - restart_delay + exp_backoff: kalau bot crash berulang, jeda restart makin lama (tidak spam Discord → tidak kena rate limit).
 * - max_memory_restart: restart otomatis kalau memori bocor / terlalu besar.
 */
module.exports = {
  apps: [
    {
      name: 'noname-assistent',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '400M',
      kill_timeout: 5000,
      restart_delay: 3000,
      exp_backoff_restart_delay: 2000,
      max_restarts: 50,
      time: true,
    },
  ],
};
