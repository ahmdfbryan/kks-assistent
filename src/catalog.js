const config = require('./config');
const { getJson, chunk, API } = require('./roblox');

/**
 * Asset type Roblox → [Tipe, Kategori] seperti di Marketplace.
 * https://create.roblox.com/docs/reference/engine/enums/AssetType
 */
const ASSET_TYPES = {
  2: ['Classic Clothing', 'T-Shirts'],
  8: ['Accessory', 'Hats'],
  11: ['Classic Clothing', 'Shirts'],
  12: ['Classic Clothing', 'Pants'],
  17: ['Body Part', 'Heads'],
  18: ['Body Part', 'Faces'],
  19: ['Gear', 'Gear'],
  27: ['Body Part', 'Torso'],
  28: ['Body Part', 'Right Arm'],
  29: ['Body Part', 'Left Arm'],
  30: ['Body Part', 'Left Leg'],
  31: ['Body Part', 'Right Leg'],
  41: ['Accessory', 'Hair'],
  42: ['Accessory', 'Face'],
  43: ['Accessory', 'Neck'],
  44: ['Accessory', 'Shoulder'],
  45: ['Accessory', 'Front'],
  46: ['Accessory', 'Back'],
  47: ['Accessory', 'Waist'],
  48: ['Animation', 'Climb'],
  49: ['Animation', 'Death'],
  50: ['Animation', 'Fall'],
  51: ['Animation', 'Idle'],
  52: ['Animation', 'Jump'],
  53: ['Animation', 'Run'],
  54: ['Animation', 'Swim'],
  55: ['Animation', 'Walk'],
  56: ['Animation', 'Pose'],
  61: ['Animation', 'Emotes'],
  64: ['Layered Clothing', 'T-Shirts'],
  65: ['Layered Clothing', 'Shirts'],
  66: ['Layered Clothing', 'Pants'],
  67: ['Layered Clothing', 'Jackets'],
  68: ['Layered Clothing', 'Sweaters'],
  69: ['Layered Clothing', 'Shorts'],
  70: ['Layered Clothing', 'Shoes'],
  71: ['Layered Clothing', 'Shoes'],
  72: ['Layered Clothing', 'Dresses & Skirts'],
  76: ['Body Part', 'Eyelashes'],
  77: ['Body Part', 'Eyebrows'],
  78: ['Animation', 'Moods'],
  79: ['Body Part', 'Heads'],
};

const BUNDLE_TYPES = {
  1: ['Bundle', 'Characters'],
  2: ['Bundle', 'Animation Packs'],
  3: ['Bundle', 'Shoes'],
  4: ['Bundle', 'Heads'],
  5: ['Bundle', 'Characters'],
};

function typeInfo(item) {
  if (item.itemType === 'Bundle') return BUNDLE_TYPES[item.bundleType] || ['Bundle', 'Bundles'];
  return ASSET_TYPES[item.assetType] || ['Item', 'Lainnya'];
}

/** Semua item catalog buatan grup (asset + bundle). */
async function searchGroupCatalog(groupId) {
  const items = [];
  let cursor = '';
  do {
    const qs =
      `Category=1&CreatorType=2&CreatorTargetId=${groupId}&IncludeNotForSale=true` +
      `&salesTypeFilter=1&SortType=3&Limit=30` +
      (cursor ? `&Cursor=${encodeURIComponent(cursor)}` : '');
    let json;
    try {
      json = await getJson(`${API('catalog')}/v2/search/items/details?${qs}`);
    } catch (err) {
      if (err.retryable !== false) throw err;
      // Fallback ke endpoint v1 kalau v2 menolak parameter.
      json = await getJson(`${API('catalog')}/v1/search/items/details?${qs}`);
    }
    items.push(...(json.data || []));
    cursor = json.nextPageCursor || '';
  } while (cursor);

  // Buang duplikat (kadang muncul di batas halaman).
  const seen = new Set();
  return items.filter((it) => {
    const key = `${it.itemType}:${it.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Isi favoriteCount yang kosong dari endpoint favorites (sebagian respons search tidak menyertakannya). */
async function fillFavorites(items) {
  const missing = items.filter((it) => typeof it.favoriteCount !== 'number');
  for (const group of chunk(missing, 5)) {
    await Promise.all(
      group.map(async (it) => {
        const kind = it.itemType === 'Bundle' ? 'bundles' : 'assets';
        try {
          const n = await getJson(`${API('catalog')}/v1/favorites/${kind}/${it.id}/count`, { retries: 2 });
          it.favoriteCount = Number(n) || 0;
        } catch {
          it.favoriteCount = 0;
        }
      }),
    );
  }
}

async function getThumbs(items) {
  const map = new Map();
  const assets = items.filter((i) => i.itemType !== 'Bundle').map((i) => i.id);
  const bundles = items.filter((i) => i.itemType === 'Bundle').map((i) => i.id);

  for (const ids of chunk(assets, 50)) {
    const json = await getJson(
      `${API('thumbnails')}/v1/assets?assetIds=${ids.join(',')}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`,
    );
    for (const t of json.data || []) if (t.state === 'Completed' && t.imageUrl) map.set(`Asset:${t.targetId}`, t.imageUrl);
  }
  for (const ids of chunk(bundles, 50)) {
    const json = await getJson(
      `${API('thumbnails')}/v1/bundles/thumbnails?bundleIds=${ids.join(',')}&size=420x420&format=Png&isCircular=false`,
    );
    for (const t of json.data || []) if (t.state === 'Completed' && t.imageUrl) map.set(`Bundle:${t.targetId}`, t.imageUrl);
  }
  return map;
}

function priceInfo(item) {
  const restrictions = item.itemRestrictions || [];
  const isLimited = restrictions.some((r) => /limited|collectible/i.test(r));
  const status = String(item.priceStatus || '');

  if (/off\s*sale/i.test(status) && !(isLimited && item.lowestPrice)) return { label: 'Off Sale', value: null, onSale: false };
  if (/free/i.test(status) || item.price === 0) return { label: 'Free', value: 0, onSale: true };

  const value = isLimited && item.lowestPrice ? item.lowestPrice : item.price;
  if (typeof value !== 'number') return { label: 'Off Sale', value: null, onSale: false };
  return { label: `R$ ${Number(value).toLocaleString('id-ID')}`, value, onSale: true };
}

const time = (d) => (d ? new Date(d).getTime() || 0 : 0);

const SORTERS = {
  // Favorit paling sedikit di atas, favorit terbanyak dikirim paling akhir.
  favorit: (a, b) => a.favorites - b.favorites || a.id - b.id,
  // Item paling awal dibuat di atas (ID Roblox makin besar = makin baru).
  terbaru: (a, b) => time(a.created) - time(b.created) || a.id - b.id,
  harga: (a, b) => (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity) || a.id - b.id,
  name: (a, b) => a.name.localeCompare(b.name, 'id'),
};

/** Ambil semua item catalog grup, siap dijadikan card. */
async function fetchGroupCatalog() {
  let raw = await searchGroupCatalog(config.groupId);
  raw = raw.filter((it) => !config.excludeCatalogIds.includes(String(it.id)));

  let items = raw.map((it) => {
    const [type, category] = typeInfo(it);
    const price = priceInfo(it);
    const isBundle = it.itemType === 'Bundle';
    return {
      _raw: it,
      id: it.id,
      itemType: isBundle ? 'Bundle' : 'Asset',
      name: it.name || 'Tanpa nama',
      description: (it.description || '').trim(),
      type,
      category,
      priceLabel: price.label,
      priceValue: price.value,
      onSale: price.onSale,
      created: it.itemCreatedUtc || it.created || null,
      url: `https://www.roblox.com/${isBundle ? 'bundles' : 'catalog'}/${it.id}`,
    };
  });

  if (!config.catalogIncludeOffsale) items = items.filter((i) => i.onSale);
  if (!items.length) return [];

  await fillFavorites(items.map((i) => i._raw));
  for (const i of items) i.favorites = Number(i._raw.favoriteCount) || 0;

  // Batasi jumlah card: ambil favorit terbanyak.
  if (config.catalogLimit > 0 && items.length > config.catalogLimit) {
    items = items.sort((a, b) => b.favorites - a.favorites).slice(0, config.catalogLimit);
  }

  const thumbs = await getThumbs(items).catch(
    (e) => (console.warn('[catalog] thumbnail gagal:', e.message), new Map()),
  );
  for (const i of items) {
    i.thumbnail = thumbs.get(`${i.itemType}:${i.id}`) || null;
    delete i._raw;
  }

  return items.sort(SORTERS[config.catalogSortBy] || SORTERS.favorit);
}

module.exports = { fetchGroupCatalog };
