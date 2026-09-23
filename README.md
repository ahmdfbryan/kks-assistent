# KKS Map Card Bot

Bot Discord yang menampilkan **card setiap map Roblox** milik grup
[KokoKrunch Studios](https://www.roblox.com/id/communities/625247444/KokoKrunch-Studios),
lalu memperbarui value-nya (Playing, Visits, Access) **otomatis setiap 1 hari**.

Isi tiap card:

```
🗺️ Judul Map            (klik → halaman game)
Playing   Visits      Access
`3`       `1.205.482` `Free`
[ Gambar thumbnail map ]
(icon) Footer • tanggal update
[ Play di Roblox ↗ ]
```

## Instalasi

```bash
npm install
cp .env.example .env      # lalu isi DISCORD_TOKEN, CLIENT_ID, GUILD_ID
npm run deploy            # daftarkan slash command (sekali saja / tiap command berubah)
npm start                 # atau: pm2 start ecosystem.config.js
```

Butuh Node.js 18.17+ (pakai `fetch` bawaan). Tidak pakai native module —
data disimpan di `data/state.json`, jadi aman di VPS Node 20.

Izin bot di channel tujuan: **View Channel, Send Messages, Embed Links**.
Undang bot dengan scope `bot` + `applications.commands`.

## Perintah (khusus member dengan izin Manage Server)

| Perintah | Fungsi |
|---|---|
| `/maps kirim [channel]` | Tampilkan card semua map di channel ini / channel pilihan. Kalau sudah ada, card lama di-edit (tidak dobel). |
| `/maps refresh` | Perbarui value semua card sekarang juga. |
| `/maps stop [channel]` | Hapus card & hentikan update otomatis di channel itu. |

## Cara kerja update

- Bot mengecek tiap 10 menit apakah sudah 24 jam sejak update terakhir tiap channel.
  Jadwal disimpan di file, jadi tetap jalan normal walau bot di-restart pm2.
- Card **di-edit**, bukan dikirim ulang — channel tetap rapi.
- Map baru di grup → card baru ditambahkan. Map dihapus/diprivate → card-nya dihapus.
- Kalau API Roblox gagal, card lama dibiarkan dan dicoba lagi 10 menit kemudian.
  Kalau VPS sering gagal konek ke Roblox, set `ROBLOX_DOMAIN=roproxy.com` di `.env`.

## Pengaturan (.env)

| Variabel | Default | Keterangan |
|---|---|---|
| `ROBLOX_GROUP_ID` | `625247444` | ID grup Roblox |
| `ROBLOX_DOMAIN` | `roblox.com` | Ganti `roproxy.com` jika perlu proxy |
| `EXCLUDE_UNIVERSE_IDS` | – | Universe ID map yang disembunyikan (pisah koma) |
| `SORT_BY` | `visits` | Urutan card: `visits`, `playing`, `name`, `updated` |
| `EMBED_COLOR` | `#E53935` | Warna garis kiri card |
| `FOOTER_TEXT` | `Update setiap 1 hari • Made by KokoKrunch Studios` | Teks footer |
| `UPDATE_INTERVAL_HOURS` | `24` | Jarak antar update otomatis |
