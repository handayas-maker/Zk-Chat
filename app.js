(function () {
  'use strict';

  const C  = window.ZK_CONFIG   || {};
  const F  = C.features         || {};
  const I  = C.i18n             || {};
  const SESSION_MS = (F.sessionMaxHours || 12) * 3600000;
  const CHUNK      = 16 * 1024;
  const MAX_PHOTO  = (F.maxPhotoSizeMB  || 5)  * 1024 * 1024;

  // ── DOM helper — HARUS di atas semua fungsi yang menggunakannya ──
  const $ = id => document.getElementById(id);

  // ── i18n — pakai strings yang sudah diload oleh inline script di HTML ──
  // ZK_STRINGS dan zkLang() sudah dijalankan sebelum app.js diload
  function t(key) {
    var s = window._zkStrings || (window.ZK_STRINGS && window.ZK_STRINGS.id) || {};
    return s[key] || key;
  }

  function switchLang(l) {
    if (window.zkLang) window.zkLang(l);
    lang = l;
    updateCounterLabels();
  }

  let lang = window._zkLang || 'id';

  function fetchCounter() {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => {
        const n = data.sessions || 0;
        const formatted = n.toLocaleString('en-US').replace(/,/g, '.');
        const el = $('counter-value');
        if (el) el.textContent = formatted;
        updateCounterLabels();
      })
      .catch(() => {
        const el = $('counter-value');
        if (el) el.textContent = '—';
      });
  }

  function updateCounterLabels() {
    const label  = $('counter-label');
    const suffix = $('counter-suffix');
    if (label)  label.textContent  = lang === 'en' ? 'Used' : 'Digunakan';
    if (suffix) suffix.textContent = lang === 'en' ? 'times' : 'kali';
  }

  // applyLang sekarang dihandle oleh zkLang() di inline script HTML
  // Ini hanya update chat-sub saat bahasa berganti di dalam chat
  function applyLangChat() {
    if (connectedState !== null) {
      const sub = $('chat-sub');
      if (sub) sub.textContent = connectedState ? t('connected') : t('disconn');
    }
  }


  // ── state ─────────────────────────────────────────────────
  let ws = null, pc = null, dc = null;
  let myCode = null, isInitiator = false;
  let typingTimeout = null, lastTypingSent = 0;
  let sessionStart = null, sessionInterval = null;
  let liveWatchId = null, liveTimeout = null;
  let rxPhoto = null;
  let connectedState = null;

  // ── DOM variables ─────────────────────────────────────────
  const landing    = $('landing');
  const optsMain   = $('opts-main');
  const optsWait   = $('opts-waiting');
  const statusArea = $('status-area');
  const chat       = $('chat');
  const messages   = $('messages');
  const msgInput   = $('msg-input');
  const typingEl   = $('typing');
  const connDot    = $('conn-dot');
  const chatSub    = $('chat-sub');
  const timerEl    = $('session-timer');
  const photoInput = $('photo-input');

  const SIGNAL_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/signal';

  // ── config init ───────────────────────────────────────────
  function applyConfig() {
    const ea         = C.ethicalAds || {};
    const adSlot     = $('ad-slot');
    const eaSlot     = $('ea-slot');
    const manualSlot = $('manual-slot');

    if (ea.enabled && ea.publisherId) {
      // Mode EthicalAds
      if (eaSlot)    eaSlot.style.display     = 'flex';
      if (manualSlot) manualSlot.style.display = 'none';
      const eaCont = $('ea-container');
      if (eaCont) eaCont.setAttribute('data-ea-type', ea.type || 'image');
      loadEthicalAds(ea.publisherId);
    } else if (C.sponsor?.enabled) {
      // Mode manual sponsor
      if (eaSlot)    eaSlot.style.display     = 'none';
      if (manualSlot) manualSlot.style.display = 'block';
    } else {
      // Tidak ada iklan sama sekali
      if (adSlot) adSlot.style.display = 'none';
    }

    const dl = $('donate-link');
    if (C.donate?.enabled && C.donate.link) {
      dl.href = C.donate.link; dl.target = '_blank'; dl.rel = 'noopener';
    } else if (dl) { dl.style.display = 'none'; }

    if (navigator.share) $('share-btn').classList.add('show');
    fetchCounter();
  }

  // ── status ────────────────────────────────────────────────
  function setStatus(html, cls) { statusArea.innerHTML = `<div class="status ${cls}">${html}</div>`; }
  function clearStatus()        { statusArea.innerHTML = ''; }

  // ── message helpers ───────────────────────────────────────
  function ts() {
    const d = new Date();
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function esc(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function addMsg(text, who) {
    const d = document.createElement('div');
    d.className = 'msg ' + who;
    if (who === 'sys') { d.textContent = text; }
    else { d.innerHTML = esc(text) + `<span class="msg-time">${ts()}</span>`; }
    messages.appendChild(d);
    messages.scrollTop = messages.scrollHeight;
    return d;
  }

  function addPhotoMsg(dataUrl, who) {
    const d = document.createElement('div'); d.className = 'msg ' + who;
    const img = document.createElement('img');
    img.className = 'msg-img'; img.src = dataUrl;
    img.addEventListener('click', () => openViewer(dataUrl));
    d.appendChild(img);
    const tm = document.createElement('span'); tm.className = 'msg-time'; tm.textContent = ts();
    d.appendChild(tm);
    messages.appendChild(d); messages.scrollTop = messages.scrollHeight;
    return d;
  }

  function addPhotoLoading(who) {
    const d = document.createElement('div'); d.className = 'msg ' + who;
    const box = document.createElement('div'); box.className = 'msg-img-loading';
    box.textContent = who === 'me' ? (lang === 'en' ? 'Sending...' : 'Mengirim...') : (lang === 'en' ? 'Loading photo...' : 'Memuat foto...');
    const wrap = document.createElement('div'); wrap.className = 'progress-wrap';
    const bar  = document.createElement('div'); bar.className  = 'progress-bar'; bar.style.width = '0%';
    wrap.appendChild(bar); d.appendChild(box); d.appendChild(wrap);
    messages.appendChild(d); messages.scrollTop = messages.scrollHeight;
    return { el: d, bar };
  }

  function addLocMsg(lat, lng, who, label) {
    const d = document.createElement('div'); d.className = 'msg ' + who;
    const loc = document.createElement('div'); loc.className = 'msg-loc';
    loc.innerHTML = `<span class="loc-icon">📍</span><div><div class="loc-label">${label}</div><div class="loc-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div></div>`;
    loc.addEventListener('click', () => window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener'));
    const tm = document.createElement('span'); tm.className = 'msg-time'; tm.textContent = ts();
    d.appendChild(loc); d.appendChild(tm);
    messages.appendChild(d); messages.scrollTop = messages.scrollHeight;
    return d;
  }

  function addLiveMsg(who) {
    const d = document.createElement('div'); d.className = 'msg ' + who;
    const live = document.createElement('div'); live.className = 'msg-live';
    live.innerHTML = `<div class="live-dot"></div><div><div style="font-weight:600;font-size:13px;">${t('locLiveActive')}</div><div class="loc-coords">${t('locLiveWaiting')}</div></div>`;
    const tm = document.createElement('span'); tm.className = 'msg-time'; tm.textContent = ts();
    d.appendChild(live); d.appendChild(tm);
    messages.appendChild(d); messages.scrollTop = messages.scrollHeight;
    return { el: d, live };
  }

  // ── photo viewer ──────────────────────────────────────────
  function openViewer(src) { $('pv-img').src = src; $('photo-viewer').classList.add('on'); }
  function closeViewer()   { $('photo-viewer').classList.remove('on'); }

  // ── session timer ─────────────────────────────────────────
  function startTimer() {
    sessionStart = Date.now(); timerEl.style.display = 'inline-block';
    window._w10 = false; window._w1 = false;
    sessionInterval = setInterval(tickTimer, 1000); tickTimer();
  }
  function tickTimer() {
    const rem = SESSION_MS - (Date.now() - sessionStart);
    if (rem <= 0) { expireSession(); return; }
    const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000), s = Math.floor((rem % 60000) / 1000);
    timerEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    timerEl.className = 'timer' + (rem < 60000 ? ' crit' : rem < 600000 ? ' warn' : '');
    if (rem < 600000 && !window._w10) { window._w10 = true; addMsg(t('sysWarn10'), 'sys'); }
    if (rem < 60000  && !window._w1)  { window._w1  = true; addMsg(t('sysWarn1'),  'sys'); }
  }
  function stopTimer() {
    clearInterval(sessionInterval); sessionInterval = null; sessionStart = null;
    timerEl.style.display = 'none'; timerEl.className = 'timer';
  }
  function expireSession() {
    stopTimer();
    if (dc?.readyState === 'open') try { dc.send(JSON.stringify({type:'session-expired'})); } catch {}
    alert(t('sysExpiredAlert'));
    setTimeout(() => location.reload(), 500);
  }

  // ── signaling ─────────────────────────────────────────────
  function connectWS() {
    return new Promise((res, rej) => {
      ws = new WebSocket(SIGNAL_URL);
      ws.onopen    = () => res();
      ws.onerror   = () => rej(new Error(t('errConnect') + 'WebSocket error'));
      ws.onmessage = onSignal;
    });
  }
  function sig(obj) { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); }

  async function onSignal(evt) {
    let m; try { m = JSON.parse(evt.data); } catch { return; }
    switch (m.type) {
      case 'registered': break;
      case 'rate-limited':
        setStatus(`${t('rateLimited')} ${m.remainingHours} ${t('rateLimitedHours')}`, 's-error');
        resetLanding(); break;
      case 'code-taken':
        setStatus(t('errCodeTaken'), 's-error'); resetLanding(); break;
      case 'code-not-found':
        setStatus(t('errCodeNotFound'), 's-error'); resetLanding(); break;
      case 'peer-joined':
        await makePeer();
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        sig({type:'offer', sdp:offer}); break;
      case 'offer':
        await makePeer(); await pc.setRemoteDescription(m.sdp);
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        sig({type:'answer', sdp:ans}); break;
      case 'answer':
        await pc.setRemoteDescription(m.sdp); break;
      case 'ice':
        if (pc && m.candidate) try { await pc.addIceCandidate(m.candidate); } catch {} break;
      case 'peer-left':
        setStatus(t('errPeerLeft'), 's-error'); resetLanding(); break;
    }
  }

  // ── WebRTC ────────────────────────────────────────────────
  async function makePeer() {
    pc = new RTCPeerConnection({ iceServers: [
      // STUN servers — multiple untuk fallback
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.stunprotocol.org:3478' },
      { urls: 'stun:stun.voip.blackberry.com:3478' },
      // TURN server gratis dari Open Relay Project
      // Membantu koneksi di belakang NAT ketat (mobile data seluler)
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
    iceCandidatePoolSize: 10,
    });
    pc.onicecandidate = e => { if (e.candidate) sig({type:'ice', candidate:e.candidate}); };
    pc.onconnectionstatechange = () => {
      if      (pc.connectionState === 'connected')    setConn(true);
      else if (pc.connectionState === 'disconnected') { setConn(false); const cs = $('chat-sub'); if(cs) cs.textContent = t('reconn'); }
      else if (pc.connectionState === 'failed')       setConn(false);
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected')
        setTimeout(() => { if (pc?.iceConnectionState === 'disconnected') try { pc.restartIce(); } catch {} }, 3000);
    };
    if (isInitiator) { dc = pc.createDataChannel('chat', {ordered:true}); setupDC(dc); }
    else { pc.ondatachannel = e => { dc = e.channel; setupDC(dc); }; }
  }

  function setupDC(ch) {
    ch.onopen = () => {
      if (ws) { try { ws.close(); } catch {} ws = null; }
      showChat();
      addMsg(t('sysConnected'), 'sys');
      addMsg(t('sysTabSafe'),   'sys');
      startTimer();
    };
    ch.onmessage = e => { let d; try { d = JSON.parse(e.data); } catch { return; } handleData(d); };
    ch.onclose   = () => { setConn(false); addMsg(t('sysDisconn'), 'sys'); stopLive(); };
  }

  // ── incoming data ─────────────────────────────────────────
  function handleData(d) {
    switch (d.type) {
      case 'msg':
        addMsg(d.text, 'them'); typingEl.textContent = '';
        try { navigator.vibrate?.(30); } catch {} break;
      case 'typing':
        if (F.showTypingIndicator === false) break;
        typingEl.textContent = t('sysTyping');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { typingEl.textContent = ''; }, 2500); break;
      case 'photo-start':
        rxPhoto = { chunks:[], total:d.total, mime:d.mime, ui:addPhotoLoading('them') }; break;
      case 'photo-chunk':
        if (!rxPhoto) break;
        rxPhoto.chunks[d.i] = d.data;
        rxPhoto.ui.bar.style.width = Math.round(rxPhoto.chunks.filter(Boolean).length / rxPhoto.total * 100) + '%'; break;
      case 'photo-end':
        if (!rxPhoto) break;
        const url = `data:${rxPhoto.mime};base64,${rxPhoto.chunks.join('')}`;
        rxPhoto.ui.el.replaceWith(addPhotoMsg(url, 'them'));
        rxPhoto = null;
        try { navigator.vibrate?.(30); } catch {} break;
      case 'loc':
        addLocMsg(d.lat, d.lng, 'them', t('locShared'));
        try { navigator.vibrate?.(30); } catch {} break;
      case 'live-start':
        window.peerLive = addLiveMsg('them');
        addMsg(t('sysLiveStarted'), 'sys'); break;
      case 'live-update':
        if (window.peerLive) {
          const ce = window.peerLive.live.querySelector('.loc-coords');
          if (ce) ce.innerHTML = `<a href="https://www.google.com/maps?q=${d.lat},${d.lng}" target="_blank" rel="noopener" style="color:inherit">${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}</a>`;
        } break;
      case 'live-end':
        if (window.peerLive) {
          const dot = window.peerLive.live.querySelector('.live-dot');
          if (dot) { dot.style.cssText = 'background:var(--dim);box-shadow:none;animation:none'; }
          const ttl = window.peerLive.live.querySelector('[style]');
          if (ttl) ttl.textContent = t('sysLiveEnded');
          window.peerLive = null;
        } break;
      case 'leave':
        addMsg(t('sysLeft'), 'sys'); setConn(false); stopLive(); break;
      case 'session-expired':
        addMsg(t('sysExpiredPeer'), 'sys');
        setTimeout(() => location.reload(), 2000); break;
    }
  }

  // ── UI ────────────────────────────────────────────────────
  function setConn(ok) {
    connectedState = ok;
    connDot.classList.toggle('off', !ok);
    const sub = $('chat-sub');
    if (sub) sub.textContent = ok ? t('connected') : t('disconn');
  }

  function showChat() {
    landing.style.display = 'none'; chat.classList.add('on');
    setTimeout(() => msgInput.focus(), 100);
  }

  function resetLanding() {
    stopTimer(); stopLive(); connectedState = null;
    if (dc)  { try { dc.close();  } catch {} dc  = null; }
    if (pc)  { try { pc.close();  } catch {} pc  = null; }
    if (ws)  { try { ws.close();  } catch {} ws  = null; }
    myCode = null; isInitiator = false; rxPhoto = null;
    optsWait.style.display = 'none'; optsMain.style.display = 'block';
    chat.classList.remove('on'); landing.style.display = 'flex';
    messages.innerHTML = ''; msgInput.value = ''; msgInput.style.height = 'auto';
    typingEl.textContent = ''; $('join-input').value = '';
  }

  // ── generate / join ───────────────────────────────────────
  function genCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => chars[b % chars.length]).join('');
  }

  async function startSession() {
    myCode = genCode(); isInitiator = true;
    $('code-display').textContent = myCode;
    optsMain.style.display = 'none'; optsWait.style.display = 'block'; clearStatus();
    try { await connectWS(); sig({type:'register', code:myCode}); }
    catch (err) { setStatus(t('errConnect') + err.message, 's-error'); resetLanding(); }
  }

  async function joinSession(code) {
    code = code.toUpperCase().trim();
    if (code.length !== 6) { setStatus(t('errCodeLength'), 's-error'); return; }
    myCode = code; isInitiator = false; clearStatus();
    setStatus(t('connecting'), 's-info');
    try { await connectWS(); sig({type:'join', code}); }
    catch (err) { setStatus(t('errConnect') + err.message, 's-error'); }
  }

  // ── send ──────────────────────────────────────────────────
  function sendMsg() {
    const text = msgInput.value.trim();
    if (!text || dc?.readyState !== 'open') return;
    if (text.length > (F.maxMessageLength || 4000)) { addMsg(t('sysMsgLong'), 'sys'); return; }
    dc.send(JSON.stringify({type:'msg', text}));
    addMsg(text, 'me'); msgInput.value = ''; msgInput.style.height = 'auto'; msgInput.focus();
  }

  function sendTyping() {
    if (dc?.readyState !== 'open' || F.showTypingIndicator === false) return;
    const now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now; dc.send(JSON.stringify({type:'typing'}));
  }

  // ── photo ─────────────────────────────────────────────────
  async function compressImg(file, maxW = 1280, q = 0.82) {
    return new Promise((res, rej) => {
      const img = new Image(), r = new FileReader();
      r.onload = e => {
        img.onload = () => {
          let {width:w, height:h} = img;
          if (w > maxW) { h = h * maxW / w; w = maxW; }
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          c.toBlob(res, 'image/jpeg', q);
        };
        img.onerror = rej; img.src = e.target.result;
      };
      r.onerror = rej; r.readAsDataURL(file);
    });
  }

  function b64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const [, b] = r.result.split(','); res({b64:b, dataUrl:r.result}); };
      r.onerror = rej; r.readAsDataURL(blob);
    });
  }

  async function sendPhoto(file) {
    if (!file.type.startsWith('image/')) { addMsg(t('sysPhotoType'), 'sys'); return; }
    if (dc?.readyState !== 'open') return;
    addMsg(t('sysCompressing'), 'sys');
    try {
      const blob = await compressImg(file);
      if (blob.size > MAX_PHOTO) { addMsg(t('sysPhotoBig'), 'sys'); return; }
      const {b64:b, dataUrl} = await b64(blob);
      const total = Math.ceil(b.length / CHUNK);
      dc.send(JSON.stringify({type:'photo-start', total, mime:'image/jpeg'}));
      const ui = addPhotoLoading('me');
      for (let i = 0; i < total; i++) {
        while (dc.bufferedAmount > 1024 * 1024) await new Promise(r => setTimeout(r, 50));
        dc.send(JSON.stringify({type:'photo-chunk', i, data:b.slice(i*CHUNK, (i+1)*CHUNK)}));
        ui.bar.style.width = Math.round((i+1)/total*100) + '%';
      }
      dc.send(JSON.stringify({type:'photo-end'}));
      ui.el.replaceWith(addPhotoMsg(dataUrl, 'me'));
    } catch (err) { addMsg(t('sysPhotoFail') + err.message, 'sys'); }
  }

  // ── location ──────────────────────────────────────────────
  function sendPin() {
    $('loc-modal').classList.remove('on');
    if (!navigator.geolocation) { addMsg(t('sysGPSUnsupported'), 'sys'); return; }
    addMsg(t('sysGettingLoc'), 'sys');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const {latitude:lat, longitude:lng} = pos.coords;
        dc.send(JSON.stringify({type:'loc', lat, lng}));
        addLocMsg(lat, lng, 'me', t('locYours'));
      },
      err => addMsg(t('sysLocFail') + err.message, 'sys'),
      {enableHighAccuracy:true, timeout:15000}
    );
  }

  function startLive() {
    $('loc-modal').classList.remove('on');
    if (!navigator.geolocation) { addMsg(t('sysGPSUnsupported'), 'sys'); return; }
    if (liveWatchId !== null) { addMsg(t('sysLiveActive'), 'sys'); return; }
    const dur = 5;
    dc.send(JSON.stringify({type:'live-start', dur}));
    const myLive = addLiveMsg('me'); window.myLive = myLive;
    liveWatchId = navigator.geolocation.watchPosition(
      pos => {
        const {latitude:lat, longitude:lng} = pos.coords;
        dc.send(JSON.stringify({type:'live-update', lat, lng}));
        const ce = myLive.live.querySelector('.loc-coords');
        if (ce) ce.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      },
      err => { addMsg(t('sysLiveError') + err.message, 'sys'); stopLive(); },
      {enableHighAccuracy:true, maximumAge:5000}
    );
    liveTimeout = setTimeout(stopLive, dur * 60000);
  }

  function stopLive() {
    if (liveWatchId !== null) { navigator.geolocation.clearWatch(liveWatchId); liveWatchId = null; }
    if (liveTimeout)          { clearTimeout(liveTimeout); liveTimeout = null; }
    if (dc?.readyState === 'open') try { dc.send(JSON.stringify({type:'live-end'})); } catch {}
    if (window.myLive) {
      const dot = window.myLive.live.querySelector('.live-dot');
      if (dot) dot.style.cssText = 'background:var(--dim);box-shadow:none;animation:none';
      window.myLive = null;
    }
  }

  // ── share ─────────────────────────────────────────────────
  function getShareLink() {
    return `${location.origin}${location.pathname}?code=${myCode}`;
  }

  function showToast(msg, duration = 2200) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), duration);
  }

  async function shareCode() {
    try {
      await navigator.share({
        title: 'ZK Chat',
        text: lang === 'en' ? `My ZK Chat code: ${myCode}` : `Kode ZK Chat saya: ${myCode}`,
        url: getShareLink()
      });
    } catch {}
  }

  // ── URL param: auto-join if ?code=XXXXXX present ─────────
  function checkUrlCode() {
    const params = new URLSearchParams(location.search);
    const code   = params.get('code');
    if (code && /^[A-Z0-9]{6}$/i.test(code)) {
      // Bersihkan URL supaya tidak reload dengan code lagi
      window.history.replaceState({}, '', location.pathname);
      // Pre-fill dan langsung join
      $('join-input').value = code.toUpperCase();
      joinSession(code);
    }
  }

  // ── events ────────────────────────────────────────────────
  $('btn-id').addEventListener('click', () => switchLang('id'));
  $('btn-en').addEventListener('click', () => switchLang('en'));
  $('gen-btn').addEventListener('click', startSession);
  $('join-btn').addEventListener('click', () => joinSession($('join-input').value));
  $('join-input').addEventListener('keydown', e => { if (e.key === 'Enter') joinSession(e.target.value); });
  $('join-input').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''); });

  $('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(myCode).then(() => {
      showToast(t('copied'));
      const btn = $('copy-code-btn'); btn.textContent = t('copied');
      setTimeout(() => { btn.textContent = t('copyBtn'); }, 1500);
    }).catch(() => {});
  });

  $('copy-link-btn').addEventListener('click', () => {
    const link = getShareLink();
    navigator.clipboard.writeText(link).then(() => {
      showToast('🔗 ' + t('copiedLink'));
      const btn = $('copy-link-btn'); btn.textContent = t('copiedLink');
      setTimeout(() => { btn.textContent = t('copyLinkBtn'); }, 1500);
    }).catch(() => {
      // Fallback: select manually
      const tmp = document.createElement('input');
      tmp.value = link; document.body.appendChild(tmp);
      tmp.select(); document.execCommand('copy');
      document.body.removeChild(tmp);
      showToast('🔗 ' + t('copiedLink'));
    });
  });
  $('share-btn').addEventListener('click', shareCode);
  $('cancel-btn').addEventListener('click', resetLanding);
  $('leave-btn').addEventListener('click', () => {
    if (!confirm(t('confirmLeave'))) return;
    if (dc?.readyState === 'open') try { dc.send(JSON.stringify({type:'leave'})); } catch {}
    resetLanding();
  });

  $('send-btn').addEventListener('click', sendMsg);
  msgInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
  msgInput.addEventListener('input', e => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    sendTyping();
  });

  $('photo-btn').addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) sendPhoto(f); e.target.value = ''; });

  $('loc-btn').addEventListener('click', () => { if (dc?.readyState === 'open') $('loc-modal').classList.add('on'); });
  $('loc-pin-btn').addEventListener('click', sendPin);
  $('loc-live-btn').addEventListener('click', startLive);
  $('loc-cancel-btn').addEventListener('click', () => $('loc-modal').classList.remove('on'));

  $('tos-link').addEventListener('click', e => { e.preventDefault(); $('tos-modal').classList.add('on'); });
  $('tos-close').addEventListener('click', () => $('tos-modal').classList.remove('on'));

  $('pv-close').addEventListener('click', closeViewer);
  $('photo-viewer').addEventListener('click', e => { if (e.target.id === 'photo-viewer') closeViewer(); });

  // ── Mobile tab suspend handler ────────────────────────────
  // Android/iOS suspend WebSocket saat user pindah app.
  // Saat kembali ke browser, langsung reconnect dalam <3 detik.

  let _reconnectTimer = null;

  function attemptReconnect() {
    // Hanya reconnect kalau sedang di waiting screen (sudah punya kode tapi belum tersambung)
    if (!myCode || !isInitiator || dc) return;

    // Kalau WebSocket masih hidup, tidak perlu reconnect
    if (ws && ws.readyState === WebSocket.OPEN) return;

    // Tutup WS lama kalau ada
    if (ws) { try { ws.close(); } catch {} ws = null; }

    // Update status agar user tahu sedang reconnect
    const waitingStatus = $('opts-waiting')?.querySelector('.status');
    if (waitingStatus) {
      waitingStatus.textContent = lang === 'en'
        ? 'Reconnecting...' : 'Menghubungkan kembali...';
      waitingStatus.className = 'status s-info';
    }

    connectWS()
      .then(() => {
        sig({ type: 'register', code: myCode });
        // Restore status normal
        const s = $('opts-waiting')?.querySelector('.status');
        if (s) {
          s.textContent = t('waiting');
          s.className = 'status s-wait';
        }
      })
      .catch(() => {
        // Retry lagi 3 detik kemudian
        _reconnectTimer = setTimeout(attemptReconnect, 3000);
      });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Clear any pending reconnect timer
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }

      // Kalau sedang chat — reconnect ICE kalau perlu
      if (pc && ['disconnected','failed'].includes(pc.iceConnectionState))
        try { pc.restartIce(); } catch {}

      // Kalau sedang waiting — reconnect WebSocket segera
      // Delay 300ms untuk beri waktu OS resume network stack
      setTimeout(attemptReconnect, 300);
    } else {
      // Tab tersembunyi — clear reconnect timer
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    }
  });

  // Heartbeat setiap 25 detik — mencegah WebSocket di-timeout proxy/firewall
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
    }
  }, 25000);

  window.addEventListener('beforeunload', () => {
    if (dc?.readyState === 'open') try { dc.send(JSON.stringify({type:'leave'})); } catch {}
    stopLive();
  });

  window.addEventListener('resize', () => {
    if (chat.classList.contains('on')) setTimeout(() => { messages.scrollTop = messages.scrollHeight; }, 100);
  });

  applyConfig();
  checkUrlCode();
})();
