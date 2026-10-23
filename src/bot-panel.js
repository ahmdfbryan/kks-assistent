const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  Events,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const { userInfoCommand, robloxCommand } = require('./profile-info');
const { serverCheckCommand } = require('./server-check');

/**
 * Bot Command Center — panel sticky (Components V2) di channel bot command.
 * Tombol: 👤 Info Akun Discord • 🎮 Info Akun Roblox • 🔍 Cek Server.
 * Tombol membuka form kecil → hasil memakai tampilan /userinfo, /roblox, /cekserver (hanya terlihat oleh pemakai).
 * Panel selalu dipindah ke paling bawah saat ada pesan baru di channel.
 */
const DEFAULT_CHANNEL = '1553613922639151176';
const DATA = path.join(__dirname, '..', 'data', 'bot-panel.json');
const V2 = MessageFlags.IsComponentsV2;
const EPH = MessageFlags.Ephemeral;
const BRAND = 0x3498db;
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));
const text = (c) => new TextDisplayBuilder().setContent(String(c));
const line = (big = false) => new SeparatorBuilder().setDivider(true).setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

let panel = (() => {
  try {
    return JSON.parse(fs.readFileSync(DATA, 'utf8'));
  } catch {
    return null;
  }
})(); // { channelId, messageId }
function savePanel() {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(`${DATA}.tmp`, JSON.stringify(panel));
  fs.renameSync(`${DATA}.tmp`, DATA);
}

// ───────────────────────── Tampilan panel ─────────────────────────
function buildPanel(guild, client) {
  const box = new ContainerBuilder().setAccentColor(BRAND);
  const avatar = client.user.displayAvatarURL({ extension: 'png', size: 256 });
  box.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        text(`# 🤖 Bot Command Center\n-# ${guild.name} • Tools & Info\nCek profil Discord, akun Roblox, dan info server lain dengan **sekali klik** ✨`),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)),
  );
  box.addSeparatorComponents(line());

  const item = (title, desc, id, label, emoji, style = ButtonStyle.Primary) =>
    new SectionBuilder()
      .addTextDisplayComponents(text(`### ${title}\n${desc}`))
      .setButtonAccessory(new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style));

  box.addSectionComponents(item('👤 Info Akun Discord', 'Profil, badge, umur akun, role & aktivitas di server.', 'bp:user', 'Cek Akun', '👤'));
  box.addSectionComponents(item('🎮 Info Akun Roblox', 'Avatar, status, teman, grup & username lama.', 'bp:roblox', 'Cek Roblox', '🎮'));
  box.addSectionComponents(item('🔍 Cek Server Discord', 'Member, online, boost, fitur & info invite server lain.', 'bp:server', 'Cek Server', '🔍'));

  box.addSeparatorComponents(line());
  box.addTextDisplayComponents(text('-# 🔒 Hasil dari tombol hanya terlihat oleh kamu\n-# ⌨️ Bisa juga lewat `/userinfo` • `/roblox` • `/cekserver`'));
  return { components: [box], flags: V2, allowedMentions: { parse: [] } };
}

// ───────────────────────── Form (modal) ─────────────────────────
function userModal() {
  return new ModalBuilder()
    .setCustomId('bp:m:user')
    .setTitle('👤 Info Akun Discord')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Pilih Member')
        .setDescription('Kosongkan untuk melihat akun kamu sendiri.')
        .setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId('member').setPlaceholder('🔍 Cari member...').setMinValues(0).setMaxValues(1).setRequired(false)),
    );
}
function robloxModal() {
  return new ModalBuilder()
    .setCustomId('bp:m:roblox')
    .setTitle('🎮 Info Akun Roblox')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Username Roblox')
        .setDescription('Bisa juga user ID atau link profil Roblox.')
        .setTextInputComponent(new TextInputBuilder().setCustomId('username').setStyle(TextInputStyle.Short).setPlaceholder('contoh: Builderman').setMinLength(1).setMaxLength(100).setRequired(true)),
    );
}
function serverModal() {
  return new ModalBuilder()
    .setCustomId('bp:m:server')
    .setTitle('🔍 Cek Server Discord')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Link Invite')
        .setDescription('Contoh: discord.gg/abcd atau kodenya saja.')
        .setTextInputComponent(new TextInputBuilder().setCustomId('link').setStyle(TextInputStyle.Short).setPlaceholder('https://discord.gg/...').setMinLength(2).setMaxLength(120).setRequired(true)),
    );
}

/**
 * Jalankan command yang sudah ada (/userinfo, /roblox, /cekserver) dari form panel.
 * Semua balasan dipaksa "hanya terlihat oleh kamu" supaya channel tidak penuh & panel tetap rapi.
 */
function asCommand(i, commandName, values) {
  const eph = (p = {}) => (typeof p === 'string' ? { content: p, flags: EPH } : { ...p, flags: (p.flags || 0) | EPH });
  return {
    commandName,
    user: i.user,
    member: i.member,
    guild: i.guild,
    guildId: i.guildId,
    channel: i.channel,
    client: i.client,
    memberPermissions: i.memberPermissions,
    get deferred() {
      return i.deferred;
    },
    get replied() {
      return i.replied;
    },
    options: {
      getUser: (k) => values[k] ?? null,
      getString: (k) => values[k] ?? null,
      getBoolean: (k) => values[k] ?? null,
    },
    deferReply: () => i.deferReply({ flags: EPH }),
    reply: (p) => i.reply(eph(p)),
    editReply: (p) => i.editReply(p),
    followUp: (p) => i.followUp(eph(p)),
    deleteReply: () => Promise.resolve(), // pesan sudah privat → tidak perlu dihapus
    fetchReply: () => i.fetchReply(),
  };
}

async function handleInteraction(i) {
  const id = i.customId;
  if (typeof id !== 'string' || !id.startsWith('bp:')) return false;
  try {
    if (i.isButton()) {
      if (id === 'bp:user') await i.showModal(userModal());
      else if (id === 'bp:roblox') await i.showModal(robloxModal());
      else if (id === 'bp:server') await i.showModal(serverModal());
      return true;
    }
    if (i.isModalSubmit()) {
      if (id === 'bp:m:user') {
        const picked = i.fields.getSelectedUsers?.('member')?.first?.() || null;
        await userInfoCommand.execute(asCommand(i, 'userinfo', { member: picked }));
      } else if (id === 'bp:m:roblox') {
        await robloxCommand.execute(asCommand(i, 'roblox', { username: i.fields.getTextInputValue('username') }));
      } else if (id === 'bp:m:server') {
        await serverCheckCommand.execute(asCommand(i, 'cekserver', { link: i.fields.getTextInputValue('link'), privat: true }));
      }
      return true;
    }
  } catch (err) {
    console.error('[bot-panel] error:', err);
    const msg = { content: '❌ Terjadi kesalahan, coba lagi.', flags: EPH };
    if (i.deferred || i.replied) await i.editReply(msg).catch(() => {});
    else await i.reply(msg).catch(() => {});
  }
  return true;
}

// ───────────────────────── Sticky ─────────────────────────
let client = null;
let stickyTimer = null;
let busy = false;
async function repost(force = false) {
  if (!panel || !client || busy) return;
  busy = true;
  try {
    const ch = await client.channels.fetch(panel.channelId).catch(() => null);
    if (!ch?.isTextBased()) return;
    if (!force && ch.lastMessageId === panel.messageId) return; // sudah paling bawah
    const old = panel.messageId;
    const sent = await ch.send(buildPanel(ch.guild, client));
    panel = { channelId: ch.id, messageId: sent.id };
    savePanel();
    await ch.messages.delete(old).catch(() => {});
  } catch (e) {
    console.warn('[bot-panel] sticky:', e.message);
  } finally {
    busy = false;
  }
}

function registerBotPanel(c) {
  client = c;
  c.on(Events.InteractionCreate, (i) => {
    if (i.customId?.startsWith?.('bp:')) handleInteraction(i);
  });
  c.on(Events.MessageCreate, (msg) => {
    if (!panel || msg.channelId !== panel.channelId || msg.author?.id === c.user?.id) return;
    clearTimeout(stickyTimer);
    stickyTimer = setTimeout(() => repost(), 6000); // tunggu chat reda → panel pindah ke bawah
  });
  c.once(Events.ClientReady, async () => {
    // Perbarui tampilan panel setelah restart (pesan dihapus manual → berhenti).
    if (!panel) return;
    const ch = await c.channels.fetch(panel.channelId).catch(() => null);
    if (!ch) return;
    try {
      await ch.messages.edit(panel.messageId, buildPanel(ch.guild, c));
    } catch (e) {
      if (e.code === 10008) {
        panel = null;
        savePanel();
      }
    }
  });
}

// ───────────────────────── Command admin ─────────────────────────
const botPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('botpanel')
    .setDescription('Panel Bot Command Center (khusus admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('kirim')
        .setDescription('Kirim / pindahkan panel Bot Command Center')
        .addChannelOption((o) => o.setName('channel').setDescription(`Default: <#${DEFAULT_CHANNEL}>`).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) => s.setName('hapus').setDescription('Hapus panel Bot Command Center')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: EPH });
    const old = panel;
    if (sub === 'hapus') {
      if (!old) return interaction.editReply('ℹ️ Tidak ada panel yang aktif.');
      panel = null;
      savePanel();
      const ch = await interaction.guild.channels.fetch(old.channelId).catch(() => null);
      await ch?.messages.delete(old.messageId).catch(() => {});
      return interaction.editReply(`🗑️ Panel di <#${old.channelId}> sudah dihapus.`);
    }
    const channel =
      interaction.options.getChannel('channel') || (await interaction.guild.channels.fetch(DEFAULT_CHANNEL).catch(() => null)) || interaction.channel;
    if (!channel?.isTextBased()) return interaction.editReply('❌ Channel tidak ditemukan.');
    const sent = await channel.send(buildPanel(interaction.guild, interaction.client));
    panel = { channelId: channel.id, messageId: sent.id };
    savePanel();
    if (old && old.messageId !== sent.id) {
      const oldCh = await interaction.guild.channels.fetch(old.channelId).catch(() => null);
      await oldCh?.messages.delete(old.messageId).catch(() => {});
    }
    return interaction.editReply(`✅ Panel **Bot Command Center** dikirim ke ${channel} — selalu di paling bawah channel.`);
  },
};

module.exports = { registerBotPanel, botPanelCommand, buildPanel, handleInteraction };
