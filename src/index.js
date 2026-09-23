const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const config = require('./config');
const maps = require('./commands');
const { startScheduler } = require('./updater');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`🤖 Login sebagai ${c.user.tag}`);
  startScheduler(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== maps.data.name) return;
  try {
    await maps.execute(interaction);
  } catch (err) {
    console.error('[command] error:', err);
    const msg = { content: '❌ Terjadi kesalahan saat menjalankan perintah.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

client.login(config.token);
