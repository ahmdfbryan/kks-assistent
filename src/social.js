const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  RESTJSONErrorCodes,
  Events,
} = require('discord.js');

/**
 * Embed Social Media: 1 kartu header + kartu Roblox, TikTok, Discord + tombol link.
 * Data Roblox (username, avatar, followers) & Discord (member, invite) diambil otomatis
 * dan di-update tiap 1 jam. Teks diatur di social.json.
 */
const FILE = path.join(__dirname, '..', 'social.json');
const STATE_FILE = path.join(__dirname, '..', 'data', 'social-state.json');
const REFRESH_MS = 60 * 60 * 1000;
const ROBLOX = process.env.ROBLOX_DOMAIN || 'roblox.com';
const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('[social] social.json tidak bisa dibaca:', err.message);
    return null;
  }
}
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(s, null, 2));
  fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}

const color = (v, fb) => {
  const n = parseInt(String(v || '').replace('#', ''), 16);
  return Number.isNaN(n) ? fb : n;
};
const num = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
const fill = (t, guild) => String(t || '').replace(/\{server\}/g, guild.name);
const ts = (ms, s = 'D') => `<t:${Math.floor(ms / 1000)}:${s}>`;
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Data akun Roblox: username, display name, tanggal dibuat, avatar, followers, friends. */
async function robloxInfo(userId) {
  if (!/^\d+$/.test(String(userId || ''))) return null;
  const [user, thumb, followers, friends] = await Promise.all([
    getJson(`https://users.${ROBLOX}/v1/users/${userId}`),
    getJson(`https://thumbnails.${ROBLOX}/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`),
    getJson(`https://friends.${ROBLOX}/v1/users/${userId}/followers/count`),
    getJson(`https://friends.${ROBLOX}/v1/users/${userId}/friends/count`),
  ]);
  return {
    name: user?.name || null,
    displayName: user?.displayName || null,
    created: user?.created ? Date.parse(user.created) : null,
    avatar: thumb?.data?.[0]?.imageUrl || null,
    followers: followers?.count ?? null,
    friends: friends?.count ?? null,
  };
}

/** ID Discord → server (buat link undangan permanen) atau akun (link profil). */
async function discordInfo(client, guild, d, st) {
  const id = String(d.id || '');
  const target = client.guilds.cache.get(id) || (id === guild.id ? guild : null);
  if (target) {
    let url = d.inviteUrl || (target.vanityURLCode ? `https://discord.gg/${target.vanityURLCode}` : st.inviteUrl || null);
    if (!url) {
      const ch =
        (isId(d.inviteChannelId) && target.channels.cache.get(d.inviteChannelId)) ||
        target.rulesChannel ||
        target.systemChannel ||
        target.channels.cache.find((c) => c.type === ChannelType.GuildText && c.permissionsFor(target.members.me)?.has(PermissionFlagsBits.CreateInstantInvite));
      const invite = await ch?.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'Link undangan untuk embed Social Media' }).catch((e) => {
        console.warn('[social] gagal membuat invite:', e.message);
        return null;
      });
      if (invite) {
        url = invite.url;
        st.inviteUrl = url; // simpan supaya tidak membuat invite baru terus
      }
    }
    return {
      kind: 'server',
      name: target.name,
      icon: target.iconURL({ extension: 'png', size: 256 }),
      members: target.memberCount,
      created: target.createdTimestamp,
      boosts: target.premiumSubscriptionCount || 0,
      url: url || `https://discord.com/channels/${target.id}`,
    };
  }
  const user = isId(id) ? await client.users.fetch(id).catch(() => null) : null;
  return {
    kind: 'user',
    name: user ? user.globalName || user.username : null,
    username: user?.username || null,
    icon: user?.displayAvatarURL({ extension: 'png', size: 256 }) || null,
    created: user?.createdTimestamp || null,
    url: d.inviteUrl || `https://discord.com/users/${id}`,
  };
}

async function buildSocial(client, guild) {
  const cfg = loadConfig();
  if (!cfg) return null;
  const st = loadState();
  const embeds = [];
  const buttons = [];

  embeds.push(
    new EmbedBuilder()
      .setColor(color(cfg.color, 0x3498db))
      .setTitle(fill(cfg.title || '🌐 Social Media | {server}', guild))
      .setDescription(fill(cfg.description, guild) || null)
      .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
      .setImage(cfg.bannerImage || null),
  );

  if (cfg.roblox?.userId) {
    const r = cfg.roblox;
    const info = await robloxInfo(r.userId);
    const url = r.url || `https://www.roblox.com/users/${r.userId}/profile`;
    const e = new EmbedBuilder()
      .setColor(color(r.color, 0x00a2ff))
      .setTitle(r.title || '🎮 Roblox')
      .setURL(url)
      .setDescription(fill(r.description, guild) || null);
    if (info?.name) {
      e.addFields(
        { name: '👤 Username', value: `\`@${info.name}\``, inline: true },
        { name: '✨ Display Name', value: `\`${info.displayName}\``, inline: true },
      );
      if (info.followers != null) e.addFields({ name: '👥 Followers', value: `\`${num(info.followers)}\``, inline: true });
      if (info.friends != null) e.addFields({ name: '🤝 Friends', value: `\`${num(info.friends)}\``, inline: true });
      if (info.created) e.addFields({ name: '📅 Bergabung', value: ts(info.created, 'D'), inline: true });
    }
    if (info?.avatar) e.setThumbnail(info.avatar);
    embeds.push(e);
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(r.button || 'Roblox').setEmoji('🎮').setURL(url));
  }

  if (cfg.tiktok?.url) {
    const t = cfg.tiktok;
    const user = String(t.username || (t.url.match(/@([^/?]+)/) || [])[1] || '').replace(/^@/, '');
    const e = new EmbedBuilder()
      .setColor(color(t.color, 0xfe2c55))
      .setTitle(t.title || '🎵 TikTok')
      .setURL(t.url)
      .setDescription(fill(t.description, guild) || null);
    if (user) e.addFields({ name: '👤 Username', value: `\`@${user}\``, inline: true });
    e.addFields({ name: '🔔 Jangan Lupa', value: '`Follow • Like • Share`', inline: true });
    if (t.thumbnail) e.setThumbnail(t.thumbnail);
    embeds.push(e);
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t.button || 'TikTok').setEmoji('🎵').setURL(t.url));
  }

  if (cfg.discord?.id || cfg.discord?.inviteUrl) {
    const d = cfg.discord;
    const info = await discordInfo(client, guild, d, st);
    const e = new EmbedBuilder()
      .setColor(color(d.color, 0x5865f2))
      .setTitle(d.title || '💬 Discord')
      .setURL(info.url)
      .setDescription(fill(d.description, guild) || null);
    if (info.kind === 'server') {
      e.addFields(
        { name: '🏠 Server', value: `\`${info.name}\``, inline: true },
        { name: '👥 Member', value: `\`${num(info.members)}\``, inline: true },
      );
      if (info.boosts) e.addFields({ name: '🚀 Boost', value: `\`${num(info.boosts)}\``, inline: true });
      e.addFields({ name: '📅 Dibuat', value: ts(info.created, 'D'), inline: true });
    } else if (info.name) {
      e.addFields({ name: '👤 Akun', value: `\`${info.name}\`${info.username ? ` (@${info.username})` : ''}`, inline: true });
    }
    if (info.icon) e.setThumbnail(info.icon);
    embeds.push(e);
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(d.button || (info.kind === 'server' ? 'Join Discord' : 'Discord'))
        .setEmoji('💬')
        .setURL(info.url),
    );
  }

  // Footer + waktu hanya di kartu paling bawah.
  embeds.at(-1).setFooter({ text: fill(cfg.footer || '{server}', guild), iconURL: guild.iconURL({ size: 128 }) || undefined }).setTimestamp(new Date());
  saveState({ ...loadState(), inviteUrl: st.inviteUrl });
  return { embeds, components: buttons.length ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] : [], allowedMentions: { parse: [] } };
}

// ───────────────────────── Command /social ─────────────────────────
const socialCommand = {
  data: new SlashCommandBuilder()
    .setName('social')
    .setDescription('Embed Social Media server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('kirim')
        .setDescription('Kirim / pindahkan embed Social Media (ter-update otomatis tiap 1 jam)')
        .addChannelOption((o) => o.setName('channel').setDescription('Default: channelId di social.json / channel ini').addChannelTypes(...TEXT)),
    )
    .addSubcommand((s) => s.setName('refresh').setDescription('Perbarui embed Social Media sekarang (setelah mengubah social.json)')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cfg = loadConfig();
    if (!cfg) return interaction.editReply('❌ social.json tidak bisa dibaca (cek format JSON-nya).');
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'refresh') {
      const ok = await refresh(interaction.client);
      return interaction.editReply(ok ? '✅ Embed Social Media diperbarui.' : '❌ Embed belum dikirim. Jalankan `/social kirim` dulu.');
    }

    const channel =
      interaction.options.getChannel('channel') ||
      (isId(cfg.channelId) ? await guild.channels.fetch(cfg.channelId).catch(() => null) : null) ||
      interaction.channel;
    if (!channel?.isTextBased()) return interaction.editReply('❌ Channel tidak ditemukan.');
    const payload = await buildSocial(interaction.client, guild);
    const msg = await channel.send(payload);
    const old = loadState().message;
    saveState({ ...loadState(), message: { channelId: channel.id, messageId: msg.id, guildId: guild.id } });
    if (old && old.messageId !== msg.id) {
      const oldCh = await guild.channels.fetch(old.channelId).catch(() => null);
      await oldCh?.messages.delete(old.messageId).catch(() => {});
    }
    return interaction.editReply(`✅ Embed Social Media dikirim ke ${channel} dan akan ter-update otomatis tiap 1 jam.`);
  },
};

async function refresh(client) {
  const loc = loadState().message;
  if (!loc) return false;
  const channel = await client.channels.fetch(loc.channelId).catch(() => null);
  if (!channel) return false;
  const payload = await buildSocial(client, channel.guild);
  if (!payload) return false;
  try {
    await channel.messages.edit(loc.messageId, payload);
    return true;
  } catch (err) {
    if (err.code === RESTJSONErrorCodes.UnknownMessage) {
      const s = loadState();
      delete s.message; // pesan dihapus manual → berhenti di-update
      saveState(s);
    } else console.error('[social] refresh:', err.message);
    return false;
  }
}

function registerSocial(client) {
  client.once(Events.ClientReady, () => {
    refresh(client).catch(() => {});
    setInterval(() => refresh(client).catch(() => {}), REFRESH_MS);
  });
}

module.exports = { socialCommand, registerSocial, buildSocial };
