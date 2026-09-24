const fs = require('fs');
const path = require('path');

/**
 * Memastikan hanya 1 proses bot yang jalan dari folder ini.
 * Kalau sudah ada proses lain yang hidup, proses baru langsung berhenti dengan pesan jelas
 * (mencegah welcome / command terkirim dobel karena bot jalan 2x atau lebih).
 */
const LOCK = path.join(__dirname, '..', 'data', 'bot.pid');

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // proses ada, tapi milik user lain
  }
}

function ensureSingleInstance() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  try {
    const oldPid = Number(fs.readFileSync(LOCK, 'utf8'));
    if (oldPid && oldPid !== process.pid && isAlive(oldPid)) {
      console.error(
        `\n❌ Bot ini SUDAH JALAN di proses lain (PID ${oldPid}). Proses baru dihentikan supaya tidak dobel.\n` +
          `   Matikan dulu proses lama:  kill ${oldPid}   (atau: pm2 list → pm2 delete <nama>)\n` +
          '   Lalu jalankan bot dengan pm2 saja, jangan ditambah npm start.\n',
      );
      process.exit(1);
    }
  } catch {
    // belum ada lock → lanjut
  }
  fs.writeFileSync(LOCK, String(process.pid));

  const release = () => {
    try {
      if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.unlinkSync(LOCK);
    } catch {
      /* abaikan */
    }
  };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
}

module.exports = { ensureSingleInstance };
