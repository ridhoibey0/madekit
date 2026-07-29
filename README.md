# Pendataan Pengambilan Barang

Web sederhana buat hari-H pengambilan barang: cek status lunas/belum + catatan
penjualan, tandai sudah ambil / belum, catat kalau ada kekurangan (misal "kurang
dasi"), dan catat refund manual (nominal, sudah transfer atau belum).

Stack: Node.js + Express + SQLite bawaan Node (`node:sqlite`, jadi tidak perlu
compile native module apa pun) + HTML/JS polos tanpa build step. Butuh **Node.js
>= 22.5**.

## Setup lokal / di VPS

```bash
npm install
cp .env.example .env
# edit .env -> isi ADMIN_USER & ADMIN_PASS (WAJIB, karena ada data nama & status bayar customer)

# import data dari Made Kit.xlsx (sekali di awal, aman dijalankan ulang)
npm run import            # default baca ../Made Kit.xlsx relatif ke folder ini
# atau kalau file excel-nya di lokasi lain:
node scripts/import.js "/path/ke/Made Kit.xlsx"

npm start                 # jalan di http://localhost:3000
```

Kalau import ulang dijalankan (misal ada data penjualan baru nambah di bawah),
baris yang sudah ada bakal di-update datanya saja — status "sudah ambil" dan
data refund yang sudah diisi manual TIDAK akan hilang/ketimpa. Baris dicocokkan
dari posisi barisnya di Excel, jadi aman walau ada 2 orang beli paket yang sama
persis dengan harga yang sama (tidak ketuker/ketimpa jadi 1 baris).

## Deploy di VPS (garis besar)

1. Copy folder ini ke VPS (`scp`/`git`), lalu `npm install --omit=dev`.
2. Isi `.env` dengan password admin yang kuat.
3. Jalankan `npm run import` sekali untuk seed data dari Excel.
4. Jalankan aplikasinya biar tetap hidup, contoh pakai `pm2`:
   ```bash
   npm install -g pm2
   pm2 start server.js --name pengambilan
   pm2 save
   ```
5. (Opsional tapi disarankan) pasang Nginx sebagai reverse proxy + HTTPS lewat
   `certbot` — lihat bagian [Nginx + HTTPS (certbot)](#nginx--https-certbot)
   di bawah.

## Nginx + HTTPS (certbot)

Asumsi: Nginx udah terpasang di VPS, dan sudah punya domain/subdomain (misal
`ambil.domainkamu.com`) yang A record-nya diarahkan ke IP VPS. App Node-nya
tetap jalan di `localhost:3000` (lewat pm2 seperti langkah 4 di atas) — Nginx
di depan cuma nerusin traffic ke situ sekalian handle HTTPS.

### 1. Buat server block

```bash
sudo nano /etc/nginx/sites-available/pengambilan
```

Isi (ganti `ambil.domainkamu.com` dengan domain kamu):

```nginx
server {
    listen 80;
    server_name ambil.domainkamu.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan lalu cek syntax & reload:

```bash
sudo ln -s /etc/nginx/sites-available/pengambilan /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Coba akses `http://ambil.domainkamu.com` dulu — kalau popup login basic-auth
muncul, berarti reverse proxy-nya udah nyambung dengan benar sebelum lanjut ke
HTTPS.

### 2. Pasang certbot (kalau belum ada)

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

### 3. Terbitkan sertifikat HTTPS

```bash
sudo certbot --nginx -d ambil.domainkamu.com
```

Certbot bakal otomatis nambahin blok `listen 443 ssl` + config sertifikat ke
server block di atas, dan nawarin redirect otomatis dari HTTP ke HTTPS —
pilih **Yes/2** pas ditanya redirect biar semua traffic dipaksa lewat HTTPS.

Certbot juga otomatis masang systemd timer buat perpanjang sertifikat sebelum
expired, jadi tidak perlu diurus manual lagi. Cek jadwalnya:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run   # tes simulasi perpanjangan, tanpa efek nyata
```

### 4. Selesai

Setelah ini web-nya bisa diakses lewat `https://ambil.domainkamu.com` dan
tetap dilindungi HTTP Basic Auth dari `.env` seperti biasa. Kalau punya lebih
dari satu app di VPS yang sama, ulangi langkah 1–3 dengan domain/subdomain dan
port `proxy_pass` yang beda buat masing-masing app.

## Aman dipakai bareng-bareng oleh tim?

Ya, dengan catatan dijalankan seperti panduan di atas (`pm2 start server.js` —
**1 proses**, jangan pakai mode cluster / `-i`). Beberapa hal yang perlu tahu:

- **Tulis data (checklist, pelunasan, refund) aman dari race condition.**
  `node:sqlite` yang dipakai di sini sifatnya sinkron/blocking, dan Node cuma
  1 thread, jadi kalau 2 admin klik "Bayar / Lunasi" ke orang yang sama nyaris
  bersamaan, request-nya tetap diproses satu-satu (baca-lalu-tulis-nya tidak
  ke-interleave), jadi tidak ada update yang "ketiban"/hilang.
  - Ini cuma berlaku kalau app-nya 1 proses. **Jangan** jalankan lewat pm2
    cluster mode (`pm2 start server.js -i max` dkk) atau bikin 2 instance
    nunjuk ke database yang sama — itu jadi 2 proses OS terpisah yang tidak
    lagi saling serialize otomatis kayak di atas.
- **Layar tiap admin otomatis nge-sync tiap ~15 detik** (auto-poll di
  `app.js`), jadi kalau admin lain baru aja nandain "sudah ambil", browser
  admin lain bakal ikut update sendiri tanpa perlu refresh manual. Sebelum
  perubahan ini ditambahkan, layar yang udah lama dibuka bisa "ketinggalan"
  dan berisiko 1 customer di-approach 2 admin sekaligus.
- **Catatan teks (catatan pengambilan / catatan refund) tetap last-write-wins**
  kalau 2 admin literally buka modal orang yang SAMA dan sama-sama ngetik
  catatan di detik yang sama — yang nyimpen belakangan yang menang, punya
  admin pertama ketimpa. Risikonya rendah karena biasanya cuma 1 admin yang
  megang 1 customer di satu waktu (fisiknya juga cuma 1 orang yang lagi
  dilayani), tapi kalau mau lebih aman lagi: bagi rata nama customer per
  fakultas/booth ke tiap admin (fitur filter Fakultas di tab Data pas buat
  ini), jadi ga ada 2 admin yang pegang orang yang sama bersamaan.

## Catatan keamanan

`npm install` akan kasih warning "1 high severity vulnerability" dari paket
`xlsx` (SheetJS) — belum ada patch di npm registry. Paket ini cuma dipakai di
`scripts/import.js` (dijalankan manual sekali oleh admin terhadap file Excel
yang dipegang sendiri), TIDAK dipakai di `server.js` yang jalan terus dan
diakses publik. Jadi risikonya rendah, tapi jangan pernah pakai `xlsx` untuk
memproses file upload dari orang lain di server.

## Login

Semua halaman & API dilindungi HTTP Basic Auth pakai `ADMIN_USER` / `ADMIN_PASS`
dari `.env`. Browser akan otomatis munculin popup login pas pertama buka web-nya.
Kalau `ADMIN_PASS` kosong, server jalan TANPA proteksi — jangan dipakai untuk
deploy ke VPS publik dalam kondisi itu (server juga akan cetak warning di log).

## Cara pakai pas hari-H

- Tab **Dashboard**: ringkasan total/sudah ambil/lunas/refund, plus rekap per
  Fakultas.
- Tab **Data Pengambilan**: cari nama / filter per Fakultas / filter status
  ambil, lalu klik barisnya buat buka detail orangnya.
- Di dalam detail (modal): kalau masih DP, ada kotak kuning buat catat
  pelunasan (isi nominal yang dibayar sekarang, klik "Bayar / Lunasi" — status
  otomatis jadi LUNAS begitu sisanya lunas).
- Klik **"Tandai Sudah Ambil"** lalu konfirmasi — waktu pengambilan otomatis
  kecatat. Salah pencet? Buka lagi detailnya, klik "Batalkan Pengambilan" lalu
  konfirmasi.
- Isi **Catatan pengambilan** kalau ada yang kurang (misal "kurang dasi,
  nyusul besok"), dan/atau bagian **Refund** (centang "Ada refund", isi
  nominal manual, centang "Sudah ditransfer" begitu sudah dibayar) — field-field
  ini BARU kesimpen kalau tombol **"Simpan Perubahan"** di bawah diklik (beda
  dari pelunasan/tandai-ambil yang aksinya langsung lewat tombol sendiri).
  Kalau modal ditutup padahal ada perubahan yang belum di-Simpan, bakal
  ditanya dulu biar ga ke-skip ga sadar.
- Dashboard & tab Data otomatis ikut update tiap ada perubahan, tanpa perlu
  refresh — dan tiap ~15 detik semua browser yang lagi buka web ini juga
  otomatis sinkron sendiri (biar antar admin ga ketinggalan info).
