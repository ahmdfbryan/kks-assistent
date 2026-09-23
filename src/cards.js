const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');

const fmt = (n) => Number(n || 0).toLocaleString('id-ID'); // 1205482 → 1.205.482

function accessLabel(map) {
  return map.price && map.price > 0 ? `${fmt(map.price)} Robux` : 'Free';
}

/** Satu card map = 1 embed + 1 tombol link "Play di Roblox". */
function buildMapCard(map) {
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`🗺️ ${map.name}`.slice(0, 256))
    .setURL(map.url)
    .addFields(
      { name: 'Playing', value: `\`${fmt(map.playing)}\``, inline: true },
      { name: 'Visits', value: `\`${fmt(map.visits)}\``, inline: true },
      { name: 'Access', value: `\`${accessLabel(map)}\``, inline: true },
    )
    .setFooter({ text: config.footerText, iconURL: map.icon || undefined })
    .setTimestamp(new Date());

  if (map.thumbnail) embed.setImage(map.thumbnail);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Play di Roblox').setURL(map.url),
  );

  return { embeds: [embed], components: [row] };
}

/** Pesan pengganti kalau grup belum punya map publik. */
function buildEmptyCard() {
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle('🗺️ Belum ada map publik')
    .setDescription('Map dari KokoKrunch Studios akan muncul di sini setelah dipublikasikan.')
    .setFooter({ text: config.footerText })
    .setTimestamp(new Date());
  return { embeds: [embed], components: [] };
}

module.exports = { buildMapCard, buildEmptyCard };
