'use strict';

/* Relé de WhaTaka.
 *
 * El relé es deliberadamente "tonto": mantiene la presencia de los nodos y
 * reenvía sobres cifrados de un Peer ID a otro. Nunca ve el texto en claro,
 * porque el cifrado AES-256-GCM se hace en el navegador.
 */

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { ethers } = require('ethers');
const { WebSocketServer } = require('ws');
const voucher = require('./lib/voucher');
const donaciones = require('./lib/donaciones');

const PORT = Number(process.env.PORT) || 10000;
const MAX_FRAME = 512 * 1024;

// Configuración de minería on-chain. Si falta la clave del firmante o la
// dirección del contrato, el relé sigue funcionando (chat y presencia), pero
// el endpoint de vales responde 503.
const CHAIN_ID = Number(process.env.CHAIN_ID) || 80002; // Polygon Amoy por defecto
const MINING_CONTRACT = (process.env.MINING_CONTRACT || '').trim();
const REPORT_SIGNER_KEY = (process.env.REPORT_SIGNER_KEY || '').trim();
const VOUCHER_TTL_SECONDS = Number(process.env.VOUCHER_TTL_SECONDS) || 600;

// Cartera de donaciones (la del administrador). Se configura por variable de
// entorno para NO incrustarla en el código: al pasar a Polygon real solo hay
// que cambiar este valor en Render y volver a desplegar.
const DONATION_WALLET = (process.env.DONATION_WALLET || '').trim();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// El frontend puede vivir en otro origen (GitHub Pages) o dentro del propio relé.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  // Permisos que la app necesita (cámara, micrófono, ubicación y avisos del
  // sistema). Sin esta cabecera, los navegadores embebidos de las wallets
  // bloquean cámara y micrófono aunque la persona los conceda.
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=(self), notifications=(self)',
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// ── Estado en memoria ────────────────────────────────────────────────────────
const peers = new Map();          // peerId -> { name, signPub, agreePub, sockets:Set, connectedAt }
const ledger = new Map();         // peerId -> { score, reports, lastReportAt }
const wallets = new Map();        // peerId -> { address, peerId, registeredAt }
const startedAt = Date.now();

function peerList() {
  return [...peers.values()].map((p) => ({
    id: p.id,
    name: p.name,
    agreePub: p.agreePub,
    photo: p.photo,
    connections: p.sockets.size,
  }));
}

// Solo aceptamos una miniatura JPEG en base64 y con un tope de tamaño; así la
// foto nunca desborda la presencia ni puede colarse otro tipo de dato.
const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{40,24000}$/;

function sanitizePhoto(photo) {
  return typeof photo === 'string' && PHOTO_RE.test(photo) ? photo : undefined;
}

function validatePeerId(id) {
  return typeof id === 'string' && /^wt1[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(id);
}

// ── Rutas HTTP ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'whataka-relay',
    peers: peers.size,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  });
});

app.get('/api/peers', (req, res) => {
  res.json({ count: peers.size, peers: peerList().map(({ id, name, connections }) => ({ id, name, connections })) });
});

// Servidores ICE para las llamadas. STUN basta en la mayoría de redes; con
// TURN (redes móviles o NAT estricto) se configura por variables de entorno,
// sin tocar el código. El navegador pide esta lista al iniciar una llamada.
app.get('/api/ice', (req, res) => {
  const stun = (process.env.ICE_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const iceServers = [{ urls: stun }];
  const turnUrl = (process.env.ICE_TURN_URL || '').trim();
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl.split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.ICE_TURN_USERNAME || undefined,
      credential: process.env.ICE_TURN_CREDENTIAL || undefined,
    });
  }
  res.json({ iceServers });
});

app.post('/api/mining/report', (req, res) => {
  const body = req.body || {};
  const { peerId, signPub, signature, nonce } = body;

  if (!validatePeerId(peerId)) {
    return res.status(400).json({ error: 'peerId inválido' });
  }
  if (typeof signPub !== 'string' || typeof signature !== 'string' || !signature) {
    return res.status(400).json({ error: 'signPub y signature son obligatorios' });
  }
  if (typeof nonce !== 'string' || nonce.length < 8) {
    return res.status(400).json({ error: 'nonce inválido' });
  }

  const relayUnits = Math.max(0, Math.min(1e9, Number(body.relayUnits) || 0));
  const storeUnits = Math.max(0, Math.min(1e9, Number(body.storeUnits) || 0));
  const uptimeMinutes = Math.max(0, Math.min(1e6, Number(body.uptimeMinutes) || 0));

  const unsigned = {
    peerId,
    signPub,
    relayUnits,
    storeUnits,
    uptimeMinutes,
    issuedAt: body.issuedAt,
    nonce,
  };

  let signatureOk = false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(signPub, 'base64'),
      format: 'der',
      type: 'spki',
    });
    signatureOk = crypto.verify(
      'sha256',
      Buffer.from(JSON.stringify(unsigned)),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64'),
    );
  } catch (err) {
    signatureOk = false;
  }

  if (!signatureOk) {
    return res.status(400).json({ error: 'firma ECDSA inválida' });
  }

  const score = Number((relayUnits * 0.5 + storeUnits * 0.3 + uptimeMinutes * 0.2).toFixed(4));
  const reward = Number((score / 100).toFixed(6));

  const entry = ledger.get(peerId) || { score: 0, reward: 0, reports: 0 };
  entry.score = Number((entry.score + score).toFixed(4));
  entry.reward = Number((entry.reward + reward).toFixed(6));
  entry.reports += 1;
  entry.lastReportAt = new Date().toISOString();
  ledger.set(peerId, entry);

  res.json({ ok: true, score, reward, total: entry });
});

// ── Minería on-chain ────────────────────────────────────────────────────────
// La app necesita saber a qué contrato/cadena apuntar y si el relé puede firmar.
app.get('/api/mining/config', (req, res) => {
  res.json({
    configured: Boolean(MINING_CONTRACT && REPORT_SIGNER_KEY),
    chainId: CHAIN_ID,
    contract: MINING_CONTRACT || null,
    weights: {
      relay: Number(voucher.WEIGHTS.relay),
      store: Number(voucher.WEIGHTS.store),
      uptime: Number(voucher.WEIGHTS.uptime),
      call: Number(voucher.WEIGHTS.call),
      reputation: Number(voucher.WEIGHTS.reputation),
    },
    rewardFactor: voucher.REWARD_FACTOR.toString(),
  });
});

// Valida un entero de unidades (0..MAX_UNITS) y lo devuelve como BigInt.
function readUnits(value) {
  if (value === undefined || value === null || value === '') return 0n;
  const n = typeof value === 'bigint' ? value : BigInt(String(value).trim());
  if (n < 0n || n > voucher.MAX_UNITS) throw new Error('unidades fuera de rango');
  return n;
}

function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

// ── Donaciones: destino y registro de carteras ──────────────────────────────
// El registro guarda, por Peer ID, la cartera que el usuario demuestra poseer.
// La prueba es una firma de esa cartera (personal_sign) sobre un mensaje que
// incluye su Peer ID: así nadie puede registrar una cartera que no es suya.

app.get('/api/donations/config', (req, res) => {
  res.json({
    chainId: CHAIN_ID,
    // Si no hay variable configurada, el frontend usa su respaldo.
    wallet: DONATION_WALLET || null,
    configured: Boolean(DONATION_WALLET),
  });
});

app.post('/api/wallets', async (req, res) => {
  const body = req.body || {};
  const { peerId, address, signature } = body;

  if (!validatePeerId(peerId)) {
    return res.status(400).json({ error: 'peerId inválido' });
  }
  if (!isAddress(address)) {
    return res.status(400).json({ error: 'dirección de cartera inválida' });
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return res.status(400).json({ error: 'firma inválida' });
  }

  const message = donaciones.mensajeRegistroCartera(peerId, address);

  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return res.status(400).json({ error: 'no se pudo verificar la firma' });
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return res.status(400).json({ error: 'la firma no corresponde a esa cartera' });
  }

  const entry = {
    address: recovered, // con las mayúsculas de comprobación de ethers
    peerId,
    registeredAt: new Date().toISOString(),
  };
  wallets.set(peerId, entry);
  res.json({ ok: true, wallet: entry });
});

app.get('/api/wallets/:peerId', (req, res) => {
  const entry = wallets.get(req.params.peerId);
  if (!entry) return res.status(404).json({ error: 'no hay cartera registrada' });
  res.json({ ok: true, wallet: entry });
});

app.post('/api/mining/voucher', (req, res) => {
  if (!MINING_CONTRACT || !REPORT_SIGNER_KEY) {
    return res.status(503).json({ error: 'la minería on-chain no está configurada' });
  }

  const body = req.body || {};
  const { user, reportHash, nonce } = body;
  if (!isAddress(user)) {
    return res.status(400).json({ error: 'dirección de wallet inválida' });
  }

  let units;
  try {
    units = {
      relay: readUnits(body.relayUnits),
      store: readUnits(body.storeUnits),
      uptime: readUnits(body.uptimeUnits),
      call: readUnits(body.callUnits),
      reputation: readUnits(body.reputationUnits),
    };
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const score = voucher.scoreOf(units);
  if (score === 0n) {
    return res.status(400).json({ error: 'score cero, no hay nada que reclamar' });
  }

  const hash = typeof reportHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(reportHash)
    ? reportHash
    : voucher.reportHashFor(body.peerId || 'anon', nonce || crypto.randomBytes(8).toString('hex'));

  const deadline = Math.floor(Date.now() / 1000) + VOUCHER_TTL_SECONDS;

  let signature;
  try {
    signature = voucher.signVoucher(REPORT_SIGNER_KEY, {
      chainId: CHAIN_ID,
      contract: MINING_CONTRACT,
      user,
      reportHash: hash,
      units,
      deadline,
    });
  } catch (err) {
    return res.status(500).json({ error: `no se pudo firmar: ${err.message}` });
  }

  res.json({
    ok: true,
    chainId: CHAIN_ID,
    contract: MINING_CONTRACT,
    user,
    reportHash: hash,
    units: {
      relay: units.relay.toString(),
      store: units.store.toString(),
      uptime: units.uptime.toString(),
      call: units.call.toString(),
      reputation: units.reputation.toString(),
    },
    score: score.toString(),
    reward: voucher.rewardUnits(units).toString(),
    rewardFormatted: voucher.formatReward(units),
    deadline,
    signature,
  });
});

app.get('/api/mining/:peerId', (req, res) => {
  const entry = ledger.get(req.params.peerId);
  if (!entry) return res.status(404).json({ error: 'sin reportes para ese nodo' });
  res.json(entry);
});

// Copia de respaldo de la app, servida desde el propio relé. Sirve para los
// navegadores internos de las wallets (MetaMask, Brave), que a veces no abren
// github.io. Solo se exponen los ficheros del frontend, nunca el código del
// servidor ni node_modules.
const PUBLIC_FILES = new Set([
  '/', '/index.html', '/app.js', '/sw.js', '/manifest.webmanifest',
  '/deploy.html', '/contract-artifact.js',
]);
const PUBLIC_DIRS = ['/vendor/', '/icons/', '/lib/'];
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const p = req.path;
  if (!PUBLIC_FILES.has(p) && !PUBLIC_DIRS.some((d) => p.startsWith(d))) return next();
  express.static(__dirname, { index: 'index.html' })(req, res, next);
});

app.use((req, res) => res.status(404).json({ error: 'ruta no encontrada' }));

// ── Servidor HTTP + WebSocket ────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/relay', maxPayload: MAX_FRAME });

// La presencia llega a todos los sockets conectados, incluso a los que
// todavía no han enviado su "hello".
function broadcast(obj, exceptSocket) {
  const data = JSON.stringify(obj);
  for (const socket of wss.clients) {
    if (socket !== exceptSocket && socket.readyState === 1) socket.send(data);
  }
}

function sendPresence() {
  broadcast({ t: 'presence', peers: peerList() });
}

function dropPeer(socket) {
  const peer = peers.get(socket.peerId);
  if (!peer) return;
  peer.sockets.delete(socket);
  if (peer.sockets.size === 0) peers.delete(socket.peerId);
  sendPresence();
}

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.t) {
      case 'hello': {
        if (!validatePeerId(msg.id)) {
          socket.close(1008, 'peerId inválido');
          return;
        }
        socket.peerId = msg.id;
        const peer = peers.get(msg.id) || {
          id: msg.id,
          sockets: new Set(),
          connectedAt: new Date().toISOString(),
        };
        peer.name = typeof msg.name === 'string' ? msg.name.slice(0, 40) : peer.name;
        if (msg.photo === null) {
          peer.photo = undefined;
        } else {
          const photo = sanitizePhoto(msg.photo);
          if (photo !== undefined) peer.photo = photo;
        }
        peer.agreePub = typeof msg.agreePub === 'string' ? msg.agreePub : peer.agreePub;
        peer.signPub = typeof msg.signPub === 'string' ? msg.signPub : peer.signPub;
        peer.sockets.add(socket);
        peers.set(msg.id, peer);
        sendPresence();
        break;
      }
      case 'getkey': {
        const target = peers.get(msg.id);
        if (target && target.agreePub) {
          socket.send(JSON.stringify({ t: 'key', id: msg.id, agreePub: target.agreePub }));
        } else {
          socket.send(JSON.stringify({ t: 'key', id: msg.id, agreePub: null, error: 'peer offline' }));
        }
        break;
      }
      case 'msg': {
        if (!socket.peerId) return;
        const target = peers.get(msg.to);
        if (!target || !target.sockets.size) {
          socket.send(JSON.stringify({ t: 'undelivered', to: msg.to }));
          return;
        }
        const envelope = JSON.stringify({
          t: 'msg',
          from: socket.peerId,
          iv: String(msg.iv || '').slice(0, 128),
          ct: String(msg.ct || '').slice(0, 400000),
        });
        for (const s of target.sockets) {
          if (s.readyState === 1) s.send(envelope);
        }
        break;
      }
      // Señalización de llamadas WebRTC. El relé NO ve el audio ni el vídeo
      // (van directos entre pares, cifrados con DTLS-SRTP); aquí solo se
      // reenvían los mensajes de negociación (offer/answer/ICE).
      case 'call': {
        if (!socket.peerId) return;
        const target = peers.get(msg.to);
        if (!target || !target.sockets.size) {
          socket.send(JSON.stringify({ t: 'call', to: msg.to, kind: 'offline', callId: msg.callId }));
          return;
        }
        const frame = JSON.stringify({
          t: 'call',
          from: socket.peerId,
          callId: typeof msg.callId === 'string' ? msg.callId.slice(0, 64) : '',
          kind: String(msg.kind || '').slice(0, 16),
          video: !!msg.video,
          payload: msg.payload && typeof msg.payload === 'object' ? msg.payload : null,
        });
        for (const s of target.sockets) {
          if (s.readyState === 1) s.send(frame);
        }
        break;
      }
      default:
        break;
    }
  });

  socket.on('close', () => dropPeer(socket));
  socket.on('error', () => dropPeer(socket));
});

// Limpieza de conexiones muertas.
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WhaTaka relay escuchando en http://0.0.0.0:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
