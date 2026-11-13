/* WhaTaka — PWA de mensajería P2P con cifrado de extremo a extremo.
   El relé solo transporta sobres cifrados: nunca ve el texto en claro. */

'use strict';

// ─────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────

const DEFAULT_RELAY = 'https://whataka-relay.onrender.com';

const params = new URLSearchParams(location.search);
const RELAY_HTTP = (params.get('relay') || localStorage.getItem('whataka.relay') || DEFAULT_RELAY)
  .replace(/\/+$/, '');
const RELAY_WS = RELAY_HTTP.replace(/^http/, 'ws');

const STORE = {
  identity: 'whataka.identity',
  profile: 'whataka.profile',
  peers: 'whataka.peers',
  keys: 'whataka.keys',
  messages: 'whataka.messages',
  status: 'whataka.status',
  relay: 'whataka.relay',
};

const E2E_INFO = 'whataka-e2e-v1';

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

const $ = (sel) => document.querySelector(sel);

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes) {
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const b of bytes) {
    if (b === 0) out += B58[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function randomHex(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('No se pudo guardar', key, err);
  }
}

function shortPeer(id, head = 10, tail = 6) {
  if (!id) return '—';
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

function timeLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hhmm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return hhmm;
  return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${hhmm}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─────────────────────────────────────────────────────────────
// Criptografía
// ─────────────────────────────────────────────────────────────

async function createIdentity() {
  const sign = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const agree = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );

  const spki = await crypto.subtle.exportKey('spki', sign.publicKey);
  const digest = await crypto.subtle.digest('SHA-256', spki);
  const peerId = 'wt1' + base58(new Uint8Array(digest));

  return {
    peerId,
    signPriv: toB64(await crypto.subtle.exportKey('pkcs8', sign.privateKey)),
    signPub: toB64(spki),
    agreePriv: toB64(await crypto.subtle.exportKey('pkcs8', agree.privateKey)),
    agreePub: toB64(await crypto.subtle.exportKey('raw', agree.publicKey)),
  };
}

async function importSignPrivate(b64) {
  return crypto.subtle.importKey('pkcs8', fromB64(b64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function importAgreePrivate(b64) {
  return crypto.subtle.importKey('pkcs8', fromB64(b64), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

async function importAgreePublic(b64) {
  return crypto.subtle.importKey('raw', fromB64(b64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function sessionKey(myAgreePriv, theirAgreePubB64, myId, theirId) {
  const theirPub = await importAgreePublic(theirAgreePubB64);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirPub }, myAgreePriv, 256);
  const salt = await crypto.subtle.digest('SHA-256', enc.encode([myId, theirId].sort().join('|')));
  const base = await crypto.subtle.importKey('raw', new Uint8Array(bits), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(E2E_INFO) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptPayload(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function decryptPayload(key, ivB64, ctB64) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64),
  );
  return JSON.parse(dec.decode(plain));
}

async function signPayload(signPriv, obj) {
  const data = enc.encode(JSON.stringify(obj));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signPriv, data);
  return toB64(sig);
}

// ─────────────────────────────────────────────────────────────
// Estado de la aplicación
// ─────────────────────────────────────────────────────────────

const state = {
  identity: null,
  signKey: null,
  agreeKey: null,
  profile: readStore(STORE.profile, { name: 'Usuario WhaTaka' }),
  peers: readStore(STORE.peers, {}),        // peerId -> { name, agreePub, lastSeen }
  keyCache: readStore(STORE.keys, {}),      // peerId -> agreePub
  messages: readStore(STORE.messages, {}),  // peerId -> [{ from, text, ts }]
  online: new Set(),
  activePeer: null,
  socket: null,
  connected: false,
  startedAt: Date.now(),
  relayUnits: 0,
  storeUnits: 0,
  pendingKeys: new Map(),
};

// ─────────────────────────────────────────────────────────────
// Interfaz
// ─────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-overlay').classList.add('open');
}

function closeModal() {
  $('#modal-overlay').classList.remove('open');
}

function switchTab(target) {
  document.querySelectorAll('.tab-content').forEach((t) => {
    t.classList.toggle('active', t.id === target);
  });
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.target === target);
  });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.toggle('active', s.id === id);
  });
}

function renderChats() {
  const list = $('#chats-list');
  const filter = ($('#search-input').value || '').trim().toLowerCase();
  const ids = Object.keys(state.messages).concat(Object.keys(state.peers));
  const unique = [...new Set(ids)].filter((id) => id !== state.identity.peerId);

  const rows = unique
    .map((id) => {
      const msgs = state.messages[id] || [];
      const last = msgs[msgs.length - 1];
      const peer = state.peers[id] || {};
      const name = peer.name || `Peer ${shortPeer(id, 8, 4)}`;
      return { id, name, last };
    })
    .filter((r) => !filter || r.name.toLowerCase().includes(filter) || r.id.toLowerCase().includes(filter))
    .sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0));

  if (!rows.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-satellite-dish"></i>
        ${
          filter
            ? 'No hay coincidencias. Prueba con otro nombre o Peer ID.'
            : 'Aún no tienes contactos.<br>Pulsa <strong>+</strong> o el icono de añadir para conectar con un Peer ID.'
        }
      </div>`;
    return;
  }

  list.innerHTML = rows.map((r) => `
    <div class="chat-row" data-peer="${escapeHtml(r.id)}">
      <div class="avatar purple-bg">
        <span class="mango-avatar">🥭</span>
        ${state.online.has(r.id) ? '<span class="dot-online"></span>' : ''}
      </div>
      <div class="chat-meta">
        <div class="chat-top">
          <h4>${escapeHtml(r.name)}</h4>
          <span class="time">${r.last ? timeLabel(r.last.ts) : ''}</span>
        </div>
        <p class="last-msg">${r.last ? escapeHtml((r.last.from === state.identity.peerId ? '' : '') + r.last.text) : 'Sin mensajes todavía'}</p>
      </div>
    </div>`).join('');

  list.querySelectorAll('.chat-row').forEach((row) => {
    row.addEventListener('click', () => openChat(row.dataset.peer));
  });
}

function renderChat() {
  const area = $('#messages-area');
  const peerId = state.activePeer;
  if (!peerId) return;

  const msgs = state.messages[peerId] || [];
  if (!msgs.length) {
    area.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-lock"></i>
        Canal cifrado listo.<br>Escribe el primer mensaje.
      </div>`;
    return;
  }

  area.innerHTML = msgs.map((m) => {
    const out = m.from === state.identity.peerId;
    return `
      <div class="msg-bubble ${out ? 'out' : 'in'}">
        ${escapeHtml(m.text)}
        <span class="msg-time">${timeLabel(m.ts)}${out ? ' <i class="fa-solid fa-check"></i>' : ''}</span>
      </div>`;
  }).join('');
  area.scrollTop = area.scrollHeight;
}

function renderProfile() {
  const id = state.identity.peerId;
  $('#display-username').textContent = state.profile.name;
  $('#display-peer-short').textContent = `Peer ID: ${shortPeer(id, 14, 8)}`;
  $('#full-peer-display').textContent = id;
}

function renderStatus() {
  const feed = $('#status-feed');
  const items = readStore(STORE.status, []);
  const base = `
    <div class="status-item">
      <div class="avatar ring-purple">🛡️</div>
      <div>
        <h4>Sistema WhaTaka P2P</h4>
        <p>${state.connected ? 'Hoy, cifrado de extremo a extremo activo' : 'Relé desconectado — modo local'}</p>
      </div>
    </div>`;
  feed.innerHTML = base + items.map((s) => `
    <div class="status-item">
      <div class="avatar ring-purple">🥭</div>
      <div>
        <h4>${escapeHtml(state.profile.name)}</h4>
        <p>${escapeHtml(s.text)}</p>
      </div>
    </div>`).join('');
}

function renderMining() {
  const minutes = Math.floor((Date.now() - state.startedAt) / 60000);
  state.storeUnits = Object.values(state.messages).reduce((n, arr) => n + arr.length, 0);
  const score = state.relayUnits * 0.5 + state.storeUnits * 0.3 + minutes * 0.2;

  $('#m-relay').textContent = String(state.relayUnits);
  $('#m-uptime').textContent = String(minutes);
  $('#m-store').textContent = String(state.storeUnits);
  $('#m-score').textContent = score.toFixed(2);

  const badge = $('#node-status');
  if (state.connected) {
    badge.className = 'badge-live';
    badge.textContent = '● NODO ACTIVO EN RED';
  } else {
    badge.className = 'badge-live off';
    badge.textContent = '● RELÉ DESCONECTADO';
  }
}

// ─────────────────────────────────────────────────────────────
// Red
// ─────────────────────────────────────────────────────────────

function connect() {
  let socket;
  try {
    socket = new WebSocket(`${RELAY_WS}/relay`);
  } catch (err) {
    console.warn('No se pudo abrir el relé', err);
    return;
  }
  state.socket = socket;

  socket.addEventListener('open', () => {
    state.connected = true;
    sendRaw({
      t: 'hello',
      id: state.identity.peerId,
      name: state.profile.name,
      signPub: state.identity.signPub,
      agreePub: state.identity.agreePub,
    });
    renderMining();
    renderChats();
  });

  socket.addEventListener('close', () => {
    state.connected = false;
    state.online.clear();
    renderMining();
    renderChats();
    setTimeout(connect, 4000);
  });

  socket.addEventListener('error', () => {
    state.connected = false;
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleRelayMessage(msg);
  });
}

function sendRaw(obj) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

function handleRelayMessage(msg) {
  switch (msg.t) {
    case 'presence': {
      state.online = new Set((msg.peers || []).map((p) => p.id));
      (msg.peers || []).forEach((p) => rememberPeer(p.id, p.name, p.agreePub));
      renderChats();
      break;
    }
    case 'key': {
      state.keyCache[msg.id] = msg.agreePub;
      writeStore(STORE.keys, state.keyCache);
      const resolve = state.pendingKeys.get(msg.id);
      if (resolve) {
        resolve(msg.agreePub);
        state.pendingKeys.delete(msg.id);
      }
      break;
    }
    case 'msg': {
      receiveMessage(msg).catch((err) => console.warn('Mensaje ilegible', err));
      break;
    }
    default:
      break;
  }
}

function rememberPeer(id, name, agreePub) {
  if (!id || id === state.identity.peerId) return;
  const peer = state.peers[id] || {};
  peer.name = name || peer.name || `Peer ${shortPeer(id, 8, 4)}`;
  if (agreePub) {
    peer.agreePub = agreePub;
    state.keyCache[id] = agreePub;
  }
  peer.lastSeen = Date.now();
  state.peers[id] = peer;
  writeStore(STORE.peers, state.peers);
  writeStore(STORE.keys, state.keyCache);
}

function requestKey(peerId) {
  if (state.keyCache[peerId]) return Promise.resolve(state.keyCache[peerId]);
  return new Promise((resolve, reject) => {
    if (!sendRaw({ t: 'getkey', id: peerId })) {
      reject(new Error('Sin conexión con el relé'));
      return;
    }
    state.pendingKeys.set(peerId, resolve);
    setTimeout(() => {
      if (state.pendingKeys.has(peerId)) {
        state.pendingKeys.delete(peerId);
        reject(new Error('El contacto no está en línea para entregar su clave'));
      }
    }, 6000);
  });
}

async function sendMessage() {
  const input = $('#msg-input');
  const text = input.value.trim();
  const peerId = state.activePeer;
  if (!text || !peerId) return;
  input.value = '';

  const entry = { from: state.identity.peerId, text, ts: Date.now() };
  (state.messages[peerId] = state.messages[peerId] || []).push(entry);
  writeStore(STORE.messages, state.messages);
  renderChat();
  renderChats();

  try {
    const theirPub = await requestKey(peerId);
    const key = await sessionKey(state.agreeKey, theirPub, state.identity.peerId, peerId);
    const sealed = await encryptPayload(key, { text, ts: entry.ts, name: state.profile.name });
    const ok = sendRaw({ t: 'msg', to: peerId, iv: sealed.iv, ct: sealed.ct });
    if (!ok) throw new Error('Sin conexión con el relé');
    state.relayUnits += 1;
    renderMining();
  } catch (err) {
    toast(`No entregado: ${err.message}`);
  }
}

async function receiveMessage(msg) {
  const from = msg.from;
  if (!from || from === state.identity.peerId) return;

  let agreePub = state.keyCache[from] || state.peers[from]?.agreePub;
  if (!agreePub) {
    try {
      agreePub = await requestKey(from);
    } catch {
      return;
    }
  }

  const key = await sessionKey(state.agreeKey, agreePub, state.identity.peerId, from);
  const data = await decryptPayload(key, msg.iv, msg.ct);

  rememberPeer(from, data.name, agreePub);
  (state.messages[from] = state.messages[from] || []).push({
    from, text: data.text, ts: data.ts || Date.now(),
  });
  writeStore(STORE.messages, state.messages);
  state.relayUnits += 1;

  if (state.activePeer === from) renderChat();
  else toast(`Nuevo mensaje de ${state.peers[from]?.name || shortPeer(from)}`);
  renderChats();
  renderMining();
}

// ─────────────────────────────────────────────────────────────
// Acciones de interfaz
// ─────────────────────────────────────────────────────────────

function openChat(peerId) {
  state.activePeer = peerId;
  const peer = state.peers[peerId] || {};
  $('#active-chat-name').textContent = peer.name || `Peer ${shortPeer(peerId, 8, 4)}`;
  $('#active-chat-sub').textContent = state.online.has(peerId)
    ? 'en línea · cifrado de extremo a extremo'
    : 'cifrado de extremo a extremo';
  renderChat();
  showScreen('chat-screen');
}

function askAddPeer(prefill) {
  openModal('Añadir contacto', `
    <p>Pega el Peer ID de tu contacto. Debe estar en línea para recibir su clave pública.</p>
    <input class="modal-input" id="peer-input" placeholder="wt1…" value="${escapeHtml(prefill || '')}">
    <div class="modal-btn-row">
      <button class="ghost-btn" id="peer-cancel">Cancelar</button>
      <button class="primary-btn" id="peer-save">Añadir</button>
    </div>`);

  $('#peer-cancel').addEventListener('click', closeModal);
  $('#peer-save').addEventListener('click', () => {
    const id = $('#peer-input').value.trim();
    if (!id) {
      toast('Introduce un Peer ID');
      return;
    }
    if (id === state.identity.peerId) {
      toast('Ese eres tú 🙂');
      return;
    }
    rememberPeer(id, null, null);
    requestKey(id).then(
      () => toast('Contacto añadido'),
      (err) => toast(err.message),
    );
    closeModal();
    renderChats();
    openChat(id);
  });
}

function askEditName() {
  openModal('Editar nombre', `
    <p>Este nombre lo verán tus contactos.</p>
    <input class="modal-input" id="name-input" value="${escapeHtml(state.profile.name)}">
    <div class="modal-btn-row">
      <button class="ghost-btn" id="name-cancel">Cancelar</button>
      <button class="primary-btn" id="name-save">Guardar</button>
    </div>`);
  $('#name-cancel').addEventListener('click', closeModal);
  $('#name-save').addEventListener('click', () => {
    const name = $('#name-input').value.trim();
    if (!name) {
      toast('El nombre no puede estar vacío');
      return;
    }
    state.profile.name = name;
    writeStore(STORE.profile, state.profile);
    renderProfile();
    if (state.connected) {
      sendRaw({ t: 'hello', id: state.identity.peerId, name, signPub: state.identity.signPub, agreePub: state.identity.agreePub });
    }
    closeModal();
    toast('Nombre actualizado');
  });
}

function showSecurity() {
  const id = state.identity.peerId;
  const fingerprint = id.replace('wt1', '').slice(0, 32).match(/.{1,4}/g).join(' ');
  openModal('Seguridad y cifrado', `
    <p><strong>Sin servidores centrales.</strong> El relé solo reenvía sobres cifrados.</p>
    <ul>
      <li>Intercambio de claves: ECDH P-256</li>
      <li>Derivación: HKDF-SHA256</li>
      <li>Cifrado: AES-256-GCM</li>
      <li>Firma de identidad: ECDSA P-256</li>
    </ul>
    <p>Huella de tu identidad:</p>
    <p><code>${escapeHtml(fingerprint || id)}</code></p>
    <p class="hint-text">Compara esta huella con tu contacto por un canal de confianza.</p>`);
}

function showPeerSecurity() {
  const peerId = state.activePeer;
  if (!peerId) return;
  const peer = state.peers[peerId] || {};
  openModal('Contacto', `
    <p><strong>${escapeHtml(peer.name || 'Peer')}</strong></p>
    <p>Peer ID:</p>
    <p><code>${escapeHtml(peerId)}</code></p>
    <p>Estado: ${state.online.has(peerId) ? 'en línea' : 'desconectado'}</p>
    <p>Clave pública disponible: ${peer.agreePub || state.keyCache[peerId] ? 'sí' : 'todavía no'}</p>`);
}

function showPrivacy() {
  openModal('Privacidad', `
    <p>Tus mensajes se cifran en tu dispositivo antes de salir. El relé nunca ve el texto.</p>
    <ul>
      <li>No hay cuentas ni teléfonos.</li>
      <li>Tu identidad es un par de claves generado en este navegador.</li>
      <li>Puedes usarlo sin conexión; se sincroniza al volver.</li>
    </ul>
    <p class="hint-text">Para borrar todo: borra los datos del sitio en los ajustes del navegador.</p>`);
}

function askStatus() {
  openModal('Publicar estado', `
    <p>Tu estado se comparte con los contactos conectados al relé.</p>
    <input class="modal-input" id="status-input" placeholder="¿Qué está pasando?">
    <div class="modal-btn-row">
      <button class="ghost-btn" id="status-cancel">Cancelar</button>
      <button class="primary-btn" id="status-save">Publicar</button>
    </div>`);
  $('#status-cancel').addEventListener('click', closeModal);
  $('#status-save').addEventListener('click', () => {
    const text = $('#status-input').value.trim();
    if (!text) {
      toast('Escribe algo para publicar');
      return;
    }
    const items = readStore(STORE.status, []);
    items.unshift({ text, ts: Date.now() });
    writeStore(STORE.status, items.slice(0, 20));
    renderStatus();
    closeModal();
    toast('Estado publicado');
  });
}

function voiceCall() {
  openModal('Llamada P2P', `
    <p>Las llamadas P2P cifradas necesitan el canal de señalización WebRTC.</p>
    <p>Esta versión incluye el transporte y el cifrado de mensajes; la capa de audio se conecta al mismo relé.</p>
    <p class="hint-text">Próximamente: audio directo entre pares.</p>`);
}

async function sendMiningReport() {
  const btn = $('#btn-send-report');
  const log = $('#report-log');
  btn.disabled = true;
  log.textContent = 'Firmando reporte…';

  const minutes = Math.floor((Date.now() - state.startedAt) / 60000);
  state.storeUnits = Object.values(state.messages).reduce((n, arr) => n + arr.length, 0);
  const payload = {
    peerId: state.identity.peerId,
    signPub: state.identity.signPub,
    relayUnits: state.relayUnits,
    storeUnits: state.storeUnits,
    uptimeMinutes: minutes,
    issuedAt: new Date().toISOString(),
    nonce: randomHex(8),
  };

  try {
    payload.signature = await signPayload(state.signKey, payload);
    const res = await fetch(`${RELAY_HTTP}/api/mining/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    log.textContent = `Reporte aceptado · score ${data.score ?? '—'} · TTC ${data.reward ?? '—'}`;
    toast('MINING_REPORT firmado y enviado');
  } catch (err) {
    log.textContent = `No se pudo enviar: ${err.message}. Se guardó localmente.`;
    toast('Reporte guardado localmente');
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────
// Arranque
// ─────────────────────────────────────────────────────────────

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.target));
  });

  $('#btn-scan-peer').addEventListener('click', () => askAddPeer());
  $('#fab-new-chat').addEventListener('click', () => askAddPeer());
  $('#btn-open-security').addEventListener('click', showSecurity);
  $('#btn-security-info').addEventListener('click', showSecurity);
  $('#btn-privacy-settings').addEventListener('click', showPrivacy);
  $('#btn-change-name').addEventListener('click', askEditName);
  $('#btn-add-status').addEventListener('click', askStatus);
  $('#btn-voice-call').addEventListener('click', voiceCall);
  $('#btn-verify-keys').addEventListener('click', showPeerSecurity);
  $('#btn-peer-security').addEventListener('click', showPeerSecurity);
  $('#btn-back-chats').addEventListener('click', () => {
    showScreen('home-screen');
    renderChats();
  });
  $('#btn-send-msg').addEventListener('click', sendMessage);
  $('#msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  $('#search-input').addEventListener('input', renderChats);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  $('#copy-peer-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.identity.peerId);
      toast('Peer ID copiado');
    } catch {
      toast(shortPeer(state.identity.peerId, 20, 10));
    }
  });
  $('#btn-send-report').addEventListener('click', sendMiningReport);
}

async function boot() {
  let identity = readStore(STORE.identity, null);
  if (!identity || !identity.peerId) {
    identity = await createIdentity();
    writeStore(STORE.identity, identity);
  }
  state.identity = identity;
  state.signKey = await importSignPrivate(identity.signPriv);
  state.agreeKey = await importAgreePrivate(identity.agreePriv);

  renderProfile();
  renderChats();
  renderStatus();
  renderMining();
  bindEvents();

  if (params.get('relay')) {
    writeStore(STORE.relay, params.get('relay'));
  }

  connect();
  setInterval(renderMining, 30000);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW', err));
  }
}

boot().catch((err) => {
  console.error('Fallo al iniciar WhaTaka', err);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="toast show">No se pudo iniciar el almacén criptográfico. Abre la app por HTTPS.</div>',
  );
});
