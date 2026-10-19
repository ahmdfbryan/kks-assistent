const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { fetchAllMembers } = require('./member-cache');

/**
 * /members — daftar member server (Components V2) dengan halaman ⏮️ ◀️ ▶️ ⏭️,
 * dropdown filter (semua / member / bot / booster / baru / role) & urutan, plus pencarian nama.
 * Hanya terlihat oleh yang memakai command (tidak memenuhi channel).
 */
const V2 = MessageFlags.IsComponentsV2;
const EPH = MessageFlags.Ephemeral;
const BRAND = 0x3498db;
const PER_PAGE = 10;
const text = (c) => new TextDisplayBuilder().setContent(String(c).slice(0, 4000));
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const num = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
const ts = (ms, s = 'R') => `<t:${Math.floor(ms / 1000)}:${s}>`;

const FILTERS = {
  all: { label: 'Semua', emoji: '👥', desc: 'Semua member & bot' },
  humans: { label: 'Member', emoji: '🙋', desc: 'Tanpa bot' },
  bots: { label: 'Bot', emoji: '🤖', desc: 'Hanya bot' },
  boosters: { label: 'Booster', emoji: '🚀', desc: 'Member yang boost server' },
  new: { label: 'Member Baru', emoji: '🌱', desc: 'Bergabung 7 hari terakhir' },
  staff: { label: 'Staff', emoji: '🛡️', desc: 'Admin & moderator' },
};
const SORTS = {
  joined_new: { label: 'Terbaru Bergabung', emoji: '🆕' },
  joined_old: { label: 'Paling Lama Bergabung', emoji: '🏛️' },
  name: { label: 'Nama A → Z', emoji: '🔤' },
  account_old: { label: 'Akun Paling Tua', emoji: '📅' },
};

const isStaff = (m) => m.permissions.has('Administrator') || m.permissions.has('ManageMessages') || m.permissions.has('ManageGuild');
const nameOf = (m) => m.displayName || m.user.globalName || m.user.username;

function listFor(guild, st) {
  let list = [...guild.members.cache.values()];
  const week = Date.now() - 7 * 86400000;
  if (st.filter === 'humans') list = list.filter((m) => !m.user.bot);
  if (st.filter === 'bots') list = list.filter((m) => m.user.bot);
  if (st.filter === 'boosters') list = list.filter((m) => m.premiumSinceTimestamp);
  if (st.filter === 'new') list = list.filter((m) => !m.user.bot && (m.joinedTimestamp || 0) >= week);
  if (st.filter === 'staff') list = list.filter((m) => !m.user.bot && isStaff(m));
  if (st.roleId) list = list.filter((m) => m.roles.cache.has(st.roleId));
  if (st.query) {
    const q = st.query.toLowerCase();
    list = list.filter((m) => [m.displayName, m.user.username, m.user.globalName, m.id].some((v) => String(v || '').toLowerCase().includes(q)));
  }
  const by = {
    joined_new: (a, b) => (b.joinedTimestamp || 0) - (a.joinedTimestamp || 0),
    joined_old: (a, b) => (a.joinedTimestamp || 0) - (b.joinedTimestamp || 0),
    name: (a, b) => nameOf(a).localeCompare(nameOf(b), 'id', { sensitivity: 'base' }),
    account_old: (a, b) => a.user.createdTimestamp - b.user.createdTimestamp,
  }[st.sort];
  return list.sort(by);
}

function badges(guild, m) {
  const b = [];
  if (guild.ownerId === m.id) b.push('👑');
  if (m.user.bot) b.push('🤖');
  else if (m.permissions.has('Administrator')) b.push('🛡️');
  if (m.premiumSinceTimestamp) b.push('🚀');
  if ((m.joinedTimestamp || 0) >= Date.now() - 7 * 86400000 && !m.user.bot) b.push('🌱');
  return b.join('');
}

function build(guild, st, disabled = false) {
  const list = listFor(guild, st);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  st.page = Math.min(Math.max(0, st.page), pages - 1);
  const slice = list.slice(st.page * PER_PAGE, st.page * PER_PAGE + PER_PAGE);
  const all = [...guild.members.cache.values()];
  const humans = all.filter((m) => !m.user.bot).length;
  const bots = all.length - humans;
  const boosters = all.filter((m) => m.premiumSinceTimestamp).length;
  const online = guild.approximatePresenceCount;

  const box = new ContainerBuilder().setAccentColor(BRAND);
  const header = [
    `# 👥 Daftar Member | ${guild.name}`,
    `-# ${guild.name} • Member Directory`,
    `**👥 ${num(guild.memberCount)}** total • **🙋 ${num(humans)}** member • **🤖 ${num(bots)}** bot • **🚀 ${num(boosters)}** booster${online ? ` • **🟢 ${num(online)}** online` : ''}`,
  ].join('\n');
  const icon = guild.iconURL({ extension: 'png', size: 256 });
  if (icon) box.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(header)).setThumbnailAccessory(new ThumbnailBuilder().setURL(icon)));
  else box.addTextDisplayComponents(text(header));

  const f = FILTERS[st.filter];
  const info = [
    `**${f.emoji} Filter:** \`${f.label}\`${st.roleId ? ` • **🎭 Role:** <@&${st.roleId}>` : ''}${st.query ? ` • **🔍 Cari:** \`${st.query}\`` : ''}`,
    `**${SORTS[st.sort].emoji} Urutan:** \`${SORTS[st.sort].label}\` • **📋 Hasil:** \`${num(list.length)} member\``,
  ].join('\n');
  box.addSeparatorComponents(line());
  box.addTextDisplayComponents(text(info));

  box.addSeparatorComponents(line());
  if (!slice.length) {
    box.addTextDisplayComponents(text('### 🔎 Tidak Ada Hasil\nTidak ada member yang cocok dengan filter / pencarian ini.'));
  } else {
    const rows = slice.map((m, i) => {
      const no = String(st.page * PER_PAGE + i + 1).padStart(2, '0');
      const b = badges(guild, m);
      const top = m.roles.highest && m.roles.highest.id !== guild.id ? ` • <@&${m.roles.highest.id}>` : '';
      return `\`#${no}\` <@${m.id}>${b ? ` ${b}` : ''}\n┗ \`@${m.user.username}\`${top} • gabung ${m.joinedTimestamp ? ts(m.joinedTimestamp) : '`-`'}`;
    });
    box.addTextDisplayComponents(text(`### 📋 Halaman ${st.page + 1} dari ${pages}\n${rows.join('\n')}`));
  }
  box.addSeparatorComponents(line());
  box.addTextDisplayComponents(text(`-# 👑 Pemilik • 🛡️ Admin • 🚀 Booster • 🌱 Baru (7 hari) • 🤖 Bot\n-# ${guild.name} • Diperbarui ${ts(Date.now())}`));

  // Navigasi
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ml:first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(disabled || st.page === 0),
    new ButtonBuilder().setCustomId('ml:prev').setEmoji('◀️').setLabel('Prev').setStyle(ButtonStyle.Primary).setDisabled(disabled || st.page === 0),
    new ButtonBuilder().setCustomId('ml:page').setLabel(`${st.page + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('ml:next').setEmoji('▶️').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(disabled || st.page >= pages - 1),
    new ButtonBuilder().setCustomId('ml:last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(disabled || st.page >= pages - 1),
  );
  const filterRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ml:filter')
      .setPlaceholder('🔽 Pilih filter member...')
      .setDisabled(disabled)
      .addOptions(Object.entries(FILTERS).map(([v, x]) => ({ label: x.label, value: v, emoji: x.emoji, description: x.desc, default: st.filter === v }))),
  );
  const sortRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ml:sort')
      .setPlaceholder('↕️ Urutkan berdasarkan...')
      .setDisabled(disabled)
      .addOptions(Object.entries(SORTS).map(([v, x]) => ({ label: x.label, value: v, emoji: x.emoji, default: st.sort === v }))),
  );
  box.addActionRowComponents(nav, filterRow, sortRow);
  return { components: [box], flags: V2, allowedMentions: { parse: [] } };
}

const membersCommand = {
  data: new SlashCommandBuilder()
    .setName('members')
    .setDescription('Lihat daftar member server (dengan halaman, filter & pencarian)')
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('filter')
        .setDescription('Default: Semua')
        .addChoices(...Object.entries(FILTERS).map(([v, x]) => ({ name: `${x.emoji} ${x.label}`, value: v }))),
    )
    .addRoleOption((o) => o.setName('role').setDescription('Hanya member dengan role ini'))
    .addStringOption((o) => o.setName('cari').setDescription('Cari nama / username / ID').setMaxLength(50))
    .addStringOption((o) =>
      o
        .setName('urutan')
        .setDescription('Default: Terbaru bergabung')
        .addChoices(...Object.entries(SORTS).map(([v, x]) => ({ name: `${x.emoji} ${x.label}`, value: v }))),
    ),
  async execute(interaction) {
    await interaction.deferReply({ flags: EPH });
    const guild = interaction.guild;
    await fetchAllMembers(guild);
    await guild.fetch().catch(() => {}); // jumlah online (approximate)
    const st = {
      filter: interaction.options.getString('filter') || 'all',
      sort: interaction.options.getString('urutan') || 'joined_new',
      roleId: interaction.options.getRole('role')?.id || null,
      query: (interaction.options.getString('cari') || '').trim() || null,
      page: 0,
    };
    const msg = await interaction.editReply(build(guild, st));
    const collector = msg.createMessageComponentCollector({ idle: 10 * 60000 });
    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Gunakan `/members` untuk membuka daftarmu sendiri.', flags: EPH }).catch(() => {});
      if (i.customId === 'ml:first') st.page = 0;
      if (i.customId === 'ml:prev') st.page -= 1;
      if (i.customId === 'ml:next') st.page += 1;
      if (i.customId === 'ml:last') st.page = Number.MAX_SAFE_INTEGER;
      if (i.customId === 'ml:filter') {
        st.filter = i.values[0];
        st.page = 0;
      }
      if (i.customId === 'ml:sort') {
        st.sort = i.values[0];
        st.page = 0;
      }
      await i.update(build(guild, st)).catch(() => {});
    });
    collector.on('end', () => interaction.editReply(build(guild, st, true)).catch(() => {}));
  },
};

module.exports = { membersCommand, build };
