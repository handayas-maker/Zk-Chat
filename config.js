window.ZK_CONFIG = {

  sponsor: {
    enabled: true,
    text_id: "🛡️ Jaga privasi anda dengan ProtonVPN — gratis & no-logs",
    text_en: "🛡️ Protect your privacy with ProtonVPN — free & no-logs",
    link: "https://protonvpn.com",
  },

  // EthicalAds — ad network tanpa tracking, khusus developer/privacy audience
  // Daftar di: https://ethicalads.io/publishers/
  // Setelah approved, isi publisherId dengan ID dari dashboard EthicalAds
  // Contoh: publisherId: "zkchat-app"
  // Selama publisherId kosong (""), slot manual sponsor di bawah yang tampil
  ethicalAds: {
    enabled: false,          // ganti ke true setelah approved
    publisherId: "",         // isi dengan publisher ID dari EthicalAds dashboard
    type: "image",           // "image" atau "text" — sesuaikan dengan preferensi
  },

  donate: {
    enabled: true,
    // TON Wallet: UQBToS2GOQ59AX7IHs0blnIT7hXW3zWQCJZyPEFCTS0l7Km
    link: "ton://transfer/UQBToS2GOQ59AX7IHs0blnIT7hXW3zWQCJZyPEFCTS0l7Km",
    desc_id: "Kalau anda merasa terbantu dan suka dengan ini, bantu donasi untuk developer 😊",
    desc_en: "If you find this helpful and enjoy it, please consider donating to support the developer 😊",
    label_id: "💎 Donasi via TON",
    label_en: "💎 Donate via TON",
  },

  // Kebijakan ads — hanya untuk referensi operator
  // Iklan yang DILARANG: judi online, pornografi, produk ilegal, penipuan
  // Iklan yang DIIZINKAN: VPN, password manager, privacy tools, software legal
  adsPolicy: {
    blocked: ["gambling", "porn", "adult", "casino", "betting", "illegal"],
    note: "Semua sponsor diseleksi manual oleh operator sebelum ditampilkan."
  },

  features: {
    roomTimeoutMinutes: 10,
    sessionMaxHours:    12,
    maxMessageLength:   4000,
    maxPhotoSizeMB:     5,
    showTypingIndicator: true,
  },

  // UI strings — tambahkan terjemahan baru di sini jika perlu
  i18n: {
    id: {
      // landing
      tagline:          "Chat privat tanpa jejak. Tidak ada akun, tidak ada server menyimpan pesan, tidak ada history. Tutup tab — semuanya hilang.",
      newChat:          "Mulai percakapan baru",
      genBtn:           "Buat kode unik",
      orDivider:        "atau",
      joinChat:         "Gabung dengan kode",
      joinPlaceholder:  "Masukkan kode 6 karakter",
      joinBtn:          "Gabung",
      yourCode:         "Kode anda",
      copyBtn:          "Salin kode",
      copyLinkBtn:      "Salin link",
      shareBtn:         "Bagikan",
      copied:           "Tersalin ✓",
      copiedLink:       "Link tersalin ✓",
      waitingMsg:       "Bagikan kode ini ke lawan bicara. Menunggu mereka bergabung...",
      cancelBtn:        "Batal",
      adLabel:          "Sponsor",
      donateLink:       "💎 Donasi via TON",
      tosLink:          "Syarat & Ketentuan",
      legal:            "Dengan menggunakan layanan ini anda setuju tidak menggunakannya untuk hal yang melanggar hukum.",
      // privacy list
      priv1: "Peer-to-peer terenkripsi (WebRTC + DTLS)",
      priv2: "Foto & lokasi dikirim langsung, tidak lewat server",
      priv3: "Tidak ada history, tidak ada log",
      priv4: "Sesi maksimal 12 jam, otomatis reset",
      priv5: "Tutup tab = semua data hilang selamanya",
      // chat header
      chatTitle:        "Sesi Privat",
      connectedSub:     "Terhubung • End-to-end terenkripsi",
      reconnecting:     "Menghubungkan kembali...",
      disconnected:     "Terputus",
      leaveBtn:         "Keluar",
      // composer
      msgPlaceholder:   "Ketik pesan...",
      // system messages
      sysConnected:     "Koneksi peer-to-peer aman tersambung. Pesan tidak melewati server.",
      sysTabSafe:       "Pindah tab atau minimize aman — hanya tutup tab yang mengakhiri sesi.",
      sysLeft:          "Lawan bicara telah keluar.",
      sysDisconn:       "Koneksi terputus.",
      sysTyping:        "Lawan bicara sedang mengetik...",
      sysCompressing:   "Mengompres foto...",
      sysPhotoFail:     "Gagal kirim foto: ",
      sysPhotoType:     "File harus berupa gambar.",
      sysPhotoBig:      "Foto terlalu besar setelah dikompres.",
      sysGettingLoc:    "Mengambil lokasi...",
      sysLocFail:       "Gagal ambil lokasi: ",
      sysGPSUnsupported:"Browser tidak mendukung GPS.",
      sysLiveActive:    "Live tracking sudah aktif.",
      sysLiveError:     "Error GPS: ",
      sysLiveStarted:   "Lawan bicara mulai live tracking selama 5 menit",
      sysLiveEnded:     "⚫ Live tracking berakhir",
      sysMsgLong:       "Pesan terlalu panjang.",
      sysExpiredPeer:   "Lawan bicara mencapai batas sesi. Halaman akan reload.",
      sysWarn10:        "⚠️ Sesi berakhir dalam 10 menit. Halaman akan auto-reload.",
      sysWarn1:         "⚠️ Sesi berakhir dalam 1 menit!",
      sysExpiredAlert:  "Sesi 12 jam telah berakhir. Halaman akan reload otomatis.",
      // location modal
      locModalTitle:    "📍 Kirim Lokasi",
      locModalSub:      "Pilih jenis lokasi yang ingin dibagikan",
      locPinBtn:        "📍 Kirim lokasi sekali",
      locLiveBtn:       "🟢 Live tracking (5 menit)",
      locCancelBtn:     "Batal",
      locShared:        "Lokasi dibagikan",
      locYours:         "Lokasi anda",
      locLiveActive:    "🟢 Live tracking aktif",
      locLiveWaiting:   "Menunggu lokasi...",
      // expired overlay
      expTitle:         "Sesi telah berakhir",
      expSub:           "Halaman akan reload otomatis. Semua pesan terhapus permanen.",
      // alerts
      confirmLeave:     "Keluar dari chat? Semua pesan akan hilang permanen.",
      rateLimited:      "⛔ IP anda di-suspend",
      rateLimitedHours: "jam karena terlalu banyak percobaan koneksi.",
      errConnect:       "Gagal terhubung: ",
      errCodeLength:    "Kode harus 6 karakter.",
      errCodeTaken:     "Kode sudah digunakan. Coba lagi.",
      errCodeNotFound:  "Kode tidak ditemukan atau sudah expired.",
      errPeerLeft:      "Pengguna lain membatalkan.",
      connecting:       "Menghubungkan...",
      // tos
      tosTitle:         "Syarat & Ketentuan",
    },

    en: {
      tagline:          "Private chat with no trace. No account, no server storing messages, no history. Close the tab — everything is gone.",
      newChat:          "Start a new conversation",
      genBtn:           "Generate unique code",
      orDivider:        "or",
      joinChat:         "Join with a code",
      joinPlaceholder:  "Enter 6-character code",
      joinBtn:          "Join",
      yourCode:         "Your code",
      copyBtn:          "Copy code",
      copyLinkBtn:      "Copy link",
      shareBtn:         "Share",
      copied:           "Copied ✓",
      copiedLink:       "Link copied ✓",
      waitingMsg:       "Share this code with your contact. Waiting for them to join...",
      cancelBtn:        "Cancel",
      adLabel:          "Sponsor",
      donateLink:       "💎 Donate via TON",
      tosLink:          "Terms & Conditions",
      legal:            "By using this service you agree not to use it for anything that violates the law.",
      priv1: "Peer-to-peer encrypted (WebRTC + DTLS)",
      priv2: "Photos & location sent directly, never through the server",
      priv3: "No history, no logs",
      priv4: "Session max 12 hours, auto-reset",
      priv5: "Close tab = all data gone permanently",
      chatTitle:        "Private Session",
      connectedSub:     "Connected • End-to-end encrypted",
      reconnecting:     "Reconnecting...",
      disconnected:     "Disconnected",
      leaveBtn:         "Leave",
      msgPlaceholder:   "Type a message...",
      sysConnected:     "Secure peer-to-peer connection established. Messages do not pass through the server.",
      sysTabSafe:       "Switching tabs or minimizing is safe — only closing the tab ends the session.",
      sysLeft:          "The other person has left.",
      sysDisconn:       "Connection lost.",
      sysTyping:        "Other person is typing...",
      sysCompressing:   "Compressing photo...",
      sysPhotoFail:     "Failed to send photo: ",
      sysPhotoType:     "File must be an image.",
      sysPhotoBig:      "Photo too large after compression.",
      sysGettingLoc:    "Getting location...",
      sysLocFail:       "Failed to get location: ",
      sysGPSUnsupported:"Your browser does not support GPS.",
      sysLiveActive:    "Live tracking is already active.",
      sysLiveError:     "GPS error: ",
      sysLiveStarted:   "Other person started live tracking for 5 minutes",
      sysLiveEnded:     "⚫ Live tracking ended",
      sysMsgLong:       "Message too long.",
      sysExpiredPeer:   "Other person reached session limit. Page will reload.",
      sysWarn10:        "⚠️ Session ends in 10 minutes. Page will auto-reload.",
      sysWarn1:         "⚠️ Session ends in 1 minute!",
      sysExpiredAlert:  "12-hour session has ended. Page will reload automatically.",
      locModalTitle:    "📍 Send Location",
      locModalSub:      "Choose the type of location to share",
      locPinBtn:        "📍 Send location once",
      locLiveBtn:       "🟢 Live tracking (5 minutes)",
      locCancelBtn:     "Cancel",
      locShared:        "Location shared",
      locYours:         "Your location",
      locLiveActive:    "🟢 Live tracking active",
      locLiveWaiting:   "Waiting for location...",
      expTitle:         "Session has ended",
      expSub:           "Page will reload automatically. All messages are permanently deleted.",
      confirmLeave:     "Leave chat? All messages will be permanently deleted.",
      rateLimited:      "⛔ Your IP is suspended for",
      rateLimitedHours: "hours due to too many connection attempts.",
      errConnect:       "Connection failed: ",
      errCodeLength:    "Code must be 6 characters.",
      errCodeTaken:     "Code already in use. Please try again.",
      errCodeNotFound:  "Code not found or already expired.",
      errPeerLeft:      "The other person cancelled.",
      connecting:       "Connecting...",
      tosTitle:         "Terms & Conditions",
    }
  }
};
