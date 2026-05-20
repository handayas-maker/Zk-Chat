// ZK Chat — Signaling Server
// Tugas server: broker WebRTC handshake awal antar dua peer.
// Pesan, foto, dan lokasi tidak pernah melewati server ini.
// Tidak ada database, tidak ada log konten, tidak ada persistence.

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ── Static files ──────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
};
const ALLOWED = ['/index.html', '/app.js', '/config.js'];
const PUBLIC  = __dirname;

// ── Rate limiting ─────────────────────────────────────────
const RL_MAX      = 5;
const RL_WINDOW   = 60  * 60 * 1000;   // 1 jam
const RL_SUSPEND  = 24  * 60 * 60 * 1000; // 24 jam

// Map<ip, { attempts: number[], suspendedUntil: number|null }>
const ipTracker = new Map();

function getIP(req) {
  const xff = req.headers['x-forwarded-for'];
  return xff ? String(xff).split(',')[0].trim() : (req.socket?.remoteAddress || 'unknown');
}

function checkRate(ip) {
  const now = Date.now();
  let e = ipTracker.get(ip);
  if (!e) { e = { attempts:[], suspendedUntil:null }; ipTracker.set(ip, e); }

  if (e.suspendedUntil) {
    if (now < e.suspendedUntil) {
      return { ok:false, hours: Math.ceil((e.suspendedUntil - now) / 3600000) };
    }
    e.suspendedUntil = null; e.attempts = [];
  }

  e.attempts = e.attempts.filter(t => now - t < RL_WINDOW);
  e.attempts.push(now);

  if (e.attempts.length > RL_MAX) {
    e.suspendedUntil = now + RL_SUSPEND;
    console.warn(`[RATE] ${ip} suspended 24h (${e.attempts.length} attempts)`);
    return { ok:false, hours:24 };
  }
  return { ok:true };
}

// cleanup stale entries every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of ipTracker.entries()) {
    const clean = (!e.suspendedUntil || now >= e.suspendedUntil) &&
                  e.attempts.every(t => now - t >= RL_WINDOW);
    if (clean) ipTracker.delete(ip);
  }
}, 10 * 60 * 1000);

// ── HTTP server ───────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control',     'no-store, no-cache, must-revalidate, private');
  res.setHeader('Referrer-Policy',   'no-referrer');
  res.setHeader('X-Frame-Options',   'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy','camera=(self), geolocation=(self), microphone=()');

  const p = req.url.split('?')[0];

  // Stats endpoint — hanya expose counter integer, tidak ada data user
  if (req.method === 'GET' && p === '/api/stats') {
    const count = await counterGet();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ sessions: count }));
  }

  let filePath = p === '/' ? '/index.html' : p;
  if (!ALLOWED.includes(filePath)) { res.writeHead(404); return res.end('Not found'); }

  fs.readFile(path.join(PUBLIC, filePath), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

// ── WebSocket signaling ───────────────────────────────────
const wss = new WebSocketServer({ server, path: '/signal' });

// rooms: Map<code, { initiator, joiner, timeout }>
const rooms = new Map();
const ROOM_TTL = 10 * 60 * 1000;

// ── Session counter ───────────────────────────────────────
// Auto-detects storage: Upstash Redis → file → in-memory
// Counter increments once per successful P2P pair (when joiner connects).

const COUNTER_FILE = process.env.COUNTER_FILE || '/tmp/zkchat-counter.json';
const UPSTASH_URL  = process.env.UPSTASH_REDIS_URL  || '';
const UPSTASH_TOKEN= process.env.UPSTASH_REDIS_TOKEN || '';
const COUNTER_KEY  = 'zkchat:sessions';

let _counterMode = 'memory';
let _memCount    = 0;

async function counterInit() {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    _counterMode = 'redis';
    console.log('[counter] Using Upstash Redis');
    return;
  }
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      const raw = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
      _memCount = raw.count || 0;
    }
    _counterMode = 'file';
    console.log(`[counter] Using file (${COUNTER_FILE}), current: ${_memCount}`);
  } catch {
    _counterMode = 'memory';
    console.log('[counter] Using in-memory (resets on restart)');
  }
}

async function counterIncrement() {
  try {
    if (_counterMode === 'redis') {
      const res = await fetch(`${UPSTASH_URL}/incr/${COUNTER_KEY}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
      });
      const data = await res.json();
      return data.result || 0;
    }
    _memCount++;
    if (_counterMode === 'file') {
      fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count: _memCount }));
    }
    return _memCount;
  } catch (err) {
    console.error('[counter] increment error:', err.message);
    return _memCount;
  }
}

async function counterGet() {
  try {
    if (_counterMode === 'redis') {
      const res = await fetch(`${UPSTASH_URL}/get/${COUNTER_KEY}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
      });
      const data = await res.json();
      return parseInt(data.result) || 0;
    }
    return _memCount;
  } catch {
    return _memCount;
  }
}

counterInit();
// ─────────────────────────────────────────────────────────

function send(ws, obj) { if (ws?.readyState === 1) try { ws.send(JSON.stringify(obj)); } catch {} }

function cleanRoom(code) {
  const r = rooms.get(code);
  if (!r) return;
  if (r.timeout) clearTimeout(r.timeout);
  rooms.delete(code);
}

wss.on('connection', (ws, req) => {
  const ip = getIP(req);
  const rl  = checkRate(ip);
  if (!rl.ok) {
    send(ws, { type:'rate-limited', remainingHours: rl.hours,
      message: `IP anda di-suspend ${rl.hours} jam karena terlalu banyak percobaan koneksi.` });
    setTimeout(() => { try { ws.close(); } catch {} }, 100);
    return;
  }

  ws._code = null;
  ws._role = null;

  ws.on('message', raw => {
    let m;
    try { if (raw.length > 16384) return; m = JSON.parse(raw); } catch { return; }

    switch (m.type) {
      case 'ping': break; // heartbeat — tidak perlu response

      case 'register': {
        const code = String(m.code || '').toUpperCase().slice(0,6);
        if (!/^[A-Z0-9]{6}$/.test(code)) return;
        if (rooms.has(code)) return send(ws, {type:'code-taken'});
        ws._code = code; ws._role = 'initiator';
        rooms.set(code, {
          initiator: ws, joiner: null,
          timeout: setTimeout(() => {
            send(ws, {type:'code-expired'});
            try { ws.close(); } catch {}
            cleanRoom(code);
          }, ROOM_TTL)
        });
        send(ws, {type:'registered'});
        break;
      }

      case 'join': {
        const code = String(m.code || '').toUpperCase().slice(0,6);
        const room = rooms.get(code);
        if (!room || room.joiner) return send(ws, {type:'code-not-found'});
        ws._code = code; ws._role = 'joiner';
        room.joiner = ws;
        clearTimeout(room.timeout); room.timeout = null;
        // Increment counter — satu sesi = satu pasangan berhasil konek
        counterIncrement().catch(() => {});
        send(room.initiator, {type:'peer-joined'});
        send(ws, {type:'join-success'});
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice': {
        const room = rooms.get(ws._code);
        if (!room) return;
        const peer = ws._role === 'initiator' ? room.joiner : room.initiator;
        if (peer) send(peer, m);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws._code) return;
    const room = rooms.get(ws._code);
    if (!room) return;
    const peer = ws._role === 'initiator' ? room.joiner : room.initiator;
    if (peer) send(peer, {type:'peer-left'});
    cleanRoom(ws._code);
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`ZK Chat running on port ${PORT}`);
  console.log(`Server hanya relay handshake — pesan tidak pernah lewat server.`);
});
