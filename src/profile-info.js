const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { request, DOMAIN } = require('./store/roblox');

/**
 * Info akun (publik, untuk semua member):
 * - /userinfo [member]  → profil akun Discord + info di server (Components V2).
 * - /roblox <username>  → profil akun Roblox (avatar, status, sosial, grup, username lama).
 */
const V2 = MessageFlags.IsComponentsV2;
const BRAND = 0x3498db;
const ROBLOX_RED = 0xe2231a;
const text = (c) => new TextDisplayBuilder().setContent(String(c).slice(0, 4000));
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const num = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
const ts = (ms, s = 'D') => `<t:${Math.floor(ms / 1000)}:${s}>`;
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  } catch {
    return {};
  }
};

/** Umur akun: "2 tahun 3 bulan" / "5 bulan" / "12 hari". */
function age(ms) {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 30) return `${Math.max(0, days)} hari`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} bulan`;
  const y = Math.floor(months / 12);
  return months % 12 ? `${y} tahun ${months % 12} bulan` : `${y} tahun`;
}
function ageBadge(ms) {
  const days = (Date.now() - ms) / 86400000;
  if (days < 30) return '🌱 Akun Baru';
  if (days < 365) return '🌿 Akun Muda';
  if (days < 365 * 3) return '🌳 Akun Lama';
  return '🏛️ Akun Veteran';
}

// Cooldown sederhana supaya channel tidak di-spam (per member, per command).
const cooldowns = new Map();
function onCooldown(interaction, sec = 8) {
  const key = `${interaction.commandName}:${interaction.user.id}`;
  const left = (cooldowns.get(key) || 0) - Date.now();
  if (left > 0) return Math.ceil(left / 1000);
  cooldowns.set(key, Date.now() + sec * 1000);
  return 0;
}

function card({ accent, thumb, header, banner, blocks, footer, buttons }) {
  const box = new ContainerBuilder().setAccentColor(accent);
  if (banner) box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(banner)));
  if (thumb) box.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(header)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)));
  else box.addTextDisplayComponents(text(header));
  for (const b of blocks.filter(Boolean)) {
    if (b.gallery) {
      box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(b.gallery).setDescription(b.desc || 'Avatar')));
      continue;
    }
    box.addSeparatorComponents(line());
    box.addTextDisplayComponents(text(b));
  }
  box.addSeparatorComponents(line());
  box.addTextDisplayComponents(text(`-# ${footer}`));
  const btns = (buttons || []).filter(Boolean).slice(0, 5);
  if (btns.length) box.addActionRowComponents(new ActionRowBuilder().addComponents(btns));
  return { components: [box], flags: V2, allowedMentions: { parse: [] } };
}
const link = (label, emoji, url) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setEmoji(emoji).setURL(url);
const footerOf = (interaction) => `${interaction.guild?.name || 'Noname Studios Creative'} • Diminta oleh @${interaction.user.username} • ${ts(Date.now(), 'f')}`;

// ═════════════════════════════════ /userinfo ═════════════════════════════════
const BADGE = {
  Staff: '👨‍💼 Discord Staff',
  Partner: '🤝 Partner',
  Hypesquad: '🎉 HypeSquad Events',
  BugHunterLevel1: '🐛 Bug Hunter',
  BugHunterLevel2: '🐞 Bug Hunter Gold',
  HypeSquadOnlineHouse1: '🟣 HypeSquad Bravery',
  HypeSquadOnlineHouse2: '🔴 HypeSquad Brilliance',
  HypeSquadOnlineHouse3: '🟢 HypeSquad Balance',
  PremiumEarlySupporter: '💎 Early Supporter',
  VerifiedDeveloper: '🛠️ Early Verified Bot Developer',
  CertifiedModerator: '🛡️ Moderator Alumni',
  ActiveDeveloper: '⚙️ Active Developer',
  VerifiedBot: '✅ Verified Bot',
};

const userInfoCommand = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Lihat informasi akun Discord kamu / member lain')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Default: kamu sendiri')),
  async execute(interaction) {
    const wait = onCooldown(interaction);
    if (wait) return interaction.reply({ content: `⏳ Tunggu **${wait} detik** sebelum memakai command ini lagi.`, flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    const guild = interaction.guild;
    const picked = interaction.options.getUser('member') || interaction.user;
    const user = await interaction.client.users.fetch(picked.id, { force: true }).catch(() => picked); // force → banner & warna profil
    const member = await guild.members.fetch(user.id).catch(() => null);

    const avatar = (member || user).displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });
    const banner = user.bannerURL?.({ size: 1024 }) || null;
    const accent = user.accentColor || member?.displayColor || BRAND;
    const badges = (user.flags?.toArray?.() || []).map((f) => BADGE[f]).filter(Boolean);
    if (member?.premiumSinceTimestamp) badges.push('🚀 Server Booster');
    if (guild.ownerId === user.id) badges.unshift('👑 Pemilik Server');
    if (user.bot) badges.push('🤖 Bot');

    const header = [
      `# ${member?.displayName || user.globalName || user.username}`,
      `-# @${user.username} • \`${user.id}\``,
      `${ageBadge(user.createdTimestamp)}${badges.length ? ` • ${badges.slice(0, 4).join(' • ')}` : ''}`,
    ].join('\n');

    const account = [
      '### 🪪 Akun Discord',
      `**🏷️ Display Name:** \`${user.globalName || user.username}\``,
      `**🔖 Username:** \`@${user.username}\``,
      `**📅 Dibuat:** ${ts(user.createdTimestamp)} (${ts(user.createdTimestamp, 'R')})`,
      `**⏳ Umur Akun:** \`${age(user.createdTimestamp)}\``,
      badges.length > 4 ? `**🎖️ Badge:** ${badges.join(' • ')}` : null,
    ];

    let server = null;
    let community = null;
    if (member) {
      // Urutan bergabung (member ke-#) — butuh daftar member lengkap.
      let joinPos = null;
      if (guild.members.cache.size >= guild.memberCount - 5) {
        joinPos = [...guild.members.cache.values()].filter((m) => m.joinedTimestamp).sort((a, b) => a.joinedTimestamp - b.joinedTimestamp).findIndex((m) => m.id === user.id) + 1;
      }
      const roles = member.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
      const shown = [...roles.values()].slice(0, 12).map((r) => `<@&${r.id}>`);
      const verifyRole = readJson('verify.json').roleId;
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      const isStaff = !isAdmin && (member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.ManageGuild));
      server = [
        `### 🏠 Di ${guild.name}`,
        `**📥 Bergabung:** ${member.joinedTimestamp ? `${ts(member.joinedTimestamp)} (${ts(member.joinedTimestamp, 'R')})` : '`-`'}`,
        joinPos ? `**🔢 Member Ke:** \`#${num(joinPos)}\` dari \`${num(guild.memberCount)}\`` : null,
        member.nickname ? `**📝 Nickname:** \`${member.nickname}\`` : null,
        isId(verifyRole) ? `**✅ Verifikasi:** ${member.roles.cache.has(verifyRole) ? '`✅ Terverifikasi`' : '`⏳ Belum verifikasi`'}` : null,
        member.premiumSinceTimestamp ? `**🚀 Boost Sejak:** ${ts(member.premiumSinceTimestamp)} (${ts(member.premiumSinceTimestamp, 'R')})` : null,
        isAdmin ? '**🛡️ Akses:** `👑 Administrator`' : isStaff ? '**🛡️ Akses:** `🛠️ Staff / Moderator`' : null,
        `**🎭 Role Tertinggi:** ${roles.first() ? `<@&${roles.first().id}>` : '`-`'}`,
        roles.size ? `**🎨 Role (${num(roles.size)}):** ${shown.join(' ')}${roles.size > shown.length ? ` \`+${roles.size - shown.length}\`` : ''}` : null,
      ];

      // Aktivitas komunitas: undangan & belanja di Noname Store.
      const rows = [];
      try {
        const inv = require('./invite-tracker').computeStats()[user.id];
        if (inv?.valid) rows.push(`**📨 Undangan Valid:** \`${num(inv.valid)} member\``);
      } catch {}
      try {
        const { state } = require('./store/state');
        const SP = require('./store/spender');
        const storeCfg = require('./store/config').loadConfig() || {};
        const sp = state.spenders?.[user.id];
        if (sp?.orders) {
          const tier = SP.tierFor(sp.revenue, storeCfg);
          rows.push(`**🛒 Order Selesai:** \`${num(sp.orders)} order\` • **🏅 Tier:** \`${tier ? SP.tierLabel(tier) : 'Buyer'}\``);
        }
        const reviews = Object.values(state.tickets || {}).filter((t) => (t.kind === 'rekber' ? t.buyerId : t.userId) === user.id && t.testimony?.rating);
        if (reviews.length) rows.push(`**⭐ Testimoni Diberikan:** \`${num(reviews.length)}\``);
      } catch {}
      if (rows.length) community = ['### 💎 Aktivitas di Komunitas', ...rows].join('\n');
    }

    const payload = card({
      accent,
      banner,
      thumb: avatar,
      header,
      blocks: [account.filter(Boolean).join('\n'), server ? server.filter(Boolean).join('\n') : '-# ⚠️ Member ini tidak berada di server.', community],
      footer: footerOf(interaction),
      buttons: [
        link('Avatar', '🖼️', user.displayAvatarURL({ size: 4096, forceStatic: false })),
        banner ? link('Banner', '🎏', user.bannerURL({ size: 4096 })) : null,
        member?.avatar ? link('Avatar Server', '🏠', member.displayAvatarURL({ size: 4096, forceStatic: false })) : null,
        link('Profil', '👤', `https://discord.com/users/${user.id}`),
      ],
    });
    return interaction.editReply(payload);
  },
};

// ═════════════════════════════════ /roblox ═════════════════════════════════
const PRESENCE = {
  0: { label: '⚫ Offline', color: 0x95a5a6 },
  1: { label: '🟢 Online', color: 0x2ecc71 },
  2: { label: '🎮 Sedang Bermain', color: 0x3498db },
  3: { label: '🛠️ Di Roblox Studio', color: 0xe67e22 },
  4: { label: '⚫ Invisible', color: 0x95a5a6 },
};
const api = (sub, p) => `https://${sub}.${DOMAIN}${p}`;
const safe = (p) => p.then((v) => v).catch(() => null);

async function fetchRoblox(input) {
  const clean = String(input || '').trim().replace(/^@/, '');
  let id = null;
  const fromUrl = clean.match(/roblox\.com\/users\/(\d+)/i);
  if (fromUrl) id = fromUrl[1];
  else if (/^\d{1,12}$/.test(clean)) id = clean;
  else if (/^[A-Za-z0-9_]{3,20}$/.test(clean)) {
    const found = await request(api('users', '/v1/usernames/users'), { method: 'POST', body: JSON.stringify({ usernames: [clean], excludeBannedUsers: false }) });
    id = found?.data?.[0]?.id ? String(found.data[0].id) : null;
  } else return { invalid: true };
  if (!id) return null;

  const detail = await request(api('users', `/v1/users/${id}`));
  if (!detail?.id) return null;
  const [head, full, friends, followers, following, groups, history, presence, inventory] = await Promise.all([
    safe(request(api('thumbnails', `/v1/users/avatar-headshot?userIds=${id}&size=420x420&format=Png&isCircular=false`))),
    safe(request(api('thumbnails', `/v1/users/avatar?userIds=${id}&size=720x720&format=Png&isCircular=false`))),
    safe(request(api('friends', `/v1/users/${id}/friends/count`))),
    safe(request(api('friends', `/v1/users/${id}/followers/count`))),
    safe(request(api('friends', `/v1/users/${id}/followings/count`))),
    safe(request(api('groups', `/v2/users/${id}/groups/roles?includeLocked=false`))),
    safe(request(api('users', `/v1/users/${id}/username-history?limit=10&sortOrder=Desc`))),
    safe(request(api('presence', '/v1/presence/users'), { method: 'POST', body: JSON.stringify({ userIds: [Number(id)] }) })),
    safe(request(api('inventory', `/v1/users/${id}/can-view-inventory`))),
  ]);
  return {
    id: String(detail.id),
    name: detail.name,
    displayName: detail.displayName || detail.name,
    description: detail.description || '',
    created: detail.created ? Date.parse(detail.created) : null,
    banned: Boolean(detail.isBanned),
    verified: Boolean(detail.hasVerifiedBadge),
    headshot: head?.data?.[0]?.state === 'Completed' ? head.data[0].imageUrl : head?.data?.[0]?.imageUrl || null,
    avatar: full?.data?.[0]?.state === 'Completed' ? full.data[0].imageUrl : null,
    friends: friends?.count ?? null,
    followers: followers?.count ?? null,
    following: following?.count ?? null,
    groups: (groups?.data || []).map((g) => ({ id: g.group?.id, name: g.group?.name, members: g.group?.memberCount || 0, verified: g.group?.hasVerifiedBadge, role: g.role?.name, rank: g.role?.rank || 0 })),
    history: (history?.data || []).map((h) => h.name).filter((n) => n && n !== detail.name),
    presence: presence?.userPresences?.[0] || null,
    inventoryPublic: inventory?.canView ?? null,
  };
}

const robloxCommand = {
  data: new SlashCommandBuilder()
    .setName('roblox')
    .setDescription('Lihat informasi akun Roblox')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('username').setDescription('Username Roblox, user ID, atau link profil').setRequired(true).setMaxLength(100)),
  async execute(interaction) {
    const wait = onCooldown(interaction);
    if (wait) return interaction.reply({ content: `⏳ Tunggu **${wait} detik** sebelum memakai command ini lagi.`, flags: MessageFlags.Ephemeral });
    const input = interaction.options.getString('username');
    await interaction.deferReply();
    let r;
    try {
      r = await fetchRoblox(input);
    } catch (err) {
      console.error('[roblox] gagal mengambil data:', err.message);
      return interaction.editReply({ content: '⚠️ Server Roblox sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi.' });
    }
    if (!r || r.invalid) {
      return interaction.editReply({
        components: [
          new ContainerBuilder()
            .setAccentColor(0xe74c3c)
            .addTextDisplayComponents(text(`## ❌ Akun Tidak Ditemukan\nAkun Roblox \`${String(input).slice(0, 40)}\` tidak ditemukan.\n-# Pastikan memakai **username** (bukan display name), user ID, atau link profil.`)),
        ],
        flags: V2,
      });
    }

    const pres = PRESENCE[r.presence?.userPresenceType ?? 0] || PRESENCE[0];
    const accent = r.banned ? 0xe74c3c : r.presence ? pres.color : ROBLOX_RED;
    const profile = `https://www.roblox.com/users/${r.id}/profile`;
    const header = [
      `# ${r.displayName}${r.verified ? ' ☑️' : ''}`,
      `-# @${r.name} • \`${r.id}\``,
      [r.banned ? '⛔ **Akun Diblokir (Banned)**' : r.presence ? `**${pres.label}**${r.presence.userPresenceType === 2 && r.presence.lastLocation ? ` • ${r.presence.lastLocation}` : ''}` : null, r.created ? ageBadge(r.created) : null]
        .filter(Boolean)
        .join(' • '),
    ].join('\n');

    const account = [
      '### 🪪 Akun Roblox',
      `**🏷️ Display Name:** \`${r.displayName}\``,
      `**🔖 Username:** \`@${r.name}\``,
      `**🆔 User ID:** \`${r.id}\``,
      r.created ? `**📅 Dibuat:** ${ts(r.created)} (${ts(r.created, 'R')})` : null,
      r.created ? `**⏳ Umur Akun:** \`${age(r.created)}\`` : null,
      `**☑️ Verified Badge:** ${r.verified ? '`✅ Ya`' : '`❌ Tidak`'}${r.inventoryPublic != null ? ` • **🎒 Inventory:** ${r.inventoryPublic ? '`🔓 Publik`' : '`🔒 Privat`'}` : ''}`,
    ];
    const social = [
      '### 👥 Sosial',
      `**🤝 Teman:** \`${r.friends == null ? '-' : num(r.friends)}\` • **❤️ Followers:** \`${r.followers == null ? '-' : num(r.followers)}\` • **➡️ Following:** \`${r.following == null ? '-' : num(r.following)}\``,
      `**🏘️ Grup:** \`${num(r.groups.length)} grup\``,
    ];
    const bio = r.description.trim() ? `### 📝 Bio\n${r.description.trim().slice(0, 350).split('\n').map((l) => `> ${l}`).join('\n')}${r.description.length > 350 ? '…' : ''}` : null;
    const topGroups = [...r.groups].sort((a, b) => b.rank - a.rank || b.members - a.members).slice(0, 5);
    const groups = topGroups.length
      ? `### 🏘️ Grup Teratas\n${topGroups
          .map((g) => `▸ [${g.name}](https://www.roblox.com/communities/${g.id})${g.verified ? ' ☑️' : ''} — \`${g.role || '-'}\` • ${num(g.members)} member`)
          .join('\n')}${r.groups.length > 5 ? `\n-# +${r.groups.length - 5} grup lainnya` : ''}`
      : null;
    const history = r.history.length ? `### 🕓 Username Sebelumnya\n${r.history.slice(0, 6).map((n) => `\`${n}\``).join(' • ')}` : null;

    const payload = card({
      accent,
      thumb: r.headshot,
      header,
      blocks: [
        account.filter(Boolean).join('\n'),
        social.join('\n'),
        bio,
        groups,
        history,
        r.avatar ? { gallery: r.avatar, desc: `Avatar ${r.displayName}` } : null,
      ],
      footer: footerOf(interaction),
      buttons: [
        link('Profil Roblox', '🎮', profile),
        link('Teman', '🤝', `https://www.roblox.com/users/${r.id}/friends`),
        r.inventoryPublic ? link('Inventory', '🎒', `https://www.roblox.com/users/${r.id}/inventory`) : null,
        link('Avatar', '🧍', `https://www.roblox.com/users/${r.id}/avatar`),
      ],
    });
    return interaction.editReply(payload);
  },
};

module.exports = { userInfoCommand, robloxCommand, fetchRoblox };
