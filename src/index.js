const { ensureSingleInstance } = require('./single-instance');
ensureSingleInstance(); // tolak jalan kalau bot sudah jalan di proses lain

const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const config = require('./config');
const { commands } = require('./commands');
const { startScheduler } = require('./updater');
const { registerWelcome } = require('./welcome');

const byName = new Map(commands.map((c) => [c.data.name, c]));
// GuildMembers wajib untuk fitur welcome → aktifkan "Server Members Intent" di Discord Developer Portal.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
registerWelcome(client);

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
