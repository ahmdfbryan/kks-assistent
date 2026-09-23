const { REST, Routes } = require('discord.js');
const config = require('./config');
const maps = require('./commands');

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = [maps.data.toJSON()];
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
      console.log(`✅ Slash command didaftarkan ke server ${config.guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body });
      console.log('✅ Slash command didaftarkan secara global (muncul dalam ~1 jam).');
    }
  } catch (err) {
    console.error('❌ Gagal mendaftarkan command:', err);
    process.exit(1);
  }
})();
