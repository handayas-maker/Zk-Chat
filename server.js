const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const MIDTRANS_IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const MIDTRANS_API_BASE = MIDTRANS_IS_PRODUCTION
  ? 'https://api.midtrans.com'
  : 'https://api.sandbox.midtrans.com';

// ===================== RATE LIMITING =====================
// Setiap IP yang request connection di-track. Setelah 5x dalam 1 jam,
// IP di-suspend 24 jam. Counter reset otomatis setelah window habis.

const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;        // 1 jam
const SUSPEND_DURATION_MS = 24 * 60 * 60 * 1000;    // 24 jam

// Map<ip, { attempts: number[], suspendedUntil: number | null }>
const ipTracker = new Map();

function getClientIP(req) {
  // Render/Cloudflare/proxy pakai X-Forwarded-For
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    return String(xff).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = ipTracker.get(ip);

  if (!entry) {
    entry = { attempts: [], suspendedUntil: null };
    ipTracker.set(ip, entry);
  }

  // Cek apakah sedang suspended
  if (entry.suspendedUntil && now < entry.suspendedUntil) {
    const remainingMs = entry.suspendedUntil - now;
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
    return {
      allowed: false,
      suspended: true,
      remainingHours,
      remainingMs
    };
  }

  // Suspend sudah expired - bersihkan
  if (entry.suspendedUntil && now >= entry.suspendedUntil) {
    entry.suspendedUntil = null;
    entry.attempts = [];
  }

  // Bersihkan attempts yang sudah keluar window (rolling 1 jam)
  entry.attempts = entry.attempts.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  // Tambah attempt baru
  entry.attempts.push(now);

  // Cek apakah melebihi limit
  if (entry.attempts.length > RATE_LIMIT_MAX_ATTEMPTS) {
    entry.suspendedUntil = now + SUSPEND_DURATION_MS;
    console.warn(`[RATE LIMIT] IP ${ip} suspended for 24h (${entry.attempts.length} attempts in 1h)`);
    return {
      allowed: false,
      suspended: true,
      remainingHours: 24,
      remainingMs: SUSPEND_DURATION_MS
    };
  }

  return {
    allowed: true,
    attemptsLeft: RATE_LIMIT_MAX_ATTEMPTS - entry.attempts.length
  };
}

// Cleanup memori untuk IP yang sudah tidak relevan (tidak suspended, tidak ada attempts terakhir)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipTracker.entries()) {
    const noSuspend = !entry.suspendedUntil || now >= entry.suspendedUntil;
    const noRecent = entry.attempts.every(t => now - t >= RATE_LIMIT_WINDOW_MS);
    if (noSuspend && noRecent) {
      ipTracker.delete(ip);
    }
  }
}, 10 * 60 * 1000); // setiap 10 menit
// =========================================================


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const PUBLIC_DIR = __dirname;

const pendingPayments = new Map();
const verifiedPayments = new Map();

const PAYMENT_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [orderId, data] of pendingPayments.entries()) {
    if (now - data.createdAt > PAYMENT_TTL_MS) {
      pendingPayments.delete(orderId);
    }
  }
  for (const [token, data] of verifiedPayments.entries()) {
    if (now - data.verifiedAt > PAYMENT_TTL_MS) {
      verifiedPayments.delete(token);
    }
  }
}, 60 * 1000);

function generateOrderId() {
  return 'ZK-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generatePremiumToken() {
  return crypto.randomBytes(24).toString('hex');
}

function midtransRequest(endpoint, method, body) {
  return new Promise((resolve, reject) => {
    if (!MIDTRANS_SERVER_KEY) {
      return reject(new Error('Midtrans server key not configured'));
    }
    const auth = Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64');
    const url = new URL(MIDTRANS_API_BASE + endpoint);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + auth,
        ...(data && { 'Content-Length': Buffer.byteLength(data) })
      }
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => {
      chunks += c;
      if (chunks.length > 100 * 1024) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(chunks || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleCreatePayment(req, res) {
  try {
    const ip = getClientIP(req);
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return sendJSON(res, 429, {
        error: 'rate_limited',
        suspended: true,
        message: `IP anda di-suspend ${rateCheck.remainingHours} jam karena terlalu banyak request. Coba lagi nanti.`,
        remainingHours: rateCheck.remainingHours
      });
    }

    if (!MIDTRANS_SERVER_KEY) {
      return sendJSON(res, 500, {
        error: 'payment_not_configured',
        message: 'Server belum dikonfigurasi untuk payment. Set MIDTRANS_SERVER_KEY di environment variables.'
      });
    }

    const orderId = generateOrderId();
    const amount = 10000;
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || (host && host.includes('localhost') ? 'http' : 'https');
    const baseUrl = `${protocol}://${host}`;

    const payload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount
      },
      item_details: [{
        id: 'PREMIUM-SESSION',
        price: amount,
        quantity: 1,
        name: 'ZK Chat Premium Session'
      }],
      // QRIS only - gopay payment method support QRIS yang dapat di-scan oleh
      // semua e-wallet QRIS-compatible: GoPay, OVO, Dana, ShopeePay, LinkAja,
      // dan mobile banking apps (BCA, Mandiri, BRI, BNI, CIMB, dll)
      enabled_payments: ['gopay', 'other_qris'],
      callbacks: {
        finish: `${baseUrl}/?payment=success&order_id=${orderId}`,
        error: `${baseUrl}/?payment=failed&order_id=${orderId}`,
        pending: `${baseUrl}/?payment=pending&order_id=${orderId}`
      },
      expiry: {
        unit: 'minutes',
        duration: 30
      }
    };

    const result = await midtransRequest('/v1/payment-links', 'POST', payload);

    if (result.status !== 200 && result.status !== 201) {
      console.error('Midtrans error:', result.body);
      return sendJSON(res, 500, {
        error: 'payment_creation_failed',
        message: 'Gagal membuat link pembayaran',
        detail: result.body
      });
    }

    pendingPayments.set(orderId, {
      createdAt: Date.now(),
      amount,
      paymentUrl: result.body.payment_url
    });

    sendJSON(res, 200, {
      orderId,
      paymentUrl: result.body.payment_url,
      amount
    });
  } catch (err) {
    console.error('Create payment error:', err.message);
    sendJSON(res, 500, { error: 'internal_error', message: err.message });
  }
}

async function handleCheckPayment(req, res, orderId) {
  try {
    if (!orderId || !pendingPayments.has(orderId)) {
      return sendJSON(res, 404, { status: 'not_found' });
    }

    const verified = [...verifiedPayments.entries()].find(([, v]) => v.orderId === orderId);
    if (verified) {
      return sendJSON(res, 200, { status: 'paid', token: verified[0] });
    }

    const result = await midtransRequest(`/v2/${orderId}/status`, 'GET');

    if (result.status === 404) {
      return sendJSON(res, 200, { status: 'pending' });
    }

    const txStatus = result.body.transaction_status;
    const fraudStatus = result.body.fraud_status;

    if (txStatus === 'settlement' || (txStatus === 'capture' && fraudStatus === 'accept')) {
      const token = generatePremiumToken();
      verifiedPayments.set(token, {
        orderId,
        verifiedAt: Date.now()
      });
      pendingPayments.delete(orderId);
      return sendJSON(res, 200, { status: 'paid', token });
    } else if (txStatus === 'pending') {
      return sendJSON(res, 200, { status: 'pending' });
    } else {
      return sendJSON(res, 200, { status: 'failed', reason: txStatus });
    }
  } catch (err) {
    console.error('Check payment error:', err.message);
    sendJSON(res, 500, { error: 'internal_error', message: err.message });
  }
}

async function handleMidtransWebhook(req, res) {
  try {
    const body = await parseJSONBody(req);
    const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body;

    if (!order_id || !signature_key) {
      return sendJSON(res, 400, { error: 'invalid_payload' });
    }

    const expectedSignature = crypto
      .createHash('sha512')
      .update(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)
      .digest('hex');

    if (signature_key !== expectedSignature) {
      console.warn('Invalid signature for order:', order_id);
      return sendJSON(res, 401, { error: 'invalid_signature' });
    }

    if ((transaction_status === 'settlement' || (transaction_status === 'capture' && fraud_status === 'accept')) && pendingPayments.has(order_id)) {
      const alreadyVerified = [...verifiedPayments.entries()].find(([, v]) => v.orderId === order_id);
      if (!alreadyVerified) {
        const token = generatePremiumToken();
        verifiedPayments.set(token, {
          orderId: order_id,
          verifiedAt: Date.now()
        });
      }
    }

    sendJSON(res, 200, { ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    sendJSON(res, 500, { error: 'internal_error' });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/payment/create' && req.method === 'POST') {
    return handleCreatePayment(req, res);
  }

  if (pathname.startsWith('/api/payment/check/') && req.method === 'GET') {
    const orderId = pathname.split('/').pop();
    return handleCheckPayment(req, res, orderId);
  }

  if (pathname === '/api/payment/webhook' && req.method === 'POST') {
    return handleMidtransWebhook(req, res);
  }

  let urlPath = pathname;
  if (urlPath === '/') urlPath = '/index.html';

  const allowed = ['/index.html', '/app.js', '/config.js'];
  if (!allowed.includes(urlPath)) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const filePath = path.join(PUBLIC_DIR, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/signal' });

const rooms = new Map();
// Room TTL = waktu kode menunggu peer join sebelum expired (10 menit)
// Session max duration = waktu chat aktif setelah P2P tersambung (12 jam, dihandle di client)
const ROOM_TTL_MS = 10 * 60 * 1000;

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.timeout) clearTimeout(room.timeout);
  rooms.delete(code);
}

wss.on('connection', (ws, req) => {
  const clientIP = getClientIP(req);
  const rateCheck = checkRateLimit(clientIP);

  if (!rateCheck.allowed) {
    send(ws, {
      type: 'rate-limited',
      suspended: true,
      remainingHours: rateCheck.remainingHours,
      message: `IP anda di-suspend ${rateCheck.remainingHours} jam karena terlalu banyak percobaan koneksi.`
    });
    setTimeout(() => { try { ws.close(); } catch {} }, 100);
    return;
  }

  ws.code = null;
  ws.role = null;
  ws.isPremium = false;
  ws.clientIP = clientIP;

  ws.on('message', (raw) => {
    let msg;
    try {
      if (raw.length > 16 * 1024) return;
      msg = JSON.parse(raw);
    } catch { return; }

    switch (msg.type) {
      case 'register': {
        const code = String(msg.code || '').toUpperCase().slice(0, 6);
        if (!/^[A-Z0-9]{6}$/.test(code)) return send(ws, { type: 'error' });
        if (rooms.has(code)) {
          return send(ws, { type: 'code-taken' });
        }

        let isPremium = false;
        if (msg.premiumToken && verifiedPayments.has(msg.premiumToken)) {
          isPremium = true;
          verifiedPayments.delete(msg.premiumToken);
        }

        ws.code = code;
        ws.role = 'initiator';
        ws.isPremium = isPremium;

        const room = {
          initiator: ws,
          joiner: null,
          isPremium,
          timeout: setTimeout(() => {
            send(ws, { type: 'code-expired' });
            try { ws.close(); } catch {}
            cleanupRoom(code);
          }, ROOM_TTL_MS),
        };
        rooms.set(code, room);
        send(ws, { type: 'registered', isPremium });
        break;
      }

      case 'join': {
        const code = String(msg.code || '').toUpperCase().slice(0, 6);
        const room = rooms.get(code);
        if (!room || room.joiner) {
          return send(ws, { type: 'code-not-found' });
        }
        ws.code = code;
        ws.role = 'joiner';
        ws.isPremium = room.isPremium;
        room.joiner = ws;
        if (room.timeout) { clearTimeout(room.timeout); room.timeout = null; }
        send(room.initiator, { type: 'peer-joined', isPremium: room.isPremium });
        send(ws, { type: 'join-success', isPremium: room.isPremium });
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice': {
        const room = rooms.get(ws.code);
        if (!room) return;
        const peer = ws.role === 'initiator' ? room.joiner : room.initiator;
        if (peer) send(peer, msg);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.code) return;
    const room = rooms.get(ws.code);
    if (!room) return;
    const peer = ws.role === 'initiator' ? room.joiner : room.initiator;
    if (peer) send(peer, { type: 'peer-left' });
    cleanupRoom(ws.code);
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`ZK Chat server running on port ${PORT}`);
  console.log(`Midtrans: ${MIDTRANS_SERVER_KEY ? (MIDTRANS_IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX') : 'NOT CONFIGURED'}`);
});
