# Noname Assistent Bot

Bot Discord untuk server **Noname Studios Creative**: welcome member baru, verifikasi, rules, cari teman di voice, dan **store + ticket order**.

## Instalasi

```bash
npm install
cp .env.example .env      # lalu isi DISCORD_TOKEN, CLIENT_ID, GUILD_ID
npm run deploy            # daftarkan slash command (setiap kali command berubah)
pm2 start src/index.js --name noname-assistent
pm2 save
```

Wajib: aktifkan **Server Members Intent** di Discord Developer Portal → aplikasi bot → *Bot* →
*Privileged Gateway Intents*. Tanpa itu bot gagal login.

Jalankan bot hanya lewat pm2. Bot menolak menyala kalau sudah ada proses lain yang jalan dari folder
yang sama (file `data/bot.pid`), supaya pesan tidak terkirim dobel.

## Perintah (khusus member dengan izin Manage Server)

| Perintah | Fungsi |
|---|---|
| `/welcome test [channel]` | Kirim contoh pesan welcome (pakai akun kamu) untuk cek tampilan. |
| `/verify kirim [channel]` | Kirim panel verifikasi Components V2 (tombol **Verify Sekarang**). Kirim ulang otomatis menghapus panel sebelumnya. |
| `/verify beri-semua` | Beri role verifikasi ke semua member lama. |
| `/rules [channel]` | Kirim rules / community guidelines (Components V2: logo server, garis pemisah, ringkasan aturan otomatis, footer) + tombol **Bahasa Inggris**. Kirim ulang otomatis menghapus rules lama. |
| `/cari-voice [channel]` | Kirim panel sticky Components V2 untuk mencari member yang sedang di voice (Live Voice, voice teramai, tombol 🎧 Lihat Semua Voice). |
| `/social kirim [channel]` / `/social refresh` | Kirim / perbarui **Social Media** (Components V2: Roblox, TikTok, Discord). Ter-update otomatis tiap 1 jam. |
| `/invite-log leaderboard [channel]` | Kirim **Top 10 Inviter** ke channel leaderboard (ter-update otomatis). Log member masuk/keluar memakai Components V2. |
| `/invites [member]` | (Semua member) Lihat statistik undangan sendiri / member lain. |
| `/giveaway mulai / akhiri / reroll / batal / list` | Kelola **giveaway** (lihat bagian Giveaway). |
| `/system panel [channel]` / `/system refresh` | Kirim / perbarui dashboard **System Operational** (status bot & semua layanan, ter-update otomatis). |
| `/booster test [member]` / `/booster kirim member` / `/booster list` | Contoh ucapan booster, kirim ucapan manual, daftar booster aktif. |
| `/suggestion panel [channel]` | Kirim panel **Suggestions** (sticky, selalu di paling bawah). |
| `/suggestion status id status [tanggapan]` / `/suggestion hapus id` | Ubah status / hapus saran. |
| `/giveaway ban / unban / banlist` | Ban / lepas ban member dari giveaway, dan lihat daftar ban. |
| `/danamasuk [nominal] [catatan]` | (Admin, di channel ticket) Umumkan **dana pembeli sudah masuk** → status Lunas, pembeli di-ping & dapat DM. |
| `/spender [member]` | (Semua member) Kartu total belanja, tier, dan progres ke tier berikutnya. |
| `/store perbarui-tampilan` | Ubah history order & testimoni lama (format embed) ke tampilan baru Components V2; urutan & nomor tetap. |
| `/store sinkron-role` | Pasang ulang role Buyer & tier spender ke semua pembeli. |
| `/server-stats setup / refresh / hapus` | Kategori **Server Stats** berisi channel terkunci 👥 Members, 🎫 Active Tickets, ✅ Total Orders (angka otomatis). |
| `/ticket panel [channel]` | Kirim panel **NCS Ticket Center** (Support, Claim Giveaway, ...). |
| `/ticket tambah / keluarkan @member` | (Di channel ticket) Tambah / keluarkan member dari ticket. |
| `/ticket tutup [alasan]` | (Di channel ticket) Tutup ticket + transcript. |
| `/store panel` | Kirim panel store (status, stock, harga, total transaksi, rating — ter-update otomatis). |
| `/store panel jenis:Produk Digital` / `/store catalog jenis:Produk Digital` | Kirim panel & katalog **Produk Digital** (Canva Pro + Coming Soon) ke channel produk digital. |
| `/store catalog [channel]` | Kirim **Katalog Produk** (Components V2): kotak header + kotak tiap produk, ter-update otomatis. |
| `/store how-to-order [channel]` | Kirim panel **How to Order** (panduan cara order + dropdown produk, ter-update otomatis). |
| `/store leaderboard` | Kirim Top 10 Spender Leaderboard (ter-update otomatis). |
| `/store buka produk` / `/store tutup produk [alasan]` | Buka / tutup **per produk** (Robux Visend, Rekber, atau Semua Produk) + pengumuman @everyone. |
| `/store stok-set jumlah [produk]` / `/store stok-tambah jumlah [produk]` | Atur stock **Robux Visend** (jumlah Robux) atau **Canva Pro** (jumlah slot email). Stock habis membuat produk tutup otomatis; stock kembali membuat produk buka otomatis. |
| `/store harga rate [produk]` | Atur harga per 1 Robux (contoh 145). Pilih produk Robux Visend / Robux Gamepass. |
| `/store status` | Ringkasan toko & daftar ticket yang sedang berjalan. |

## File pengaturan (dibaca ulang otomatis, tidak perlu restart)

| File | Isi |
|---|---|
| `welcome.json` | Channel, teks, dan tombol pesan welcome. `onlyOnce: true` = welcome hanya 1x per akun. |
| `verify.json` | ID role verifikasi, teks panel merah & panel hijau (sudah terverifikasi). Opsional: `rulesChannelId` (tombol 📜 Baca Rules), `panel.subtitle`, `panel.perks` (daftar), `panel.steps` (daftar), `panel.note`, `panel.image` (banner URL), `verifiedPanel.alreadyTitle`, `verifiedPanel.alreadyDescription`, `verifiedPanel.next` (daftar). `{role}` = role verifikasi, `{user}` = member. |
| `rules.json` | Isi rules versi Indonesia (`id`) dan Inggris (`en`). Opsional: `showSummary` (false = sembunyikan ringkasan aturan), `showIcon` (false = tanpa logo server), `footer.id` / `footer.en` (teks footer, `{server}` = nama server), `summaryTitle.id` / `summaryTitle.en`. |
| `store.json` | ID channel store, teks panel & tata cara, produk, info pembayaran, pengaturan ticket. |
| `system.json` | Channel dashboard System Operational, jeda update, judul, warna status. |
| `booster.json` | Channel ucapan booster, warna, teks ucapan & DM, banner, role hadiah (opsional). |
| `suggestions.json` | Channel suggestions, role staff, kategori (Server Discord / Noname Store), teks panel, cooldown, thread diskusi, DM pengirim, warna status. |
| `social.json` | Link & teks embed Social Media (Roblox userId, TikTok, ID Discord / link undangan, warna kartu). |
| `archive.json` | Channel arsip ticket order & ticket NCS (private), jumlah gambar galeri, batas ukuran transkrip. |
| `invites.json` | Channel invite log, channel leaderboard, warna, teks leaderboard. |
| `giveaway.json` | Channel giveaway, warna, teks tombol, teks klaim hadiah, DM pemenang / penyelenggara. |
| `server-stats.json` | Nama kategori & teks channel server stats, hitung bot / tidak, format angka. |
| `tickets.json` | NCS Ticket Center: channel panel, kategori, role staff, channel log, jenis ticket & teksnya. |
| `voice-finder.json` | Teks panel cari voice, warna, jeda sticky, hapus hasil otomatis. |

## Store + Ticket order

Alur pembeli: klik **💎 Robux Visend** → isi username Roblox → **🔍 Confirm Your Roblox Account** →
pilih jumlah (100–1000 atau jumlah lain maks 5.000) → bot membuat **ticket pribadi** + kirim DM.

- Stock dipotong saat ticket dibuat; **Cancelled / Refund** mengembalikan stock & diumumkan di channel stock.
- Setiap ada order Robux Visend, channel stock mendapat info **🛒 Robux Terjual** (jumlah terjual, sisa stock, rate, bar ketersediaan dari stock terakhir yang dibuka admin). Order beruntun dalam 15 detik digabung jadi 1 info. Kalau stock habis, cukup pengumuman tutup otomatis. Matikan dengan `"announceSold": false` di `store.json`.
- Jumlah melebihi sisa stock → pembeli diberi tahu sisa stock & tidak bisa lanjut.
- 1 akun Discord **dan** 1 akun Roblox hanya boleh punya 1 ticket berjalan.
- Kategori ticket penuh (50 channel) → bot otomatis membuat kategori baru.
- **Tutup Ticket** hanya untuk Administrator: upload gambar bukti + pilih status (Completed / Cancelled / Refund).
- Completed → pembeli diminta testimoni (bintang 1–5 + komentar) → dikirim ke channel testimoni,
  lalu ticket dihapus otomatis. Tidak memberi testimoni dalam 24 jam → testimoni tetap dikirim tanpa ulasan.
- Izin bot yang dibutuhkan: **Manage Channels, Manage Roles, Mention Everyone, Embed Links, Attach Files,
  Read Message History** (Manage Messages opsional, untuk pin detail pesanan).

## Produk Digital (panel & katalog terpisah)

Produk digital punya panel dan katalog sendiri:
- **Panel:** channel `1560602559062999120`.
- **Katalog:** channel `1560602363553775686`.

Kirim keduanya dengan `/store panel jenis:Produk Digital` dan `/store catalog jenis:Produk Digital`.

- Produk dengan `"type": "canva"` otomatis masuk **Produk Digital**. Produk lain bisa dipindah dengan menambahkan `"group": "digital"` di `store.json` → `products[]`. Panel & katalog digital otomatis punya tombol / kartu **🔒 Coming Soon**.
- Panel & katalog store utama sekarang tanpa Canva Pro. Katalog utama yang lama otomatis dikirim ulang saat daftar produknya berubah.
- Opsional di `store.json`:
  - `channels.digitalPanel` dan `channels.digitalCatalog`: ID channel.
  - `digitalPanel` dan `digitalCatalog`: `title`, `subtitle`, `description`, `bannerImage`.
- Tombol "Order di Store" di How to Order, pengumuman buka/tutup produk digital, dan pengingat masa aktif Canva otomatis mengarah ke panel Produk Digital.

## Server Boost (Produk Digital)

Produk `server-boost` (`"type": "boost"`) tampil di panel & katalog **Produk Digital**.

- **Paket:** 1 Bulan dan 3 Bulan. Harga di `plans[].price` adalah **harga per 1 boost**, dan totalnya dihitung otomatis: jumlah boost × harga.
- **Form order:** pembeli memilih paket, mengisi jumlah boost (`minBoost`–`maxBoost`, dibatasi sisa stock), lalu memasukkan link server Discord. Bot otomatis membaca nama server, jumlah member, dan jumlah boost saat ini dari link tersebut. Link yang kedaluwarsa atau salah akan ditolak.
- **Stock dipisah per paket**, diatur dengan `/store stok-set produk:🚀 Server Boost • 1 Bulan` / `• 3 Bulan` (atau `/store stok-tambah`). Paket yang stock-nya habis tidak muncul di form order. Produk otomatis tutup kalau semua paket habis. Stock paket dikunci saat ticket dibuat, dan dikembalikan ke paket yang sama kalau ticket batal atau refund.
- **Alur ticket:**
  1. Pembeli membayar dan admin menekan **Dana Masuk**.
  2. Admin menekan **🚀 Boost Terkirim (Admin)**. Tombol ini hanya bisa ditekan setelah pembayaran lunas, dan pembeli di-ping dengan panduan cara cek boost.
  3. Pembeli menekan **✅ Boost Sudah Masuk**.
  4. Admin menutup ticket sebagai Completed.
- **Masa aktif** tiap paket diatur di `plans[].duration` (contoh `25–31 hari`), dan keterangan paket di `plans[].notes`. Server Boost tidak mengirim pengingat ke pembeli (`remindDays: 0`). Admin tetap diberi tahu via DM saat masa aktif habis (`plans[].days`).

## Catalog

Channel `channels.catalog` berisi 1 kartu header (produk buka, total transaksi, rating) dan **1 kartu per produk**. Tiap kartu menampilkan harga, status, stock/estimasi, tabel harga (Gamepass: After Tax; Rekber: tabel fee), keunggulan, order selesai, Robux terjual, dan **rating khusus produk itu**.

Tombol di tiap kartu: **🛒 Order Sekarang**, **📖 Cara Order**, **🧮 Tax Calculator** (Gamepass), dan **📌 Syarat**. Semua kartu ter-update otomatis setiap produk dibuka/ditutup, stock berubah, atau ada transaksi / testimoni baru.

Teks diatur di `store.json` → `catalog` dan `products[].catalog`. Setelah menambah atau menghapus produk, jalankan `/store catalog` lagi; katalog lama otomatis dihapus. Tampilan memakai Components V2; katalog lama berformat embed otomatis dikirim ulang ke tampilan baru (urutan tetap) saat bot restart / ada update. Opsional: `catalog.subtitle` untuk teks kecil di bawah judul.

## How to Order

Panel di channel `channels.howToOrder` berisi alur order singkat, daftar produk dengan status buka/tutup, rate, dan stock (ter-update otomatis), serta alasan memilih toko.

Dropdown **Cara Order [Produk]**, **Metode Pembayaran**, dan **FAQ** membuka panduan yang hanya terlihat oleh member yang memilih. Panduan berisi yang perlu disiapkan, langkah order, tips, dan tombol ke store. Untuk Gamepass ada juga tombol Cek Harga dan Tax Calculator.

Teks diatur di `store.json` → `howToOrder` dan `products[].howTo`. Produk tanpa `howTo` tidak muncul di dropdown.

## Canva Pro

Pembeli cukup mengirim **alamat email**, lalu admin mengundang email itu ke **Team Canva Pro**.

- **Info produk:** pilihan paket (1 Bulan / 1 Tahun, otomatis tampil "Hemat X%"), sisa slot, keuntungan, cara kerja, member aktif, serta tombol Order, Cara Order, dan Syarat & Ketentuan.
- **Form order:** pilih paket, isi email, lalu ulangi email untuk mencegah salah ketik. Setelah ringkasan dikonfirmasi, ticket `CV-0001` dibuat di kategori **🎨 TICKET CANVA**.
- **Progress di ticket:**
  1. Admin klik **📨 Undangan Terkirim**. Pembeli di-ping dan mendapat panduan menerima undangan.
  2. Pembeli klik **✅ Saya Sudah Join Team**.
  3. Admin **Tutup Ticket** → Completed. Masa aktif mulai dihitung dan DM pembeli menampilkan tanggal "Berlaku hingga".
- **Stock:** 1 order = 1 slot. Slot dikunci saat ticket dibuat dan dikembalikan saat Cancelled / Refund. Slot 0 → Canva Pro tutup otomatis.
- **Pengingat masa aktif:** pembeli mendapat DM H-`remindDays` (default 3 hari) sebelum masa aktif habis. Saat habis, admin yang menutup ticket mendapat DM berisi email yang perlu dikeluarkan dari team.
- **Log publik:** email disamarkan (`ah********an@gmail.com`).
- **Pengaturan:** paket & harga diatur di `store.json` → produk `canva-pro` → `plans` (tanpa restart).

## Robux Gamepass

Pembeli membuat gamepass sendiri, toko yang membelinya. Tombol di info produk:

- **🛒 Order Sekarang**: form username Roblox, link gamepass, dan harga gamepass (Before Tax). Bot otomatis mengecek ke Roblox apakah gamepass ada, **On Sale**, harganya sama, dan milik akun Roblox tersebut. Kalau server Roblox sedang down, order tetap bisa dibuat dengan tanda *dicek manual*.
- **💰 Cek Harga**: masukkan Robux Before Tax, lalu bot menampilkan Robux diterima dan total Rupiah.
- **🧮 Tax Calculator**: masukkan Robux yang ingin diterima, lalu bot menampilkan harga gamepass (Before Tax). Contoh: 1.000 menjadi 1.429.
- **📖 Tutorial**: langkah order dan tombol ke Creator Hub.

Harga = harga gamepass (Before Tax) × rate. Contoh: 1.429 × Rp 84 = Rp 120.036.

- Ticket `GP-0001` dibuat di kategori **🎟️ TICKET GAMEPASS**, dengan tombol **🔗 Buka Gamepass** dan **🔍 Cek Gamepass**. Tombol Cek Gamepass khusus admin, untuk cek ulang harga sebelum membeli.
- Tidak memakai stock Robux. 1 akun Discord / akun Roblox / gamepass hanya boleh 1 ticket gamepass berjalan.
- Atur rate, pajak, estimasi hari, batas order, contoh harga, tutorial, dan catatan ticket di `store.json` → produk `robux-gamepass`.

## Rekber (Rekening Bersama)

Alur: klik **🤝 Rekber** → **Buat Ticket Rekber** → isi form (pihak lawan via username Discord, peran
pembeli/penjual, objek transaksi, nominal, detail) → ringkasan + fee → ticket untuk **kedua pihak**.

Progress di ticket (ter-update otomatis):
1. Pihak lawan klik **🤝 Setujui Transaksi**
2. Admin klik **💰 Konfirmasi Dana** setelah pembeli transfer
3. Pembeli klik **📦 Barang Sudah Diterima**
4. Admin **🔒 Tutup Ticket** → Completed (dana dicairkan) / Cancelled / Refund

- 1 akun hanya boleh terlibat di 1 rekber yang berjalan (sebagai pembeli maupun penjual).
- Fee, batas nominal, dan siapa yang menanggung fee diatur di `store.json` → produk `rekber`.
- Rekber tidak memengaruhi stock Robux & leaderboard spender; dihitung terpisah (Rekber Sukses).

## Ticket Archive (private)

Setiap ticket yang selesai otomatis diarsipkan **tepat sebelum channel ticket dihapus**:
- **Ticket order** (Robux Visend, Gamepass, Canva Pro, Server Boost, Rekber) → `orderChannelId` di `archive.json`.
- **Ticket NCS Ticket Center** → `ncsChannelId`.

Isi arsip (Components V2):
- **Pelanggan:** Discord (mention, username, ID) + akun Roblox (rekber: pembeli & penjual).
- **Detail pesanan:** produk, jumlah, rate, gamepass, paket, email Canva, server & invite boost, nominal & fee rekber.
- **Pembayaran:** total tagihan, status, metode/bank, nama pengirim, catatan pembeli, dana masuk (nominal, waktu, admin).
- **Penanganan:** dibuat/ditutup, durasi, admin penutup, catatan, testimoni. Ticket NCS: detail form, staff yang menangani, hadiah terkirim, alasan tutup.
- **Timeline** kejadian ticket + **ringkasan percakapan** (jumlah pesan, peserta).
- **Galeri gambar** dari ticket (bukti transfer, screenshot, bukti pengiriman) disimpan permanen.
- **File transkrip HTML** premium: buka di browser untuk melihat seluruh chat (embed, kotak V2, gambar ikut tersimpan di dalam file).

Channel ticket yang dihapus manual tetap diarsipkan, tetapi tanpa transkrip. Bot butuh izin **View Channel, Send Messages, Attach Files** di channel arsip.

## Log Order (publik)

Channel `channels.log` di `store.json` — bisa dilihat semua member. Setiap ticket (Robux Visend & Rekber)
punya **1 pesan log** yang di-edit otomatis: status (warna ikut status), produk/jumlah/rate/total, waktu order,
waktu selesai & **waktu proses**, rating, dan **progress** dengan jam. Gambar bukti **tidak** ditampilkan (hanya di testimoni).

Tidak ditampilkan: catatan admin, nama admin, link ticket. Username Roblox disamarkan (`Bu******an`).
Atur detail yang tampil di `store.json` → `publicLog`.

## Social Media

`/social kirim` mengirim tampilan Components V2: 1 kotak pembuka dan 1 kotak per platform (warna masing-masing), dengan tombol link di dalam tiap kotak. Opsional: `subtitle` di `social.json` untuk teks kecil di bawah judul. Pesan lama berformat embed otomatis diganti ke tampilan baru saat refresh:

- **🎮 Roblox:** username, display name, followers, friends, dan tanggal bergabung, plus foto avatar. Semua diambil otomatis dari Roblox.
- **🎵 TikTok:** username dan ajakan Follow • Like • Share.
- **💬 Discord:** kalau `discord.id` adalah ID server ini, bot otomatis membuat **link undangan permanen** (butuh izin *Create Invite*) dan menampilkan jumlah member, boost, dan tanggal server dibuat. Kalau ID akun, yang ditampilkan link profil.

Footer dan waktu hanya muncul di kartu paling bawah. Embed ter-update otomatis tiap 1 jam; setelah mengubah `social.json`, jalankan `/social refresh`.

## Invite Log

Channel log: `invites.json` → `channelId`. Leaderboard: `invites.json` → `leaderboardChannelId`.

- **📥 Log member masuk:** siapa yang mengundang, kode undangan, umur akun, nomor member, dan total undangan inviter. Undangan baru dihitung **valid setelah member yang diundang verifikasi** (role `roleId` di `verify.json`) — tidak ada sistem fake, akun baru pun valid asal sudah verifikasi. Sebelum verifikasi ditandai ⏳ Menunggu Verifikasi. Member yang keluar lalu masuk lagi ditandai 🔁 Rejoin.
- **📤 Log member keluar:** inviter dan lama member di server; undangan inviter otomatis berkurang.
- **🏆 Top 10 Inviter:** 1 pesan di channel leaderboard terpisah yang di-edit otomatis setiap ada member masuk / keluar.

Setiap member hanya dihitung 1x, jadi keluar-masuk tidak menggandakan undangan. Undangan dari diri sendiri dan bot tidak dihitung.

**Wajib:** beri bot izin **Manage Server**, supaya bot bisa membaca daftar link undangan. Member yang masuk sebelum fitur ini aktif tidak tercatat.

## System Operational

`/system panel` mengirim dashboard Components V2 ke channel system (`system.json` → `channelId`). Dashboard ini ter-update otomatis tiap 60 detik, dan bisa di-refresh manual lewat tombol **🔄 Refresh Status**. Isinya:

- **Status keseluruhan:** 🟢 Semua Sistem Normal / 🟡 Sebagian Terganggu / 🔴 Terjadi Gangguan. Warna kotak ikut berubah.
- **🤖 Bot:** status, uptime, waktu restart terakhir, ping, dan jumlah error sejak bot menyala.
- **🖥️ Server:** RAM bot, RAM dan CPU VPS (dengan bar), uptime VPS, serta versi bot, Node, dan discord.js.
- **🧩 Status Layanan:**
  - Discord Gateway dan Roblox API
  - Store (produk buka dan ticket aktif) dan NCS Ticket Center
  - Verifikasi (role valid dan bisa diberikan bot)
  - Giveaway, Suggestions, Invite Tracker, Booster
  - Server Stats, Cari Voice, Social Media
- **📊 Statistik server** dan **📜 Riwayat Status** (5 perubahan status terakhir).

## Booster

Saat member mem-boost server, bot otomatis mengirim kartu **ucapan terima kasih** (Components V2) ke channel booster (`booster.json` → `channelId`). Kartu berisi:

- Mention booster.
- Booster ke berapa di server dan sejak kapan.
- Info **🎉 Server naik ke Level X!** kalau boost tersebut membuat server naik level.
- Tombol **💖 Ucapkan Terima Kasih** yang bisa diklik member lain. Jumlahnya tampil di kartu.

Booster juga mendapat DM terima kasih.

- Deteksi memakai **pesan sistem boost Discord**: aktifkan *Server Settings → Overview → System Messages → Send a message when someone boosts this server*, dan pastikan bot bisa melihat channel pesan sistem itu. Sebagai cadangan, bot juga membaca perubahan status booster member. Keduanya disaring supaya ucapan tidak terkirim dua kali.
- `/booster test` mengirim contoh ucapan untuk mengecek tampilan.
- `/booster kirim member` mengirim ucapan manual, misalnya untuk boost yang terjadi saat bot sedang mati.
- `rewardRoleId` (opsional) memberi role tambahan saat boost dan melepasnya saat boost berakhir.

## Suggestions

Panel Components V2 di channel suggestions (`suggestions.json` → `channelId`).

- Member memilih peruntukan saran di dropdown (**🏠 Server Discord** atau **🛒 Noname Store**), lalu mengisi form: judul, detail, dan manfaat (opsional).
- Saran tampil di channel yang sama sebagai kotak V2 (nomor `SG-0001`, kategori, pengirim, vote, status). Bot otomatis membuat thread diskusi untuk tiap saran.
- Member bisa vote **👍 Setuju / 👎 Tidak Setuju**. Klik lagi untuk membatalkan vote, atau klik yang lain untuk pindah vote. Hasilnya tampil sebagai bar persentase.
- **Sticky:** setiap ada saran baru atau pesan baru di channel, panel otomatis dipindah ke paling bawah.
- Tombol **📋 Saran Saya** menampilkan saran milik member beserta statusnya.
- Staff (izin Manage Server atau `staffRoleId`) memakai tombol **🛠️ Kelola** atau `/suggestion status` untuk mengubah status:
  - ⏳ Menunggu Review
  - 🤔 Dipertimbangkan
  - ✅ Diterima
  - 🎉 Sudah Diterapkan
  - ❌ Ditolak

  Staff bisa menambahkan tanggapan. Warna kotak ikut berubah, pengirim mendapat DM, dan update dikirim ke thread. Status Ditolak dan Diterapkan menutup vote dan mengunci thread.
- `cooldownMinutes` membatasi jeda antar saran per member.
- Izin bot di channel ini: View Channel, Send Messages, Read Message History, Create Public Threads, dan Manage Threads.
- Disarankan **Send Messages** untuk @everyone dimatikan di channel ini, tapi **Send Messages in Threads** tetap diizinkan, supaya diskusi berjalan di thread.

## Giveaway

`/giveaway mulai` punya opsi berikut:

| Opsi | Keterangan |
|---|---|
| `hadiah` | Hadiah giveaway. |
| `durasi` | `30m`, `2j`, `1d`, `1d12j` (m = menit, j/h = jam, d = hari). |
| `pemenang` | Jumlah pemenang. |
| `deskripsi` | Keterangan tambahan. |
| `gambar` | Gambar / banner giveaway. |
| `syarat_role` | Hanya member dengan role ini yang bisa ikut. |
| `umur_akun` | Minimal umur akun Discord (hari). |
| `lama_di_server` | Minimal lama berada di server (hari). |
| `ping` | Mention @everyone saat giveaway dimulai. |
| `channel` | Channel giveaway (default: `giveaway.json`). |

Cara kerja:

- Peserta klik **🎉 Ikuti Giveaway**. Jumlah peserta di pesan ter-update otomatis. Klik lagi untuk keluar. Tombol **👥 Peserta** menampilkan daftar peserta.
- Saat waktu habis, pemenang diundi otomatis secara acak dan adil (kriptografis). Pengundian tetap berjalan walau bot sempat restart. Pemenang di-ping dan mendapat DM, dan penyelenggara mendapat ringkasan hasil.
- `/giveaway akhiri` mengakhiri giveaway sekarang.
- `/giveaway reroll` mengundi ulang tanpa mengulang pemenang lama.
- `/giveaway batal` membatalkan giveaway.
- `/giveaway list` menampilkan giveaway yang sedang berjalan.
- ID giveaway (`GA-0001`) muncul otomatis saat diketik.
- Semua tampilan giveaway memakai **Components V2**: pesan giveaway, pengumuman pemenang, DM pemenang, laporan penyelenggara, daftar peserta, dan balasan tombol. Giveaway lama (embed) yang masih berjalan tetap memakai tampilan lama sampai selesai.

### Ban Giveaway

- **Auto-ban pemenang:** pemenang otomatis tidak bisa ikut giveaway berikutnya. Diatur lewat `autoBanWinners` (true/false) dan `autoBanDays` (0 = permanen sampai di-unban) di `giveaway.json`.
- `/giveaway ban member [durasi] [alasan]` mem-ban member secara manual, misalnya `7d` atau `30d`. Kalau durasi dikosongkan, ban berlaku permanen. Member tersebut langsung dikeluarkan dari giveaway yang sedang berjalan.
- `/giveaway unban member` melepas ban, sehingga member bisa ikut giveaway lagi.
- `/giveaway banlist` menampilkan daftar ban beserta jenisnya (auto / manual), alasan, dan masa berlaku.
- Member yang terkena ban mendapat pesan **🔒 Kamu Tidak Bisa Ikut Giveaway** saat menekan tombol ikut, dan tidak ikut diundi saat pengundian maupun reroll. Ban berdurasi otomatis habis sesuai waktunya.

## Pembayaran (semua produk)

Rekening diatur di `store.json` → `payment.methods`. Isi `payment.accountName` untuk menampilkan "a.n." di semua rekening.

**Di setiap ticket** (Robux Visend, Gamepass, Canva Pro, Rekber):

- Muncul total yang harus ditransfer dan semua nomor rekening.
- Tombol **💳 Konfirmasi Pembayaran**: pembeli memilih rekening tujuan, mengisi nama pengirim, upload bukti transfer, dan catatan (opsional).
- Tombol **📋 Salin No. Rekening**: menampilkan daftar nomor rekening polos supaya mudah disalin di HP.

**Verifikasi admin:**

- Bukti pembayaran muncul di ticket dengan tombol **✅ Dana Masuk** / **❌ Tolak** (khusus admin). Kalau ditolak, admin mengisi alasan dan pembeli bisa mengirim ulang bukti.
- `/danamasuk [nominal] [catatan]` di channel ticket bisa dipakai untuk konfirmasi tanpa bukti, atau kalau nominal yang diterima berbeda.
- **Setelah dana masuk:** status ticket berubah jadi **🔄 Dana Diterima — Sedang Diproses**, info rekening disembunyikan, pembeli di-ping dan mendapat DM berisi langkah selanjutnya sesuai produk, dan log publik ikut ter-update.
- **Rekber:** rekening baru muncul setelah pihak lawan menyetujui transaksi. Dana Masuk sama dengan langkah **💰 Dana Diamankan**.

## Role Spender

Pengaturan ada di `store.json` → `spenderRoles`.

- **🛍️ Buyer:** diberikan otomatis saat order pertama selesai (Completed).
- **Tier:** dipasang berdasarkan total belanja dari order yang selesai. Rekber tidak dihitung.

| Tier | Total belanja |
|---|---|
| 🥉 Bronze | 100k+ |
| 🥈 Silver | 250k+ |
| 🥇 Gold | 500k+ |
| 💎 Elite | 1JT+ |
| 🔥 Legendary | 3JT+ |
| 👑 Royal | 5JT+ |
| 🌟 Sultan | 10JT+ |
| 🏆 Emperor | 20JT+ |

- Role tier **bertambah** dan tidak dilepas: semua tier yang sudah dicapai tetap terpasang (`keepLowerTiers: true`).
- Saat order pertama atau naik tier, muncul kartu ucapan di ticket dan DM, lengkap dengan progress bar ke tier berikutnya.
- Leaderboard spender ikut menampilkan tier.
- **Wajib:** bot punya izin **Manage Roles**, dan role bot berada **di atas** semua role spender (Server Settings → Roles).

## Server Stats

`/server-stats setup` membuat kategori **—・✦ Noname Studios Creative ✦・—** di paling atas server, berisi 3 voice channel terkunci 🔒 (member bisa melihat, tapi tidak bisa masuk):

- **👥 Members:** jumlah member (tanpa bot, bisa diubah di `countBots`).
- **🎫 Active Tickets:** ticket order / rekber yang sedang berjalan.
- **✅ Total Orders:** total transaksi selesai (order + rekber).

Angka ter-update otomatis tiap ±5 menit, karena Discord membatasi ganti nama channel 2x per 10 menit. Bot butuh izin **Manage Channels**.

## NCS Ticket Center (ticket layanan, bukan jualan)

Panel di channel Tickets berisi dropdown jenis ticket:

- **🛟 Support:** form berisi Topik dan Jelaskan Kendalamu.
- **🎁 Claim Giveaway:** pemenang memilih giveaway yang dimenangkan (terdeteksi otomatis dari data giveaway), lalu memilih **jenis hadiah** (Robux, E-Wallet, Uang Tunai/Transfer Bank, Pulsa/Kuota, Produk Digital, Voucher/Game Item, Lainnya; ditebak otomatis dari nama hadiah). Setelah itu pemenang mengisi data penerimaan, nama penerima (a.n.), dan catatan. Bot menandai **✅ Terverifikasi** atau **⚠️ cek manual**. Staff punya checklist dan tombol **🎁 Hadiah Terkirim**: status ticket berubah, pemenang di-ping, dan history ikut tercatat. Daftar jenis hadiah bisa diganti lewat `claimRewardTypes` di `tickets.json`.
- Semua pesan di dalam ticket NCS (detail ticket, ditangani, hadiah terkirim, ditutup) memakai Components V2. Ticket lama yang masih terbuka tetap memakai tampilan lama.
- **🔒 Coming Soon:** muncul di dropdown, tapi belum bisa dibuka.

Cara kerja ticket:

- Channel ticket dibuat otomatis di kategori **Customer Service** (kategori channel panel), dan hanya bisa dilihat pembuka, staff, dan admin.
- Tombol **🙋 Tangani Ticket (Staff)** dan **🔒 Tutup Ticket** (pembuka atau staff, dengan alasan opsional).
- Saat ditutup: transcript `.txt` dikirim ke DM pembuka dan ke channel log (kalau `logChannelId` diisi), lalu channel dihapus otomatis.
- 1 member hanya bisa punya 1 ticket aktif per jenis. Isi `staffRoleId` di `tickets.json` supaya staff bisa melihat dan menangani ticket.
- **Tickets History** (`historyChannelId`): 1 kartu per ticket (Components V2) yang ter-update otomatis. Isinya status (⏳ Menunggu Staff → 🙋 Sedang Ditangani → ✅ Selesai), pembuka, staff yang menangani, topik, waktu respon staff, durasi, alasan tutup, dan progress dengan jam. Set `history.showTopic` / `history.showCloseReason` ke `false` untuk menyembunyikan topik / alasan tutup.
