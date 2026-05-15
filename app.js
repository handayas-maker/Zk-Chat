(function () {
  'use strict';

  const CONFIG = window.GHOST_CHAT_CONFIG || {};

  let ws = null;
  let pc = null;
  let dc = null;
  let myCode = null;
  let isInitiator = false;
  let isPremium = false;
  let premiumToken = null;
  let typingTimeout = null;
  let lastTypingSent = 0;
  let paymentCheckInterval = null;
  let currentOrderId = null;

  let receivingPhoto = null;
  let liveTrackingWatchId = null;
  let liveTrackingTimeout = null;
  let sessionTimerInterval = null;
  let sessionStartTime = null;
  const PHOTO_CHUNK_SIZE = 16 * 1024;
  const MAX_PHOTO_SIZE = (CONFIG.features?.maxPhotoSizeMB || 2) * 1024 * 1024;
  const SESSION_MAX_DURATION_MS = (CONFIG.features?.sessionMaxHours || 12) * 60 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const landing = $('landing');
  const chatScreen = $('chat-screen');
  const initialOpts = $('initial-options');
  const codeShown = $('code-shown');
  const statusArea = $('status-area');
  const messagesEl = $('messages');
  const msgInput = $('msg-input');
  const connDot = $('conn-dot');
  const chatSubtitle = $('chat-subtitle');
  const typingEl = $('typing');
  const photoInput = $('photo-input');

  const SIGNAL_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/signal';

  function applyConfig() {
    const sponsorSlot = $('sponsor-slot');
    const sponsorLink = $('sponsor-link');
    if (CONFIG.sponsor?.enabled && CONFIG.sponsor.link && CONFIG.sponsor.text) {
      sponsorLink.textContent = CONFIG.sponsor.text;
      sponsorLink.href = CONFIG.sponsor.link;
      sponsorSlot.style.display = 'block';
    } else {
      sponsorSlot.style.display = 'none';
    }

    const donateLink = $('donate-link');
    if (CONFIG.donate?.enabled && CONFIG.donate.link) {
      donateLink.href = CONFIG.donate.link;
      donateLink.target = '_blank';
      donateLink.rel = 'noopener';
      donateLink.style.display = 'inline-block';
    } else {
      donateLink.style.display = 'none';
    }

    if (navigator.share) {
      $('share-btn').classList.add('visible');
    }

    if (!CONFIG.premium?.enabled) {
      const promo = document.querySelector('.premium-promo');
      if (promo) promo.style.display = 'none';
    }
  }

  function generateCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 6; i++) out += chars[arr[i] % chars.length];
    return out;
  }

  function showStatus(text, type) {
    statusArea.innerHTML = `<div class="status ${type}">${text}</div>`;
  }
  function clearStatus() { statusArea.innerHTML = ''; }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function nowTime() {
    const d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }

  function addMessage(text, who) {
    const div = document.createElement('div');
    div.className = 'msg ' + who;
    if (who === 'system') {
      div.textContent = text;
    } else {
      div.innerHTML = escapeHtml(text) + `<span class="msg-time">${nowTime()}</span>`;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addPhotoMessage(dataUrl, who) {
    const div = document.createElement('div');
    div.className = 'msg ' + who;
    const img = document.createElement('img');
    img.className = 'msg-photo';
    img.src = dataUrl;
    img.addEventListener('click', () => openPhotoViewer(dataUrl));
    div.appendChild(img);
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = nowTime();
    div.appendChild(time);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addPhotoLoadingMessage(who, totalChunks) {
    const div = document.createElement('div');
    div.className = 'msg ' + who;
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'msg-photo-loading';
    loadingDiv.textContent = 'Memuat foto...';
    div.appendChild(loadingDiv);
    const progressDiv = document.createElement('div');
    progressDiv.className = 'msg-photo-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'msg-photo-progress-bar';
    progressBar.style.width = '0%';
    progressDiv.appendChild(progressBar);
    div.appendChild(progressDiv);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { div, progressBar };
  }

  function addLocationMessage(lat, lng, who, label) {
    const div = document.createElement('div');
    div.className = 'msg ' + who;
    const locDiv = document.createElement('div');
    locDiv.className = 'msg-location';
    locDiv.innerHTML = `
      <div class="msg-location-icon">📍</div>
      <div>
        <div class="msg-location-text">${label || 'Lokasi dibagikan'}</div>
        <div class="msg-location-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      </div>
    `;
    locDiv.addEventListener('click', () => {
      window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener');
    });
    div.appendChild(locDiv);
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = nowTime();
    div.appendChild(time);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addLiveTrackingMessage(who) {
    const div = document.createElement('div');
    div.className = 'msg ' + who;
    const liveDiv = document.createElement('div');
    liveDiv.className = 'msg-live-tracking';
    liveDiv.innerHTML = `
      <div class="live-dot"></div>
      <div>
        <div style="font-weight:600; font-size:13px;">🟢 Live tracking aktif</div>
        <div class="msg-location-coords" id="live-coords-${Date.now()}">Menunggu lokasi...</div>
      </div>
    `;
    div.appendChild(liveDiv);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { div, liveDiv };
  }

  function openPhotoViewer(src) {
    $('photo-viewer-img').src = src;
    $('photo-viewer').classList.add('active');
  }

  function connectSignaling() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(SIGNAL_URL);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Tidak bisa terhubung ke server'));
      ws.onmessage = handleSignalMessage;
    });
  }

  function sendSignal(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  async function handleSignalMessage(evt) {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    switch (msg.type) {
      case 'rate-limited':
        showStatus(`⛔ IP anda di-suspend ${msg.remainingHours} jam karena terlalu banyak percobaan koneksi. Silakan coba lagi nanti.`, 'error');
        resetToLanding();
        break;

      case 'registered':
        isPremium = !!msg.isPremium;
        break;

      case 'code-taken':
        showStatus('Kode sudah digunakan. Coba lagi.', 'error');
        resetToLanding();
        break;

      case 'code-not-found':
        showStatus('Kode tidak ditemukan atau sudah expired.', 'error');
        resetToLanding();
        break;

      case 'join-success':
        isPremium = !!msg.isPremium;
        break;

      case 'peer-joined':
        isPremium = !!msg.isPremium;
        await createPeerConnection();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ type: 'offer', sdp: offer });
        break;

      case 'offer':
        await createPeerConnection();
        await pc.setRemoteDescription(msg.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: 'answer', sdp: answer });
        break;

      case 'answer':
        await pc.setRemoteDescription(msg.sdp);
        break;

      case 'ice':
        if (pc && msg.candidate) {
          try { await pc.addIceCandidate(msg.candidate); } catch {}
        }
        break;

      case 'peer-left':
        handlePeerLeft();
        break;
    }
  }

  async function createPeerConnection() {
    pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ]
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'ice', candidate: e.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        updateConnUI(true);
      } else if (pc.connectionState === 'disconnected') {
        // Disconnected adalah state sementara, bisa pulih sendiri.
        // Browser kadang trigger ini saat tab di background.
        updateConnUI(false);
        chatSubtitle.textContent = 'Reconnecting...';
      } else if (pc.connectionState === 'failed') {
        // Failed adalah disconnect permanen
        updateConnUI(false);
      }
    };

    // Tangani ICE state secara terpisah - ini lebih granular
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected') {
        // Coba ICE restart setelah 3 detik kalau masih disconnected
        setTimeout(() => {
          if (pc && pc.iceConnectionState === 'disconnected') {
            try { pc.restartIce(); } catch {}
          }
        }, 3000);
      }
    };

    if (isInitiator) {
      dc = pc.createDataChannel('chat', { ordered: true });
      setupDataChannel(dc);
    } else {
      pc.ondatachannel = (e) => {
        dc = e.channel;
        setupDataChannel(dc);
      };
    }
  }

  function setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (ws) { try { ws.close(); } catch {} ws = null; }
      showChatScreen();
      const premiumNote = isPremium ? ' • Premium aktif ⭐' : '';
      addMessage('Koneksi peer-to-peer aman tersambung. Pesan tidak melewati server.' + premiumNote, 'system');
      addMessage('Sesi maksimal 12 jam. Pindah tab atau minimize aman — hanya tutup tab yang akan mengakhiri sesi.', 'system');
      updatePremiumUI();
      startSessionTimer();
    };

    channel.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      handleDataMessage(data);
    };

    channel.onclose = () => {
      updateConnUI(false);
      addMessage('Koneksi terputus.', 'system');
      stopLiveTracking();
    };
  }

  function handleDataMessage(data) {
    switch (data.type) {
      case 'msg':
        addMessage(data.text, 'them');
        typingEl.textContent = '';
        try { navigator.vibrate?.(30); } catch {}
        break;

      case 'typing':
        if (CONFIG.features?.showTypingIndicator === false) return;
        typingEl.textContent = 'Lawan bicara sedang mengetik...';
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { typingEl.textContent = ''; }, 2500);
        break;

      case 'photo-start':
        receivingPhoto = {
          chunks: [],
          totalChunks: data.totalChunks,
          mimeType: data.mimeType,
          ui: addPhotoLoadingMessage('them', data.totalChunks)
        };
        break;

      case 'photo-chunk':
        if (!receivingPhoto) return;
        receivingPhoto.chunks[data.index] = data.data;
        const percent = Math.round((receivingPhoto.chunks.filter(Boolean).length / receivingPhoto.totalChunks) * 100);
        if (receivingPhoto.ui?.progressBar) {
          receivingPhoto.ui.progressBar.style.width = percent + '%';
        }
        break;

      case 'photo-end':
        if (!receivingPhoto) return;
        const allChunks = receivingPhoto.chunks.join('');
        const dataUrl = `data:${receivingPhoto.mimeType};base64,${allChunks}`;
        const oldDiv = receivingPhoto.ui.div;
        const newDiv = addPhotoMessage(dataUrl, 'them');
        oldDiv.replaceWith(newDiv);
        receivingPhoto = null;
        try { navigator.vibrate?.(30); } catch {}
        break;

      case 'location':
        addLocationMessage(data.lat, data.lng, 'them', 'Lokasi dibagikan');
        try { navigator.vibrate?.(30); } catch {}
        break;

      case 'live-start':
        window.peerLiveUI = addLiveTrackingMessage('them');
        addMessage(`Lawan bicara mulai live tracking selama ${data.duration} menit`, 'system');
        break;

      case 'live-update':
        if (window.peerLiveUI) {
          const coordsEl = window.peerLiveUI.liveDiv.querySelector('.msg-location-coords');
          if (coordsEl) {
            coordsEl.innerHTML = `<a href="https://www.google.com/maps?q=${data.lat},${data.lng}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}</a>`;
          }
        }
        break;

      case 'live-end':
        if (window.peerLiveUI) {
          const liveDot = window.peerLiveUI.liveDiv.querySelector('.live-dot');
          if (liveDot) {
            liveDot.style.background = 'var(--text-dim)';
            liveDot.style.boxShadow = 'none';
            liveDot.style.animation = 'none';
          }
          const titleEl = window.peerLiveUI.liveDiv.querySelector('div > div');
          if (titleEl) titleEl.textContent = '⚫ Live tracking berakhir';
          window.peerLiveUI = null;
        }
        break;

      case 'leave':
        addMessage('Lawan bicara telah keluar.', 'system');
        updateConnUI(false);
        stopLiveTracking();
        break;

      case 'session-expired':
        addMessage('Lawan bicara mencapai batas sesi 12 jam. Halaman akan reload.', 'system');
        setTimeout(() => location.reload(), 2000);
        break;
    }
  }

  function updatePremiumUI() {
    const photoBtn = $('photo-btn');
    const locationBtn = $('location-btn');
    if (isPremium) {
      photoBtn.classList.remove('premium-locked');
      locationBtn.classList.remove('premium-locked');
      $('chat-premium-tag').style.display = 'inline-block';
    } else {
      photoBtn.classList.add('premium-locked');
      locationBtn.classList.add('premium-locked');
      $('chat-premium-tag').style.display = 'none';
    }
  }

  function updateConnUI(connected) {
    if (connected) {
      connDot.classList.remove('disconnected');
      chatSubtitle.textContent = 'Terhubung • End-to-end encrypted';
    } else {
      connDot.classList.add('disconnected');
      chatSubtitle.textContent = 'Terputus';
    }
  }

  function showChatScreen() {
    landing.style.display = 'none';
    chatScreen.classList.add('active');
    setTimeout(() => msgInput.focus(), 100);
  }

  function startSessionTimer() {
    sessionStartTime = Date.now();
    const timerEl = $('session-timer');
    if (timerEl) timerEl.style.display = 'inline-block';
    updateSessionTimer();
    sessionTimerInterval = setInterval(updateSessionTimer, 1000);
  }

  function updateSessionTimer() {
    if (!sessionStartTime) return;
    const elapsed = Date.now() - sessionStartTime;
    const remaining = SESSION_MAX_DURATION_MS - elapsed;

    if (remaining <= 0) {
      handleSessionExpired();
      return;
    }

    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const secs = Math.floor((remaining % (60 * 1000)) / 1000);
    const formatted = `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

    const timerEl = $('session-timer');
    if (timerEl) {
      timerEl.textContent = formatted;
      if (remaining < 10 * 60 * 1000) {
        timerEl.style.color = 'var(--danger)';
        timerEl.style.borderColor = 'var(--danger)';
      } else if (remaining < 60 * 60 * 1000) {
        timerEl.style.color = 'var(--gold)';
        timerEl.style.borderColor = 'rgba(251,191,36,0.5)';
      }
    }

    if (remaining < 10 * 60 * 1000 && !window._warned10min) {
      window._warned10min = true;
      addMessage('⚠️ Sesi akan berakhir dalam 10 menit. Halaman akan auto-reload.', 'system');
    }
    if (remaining < 60 * 1000 && !window._warned1min) {
      window._warned1min = true;
      addMessage('⚠️ Sesi berakhir dalam 1 menit!', 'system');
    }
  }

  function stopSessionTimer() {
    if (sessionTimerInterval) {
      clearInterval(sessionTimerInterval);
      sessionTimerInterval = null;
    }
    sessionStartTime = null;
    window._warned10min = false;
    window._warned1min = false;
    const timerEl = $('session-timer');
    if (timerEl) {
      timerEl.style.display = 'none';
      timerEl.style.color = '';
      timerEl.style.borderColor = '';
    }
  }

  function handleSessionExpired() {
    stopSessionTimer();
    if (dc?.readyState === 'open') {
      try { dc.send(JSON.stringify({ type: 'session-expired' })); } catch {}
    }
    alert('Sesi 12 jam telah berakhir. Halaman akan reload otomatis.');
    setTimeout(() => {
      location.reload();
    }, 500);
  }

  function resetToLanding() {
    stopSessionTimer();
    stopLiveTracking();
    if (dc) { try { dc.close(); } catch {} dc = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (ws) { try { ws.close(); } catch {} ws = null; }
    if (paymentCheckInterval) { clearInterval(paymentCheckInterval); paymentCheckInterval = null; }
    myCode = null;
    isInitiator = false;
    isPremium = false;
    premiumToken = null;
    currentOrderId = null;
    receivingPhoto = null;
    codeShown.style.display = 'none';
    initialOpts.style.display = 'block';
    landing.style.display = 'flex';
    chatScreen.classList.remove('active');
    messagesEl.innerHTML = '';
    msgInput.value = '';
    msgInput.style.height = 'auto';
    typingEl.textContent = '';
    $('join-code').value = '';
    $('premium-badge').style.display = 'none';
  }

  function handlePeerLeft() {
    showStatus('Pengguna lain membatalkan. Coba kode lain.', 'error');
    resetToLanding();
  }

  async function generateAndWait(premium = false) {
    myCode = generateCode();
    isInitiator = true;
    isPremium = premium;
    $('my-code').textContent = myCode;
    $('premium-badge').style.display = premium ? 'inline-block' : 'none';
    initialOpts.style.display = 'none';
    codeShown.style.display = 'block';
    clearStatus();
    try {
      await connectSignaling();
      sendSignal({
        type: 'register',
        code: myCode,
        premiumToken: premium ? premiumToken : null
      });
    } catch (err) {
      showStatus('Gagal terhubung: ' + err.message, 'error');
      resetToLanding();
    }
  }

  async function startPremiumPayment() {
    try {
      $('premium-pay-btn').disabled = true;
      $('premium-pay-btn').textContent = 'Membuat link...';

      const res = await fetch('/api/payment/create', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        if (data.suspended) {
          alert(`⛔ IP anda di-suspend ${data.remainingHours} jam karena terlalu banyak percobaan. Silakan coba lagi nanti.`);
        } else if (data.error === 'payment_not_configured') {
          alert('Payment belum dikonfigurasi oleh admin server. Hubungi pengelola.');
        } else {
          alert('Gagal membuat link pembayaran: ' + (data.message || 'Unknown error'));
        }
        $('premium-pay-btn').disabled = false;
        $('premium-pay-btn').textContent = 'Bayar dengan QRIS';
        return;
      }

      currentOrderId = data.orderId;
      window.open(data.paymentUrl, '_blank');
      $('premium-modal').classList.remove('active');
      showStatus('Selesaikan pembayaran QRIS di tab baru. Scan QR code dengan e-wallet anda (GoPay/OVO/Dana/dll). Halaman ini akan otomatis update setelah berhasil...', 'waiting');

      paymentCheckInterval = setInterval(checkPaymentStatus, 3000);

      setTimeout(() => {
        if (paymentCheckInterval) {
          clearInterval(paymentCheckInterval);
          paymentCheckInterval = null;
          showStatus('Pembayaran timeout. Coba lagi jika sudah bayar.', 'error');
        }
      }, 15 * 60 * 1000);

      $('premium-pay-btn').disabled = false;
      $('premium-pay-btn').textContent = 'Bayar dengan QRIS';
    } catch (err) {
      alert('Error: ' + err.message);
      $('premium-pay-btn').disabled = false;
      $('premium-pay-btn').textContent = 'Bayar dengan QRIS';
    }
  }

  async function checkPaymentStatus() {
    if (!currentOrderId) return;
    try {
      const res = await fetch(`/api/payment/check/${currentOrderId}`);
      const data = await res.json();

      if (data.status === 'paid' && data.token) {
        clearInterval(paymentCheckInterval);
        paymentCheckInterval = null;
        premiumToken = data.token;
        showStatus('✓ Pembayaran berhasil! Membuat sesi premium...', 'success');
        setTimeout(() => {
          clearStatus();
          generateAndWait(true);
        }, 1000);
      } else if (data.status === 'failed') {
        clearInterval(paymentCheckInterval);
        paymentCheckInterval = null;
        showStatus('Pembayaran gagal. Coba lagi.', 'error');
      }
    } catch {}
  }

  async function joinWithCode(code) {
    code = code.toUpperCase().trim();
    if (code.length !== 6) {
      showStatus('Kode harus 6 karakter.', 'error');
      return;
    }
    myCode = code;
    isInitiator = false;
    clearStatus();
    showStatus('Menghubungkan...', 'info');
    try {
      await connectSignaling();
      sendSignal({ type: 'join', code });
    } catch (err) {
      showStatus('Gagal terhubung: ' + err.message, 'error');
    }
  }

  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !dc || dc.readyState !== 'open') return;
    const maxLen = CONFIG.features?.maxMessageLength || 4000;
    if (text.length > maxLen) {
      addMessage(`Pesan terlalu panjang (max ${maxLen} karakter)`, 'system');
      return;
    }
    dc.send(JSON.stringify({ type: 'msg', text }));
    addMessage(text, 'me');
    msgInput.value = '';
    msgInput.style.height = 'auto';
    msgInput.focus();
  }

  function sendTyping() {
    if (!dc || dc.readyState !== 'open') return;
    if (CONFIG.features?.showTypingIndicator === false) return;
    const now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now;
    dc.send(JSON.stringify({ type: 'typing' }));
  }

  async function compressImage(file, maxWidth = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, dataUrl });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function handlePhotoSelect(file) {
    if (!isPremium) {
      $('premium-modal').classList.add('active');
      return;
    }
    if (!dc || dc.readyState !== 'open') return;
    if (!file.type.startsWith('image/')) {
      addMessage('File harus berupa gambar', 'system');
      return;
    }

    addMessage('Mengompres foto...', 'system');
    try {
      const blob = await compressImage(file);
      if (blob.size > MAX_PHOTO_SIZE) {
        addMessage(`Foto terlalu besar setelah dikompres (max ${MAX_PHOTO_SIZE / 1024 / 1024}MB)`, 'system');
        return;
      }
      const { base64, dataUrl } = await blobToBase64(blob);
      const totalChunks = Math.ceil(base64.length / PHOTO_CHUNK_SIZE);

      dc.send(JSON.stringify({
        type: 'photo-start',
        totalChunks,
        mimeType: 'image/jpeg'
      }));

      const myLoadingUI = addPhotoLoadingMessage('me', totalChunks);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64.slice(i * PHOTO_CHUNK_SIZE, (i + 1) * PHOTO_CHUNK_SIZE);
        while (dc.bufferedAmount > 1024 * 1024) {
          await new Promise(r => setTimeout(r, 50));
        }
        dc.send(JSON.stringify({
          type: 'photo-chunk',
          index: i,
          data: chunk
        }));
        const percent = Math.round(((i + 1) / totalChunks) * 100);
        myLoadingUI.progressBar.style.width = percent + '%';
      }

      dc.send(JSON.stringify({ type: 'photo-end' }));

      const newDiv = addPhotoMessage(dataUrl, 'me');
      myLoadingUI.div.replaceWith(newDiv);
    } catch (err) {
      addMessage('Gagal mengirim foto: ' + err.message, 'system');
    }
  }

  function sendLocationPin() {
    if (!isPremium) {
      $('premium-modal').classList.add('active');
      return;
    }
    if (!navigator.geolocation) {
      addMessage('Browser anda tidak mendukung GPS', 'system');
      return;
    }
    $('location-modal').classList.remove('active');
    addMessage('Mengambil lokasi...', 'system');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        dc.send(JSON.stringify({ type: 'location', lat: latitude, lng: longitude }));
        addLocationMessage(latitude, longitude, 'me', 'Lokasi anda');
      },
      (err) => {
        addMessage('Gagal ambil lokasi: ' + err.message, 'system');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function startLiveTracking() {
    if (!isPremium) {
      $('premium-modal').classList.add('active');
      return;
    }
    if (!navigator.geolocation) {
      addMessage('Browser anda tidak mendukung GPS', 'system');
      return;
    }
    if (liveTrackingWatchId !== null) {
      addMessage('Live tracking sudah aktif', 'system');
      return;
    }

    $('location-modal').classList.remove('active');
    const duration = 5;
    dc.send(JSON.stringify({ type: 'live-start', duration }));
    const myUI = addLiveTrackingMessage('me');
    window.myLiveUI = myUI;

    liveTrackingWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        dc.send(JSON.stringify({ type: 'live-update', lat: latitude, lng: longitude }));
        if (myUI?.liveDiv) {
          const coordsEl = myUI.liveDiv.querySelector('.msg-location-coords');
          if (coordsEl) coordsEl.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        }
      },
      (err) => {
        addMessage('Error tracking: ' + err.message, 'system');
        stopLiveTracking();
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    liveTrackingTimeout = setTimeout(() => {
      stopLiveTracking();
    }, duration * 60 * 1000);
  }

  function stopLiveTracking() {
    if (liveTrackingWatchId !== null) {
      navigator.geolocation.clearWatch(liveTrackingWatchId);
      liveTrackingWatchId = null;
    }
    if (liveTrackingTimeout) {
      clearTimeout(liveTrackingTimeout);
      liveTrackingTimeout = null;
    }
    if (dc?.readyState === 'open') {
      try { dc.send(JSON.stringify({ type: 'live-end' })); } catch {}
    }
    if (window.myLiveUI?.liveDiv) {
      const liveDot = window.myLiveUI.liveDiv.querySelector('.live-dot');
      if (liveDot) {
        liveDot.style.background = 'var(--text-dim)';
        liveDot.style.boxShadow = 'none';
        liveDot.style.animation = 'none';
      }
      const titleEl = window.myLiveUI.liveDiv.querySelector('div > div');
      if (titleEl) titleEl.textContent = '⚫ Live tracking berakhir';
      window.myLiveUI = null;
    }
  }

  function leaveChat() {
    if (!confirm('Keluar dari chat? Semua pesan akan hilang permanen.')) return;
    if (dc?.readyState === 'open') {
      try { dc.send(JSON.stringify({ type: 'leave' })); } catch {}
    }
    stopLiveTracking();
    resetToLanding();
  }

  async function shareCode() {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: 'ZK Chat',
        text: `Join private chat saya dengan kode: ${myCode}`,
        url: location.origin
      });
    } catch {}
  }

  $('generate-btn').addEventListener('click', () => generateAndWait(false));

  $('generate-premium-btn').addEventListener('click', () => {
    $('premium-modal').classList.add('active');
  });

  $('premium-cancel-btn').addEventListener('click', () => {
    $('premium-modal').classList.remove('active');
  });

  $('premium-pay-btn').addEventListener('click', startPremiumPayment);

  $('join-btn').addEventListener('click', () => joinWithCode($('join-code').value));

  $('join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinWithCode(e.target.value);
  });

  $('join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(myCode).then(() => {
      const btn = $('copy-btn');
      const orig = btn.textContent;
      btn.textContent = 'Tersalin ✓';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => {});
  });

  $('share-btn').addEventListener('click', shareCode);
  $('cancel-btn').addEventListener('click', resetToLanding);
  $('leave-btn').addEventListener('click', leaveChat);
  $('send-btn').addEventListener('click', sendMessage);

  $('photo-btn').addEventListener('click', () => {
    if (!isPremium) {
      $('premium-modal').classList.add('active');
      return;
    }
    photoInput.click();
  });

  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handlePhotoSelect(file);
    e.target.value = '';
  });

  $('location-btn').addEventListener('click', () => {
    if (!isPremium) {
      $('premium-modal').classList.add('active');
      return;
    }
    $('location-modal').classList.add('active');
  });

  $('send-pin-btn').addEventListener('click', sendLocationPin);
  $('send-live-btn').addEventListener('click', startLiveTracking);
  $('location-cancel-btn').addEventListener('click', () => {
    $('location-modal').classList.remove('active');
  });

  $('terms-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('terms-modal').classList.add('active');
  });
  $('terms-close-btn').addEventListener('click', () => {
    $('terms-modal').classList.remove('active');
  });

  $('photo-viewer-close').addEventListener('click', () => {
    $('photo-viewer').classList.remove('active');
  });
  $('photo-viewer').addEventListener('click', (e) => {
    if (e.target.id === 'photo-viewer') {
      $('photo-viewer').classList.remove('active');
    }
  });

  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  msgInput.addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    sendTyping();
  });

  window.addEventListener('beforeunload', () => {
    if (dc?.readyState === 'open') {
      try { dc.send(JSON.stringify({ type: 'leave' })); } catch {}
    }
    stopLiveTracking();
  });

  // Page Visibility API: pindah tab atau minimize TIDAK menutup session.
  // Hanya tab close (beforeunload) yang menutup session.
  // Handler ini hanya untuk reconnect attempt jika koneksi drop saat tab di background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pc) {
      // Tab kembali ke foreground - cek apakah koneksi masih hidup
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        try { pc.restartIce(); } catch {}
      }
    }
  });

  function checkUrlPayment() {
    const params = new URLSearchParams(location.search);
    if (params.get('payment') === 'success' && params.get('order_id')) {
      currentOrderId = params.get('order_id');
      showStatus('Memverifikasi pembayaran...', 'waiting');
      paymentCheckInterval = setInterval(checkPaymentStatus, 2000);
      window.history.replaceState({}, '', location.pathname);
    }
  }

  applyConfig();
  checkUrlPayment();

})();
