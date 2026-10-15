const { ensureSingleInstance } = require('./single-instance');
ensureSingleInstance(); // tolak jalan kalau bot sudah jalan di proses lain

const { Client, GatewayIntentBits, Events, MessageFlags, Partials } = require('discord.js');
const config = require('./config');
const { commands } = require('./commands');
const { registerWelcome } = require('./welcome');
const { handleVerifyButton, BUTTON_ID: VERIFY_BUTTON } = require('./verify');
const { handleTranslateButton, TRANSLATE_BUTTON } = require('./rules');
const voiceFinder = require('./voice-finder');
const store = require('./store');
const { registerSocial } = require('./social');
const { registerInviteTracker } = require('./invite-tracker');
const giveaway = require('./giveaway');
const { registerServerStats } = require('./server-stats');
const supportTicket = require('./support-ticket');

const byName = new Map(commands.map((c) => [c.data.name, c]));
// GuildMembers wajib untuk fitur welcome → aktifkan "Server Members Intent" di Discord Developer Portal.
// GuildVoiceStates dipakai fitur cari voice (tidak perlu diaktifkan di Developer Portal).
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages, // untuk panel sticky (tidak membaca isi pesan)
    GatewayIntentBits.GuildInvites, // invite log: mendeteksi link undangan yang dipakai member baru
  ],
  // Partials: event member keluar tetap diterima walau member belum tersimpan di cache bot (member lama / setelah restart).
  partials: [Partials.GuildMember, Partials.User],
});
registerWelcome(client);
voiceFinder.registerStickyPanel(client);
store.registerStore(client);
registerSocial(client);
registerInviteTracker(client);
giveaway.registerGiveaway(client);
registerServerStats(client);
supportTicket.registerSupportTickets(client);

client.once(Events.ClientReady, (c) => {
  console.log(`🤖 Login sebagai ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Store: semua tombol / dropdown / form dengan customId "store:..."
  if (await store.handleInteraction(interaction)) return;
  // Giveaway: tombol ikut / keluar / daftar peserta ("ga:...")
  if (await giveaway.handleInteraction(interaction)) return;
  // NCS Ticket Center: dropdown / form / tombol ("st:...")
  if (await supportTicket.handleInteraction(interaction)) return;
  // Autocomplete ID giveaway
  if (interaction.isAutocomplete()) {
    const cmd = byName.get(interaction.commandName);
    if (cmd?.autocomplete) await cmd.autocomplete(interaction).catch(() => {});
    return;
  }

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

  // Cari member di voice: pilih member dari daftar → hasil
  if (interaction.isUserSelectMenu() && interaction.customId === voiceFinder.SELECT_ID) {
    try {
      await voiceFinder.handleSelect(interaction);
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
