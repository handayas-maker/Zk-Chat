# ZK Chat — Private Chat dengan Premium Tier

Web app chat privat dengan premium features. Tanpa install app, tanpa akun, tanpa jejak. Sesi otomatis berakhir setelah 12 jam.

## Fitur

### Free (semua user)
- Generate kode unik 6-karakter, share ke lawan bicara
- Chat text end-to-end peer-to-peer (WebRTC + DTLS encryption)
- Typing indicator
- Auto-delete saat tab ditutup
- Session timer 12 jam dengan auto-reload

### Premium (Rp 10.000 per sesi, 1x bayar)
- ⭐ Kirim foto/selfie (auto-kompres, P2P encrypted, hilang saat session berakhir)
- 📍 Share lokasi pin (one-time)
- 🟢 Live location tracking (5 menit)

Yang generate kode bayar, kedua user dapat akses fitur premium.

## Sistem session timer

Setiap sesi chat maksimal **12 jam**, dihitung sejak peer-to-peer connection terbentuk:

- Timer ditampilkan di chat header (format `HH:MM:SS`)
- Warning 10 menit sebelum berakhir → timer berubah warna kuning
- Warning 1 menit sebelum berakhir → timer berubah merah
- Pada menit ke-12 jam: halaman auto-reload ke landing page, semua chat hilang
- Peer juga otomatis di-notify dan halaman mereka reload juga

Timer di-reset setiap kali user buat sesi baru. Tutup tab sebelum 12 jam = session langsung berakhir.

---

## Cara deploy ke Render.com (5 menit)

### Step 1: Upload ke GitHub
1. Buat akun [github.com](https://github.com)
2. New repository, beri nama `zk-chat`, set Public
3. "uploading an existing file" → drag-drop semua file dari folder ini
4. Commit

### Step 2: Deploy
1. [render.com](https://render.com) → sign up dengan GitHub
2. New + → Web Service → pilih repo `zk-chat`
3. Render auto-detect `render.yaml` — biarkan default
4. Klik Create Web Service
5. Tunggu 2-3 menit → dapat URL `https://zk-chat-xxx.onrender.com`

### Step 3: Setup Midtrans (untuk premium features)
1. Daftar di [midtrans.com](https://midtrans.com)
2. Pilih "Personal" untuk akun pribadi (butuh KTP)
3. Verifikasi email & data diri (1-3 hari kerja)
4. **Aktifkan payment method GoPay** di Dashboard Midtrans (ini akan otomatis enable QRIS — semua e-wallet QRIS-compatible akan bisa scan: GoPay, OVO, Dana, ShopeePay, LinkAja, plus mobile banking BCA/Mandiri/BRI/BNI/CIMB/dll)
5. Di Midtrans Dashboard → Settings → Access Keys
6. Copy **Server Key** (yang dimulai dengan `Mid-server-...` atau `SB-Mid-server-...`)

> **Catatan**: Aplikasi ini di-set untuk **hanya menerima QRIS** sebagai metode pembayaran. Transfer bank, kartu kredit, dan VA dinonaktifkan untuk memastikan UX yang konsisten dan settlement cepat (H+1).

### Step 4: Pasang Server Key di Render
1. Di Render Dashboard → service anda → Environment
2. Tambah environment variables:
   - `MIDTRANS_SERVER_KEY` = paste server key
   - `MIDTRANS_IS_PRODUCTION` = `false` (untuk testing) atau `true` (untuk live)
3. Save → Render auto-redeploy

### Step 5: Setup Webhook di Midtrans
1. Di Midtrans Dashboard → Settings → Configuration → Payment Notification URL
2. Set ke: `https://your-domain.onrender.com/api/payment/webhook`
3. Save

**Done!** Sekarang tombol "Buat sesi Premium" akan bisa generate link pembayaran.

---

## Test payment dengan sandbox

Sebelum production, test dulu dengan sandbox Midtrans:

1. Set `MIDTRANS_IS_PRODUCTION=false` di Render env
2. Pakai Server Key sandbox (yang dimulai `SB-Mid-server-`)
3. Saat checkout, akan muncul QR code QRIS. Untuk test:
   - Pakai [Midtrans Simulator](https://simulator.sandbox.midtrans.com/qris/index) — paste QR string atau order ID untuk simulate payment
   - Atau scan QR dengan app GoPay/OVO sandbox jika punya
4. Setelah simulator mark as success, webhook akan terima notifikasi

Setelah yakin works, switch ke production:
- Server Key production (`Mid-server-`)
- `MIDTRANS_IS_PRODUCTION=true`

---

## Cara monetisasi lain

### 1. Donasi (Saweria/Trakteer/Ko-fi)
Edit `config.js` di GitHub (klik file → pensil icon → edit → commit):
```javascript
donate: {
  enabled: true,
  link: "https://saweria.co/username-anda",
  label: "☕ Dukung server gratis ini"
}
```

### 2. Sponsor banner
Manual deal dengan VPN/password manager/privacy tools. Edit `config.js`:
```javascript
sponsor: {
  enabled: true,
  text: "🛡️ Pakai ProtonVPN — gratis & no-logs",
  link: "https://protonvpn.com?ref=YOUR-AFFILIATE-CODE"
}
```

### 3. Premium sessions (Rp 10.000/sesi)
Sudah terimplementasi. Revenue projection:
- 100 sesi premium/hari × Rp 10.000 = Rp 1.000.000/hari = Rp 30jt/bulan
- Setelah fee Midtrans QRIS 0.7% = Rp 9.930/sesi
- Settlement ke rekening anda: H+1 (kerja)

---

## Cara mengubah durasi session

Edit `config.js`, ubah `sessionMaxHours`:
```javascript
features: {
  sessionMaxHours: 12,  // ubah ke angka lain (jam)
  ...
}
```
Commit ke GitHub → Render auto-redeploy.

---

## File structure

```
zk-chat/
├── index.html       UI utama
├── app.js           Logic frontend (WebRTC, photo, location, payment, timer)
├── server.js        Backend (signaling + Midtrans payment)
├── config.js        Settings yang anda edit (sponsor, donate, durasi, dll)
├── package.json     Dependencies
├── render.yaml      Auto-deploy config untuk Render
├── Dockerfile       Untuk deploy di Fly.io/Docker
└── README.md        File ini
```

---

## Privasi & keamanan

### Yang tidak disimpan di server
- Isi pesan teks (P2P, server tidak lihat)
- Foto yang dikirim (P2P chunked, server tidak lihat)
- Koordinat lokasi (P2P, server tidak lihat)
- IP address user (tidak di-log)
- Riwayat session

### Yang disimpan di server (sementara)
- Kode 6-karakter (in-memory, dihapus saat pair tersambung atau timeout 10 menit)
- Order ID Midtrans (in-memory, dihapus setelah payment verified atau 30 menit)
- Premium token sementara (in-memory, sekali pakai, dihapus segera)

### Yang Midtrans simpan
- Data transaksi (sesuai regulasi BI/OJK)
- Tidak ada data isi chat — Midtrans hanya tahu "user X bayar Rp 10.000 untuk Premium Session"

---

## Hal yang perlu anda perhatikan

### Hukum & Compliance
- Anda sebagai operator wajib pasang Terms of Service (sudah ada template di-app)
- Untuk Indonesia: UU ITE No 11/2008, UU PDP No 27/2022 — anda sebagai pengontrol data
- Jika ada laporan abuse via email, harus bisa terima dan respon
- Pasang email kontak di Terms of Service

### Bandwidth cost
- Text chat: ~0 server bandwidth (P2P)
- Photo (P2P): ~0 server bandwidth (P2P)
- Signaling handshake: ~5 KB per session
- Render free tier: 100 GB bandwidth/bulan = sangat cukup untuk 100rb sesi/bulan

---

## Test lokal (opsional)

Kalau mau test di komputer dulu sebelum deploy:
```bash
npm install
MIDTRANS_SERVER_KEY=SB-Mid-server-xxx npm start
```
Buka `http://localhost:3000`. Untuk test mobile di HP, akses `http://[IP-komputer]:3000` dari HP yang same-WiFi.

---

## Troubleshooting

**"Payment belum dikonfigurasi"** → set `MIDTRANS_SERVER_KEY` di Render env vars

**Foto gagal terkirim** → koneksi peer-to-peer butuh STUN server. Untuk user di balik NAT ketat, butuh TURN server. Pakai [metered.ca](https://www.metered.ca/tools/openrelay/) gratis untuk 50GB/bulan, atau Twilio.

**Premium tidak aktif setelah bayar** → cek webhook URL di Midtrans dashboard sudah benar dan signature key sama dengan server key.

**Sleep di Render free tier** → service sleep setelah 15 menit idle. Untuk produksi, upgrade ke $7/month atau pakai cron-job.org untuk ping setiap 14 menit.

**Timer tidak akurat setelah HP di-lock** → ini behavior browser normal. JavaScript timer throttle saat tab tidak aktif. Tapi waktu wall-clock tetap dihitung benar dari `Date.now()`, jadi cek akhir sesi tetap akurat.
