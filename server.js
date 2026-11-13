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
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 10000;
const MAX_FRAME = 64 * 1024;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// El frontend puede vivir en otro origen (GitHub Pages) o dentro del propio relé.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// ── Estado en memoria ────────────────────────────────────────────────────────
const peers = new Map();          // peerId -> { name, signPub, agreePub, sockets:Set, connectedAt }
const ledger = new Map();         // peerId -> { score, reports, lastReportAt }
const startedAt = Date.now();

function peerList() {
  return [...peers.values()].map((p) => ({
    id: p.id,
    name: p.name,
    agreePub: p.agreePub,
    connections: p.sockets.size,
  }));
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

app.get('/api/mining/:peerId', (req, res) => {
  const entry = ledger.get(req.params.peerId);
  if (!entry) return res.status(404).json({ error: 'sin reportes para ese nodo' });
  res.json(entry);
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
          ct: String(msg.ct || '').slice(0, 48000),
        });
        for (const s of target.sockets) {
          if (s.readyState === 1) s.send(envelope);
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
