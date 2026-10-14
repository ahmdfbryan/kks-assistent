const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  Events,
} = require('discord.js');

/**
 * Giveaway premium.
 * /giveaway mulai | akhiri | reroll | batal | list
 * Peserta ikut lewat tombol, jumlah peserta ter-update otomatis, pemenang diundi otomatis
 * saat waktu habis (tetap jalan walau bot restart). Teks & warna di giveaway.json.
 */
const FILE = path.join(__dirname, '..', 'giveaway.json');
const DATA = path.join(__dirname, '..', 'data', 'giveaways.json');
const EPH = MessageFlags.Ephemeral;
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));
const num = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
const ts = (ms, s = 'R') => `<t:${Math.floor(ms / 1000)}:${s}>`;
let client = null;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('[giveaway] giveaway.json tidak bisa dibaca:', err.message);
    return {};
  }
}
function loadData() {
  try {
    return { seq: 0, items: {}, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) };
  } catch {
    return { seq: 0, items: {} };
  }
}
const data = loadData();
function save() {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(`${DATA}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${DATA}.tmp`, DATA);
}
const color = (cfg, key, fb) => {
  const n = parseInt(String(cfg.colors?.[key] || '').replace('#', ''), 16);
  return Number.isNaN(n) ? fb : n;
};

/** "30m", "2j", "1h", "1d12j", "1 hari 2 jam" → milidetik. */
function parseDuration(text) {
  const units = { s: 1e3, detik: 1e3, m: 6e4, mnt: 6e4, menit: 6e4, j: 36e5, jam: 36e5, h: 36e5, d: 864e5, hari: 864e5, w: 6048e5, minggu: 6048e5 };
  const re = /(\d+)\s*(detik|menit|mnt|jam|hari|minggu|[smjhdw])/gi;
  let total = 0;
  let m;
  let matched = '';
  while ((m = re.exec(String(text || '')))) {
    total += Number(m[1]) * units[m[2].toLowerCase()];
    matched += m[0];
  }
  return matched.replace(/\s/g, '').length === String(text || '').replace(/\s/g, '').length ? total : 0;
}
function durationText(ms) {
  const d = Math.floor(ms / 864e5);
  const h = Math.floor((ms % 864e5) / 36e5);
  const m = Math.round((ms % 36e5) / 6e4);
  return [d && `${d} hari`, h && `${h} jam`, m && `${m} menit`].filter(Boolean).join(' ') || '< 1 menit';
}

/** Ambil N pemenang acak (kriptografis) dari daftar, kecuali yang dikecualikan. */
function pickWinners(entries, count, exclude = []) {
  const pool = entries.filter((id) => !exclude.includes(id));
  const winners = [];
  while (pool.length && winners.length < count) winners.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  return winners;
}

// ───────────────────────── Tampilan ─────────────────────────
function buildGiveaway(g, guild) {
  const cfg = loadConfig();
  const status = g.status;
  const e = new EmbedBuilder()
    .setColor(color(cfg, status === 'active' ? 'active' : status === 'ended' ? 'ended' : 'cancelled', 0x3498db))
    .setAuthor({ name: `${guild.name} • Giveaway`, iconURL: guild.iconURL({ size: 128 }) || undefined })
    .setTitle(status === 'active' ? cfg.title || '🎉 GIVEAWAY 🎉' : status === 'ended' ? '🎊 GIVEAWAY SELESAI 🎊' : '🚫 GIVEAWAY DIBATALKAN')
    .setDescription(`## 🎁 ${g.prize}\n${g.description || (status === 'active' ? cfg.defaultDescription || '' : '')}`.slice(0, 4096))
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null);

  if (status === 'active') {
    e.addFields(
      { name: '⏰ Berakhir', value: `${ts(g.endAt, 'R')}\n┗ ${ts(g.endAt, 'f')}`, inline: true },
      { name: '🏆 Pemenang', value: `\`${num(g.winnerCount)} orang\``, inline: true },
      { name: '👥 Peserta', value: `\`${num(g.entries.length)} orang\``, inline: true },
    );
  } else if (status === 'ended') {
    e.addFields(
      {
        name: `🏆 Pemenang (${g.winners.length})`,
        value: g.winners.length ? g.winners.map((id, i) => `\`${i + 1}.\` <@${id}>`).join('\n').slice(0, 1024) : '_Tidak ada peserta yang memenuhi syarat._',
      },
      { name: '👥 Total Peserta', value: `\`${num(g.entries.length)} orang\``, inline: true },
      { name: '⏱️ Berakhir', value: ts(g.endedAt || g.endAt, 'f'), inline: true },
    );
  }
  e.addFields({ name: '🎟️ Penyelenggara', value: `<@${g.hostId}>`, inline: true });

  const reqs = [];
  if (g.roleId) reqs.push(`▸ Memiliki role <@&${g.roleId}>`);
  if (g.minAccountDays) reqs.push(`▸ Umur akun Discord minimal **${num(g.minAccountDays)} hari**`);
  if (g.minServerDays) reqs.push(`▸ Sudah di server minimal **${num(g.minServerDays)} hari**`);
  if (reqs.length && status === 'active') e.addFields({ name: '📌 Syarat Ikut', value: reqs.join('\n') });
  if (g.image) e.setImage(g.image);
  e.setFooter({ text: `${g.id} • ${{ active: 'Berakhir', ended: 'Selesai', cancelled: 'Dibatalkan' }[status]}`, iconURL: guild.iconURL({ size: 64 }) || undefined }).setTimestamp(
    status === 'active' ? g.endAt : g.endedAt || Date.now(),
  );

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`ga:join:${g.id}`)
      .setLabel(status === 'active' ? cfg.joinButton || 'Ikuti Giveaway' : 'Giveaway Selesai')
      .setEmoji('🎉')
      .setStyle(status === 'active' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(status !== 'active'),
    new ButtonBuilder()
      .setCustomId(`ga:list:${g.id}`)
      .setLabel(`${cfg.participantsButton || 'Peserta'} (${num(g.entries.length)})`)
      .setEmoji('👥')
      .setStyle(ButtonStyle.Secondary),
  ];
  return { embeds: [e], components: [new ActionRowBuilder().addComponents(buttons)], allowedMentions: { parse: [] } };
}

function buildWinnerAnnouncement(g, guild, { reroll = false } = {}) {
  const cfg = loadConfig();
  const link = `https://discord.com/channels/${guild.id}/${g.channelId}/${g.messageId}`;
  const e = new EmbedBuilder()
    .setColor(color(cfg, 'ended', 0x2ecc71))
    .setTitle(reroll ? '🔁 Pemenang Baru (Reroll)!' : '🎊 Selamat Kepada Pemenang!')
    .setDescription(
      g.winners.length
        ? `${g.winners.map((id) => `🏆 <@${id}>`).join('\n')}\n\nKamu memenangkan **${g.prize}**! 🎉\n\n${cfg.claimText || ''}`
        : `Giveaway **${g.prize}** berakhir tanpa pemenang karena tidak ada peserta yang memenuhi syarat. 😢`,
    )
    .addFields(
      { name: '👥 Total Peserta', value: `\`${num(g.entries.length)} orang\``, inline: true },
      { name: '🎟️ Penyelenggara', value: `<@${g.hostId}>`, inline: true },
      { name: '🔗 Giveaway', value: `[Lihat Giveaway](${link})`, inline: true },
    )
    .setFooter({ text: `${g.id} • ${guild.name}`, iconURL: guild.iconURL({ size: 64 }) || undefined })
    .setTimestamp(new Date());
  return {
    content: g.winners.length ? `🎉 ${g.winners.map((id) => `<@${id}>`).join(' ')}` : undefined,
    embeds: [e],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Lihat Giveaway').setEmoji('🎁').setURL(link))],
    allowedMentions: { users: g.winners },
  };
}

// ───────────────────────── Aksi ─────────────────────────
async function fetchMessage(g) {
  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  const msg = channel ? await channel.messages.fetch(g.messageId).catch(() => null) : null;
  return { channel, msg };
}

const editTimers = new Map();
function scheduleEdit(g) {
  clearTimeout(editTimers.get(g.id));
  editTimers.set(
    g.id,
    setTimeout(async () => {
      editTimers.delete(g.id);
      const { channel, msg } = await fetchMessage(g);
      if (msg) await msg.edit(buildGiveaway(g, channel.guild)).catch(() => {});
    }, 2000),
  );
}

async function endGiveaway(g, { reroll = false, count } = {}) {
  const { channel, msg } = await fetchMessage(g);
  if (!channel) return null;
  const guild = channel.guild;
  // Hanya peserta yang masih ada di server yang bisa menang.
  const present = [];
  for (const id of g.entries) if (await guild.members.fetch(id).catch(() => null)) present.push(id);

  if (reroll) {
    const exclude = g.allWinners || g.winners || [];
    g.winners = pickWinners(present, count || g.winnerCount, exclude);
  } else {
    g.status = 'ended';
    g.endedAt = Date.now();
    g.winners = pickWinners(present, g.winnerCount);
  }
  g.allWinners = [...new Set([...(g.allWinners || []), ...g.winners])];
  save();

  if (msg) await msg.edit(buildGiveaway(g, guild)).catch(() => {});
  const announce = buildWinnerAnnouncement(g, guild, { reroll });
  if (msg) await msg.reply(announce).catch(() => channel.send(announce).catch(() => {}));
  else await channel.send(announce).catch(() => {});

  const cfg = loadConfig();
  if (cfg.dmWinners !== false) {
    for (const id of g.winners) {
      const u = await client.users.fetch(id).catch(() => null);
      await u
        ?.send({
          embeds: [
            new EmbedBuilder()
              .setColor(color(cfg, 'ended', 0x2ecc71))
              .setTitle('🎉 Kamu Memenangkan Giveaway!')
              .setDescription(`Selamat! Kamu memenangkan **${g.prize}** di **${guild.name}**! 🏆\n\n${cfg.claimText || ''}`)
              .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }) || null)
              .setFooter({ text: `${g.id} • ${guild.name}` })
              .setTimestamp(new Date()),
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('Lihat Giveaway')
                .setEmoji('🎁')
                .setURL(`https://discord.com/channels/${guild.id}/${g.channelId}/${g.messageId}`),
            ),
          ],
        })
        .catch(() => {});
    }
  }
  if (cfg.dmHost !== false && !reroll) {
    const host = await client.users.fetch(g.hostId).catch(() => null);
    await host
      ?.send(
        `📋 Giveaway **${g.prize}** (\`${g.id}\`) di **${guild.name}** telah selesai.\n👥 Peserta: **${num(g.entries.length)}**\n🏆 Pemenang: ${
          g.winners.map((id) => `<@${id}>`).join(', ') || '-'
        }`,
      )
      .catch(() => {});
  }
  return g;
}

/** Cek syarat peserta. Return teks alasan kalau tidak memenuhi. */
function checkRequirements(g, member) {
  if (g.roleId && !member.roles.cache.has(g.roleId)) return `Kamu harus memiliki role <@&${g.roleId}> untuk ikut giveaway ini.`;
  if (g.minAccountDays && Date.now() - member.user.createdTimestamp < g.minAccountDays * 864e5) {
    return `Umur akun Discord kamu minimal **${num(g.minAccountDays)} hari** untuk ikut giveaway ini.`;
  }
  if (g.minServerDays && Date.now() - (member.joinedTimestamp || Date.now()) < g.minServerDays * 864e5) {
    return `Kamu harus sudah berada di server minimal **${num(g.minServerDays)} hari** untuk ikut giveaway ini.`;
  }
  return null;
}

async function handleInteraction(interaction) {
  const id = interaction.customId;
  if (typeof id !== 'string' || !id.startsWith('ga:')) return false;
  const [, action, gid] = id.split(':');
  const g = data.items[gid];
  try {
    if (!g) {
      await interaction.reply({ content: '❌ Giveaway tidak ditemukan.', flags: EPH });
      return true;
    }
    if (action === 'join') {
      if (g.status !== 'active' || g.endAt <= Date.now()) {
        await interaction.reply({ content: '⌛ Giveaway ini sudah berakhir.', flags: EPH });
      } else if (g.entries.includes(interaction.user.id)) {
        await interaction.reply({
          content: `✅ Kamu **sudah terdaftar** di giveaway **${g.prize}**.\nPeluang menangmu saat ini: **${chance(g)}**. Ingin keluar?`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`ga:leave:${g.id}`).setLabel('Keluar dari Giveaway').setEmoji('🚪').setStyle(ButtonStyle.Danger),
            ),
          ],
          flags: EPH,
        });
      } else {
        const reason = checkRequirements(g, interaction.member);
        if (reason) {
          await interaction.reply({ content: `⛔ ${reason}`, flags: EPH, allowedMentions: { parse: [] } });
        } else {
          g.entries.push(interaction.user.id);
          save();
          scheduleEdit(g);
          await interaction.reply({
            content: `🎉 Kamu **berhasil ikut** giveaway **${g.prize}**!\n🍀 Peluang menangmu: **${chance(g)}** • Diundi ${ts(g.endAt, 'R')}`,
            flags: EPH,
          });
        }
      }
    } else if (action === 'leave') {
      if (g.status === 'active') {
        g.entries = g.entries.filter((u) => u !== interaction.user.id);
        save();
        scheduleEdit(g);
      }
      await interaction.update({ content: `🚪 Kamu telah **keluar** dari giveaway **${g.prize}**.`, components: [] });
    } else if (action === 'list') {
      const list = g.entries.slice(-30).reverse();
      const e = new EmbedBuilder()
        .setColor(color(loadConfig(), 'active', 0x3498db))
        .setTitle(`👥 Peserta Giveaway • ${g.prize}`.slice(0, 256))
        .setDescription(
          list.length
            ? `${list.map((u) => `▸ <@${u}>`).join('\n')}${g.entries.length > 30 ? `\n\n_…dan ${num(g.entries.length - 30)} peserta lainnya_` : ''}`
            : '_Belum ada peserta. Jadilah yang pertama!_ 🎉',
        )
        .addFields(
          { name: '👥 Total', value: `\`${num(g.entries.length)} orang\``, inline: true },
          { name: '🏆 Pemenang', value: `\`${num(g.winnerCount)} orang\``, inline: true },
          { name: '🍀 Peluangmu', value: g.entries.includes(interaction.user.id) ? `\`${chance(g)}\`` : '`Belum ikut`', inline: true },
        );
      await interaction.reply({ embeds: [e], flags: EPH, allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console.error('[giveaway] error:', err);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Terjadi kesalahan, coba lagi.', flags: EPH }).catch(() => {});
  }
  return true;
}
function chance(g) {
  if (!g.entries.length) return '0%';
  const p = Math.min(100, (g.winnerCount / g.entries.length) * 100);
  return `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%`;
}

// ───────────────────────── Command ─────────────────────────
const idOption = (o) => o.setName('id').setDescription('ID giveaway (contoh GA-0001)').setRequired(true).setAutocomplete(true);

const giveawayCommand = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Kelola giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('mulai')
        .setDescription('Mulai giveaway baru')
        .addStringOption((o) => o.setName('hadiah').setDescription('Hadiah giveaway, contoh: 1.000 Robux').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('durasi').setDescription('Contoh: 30m, 2j, 1d, 1d12j (m=menit, j=jam, d=hari)').setRequired(true).setMaxLength(30))
        .addIntegerOption((o) => o.setName('pemenang').setDescription('Jumlah pemenang (default 1)').setMinValue(1).setMaxValue(50))
        .addStringOption((o) => o.setName('deskripsi').setDescription('Keterangan tambahan').setMaxLength(1000))
        .addAttachmentOption((o) => o.setName('gambar').setDescription('Gambar / banner giveaway'))
        .addRoleOption((o) => o.setName('syarat_role').setDescription('Hanya member dengan role ini yang bisa ikut'))
        .addIntegerOption((o) => o.setName('umur_akun').setDescription('Minimal umur akun Discord (hari)').setMinValue(1).setMaxValue(3650))
        .addIntegerOption((o) => o.setName('lama_di_server').setDescription('Minimal lama berada di server (hari)').setMinValue(1).setMaxValue(3650))
        .addBooleanOption((o) => o.setName('ping').setDescription('Mention @everyone saat giveaway dimulai'))
        .addChannelOption((o) => o.setName('channel').setDescription('Default: channel giveaway di giveaway.json').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) => s.setName('akhiri').setDescription('Akhiri giveaway sekarang & undi pemenang').addStringOption(idOption))
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Undi ulang pemenang giveaway yang sudah selesai')
        .addStringOption(idOption)
        .addIntegerOption((o) => o.setName('jumlah').setDescription('Jumlah pemenang baru (default = jumlah pemenang awal)').setMinValue(1).setMaxValue(50)),
    )
    .addSubcommand((s) => s.setName('batal').setDescription('Batalkan giveaway (tanpa pemenang)').addStringOption(idOption))
    .addSubcommand((s) => s.setName('list').setDescription('Daftar giveaway yang sedang berjalan')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = loadConfig();

    if (sub === 'list') {
      const active = Object.values(data.items).filter((g) => g.status === 'active');
      return interaction.reply({
        flags: EPH,
        embeds: [
          new EmbedBuilder()
            .setColor(color(cfg, 'active', 0x3498db))
            .setTitle('🎉 Giveaway Berjalan')
            .setDescription(
              active.length
                ? active
                    .map((g) => `\`${g.id}\` **${g.prize}**\n┗ 👥 ${num(g.entries.length)} peserta • 🏆 ${g.winnerCount} pemenang • ⏰ ${ts(g.endAt, 'R')} • <#${g.channelId}>`)
                    .join('\n\n')
                : '_Tidak ada giveaway yang sedang berjalan._',
            ),
        ],
      });
    }

    if (sub === 'mulai') {
      await interaction.deferReply({ flags: EPH });
      const ms = parseDuration(interaction.options.getString('durasi'));
      if (!ms || ms < 60e3 || ms > 60 * 864e5) {
        return interaction.editReply('❌ Durasi tidak valid. Contoh: `30m`, `2j`, `1d`, `1d12j` (minimal 1 menit, maksimal 60 hari).');
      }
      const channel =
        interaction.options.getChannel('channel') ||
        (isId(cfg.channelId) ? await interaction.guild.channels.fetch(cfg.channelId).catch(() => null) : null) ||
        interaction.channel;
      if (!channel?.isTextBased()) return interaction.editReply('❌ Channel tidak ditemukan.');
      const img = interaction.options.getAttachment('gambar');
      if (img && img.contentType && !img.contentType.startsWith('image/')) return interaction.editReply('❌ File gambar harus berupa gambar (PNG / JPG / GIF).');

      data.seq = (data.seq || 0) + 1;
      const g = {
        id: `GA-${String(data.seq).padStart(4, '0')}`,
        guildId: interaction.guild.id,
        channelId: channel.id,
        messageId: null,
        hostId: interaction.user.id,
        prize: interaction.options.getString('hadiah'),
        description: interaction.options.getString('deskripsi') || null,
        winnerCount: interaction.options.getInteger('pemenang') || 1,
        roleId: interaction.options.getRole('syarat_role')?.id || null,
        minAccountDays: interaction.options.getInteger('umur_akun') || 0,
        minServerDays: interaction.options.getInteger('lama_di_server') || 0,
        image: null,
        entries: [],
        winners: [],
        status: 'active',
        createdAt: Date.now(),
        endAt: Date.now() + ms,
      };
      // Gambar diunggah ulang bersama pesan supaya link-nya tidak kedaluwarsa.
      const files = [];
      if (img) {
        const name = `giveaway${path.extname(img.name || '.png').split('?')[0] || '.png'}`;
        files.push({ attachment: img.url, name });
        g.image = `attachment://${name}`;
      }
      const ping = interaction.options.getBoolean('ping');
      const msg = await channel.send({
        ...buildGiveaway(g, interaction.guild),
        content: ping ? '@everyone' : undefined,
        files,
        allowedMentions: { parse: ping ? ['everyone'] : [] },
      });
      g.messageId = msg.id;
      data.items[g.id] = g;
      save();
      return interaction.editReply(`✅ Giveaway \`${g.id}\` **${g.prize}** dimulai di ${channel} — berakhir ${ts(g.endAt, 'R')} (${durationText(ms)}).`);
    }

    const gid = interaction.options.getString('id').trim().toUpperCase();
    const g = data.items[gid];
    if (!g) return interaction.reply({ content: `❌ Giveaway \`${gid}\` tidak ditemukan.`, flags: EPH });
    await interaction.deferReply({ flags: EPH });

    if (sub === 'akhiri') {
      if (g.status !== 'active') return interaction.editReply('Giveaway ini sudah tidak berjalan.');
      await endGiveaway(g);
      return interaction.editReply(`✅ Giveaway \`${g.id}\` diakhiri. Pemenang: ${g.winners.map((id) => `<@${id}>`).join(', ') || '-'}`);
    }
    if (sub === 'reroll') {
      if (g.status !== 'ended') return interaction.editReply('❌ Reroll hanya untuk giveaway yang sudah selesai.');
      await endGiveaway(g, { reroll: true, count: interaction.options.getInteger('jumlah') });
      return interaction.editReply(
        g.winners.length ? `🔁 Pemenang baru \`${g.id}\`: ${g.winners.map((id) => `<@${id}>`).join(', ')}` : '❌ Tidak ada peserta lain yang bisa dipilih.',
      );
    }
    if (sub === 'batal') {
      if (g.status !== 'active') return interaction.editReply('Giveaway ini sudah tidak berjalan.');
      g.status = 'cancelled';
      g.endedAt = Date.now();
      save();
      const { channel, msg } = await fetchMessage(g);
      if (msg) await msg.edit(buildGiveaway(g, channel.guild)).catch(() => {});
      return interaction.editReply(`🚫 Giveaway \`${g.id}\` dibatalkan.`);
    }
  },

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    const q = String(interaction.options.getFocused() || '').toLowerCase();
    const want = sub === 'reroll' ? 'ended' : 'active';
    const choices = Object.values(data.items)
      .filter((g) => g.status === want && g.guildId === interaction.guildId)
      .filter((g) => !q || g.id.toLowerCase().includes(q) || g.prize.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25)
      .map((g) => ({ name: `${g.id} • ${g.prize}`.slice(0, 100), value: g.id }));
    await interaction.respond(choices).catch(() => {});
  },
};

// ───────────────────────── Timer ─────────────────────────
let checking = false;
async function tick() {
  if (checking || !client) return;
  checking = true;
  try {
    for (const g of Object.values(data.items)) {
      if (g.status === 'active' && g.endAt <= Date.now()) await endGiveaway(g).catch((e) => console.error(`[giveaway] ${g.id}:`, e.message));
    }
  } finally {
    checking = false;
  }
}

function registerGiveaway(c) {
  client = c;
  c.once(Events.ClientReady, () => {
    tick();
    setInterval(tick, 10 * 1000); // cek tiap 10 detik → tetap terundi walau bot sempat restart
  });
}

module.exports = { giveawayCommand, registerGiveaway, handleInteraction, parseDuration, pickWinners };
