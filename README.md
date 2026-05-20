# ZK Chat — Private Chat, No Trace

Web app chat privat peer-to-peer. Tanpa install app, tanpa akun, tanpa jejak. Semua fitur gratis.

## Fitur (semua gratis)
- Chat text end-to-end encrypted (WebRTC + DTLS)
- Kirim foto & selfie (P2P, auto-kompres, hilang saat sesi berakhir)
- Share lokasi pin (one-time)
- Live location tracking (5 menit)
- Bilingual UI: Bahasa Indonesia / English
- Session counter (Digunakan X kali)
- Sesi maksimal 12 jam, auto-reset
- Share link langsung dengan kode tertanam (`?code=XXXXXX`)
- Rate limiting: 5 percobaan/jam → suspend 24 jam

## Monetisasi
- Sponsor banner (manual / EthicalAds)
- Donasi via TON wallet

## Deploy ke Render.com

1. Fork/upload repo ini ke GitHub
2. Daftar di [render.com](https://render.com) → sign up with GitHub
3. New + → Web Service → pilih repo ini
4. Render auto-detect `render.yaml` → Create Web Service
5. Tunggu 2-3 menit → dapat URL live

## Setup Upstash Redis (counter persisten)

1. Daftar di [upstash.com](https://upstash.com) → Create Database (region: Singapore)
2. Copy REST URL dan REST Token
3. Render Dashboard → Environment → tambah:
   - `UPSTASH_REDIS_URL` = REST URL
   - `UPSTASH_REDIS_TOKEN` = REST Token

## Konfigurasi

Edit `config.js` untuk mengubah sponsor, donasi, dan fitur:

```js
window.ZK_CONFIG = {
  sponsor: {
    enabled: true,
    text_id: "Teks iklan Bahasa Indonesia",
    text_en: "Ad text in English",
    link: "https://link-sponsor.com",
  },
  donate: {
    enabled: true,
    link: "ton://transfer/WALLET_ADDRESS",
    label_id: "💎 Donasi via TON",
    label_en: "💎 Donate via TON",
  },
  ethicalAds: {
    enabled: false,       // true setelah approved
    publisherId: "",      // isi setelah dapat publisher ID
  },
  features: {
    sessionMaxHours: 12,
    maxPhotoSizeMB: 5,
  }
};
```

## Privasi

- Pesan, foto, lokasi: peer-to-peer langsung, tidak lewat server
- Server hanya relay handshake WebRTC awal (~5KB per sesi)
- Kode sesi: in-memory, dihapus saat tersambung
- IP: hanya untuk rate limiting, tidak dicatat permanen
- Tidak ada cookie, localStorage, atau tracking
