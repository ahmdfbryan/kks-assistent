const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');

const fmt = (n) => Number(n || 0).toLocaleString('id-ID'); // 1205482 → 1.205.482
const code = (v) => `\`${v}\``;

function accessLabel(map) {
  return map.price && map.price > 0 ? `${fmt(map.price)} Robux` : 'Free';
}

function linkButton(label, url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url),
  );
}

/**
 * Card map = 1 embed + tombol "Play di Roblox".
 * footerIcon = logo server Discord (diambil dari server channel tujuan).
 */
function buildMapCard(map, { footerIcon } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`🗺️ ${map.name}`.slice(0, 256))
    .setURL(map.url)
    .addFields(
      { name: 'Playing', value: code(fmt(map.playing)), inline: true },
      { name: 'Visits', value: code(fmt(map.visits)), inline: true },
      { name: 'Access', value: code(accessLabel(map)), inline: true },
    )
    .setFooter({ text: config.footerText, iconURL: footerIcon || undefined })
    .setTimestamp(new Date());

  if (map.thumbnail) embed.setImage(map.thumbnail);
  return { embeds: [embed], components: [linkButton('Play di Roblox', map.url)] };
}

/** Card catalog = 1 embed + tombol "Beli di Catalog". */
function buildCatalogCard(item, { footerIcon } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`🛍️ ${item.name}`.slice(0, 256))
    .setURL(item.url)
    .addFields(
      { name: 'Tipe', value: code(item.type), inline: true },
      { name: 'Kategori', value: code(item.category), inline: true },
      { name: 'Harga', value: code(item.priceLabel), inline: true },
      { name: 'Favorit', value: code(fmt(item.favorites)), inline: true },
    )
    .setFooter({ text: config.footerText, iconURL: footerIcon || undefined })
    .setTimestamp(new Date());

  if (item.thumbnail) embed.setImage(item.thumbnail);
  return { embeds: [embed], components: [linkButton('Beli di Catalog', item.url)] };
}

/** Pesan pengganti kalau belum ada data. */
function buildEmptyCard({ footerIcon, title, description } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(title || '🗺️ Belum ada map publik')
    .setDescription(description || 'Map dari KokoKrunch Studios akan muncul di sini setelah dipublikasikan.')
    .setFooter({ text: config.footerText, iconURL: footerIcon || undefined })
    .setTimestamp(new Date());
  return { embeds: [embed], components: [] };
}

module.exports = { buildMapCard, buildCatalogCard, buildEmptyCard };
