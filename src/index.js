const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const config = require('./config');
const { commands } = require('./commands');
const { startScheduler } = require('./updater');

const byName = new Map(commands.map((c) => [c.data.name, c]));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`🤖 Login sebagai ${c.user.tag}`);
  startScheduler(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = byName.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error('[command] error:', err);
    const msg = { content: '❌ Terjadi kesalahan saat menjalankan perintah.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

client.login(config.token);
