const { ensureSingleInstance } = require('./single-instance');
ensureSingleInstance(); // tolak jalan kalau bot sudah jalan di proses lain

const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const config = require('./config');
const { commands } = require('./commands');
const { startScheduler } = require('./updater');
const { registerWelcome } = require('./welcome');
const { handleVerifyButton, BUTTON_ID: VERIFY_BUTTON } = require('./verify');
const { handleTranslateButton, TRANSLATE_BUTTON } = require('./rules');
const voiceFinder = require('./voice-finder');

const byName = new Map(commands.map((c) => [c.data.name, c]));
// GuildMembers wajib untuk fitur welcome → aktifkan "Server Members Intent" di Discord Developer Portal.
// GuildVoiceStates dipakai fitur cari voice (tidak perlu diaktifkan di Developer Portal).
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
});
registerWelcome(client);

client.once(Events.ClientReady, (c) => {
  console.log(`🤖 Login sebagai ${c.user.tag}`);
  startScheduler(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Tombol "Verify Sekarang"
  if (interaction.isButton() && interaction.customId === VERIFY_BUTTON) {
    try {
      await handleVerifyButton(interaction);
    } catch (err) {
      console.error('[verify] error:', err);
      const msg = { content: '❌ Verifikasi gagal diproses. Silakan hubungi admin.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
    return;
  }

  // Tombol "Bahasa Inggris" di rules
  if (interaction.isButton() && interaction.customId === TRANSLATE_BUTTON) {
    await handleTranslateButton(interaction).catch((err) => console.error('[rules] error:', err));
    return;
  }

  // Cari member di voice: tombol "Cari Username" → form → hasil
  if (interaction.isButton() && interaction.customId === voiceFinder.OPEN_BUTTON) {
    await voiceFinder.handleOpenButton(interaction).catch((err) => console.error('[voice-finder] error:', err));
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId === voiceFinder.MODAL_ID) {
    try {
      await voiceFinder.handleSearchModal(interaction);
    } catch (err) {
      console.error('[voice-finder] error:', err);
      const msg = { content: '❌ Pencarian gagal, coba lagi.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
    return;
  }

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
