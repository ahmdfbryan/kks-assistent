const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

/**
 * /clear — hapus chat di channel (khusus member dengan izin Manage Messages).
 * - Tanpa "jumlah" → hapus SELURUH chat di channel (wajib konfirmasi).
 * - Filter opsional: member tertentu, hanya pesan bot, simpan pesan yang di-pin.
 * - Pesan < 14 hari dihapus massal (cepat); pesan lebih lama dihapus satu per satu (aturan Discord).
 * - Progres tampil langsung + tombol Hentikan. Channel tetap sama (ID tidak berubah).
 */
const V2 = MessageFlags.IsComponentsV2;
const EPH = MessageFlags.Ephemeral;
const BRAND = 0x3498db;
const BULK_AGE = 14 * 86400000 - 60000; // batas hapus massal Discord (14 hari)
const running = new Map(); // channelId → { stop }

const text = (c) => new TextDisplayBuilder().setContent(String(c).slice(0, 4000));
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const num = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
function card(accent, blocks, rows = []) {
  const box = new ContainerBuilder().setAccentColor(accent);
  blocks.filter(Boolean).forEach((b, i) => {
    if (i) box.addSeparatorComponents(line());
    box.addTextDisplayComponents(text(b));
  });
  for (const r of rows) box.addActionRowComponents(r);
  return { components: [box], flags: V2 | EPH, allowedMentions: { parse: [] } };
}
const bar = (pct) => '🟦'.repeat(Math.round(pct / 10)) + '⬛'.repeat(10 - Math.round(pct / 10));
function dur(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} detik` : `${Math.floor(s / 60)} menit ${s % 60} detik`;
}
const filterText = (o) =>
  [
    o.limit ? `**🔢 Jumlah:** \`${num(o.limit)} pesan terakhir\`` : '**🔢 Jumlah:** `SEMUA pesan di channel`',
    o.user ? `**👤 Hanya dari:** <@${o.user.id}>` : null,
    o.botsOnly ? '**🤖 Hanya pesan bot**' : null,
    `**📌 Pesan di-pin:** ${o.keepPinned ? '`Disimpan`' : '`Ikut dihapus`'}`,
  ]
    .filter(Boolean)
    .join('\n');

/** Hapus pesan sesuai filter. onProgress dipanggil berkala. */
async function purge(channel, o, state, onProgress) {
  let before;
  let lastReport = 0;
  const report = async (force = false) => {
    if (!force && Date.now() - lastReport < 2500) return;
    lastReport = Date.now();
    await onProgress().catch(() => {});
  };
  while (!state.stop) {
    const batch = await channel.messages.fetch({ limit: 100, before, cache: false }).catch(() => null);
    if (!batch?.size) break;
    before = batch.last().id;
    state.scanned += batch.size;
    let targets = [...batch.values()].filter((m) => {
      if (m.id === o.keepId) return false;
      if (o.keepPinned && m.pinned) {
        state.skipped += 1;
        return false;
      }
      if (o.user && m.author?.id !== o.user.id) return false;
      if (o.botsOnly && !m.author?.bot) return false;
      return true;
    });
    if (o.limit) targets = targets.slice(0, Math.max(0, o.limit - state.deleted - state.failed));

    const recent = targets.filter((m) => Date.now() - m.createdTimestamp < BULK_AGE && m.bulkDeletable !== false);
    const old = targets.filter((m) => !recent.includes(m));
    if (recent.length >= 2) {
      const done = await channel.bulkDelete(recent.map((m) => m.id), true).catch(() => null);
      state.deleted += done?.size || 0;
      state.failed += recent.length - (done?.size || 0);
    } else if (recent.length === 1) old.unshift(recent[0]);
    await report();

    for (const m of old) {
      if (state.stop) break;
      state.old += 1;
      const ok = await m.delete().then(() => true).catch(() => false);
      if (ok) state.deleted += 1;
      else state.failed += 1;
      await report();
    }
    if (o.limit && state.deleted + state.failed >= o.limit) break;
    if (batch.size < 100) break;
  }
  await report(true);
}

const clearCommand = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Hapus chat di channel ini (semua / sejumlah pesan terakhir)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('jumlah').setDescription('Jumlah pesan terakhir yang dihapus (kosongkan = hapus SEMUA chat)').setMinValue(1).setMaxValue(10000))
    .addUserOption((o) => o.setName('member').setDescription('Hanya hapus pesan dari member ini'))
    .addBooleanOption((o) => o.setName('hanya-bot').setDescription('Hanya hapus pesan dari bot'))
    .addBooleanOption((o) => o.setName('simpan-pin').setDescription('Jangan hapus pesan yang di-pin (default: ikut dihapus)')),
  async execute(interaction) {
    const channel = interaction.channel;
    if (!channel?.isTextBased() || !channel.messages) return interaction.reply({ content: '❌ Command ini hanya bisa dipakai di channel teks.', flags: EPH });
    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ViewChannel])) {
      return interaction.reply({ content: '❌ Bot butuh izin **Manage Messages** & **Read Message History** di channel ini.', flags: EPH });
    }
    if (running.has(channel.id)) return interaction.reply({ content: '⏳ Proses hapus chat di channel ini masih berjalan.', flags: EPH });

    const o = {
      limit: interaction.options.getInteger('jumlah'),
      user: interaction.options.getUser('member'),
      botsOnly: interaction.options.getBoolean('hanya-bot') || false,
      keepPinned: interaction.options.getBoolean('simpan-pin') || false,
    };

    // ── Konfirmasi (selalu untuk hapus semua / jumlah besar)
    const needConfirm = !o.limit || o.limit > 100;
    let current = interaction;
    if (needConfirm) {
      const msg = await interaction.reply({
        ...card(
          0xe74c3c,
          [
            `## ⚠️ Konfirmasi Hapus Chat\nKamu akan menghapus chat di ${channel}. **Tindakan ini tidak bisa dibatalkan.**`,
            filterText(o),
            '-# Pesan berumur lebih dari 14 hari dihapus satu per satu (lebih lambat, aturan Discord).',
          ],
          [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('clr:yes').setLabel('Ya, Hapus Sekarang').setEmoji('🧹').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('clr:no').setLabel('Batal').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
            ),
          ],
        ),
        withResponse: true,
      });
      const replyMsg = msg.resource?.message || (await interaction.fetchReply());
      const btn = await replyMsg
        .awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith('clr:'), time: 60000 })
        .catch(() => null);
      if (!btn || btn.customId === 'clr:no') {
        const payload = card(0x95a5a6, [btn ? '## ✖️ Dibatalkan\nTidak ada pesan yang dihapus.' : '## ⌛ Waktu Habis\nKonfirmasi tidak diklik dalam 60 detik. Tidak ada pesan yang dihapus.']);
        return btn ? btn.update(payload) : interaction.editReply(payload);
      }
      await btn.deferUpdate();
      current = btn;
    } else {
      await interaction.deferReply({ flags: EPH });
    }

    // ── Proses hapus + progres
    const state = { stop: false, deleted: 0, failed: 0, skipped: 0, scanned: 0, old: 0, started: Date.now() };
    running.set(channel.id, state);
    const stopRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('clr:stop').setLabel('Hentikan').setEmoji('⏹️').setStyle(ButtonStyle.Danger));
    const progress = () => {
      const pct = o.limit ? Math.min(100, Math.round(((state.deleted + state.failed) / o.limit) * 100)) : null;
      return card(
        BRAND,
        [
          `## 🧹 Sedang Menghapus Chat…\nChannel: ${channel}`,
          [
            pct != null ? `${bar(pct)} \`${pct}%\`` : null,
            `**🗑️ Terhapus:** \`${num(state.deleted)}\` • **🔍 Dipindai:** \`${num(state.scanned)}\``,
            state.old ? `**🐢 Pesan lama (>14 hari):** \`${num(state.old)}\` — dihapus satu per satu` : null,
            `**⏱️ Berjalan:** \`${dur(Date.now() - state.started)}\``,
          ]
            .filter(Boolean)
            .join('\n'),
        ],
        [stopRow],
      );
    };
    const edit = (p) => (current === interaction ? interaction.editReply(p) : current.editReply(p));
    await edit(progress()).catch(() => {});
    const replyMsg = await (current === interaction ? interaction.fetchReply() : current.fetchReply()).catch(() => null);
    const collector = replyMsg?.createMessageComponentCollector({ filter: (i) => i.customId === 'clr:stop' && i.user.id === interaction.user.id, time: 3600000 });
    collector?.on('collect', (i) => {
      state.stop = true;
      i.deferUpdate().catch(() => {});
    });

    try {
      await purge(channel, { ...o, keepId: null }, state, () => edit(progress()));
    } finally {
      running.delete(channel.id);
      collector?.stop();
    }

    const took = Date.now() - state.started;
    await edit(
      card(state.stop ? 0xe67e22 : 0x2ecc71, [
        `## ${state.stop ? '⏹️ Penghapusan Dihentikan' : '✅ Chat Berhasil Dihapus'}\nChannel: ${channel}`,
        [
          `**🗑️ Terhapus:** \`${num(state.deleted)} pesan\``,
          state.failed ? `**⚠️ Gagal:** \`${num(state.failed)} pesan\`` : null,
          state.skipped ? `**📌 Disimpan (pin):** \`${num(state.skipped)} pesan\`` : null,
          `**⏱️ Durasi:** \`${dur(took)}\``,
        ]
          .filter(Boolean)
          .join('\n'),
        filterText(o),
        `-# ${interaction.guild.name} • ${`<t:${Math.floor(Date.now() / 1000)}:f>`}`,
      ]),
    ).catch(() => {});

    // Info singkat di channel (hilang otomatis setelah 6 detik).
    if (state.deleted) {
      const note = await channel
        .send({
          components: [
            new ContainerBuilder()
              .setAccentColor(BRAND)
              .addTextDisplayComponents(text(`### 🧹 Channel Dibersihkan\n**${num(state.deleted)} pesan** dihapus oleh <@${interaction.user.id}>.\n-# Pesan ini akan hilang otomatis.`)),
          ],
          flags: V2,
          allowedMentions: { parse: [] },
        })
        .catch(() => null);
      if (note) setTimeout(() => note.delete().catch(() => {}), 6000);
    }
  },
};

module.exports = { clearCommand, purge };
