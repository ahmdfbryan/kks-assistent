const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
} = require('discord.js');

const FILE = path.join(__dirname, '..', 'verify.json');
const BUTTON_ID = 'verify:start';
const isId = (v) => /^\d{17,20}$/.test(String(v || ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dibaca ulang tiap dipakai → edit verify.json tidak perlu restart bot. */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('[verify] verify.json tidak bisa dibaca:', err.message);
    return null;
  }
}

function parseColor(value) {
  const n = parseInt(String(value || '').replace('#', ''), 16);
  return Number.isNaN(n) ? 0xe53935 : n;
}

/** Cek role verifikasi valid & bisa diberikan bot. Mengembalikan { role } atau { error }. */
async function resolveRole(guild, cfg) {
  if (!isId(cfg?.roleId)) return { error: 'roleId di verify.json belum diisi.' };
  const role = await guild.roles.fetch(cfg.roleId).catch(() => null);
  if (!role) return { error: `Role ${cfg.roleId} tidak ditemukan di server ini.` };

  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { error: 'Bot belum punya izin **Manage Roles**.' };
  }
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return { error: `Role bot harus berada **di atas** role ${role} (Server Settings → Roles, geser role bot ke atas).` };
  }
  return { role };
}

/**
 * Panel verifikasi.
 * - verified: false → panel utama (merah) + tombol "Verify Sekarang" aktif. Dikirim ke channel.
 * - verified: true  → panel hijau + tombol mati "Terverifikasi". Ditampilkan KHUSUS ke member
 *   yang klik (ephemeral), karena panel utama dilihat semua orang dan harus tetap aktif untuk member baru.
 */
function buildPanel(guild, cfg, { verified = false, role = null } = {}) {
  const p = cfg.panel || {};
  const v = cfg.verifiedPanel || {};
  const icon = guild.iconURL({ extension: 'png', size: 256 }) || undefined;
  const fillRole = (t) => String(t).replace(/\{role\}/g, role ? `${role}` : 'member');

  const embed = new EmbedBuilder()
    .setColor(parseColor(verified ? v.color || '#43B581' : cfg.color))
    .setTitle(verified ? v.title || '✅ Verifikasi Berhasil' : p.title || 'Verifikasi Diperlukan')
    .setDescription(
      verified
        ? fillRole(v.description || 'Kamu sudah terverifikasi dan mendapatkan role {role}. Semua channel sudah terbuka!')
        : p.description || 'Klik tombol di bawah untuk verifikasi.',
    )
    .setFooter({ text: p.footer || guild.name, iconURL: icon })
    .setTimestamp(new Date());
  if (icon) embed.setThumbnail(icon);

  const button = new ButtonBuilder()
    .setCustomId(BUTTON_ID)
    .setStyle(ButtonStyle.Success)
    .setLabel(verified ? v.button || 'Terverifikasi' : p.button || 'Verify Sekarang')
    .setEmoji('✅')
    .setDisabled(verified);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

/** Saat member klik "Verify Sekarang". */
async function handleVerifyButton(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const cfg = loadConfig();
  const msg = cfg?.messages || {};

  const { role, error } = await resolveRole(interaction.guild, cfg);
  if (error) {
    console.warn(`[verify] ${interaction.user.tag}: ${error}`);
    return interaction.editReply(msg.failed || '❌ Verifikasi gagal diproses. Silakan hubungi admin.');
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const greenPanel = buildPanel(interaction.guild, cfg, { verified: true, role });

  if (member.roles.cache.has(role.id)) {
    // Sudah member → tampilkan panel hijau dengan tombol mati.
    return interaction.editReply({ content: msg.already || null, ...greenPanel });
  }

  try {
    await member.roles.add(role, 'Verifikasi lewat tombol Verify Sekarang');
  } catch (err) {
    console.error(`[verify] gagal memberi role ke ${interaction.user.tag}:`, err.message);
    return interaction.editReply(msg.failed || '❌ Verifikasi gagal diproses. Silakan hubungi admin.');
  }

  console.log(`[verify] ${interaction.user.tag} terverifikasi.`);
  return interaction.editReply({
    content: String(msg.success ?? '').replace(/\{role\}/g, `${role}`) || null,
    ...greenPanel,
  });
}

/** /verify kirim | beri-semua */
const verifyCommand = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Sistem verifikasi member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('kirim')
        .setDescription('Kirim panel verifikasi (embed + tombol Verify Sekarang)')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel tujuan (default: channel ini)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('beri-semua')
        .setDescription('Beri role verifikasi ke SEMUA member lama (jalankan sekali sebelum channel dikunci)'),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cfg = loadConfig();
    if (!cfg) return interaction.editReply('❌ verify.json tidak bisa dibaca (cek format JSON-nya).');

    const { role, error } = await resolveRole(interaction.guild, cfg);
    if (error) return interaction.editReply(`❌ ${error}`);

    const sub = interaction.options.getSubcommand();

    if (sub === 'kirim') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.editReply(`❌ Bot butuh izin View Channel, Send Messages, dan Embed Links di ${channel}.`);
      }
      await channel.send(buildPanel(interaction.guild, cfg));
      return interaction.editReply(`✅ Panel verifikasi dikirim ke ${channel}. Member yang klik tombolnya akan mendapat role ${role}.`);
    }

    if (sub === 'beri-semua') {
      const members = await interaction.guild.members.fetch();
      const targets = members.filter((m) => !m.user.bot && !m.roles.cache.has(role.id));
      if (!targets.size) return interaction.editReply(`Semua member sudah punya role ${role}.`);

      await interaction.editReply(`⏳ Memberi role ${role} ke ${targets.size} member lama...`);
      let done = 0;
      let failed = 0;
      for (const m of targets.values()) {
        try {
          await m.roles.add(role, 'Member lama — diberi role verifikasi otomatis');
          done++;
        } catch {
          failed++;
        }
        if ((done + failed) % 25 === 0) {
          await interaction.editReply(`⏳ Proses ${done + failed}/${targets.size} member...`).catch(() => {});
        }
        await sleep(300); // jaga-jaga rate limit Discord
      }
      return interaction
        .editReply(`✅ Selesai: ${done} member lama mendapat role ${role}.` + (failed ? ` ⚠️ ${failed} gagal.` : ''))
        .catch(() => {});
    }
  },
};

module.exports = { verifyCommand, handleVerifyButton, BUTTON_ID };
