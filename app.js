/* Whataka — PWA de mensajería P2P con cifrado de extremo a extremo.
   El relé solo transporta sobres cifrados: nunca ve el texto en claro. */

'use strict';

window.__wtBootAt = Date.now();

// ─────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────

const DEFAULT_RELAY = 'https://whataka-relay.onrender.com';

// Project ID de Reown/WalletConnect Cloud (gratuito). Con él, la app conecta
// con MetaMask desde el navegador normal del móvil: no hace falta abrir
// Whataka dentro de MetaMask. Si está vacío, se usa el que el usuario pegue
// en Ajustes → WalletConnect, y si tampoco hay, se ofrece abrir la app en
// MetaMask mediante enlace directo.
const DEFAULT_WC_PROJECT_ID = '';
const WC_BUNDLE =
  'https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.17.2/dist/index.umd.js';
const METAMASK_DEEPLINK = 'https://metamask.app.link/dapp/';

const STORE = {
  identity: 'whataka.identity',
  profile: 'whataka.profile',
  peers: 'whataka.peers',
  keys: 'whataka.keys',
  messages: 'whataka.messages',
  status: 'whataka.status',
  relay: 'whataka.relay',
  avatar: 'whataka.avatar',
  wallet: 'whataka.wallet',
  directKey: 'whataka.directKey',
  wc: 'whataka.wcProjectId',
  calls: 'whataka.calls',
  nivel: 'whataka.nivel',
  padrino: 'whataka.padrino',
  padrinoHecho: 'whataka.padrinoHecho',
  invitados: 'whataka.invitados',
  refPuntos: 'whataka.refPuntos',
};

// Pesos de minería: idénticos a los del contrato WhaTakaMiningRewards.
const WEIGHTS = { relay: 5n, store: 8n, uptime: 1n, call: 10n, reputation: 3n };

// ABI mínima del contrato para reclamar la recompensa.
const MINING_ABI = [
  'function claimMiningReward(bytes32 reportHash, uint256 relayUnits, uint256 storeUnits, uint256 uptimeUnits, uint256 callUnits, uint256 reputationUnits, uint256 deadline, bytes signature)',
  'function rewardFor(uint256 relayUnits, uint256 storeUnits, uint256 uptimeUnits, uint256 callUnits, uint256 reputationUnits) view returns (uint256)',
  'function rewardPool() view returns (uint256)',
];

const params = new URLSearchParams(location.search);

// Un enlace de invitación (?ref=<Peer ID>) se guarda para registrarlo cuando
// exista la identidad, y se quita de la barra de direcciones.
const refParam = params.get('ref');
if (refParam && /^wt1[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(refParam)) {
  localStorage.setItem(STORE.padrino, JSON.stringify(refParam));
  params.delete('ref');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
}

// Un enlace compartido con ?relay=… se adopta y se guarda, y luego se quita de
// la barra de direcciones para que el ajuste "Nodo relé" pueda cambiarlo.
const relayParam = params.get('relay');
if (relayParam) {
  localStorage.setItem(STORE.relay, JSON.stringify(relayParam.replace(/\/+$/, '')));
  params.delete('relay');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
}

const RELAY_URL = window.WhaTakaRelayUrl || {
  normalizar: () => '',
  analizar: () => ({ utilizable: false, url: '', motivo: 'Recarga la app: falta el módulo de configuración del relé' }),
};
const RELAY_OFICIAL = DEFAULT_RELAY;
// En local (desarrollo) sí tiene sentido apuntar a localhost; en el móvil no.
const PAGINA_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const OPCIONES_RELAY = { protocolo: location.protocol, oficial: RELAY_OFICIAL, permiteLocal: PAGINA_LOCAL };

// Una dirección guardada que el navegador no puede usar dejaba la app muda y
// desconectada; aquí se descarta y se avisa.
const relayGuardado = readStore(STORE.relay, '');
const relayAjustado = RELAY_URL.normalizar(relayGuardado, OPCIONES_RELAY);
if (relayGuardado && !relayAjustado) localStorage.removeItem(STORE.relay);
else if (relayGuardado && relayAjustado !== String(relayGuardado).replace(/\/+$/, '')) {
  writeStore(STORE.relay, relayAjustado);
}

let RELAY_HTTP = (relayAjustado || RELAY_OFICIAL).replace(/\/+$/, '');
let RELAY_WS = RELAY_HTTP.replace(/^http/, 'ws');

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

// Etiqueta de fecha estilo WhatsApp para los separadores del chat.
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'HOY';
  if (d.toDateString() === yesterday.toDateString()) return 'AYER';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long' }).toUpperCase();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─────────────────────────────────────────────────────────────
// Fotos de perfil
// ─────────────────────────────────────────────────────────────

const PHOTO_MAX = 220;
const PHOTO_QUALITY = 0.72;
// La foto viaja en la presencia y en los mensajes, así que se mantiene pequeña.
const PHOTO_BUDGET = 16000;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagen no válida'));
    img.src = src;
  });
}

function renderPhoto(img, max, quality) {
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  const out = Math.min(side, max);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, out, out);
  return canvas.toDataURL('image/jpeg', quality);
}

// Recorta al centro, reduce a un cuadrado y baja calidad/tamaño hasta caber.
function fitPhoto(img, budget) {
  let side = PHOTO_MAX;
  for (let round = 0; round < 3; round++) {
    for (let quality = PHOTO_QUALITY; quality >= 0.3; quality -= 0.08) {
      const data = renderPhoto(img, side, quality);
      if (data.length <= budget) return data;
    }
    side = Math.round(side * 0.72);
  }
  return renderPhoto(img, Math.min(side, 96), 0.5);
}

async function compressPhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Selecciona un archivo de imagen');
  const img = await loadImage(await readImage(file));
  return fitPhoto(img, PHOTO_BUDGET);
}

function avatarInner(photo) {
  if (photo) return `<img src="${escapeHtml(photo)}" alt="">`;
  return '<span class="mango-avatar">🥭</span>';
}

function applyAvatar(el, photo) {
  if (el) el.innerHTML = avatarInner(photo);
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

// Firma un texto tal cual (UTF-8) y devuelve la firma en base64. WebCrypto
// devuelve la firma en formato IEEE-P1363, que es lo que verifica el relé.
async function signText(signPriv, text) {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signPriv, enc.encode(text));
  return toB64(sig);
}

// ─────────────────────────────────────────────────────────────
// Estado de la aplicación
// ─────────────────────────────────────────────────────────────

const state = {
  identity: null,
  signKey: null,
  agreeKey: null,
  profile: readStore(STORE.profile, { name: 'Usuario Whataka', photo: null }),
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
  relayIntentos: 0,
  // Web3
  wallet: null,
  miningConfig: null,
  wcProvider: null,
};

// ─────────────────────────────────────────────────────────────
// Web3 (MetaMask, Brave Wallet u otra wallet inyectada)
// ─────────────────────────────────────────────────────────────

// Carga la config de minería del relé (contrato + cadena) una sola vez.
async function loadMiningConfig() {
  if (state.miningConfig) return state.miningConfig;
  try {
    // El plan gratis de Render duerme el relé: sin este tope, un primer clic
    // se quedaría colgado hasta un minuto esperando la respuesta.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${RELAY_HTTP}/api/mining/config`, { signal: ctrl.signal });
    clearTimeout(timer);
    const cfg = await res.json();
    state.miningConfig = cfg && cfg.configured ? cfg : null;
  } catch {
    state.miningConfig = null;
  }
  return state.miningConfig;
}

function updateWalletUI() {
  const status = $('#wallet-status-text');
  const sub = $('#wallet-address-sub');
  if (!status || !sub) return;
  if (state.wallet) {
    const isDirect = Boolean(state.directWallet);
    status.textContent = isDirect ? '⚡ Cartera Directa Conectada' : 'Wallet conectada 🟢';
    sub.textContent = `${shortPeer(state.wallet, 8, 4)} · Toca para ver opciones`;
  } else {
    status.textContent = '⚡ Conectar wallet (Directa)';
    sub.textContent = 'Vincular wallet sin salir de la app para cobrar WTK';
  }
}

// Devuelve el proveedor Web3 disponible. Si hay una cartera directa integrada, esa manda para que el usuario nunca salga de la app.
function getWalletProvider() {
  if (state.directWalletProvider) return state.directWalletProvider;
  if (window.BinanceChain) return window.BinanceChain;
  const injected = window.ethereum;
  if (injected) {
    const list = Array.isArray(injected.providers) ? injected.providers : [];
    if (list.length === 0) return injected;
    return (
      list.find((p) => p.isBraveWallet) ||
      list.find((p) => p.isBinance || p.isBinanceWallet) ||
      list.find((p) => p.isMetaMask) ||
      injected
    );
  }
  return state.wcProvider || null;
}

// Crea un proveedor EIP-1193 completo para la cartera directa integrada,
// permitiendo firmar mensajes y transacciones de minería/donaciones sin apps externas.
function createDirectWalletProvider(walletInstance, rpcUrl, chainId = 80002) {
  const jsonRpc = new ethers.JsonRpcProvider(rpcUrl);
  const connectedSigner = walletInstance.connect(jsonRpc);

  return {
    isDirectWallet: true,
    isMetaMask: false,
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        return [walletInstance.address];
      }
      if (method === 'eth_chainId') {
        return '0x' + Number(chainId).toString(16);
      }
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
        return null;
      }
      if (method === 'personal_sign') {
        const msg = params[0].startsWith('0x') && params[0].length === 42 ? params[1] : params[0];
        const bytes = ethers.isHexString(msg) ? ethers.getBytes(msg) : ethers.toUtf8Bytes(msg);
        return connectedSigner.signMessage(bytes);
      }
      if (method === 'eth_signTypedData_v4') {
        const data = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        return connectedSigner.signTypedData(data.domain, data.types, data.message);
      }
      if (method === 'eth_sendTransaction') {
        const tx = await connectedSigner.sendTransaction(params[0]);
        return tx.hash;
      }
      return jsonRpc.send(method, params || []);
    },
  };
}

function initDirectWalletFromKey(privateKey, chainId = 80002) {
  try {
    const w = new ethers.Wallet(privateKey);
    const meta = KNOWN_CHAINS[chainId] || KNOWN_CHAINS[80002];
    const rpc = meta.rpcs ? meta.rpcs[0] : meta.rpc;
    state.directWallet = w;
    state.directWalletProvider = createDirectWalletProvider(w, rpc, chainId);
    state.wallet = w.address;
    writeStore(STORE.wallet, w.address);
    writeStore(STORE.directKey, privateKey);
    updateWalletUI();
    return w;
  } catch (err) {
    console.error('Error inicializando directWallet', err);
    return null;
  }
}

async function connectWalletDirect() {
  const existingKey = readStore(STORE.directKey, null);
  let w;
  if (existingKey) {
    w = initDirectWalletFromKey(existingKey);
  } else {
    const randomWallet = ethers.Wallet.createRandom();
    w = initDirectWalletFromKey(randomWallet.privateKey);
    toast('¡Cartera directa creada en Whataka!');
  }
  if (w) {
    registrarCartera(w.address).then((ok) => { if (ok) console.info('Cartera registrada en el relé'); });
    updateWalletUI();
    closeModal();
    toast(`Conectado directo: ${shortPeer(w.address, 6, 4)}`);
    return w.address;
  }
  return null;
}

function showWalletDetails() {
  const isDirect = Boolean(state.directWallet);
  openModal('Tu Wallet Conectada', `
    <div style="text-align:center; padding:10px 0;">
      <div style="font-size:36px; margin-bottom:8px;">${isDirect ? '⚡' : '🦊'}</div>
      <h4 style="color:var(--text-strong); margin-bottom:4px;">${isDirect ? 'Cartera Directa Integrada' : 'Wallet Web3'}</h4>
      <p class="mono-text" style="font-size:12px; background:rgba(0,0,0,0.3); padding:8px 10px; border-radius:8px; word-break:break-all; margin:10px 0;">
        ${state.wallet}
      </p>
      <button class="primary-btn" id="btn-copy-wallet" style="margin-bottom:8px;">📋 Copiar Dirección</button>
      ${isDirect ? `
        <button class="ghost-btn" id="btn-show-privkey" style="margin-bottom:8px; width:100%;">🔑 Ver / Exportar Clave Privada</button>
      ` : ''}
      <button class="ghost-btn" id="btn-disconnect-wallet" style="color:var(--danger); border-color:var(--danger); width:100%;">Desconectar Cartera</button>
    </div>
  `);

  $('#btn-copy-wallet').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.wallet);
      toast('Dirección copiada');
    } catch {
      toast(state.wallet);
    }
  });

  if (isDirect) {
    $('#btn-show-privkey').addEventListener('click', () => {
      const key = readStore(STORE.directKey, '');
      openModal('Clave Privada (Respaldar)', `
        <p style="color:var(--danger); font-weight:600; font-size:13px; margin-bottom:8px;">⚠️ Nunca compartas tu clave privada con nadie.</p>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">Puedes importar esta clave en MetaMask cuando quieras para ver tus tokens WTK también allí:</p>
        <p class="mono-text" style="font-size:11px; background:rgba(0,0,0,0.4); padding:10px; border-radius:8px; word-break:break-all; user-select:all;">
          ${key}
        </p>
        <button class="primary-btn" id="btn-copy-privkey" style="margin-top:10px;">📋 Copiar Clave Privada</button>
      `);
      $('#btn-copy-privkey').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(key);
          toast('Clave copiada al portapapeles');
        } catch {
          toast(key);
        }
      });
    });
  }

  $('#btn-disconnect-wallet').addEventListener('click', () => {
    state.wallet = null;
    state.directWallet = null;
    state.directWalletProvider = null;
    localStorage.removeItem(STORE.wallet);
    localStorage.removeItem(STORE.directKey);
    updateWalletUI();
    closeModal();
    toast('Wallet desconectada');
  });
}

// ── WalletConnect (Reown) ───────────────────────────────────────────────────
// Permite conectar MetaMask u otra wallet DESDE el navegador normal del móvil,
// sin abrir la app dentro de MetaMask. Necesita un Project ID gratuito de
// https://cloud.reown.com que se pega en Ajustes → WalletConnect.

function wcProjectId() {
  return (readStore(STORE.wc, DEFAULT_WC_PROJECT_ID) || '').trim();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`no se pudo cargar ${src}`));
    document.head.appendChild(el);
  });
}

// Crea (o reutiliza) el proveedor WalletConnect para la cadena del contrato.
async function openWcSession(chainId) {
  const projectId = wcProjectId();
  if (!projectId) return null;
  if (typeof window.process === 'undefined') {
    window.process = { env: { NODE_ENV: 'production' } };
  }
  await loadScript(WC_BUNDLE);
  const mod = window['@walletconnect/ethereum-provider'];
  if (!mod || !mod.EthereumProvider) throw new Error('WalletConnect no cargó');

  const id = Number(chainId) || 80002;
  const meta = KNOWN_CHAINS[id] || KNOWN_CHAINS[80002];
  const provider = await mod.EthereumProvider.init({
    projectId,
    chains: [id],
    optionalChains: [id],
    showQrModal: true,
    rpcMap: { [id]: meta.rpc },
    metadata: {
      name: 'Whataka',
      description: 'Mensajería P2P cifrada y minería WTK',
      url: location.origin,
      icons: [`${location.origin}/icons/icon-192.png`],
    },
  });
  state.wcProvider = provider;
  return provider;
}

// Abre Whataka dentro de la app de MetaMask (deep link).
function openInMetaMask() {
  const target = location.href.replace(/^https?:\/\//, '');
  window.location.href = METAMASK_DEEPLINK + target;
}

async function connectWallet() {
  if (state.wallet) {
    showWalletDetails();
    return state.wallet;
  }

  const injected = window.ethereum;

  openModal('Conectar Cartera Web3', `
    <div style="display:flex; flex-direction:column; gap:12px; padding:6px 0;">
      <p style="font-size:13px; color:var(--text-muted); line-height:1.4;">
        Conéctate <strong>directamente sin salir de Whataka</strong> para recibir y reclamar tus tokens WTK.
      </p>

      <!-- Opción 1: Cartera Directa Integrada (Sin salir de la app) -->
      <div style="background:var(--bg-card); border:1px solid var(--accent); border-radius:12px; padding:12px; text-align:left;">
        <h4 style="color:var(--text-strong); font-size:14px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          <span style="color:var(--accent); font-size:16px;">⚡</span> Cartera Directa Integrada <span style="font-size:10px; background:var(--accent); color:#fff; padding:2px 6px; border-radius:10px;">Recomendada</span>
        </h4>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
          Crea o activa tu cartera en 1 toque. Cero apps externas, cero inicios de sesión, 100% dentro de Whataka.
        </p>
        <button class="primary-btn" id="btn-wallet-instant" style="width:100%; padding:11px;">
          ⚡ Conectar Directo (1 toque)
        </button>
      </div>

      <!-- Opción 2: Importar cuenta o clave de MetaMask -->
      <div style="background:var(--bg-card); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px; text-align:left;">
        <h4 style="color:var(--text-strong); font-size:13.5px; margin-bottom:4px;">
          🔑 Importar cuenta o clave de MetaMask
        </h4>
        <p style="font-size:11.5px; color:var(--text-muted); margin-bottom:8px;">
          Pega tu clave privada (o dirección) para usar tu cuenta directamente aquí sin salirte.
        </p>
        <input class="modal-input" id="input-import-wallet" placeholder="0x... (clave privada o dirección)" style="margin-bottom:8px;">
        <button class="ghost-btn" id="btn-import-wallet" style="width:100%; padding:10px;">
          Importar y Conectar
        </button>
      </div>

      ${injected ? `
      <!-- Opción 3: Extensión inyectada si existe -->
      <button class="ghost-btn" id="btn-wallet-injected" style="width:100%; padding:10px;">
        🦊 Conectar Extensión del Navegador (${walletName(injected)})
      </button>
      ` : ''}

      <!-- Opción alternativa: abrir en app MetaMask -->
      <p style="font-size:11px; color:var(--text-dim); text-align:center; margin-top:4px;">
        ¿Prefieres abrir la app externa de MetaMask? 
        <a href="#" id="link-open-mm" style="color:var(--accent); text-decoration:underline;">Abrir en MetaMask</a>
      </p>
    </div>
  `);

  $('#btn-wallet-instant').addEventListener('click', async () => {
    closeModal();
    await connectWalletDirect();
  });

  $('#btn-import-wallet').addEventListener('click', async () => {
    const val = $('#input-import-wallet').value.trim();
    if (!val) {
      toast('Ingresa una clave privada o dirección');
      return;
    }
    const cleanKey = val.startsWith('0x') ? val : '0x' + val;
    if (cleanKey.length === 66 && /^0x[0-9a-fA-F]{64}$/.test(cleanKey)) {
      const w = initDirectWalletFromKey(cleanKey);
      if (w) {
        registrarCartera(w.address).then((ok) => { if (ok) console.info('Registrada en relé'); });
        updateWalletUI();
        closeModal();
        toast(`Conectado directo: ${shortPeer(w.address, 6, 4)}`);
      } else {
        toast('Clave privada inválida');
      }
      return;
    }
    if (ethers.isAddress(val)) {
      state.wallet = ethers.getAddress(val);
      writeStore(STORE.wallet, state.wallet);
      updateWalletUI();
      closeModal();
      toast(`Dirección vinculada: ${shortPeer(state.wallet, 6, 4)}`);
      return;
    }
    toast('Formato no reconocido (debe ser clave privada o dirección 0x...)');
  });

  if (injected) {
    $('#btn-wallet-injected').addEventListener('click', async () => {
      closeModal();
      await connectInjectedWallet(injected);
    });
  }

  $('#link-open-mm').addEventListener('click', (e) => {
    e.preventDefault();
    openInMetaMask();
  });

  return null;
}

async function connectInjectedWallet(wallet) {
  try {
    const cfg = await loadMiningConfig();
    const chainId = cfg ? cfg.chainId : 80002;
    const provider = new ethers.BrowserProvider(wallet);
    const accounts = await provider.send('eth_requestAccounts', []);
    const address = accounts && accounts[0];
    if (!address) throw new Error('sin cuentas');

    const current = Number(await provider.send('eth_chainId', []));
    if (current !== Number(chainId)) {
      await ensureChain(wallet, chainId);
    }

    state.wallet = address;
    writeStore(STORE.wallet, address);
    updateWalletUI();
    registrarCartera(address).then((ok) => { if (ok) console.info('Cartera registrada en el relé'); });
    toast(`Wallet conectada (${walletName(wallet)})`);
    return address;
  } catch (err) {
    console.warn('Wallet', err);
    if (err && err.code === 4001) toast('Conexión cancelada');
    else toast('No se pudo conectar la wallet');
    return null;
  }
}

// Nombre de la wallet para los mensajes, según lo que anuncie el proveedor.
function walletName(provider) {
  if (!provider) return 'wallet';
  if (provider.isBraveWallet) return 'Brave Wallet';
  if (provider.isMetaMask) return 'MetaMask';
  if (provider.isBinance || provider.isBinanceWallet) return 'Binance Wallet';
  if (provider.isWalletConnect) return 'WalletConnect';
  return 'wallet';
}

// Metadatos de las redes conocidas, para poder AÑADIRLAS a MetaMask si el
// usuario no las tiene. `wallet_switchEthereumChain` solo funciona si la red
// ya existe en la wallet; si no, hay que llamar antes a wallet_addEthereumChain.
const KNOWN_CHAINS = {
  56: {
    name: 'BNB Smart Chain',
    rpc: 'https://bsc-dataseed.binance.org',
    symbol: 'BNB',
    explorer: 'https://bscscan.com',
  },
  97: {
    name: 'BNB Smart Chain Testnet',
    rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545',
    symbol: 'tBNB',
    explorer: 'https://testnet.bscscan.com',
  },
  137: {
    name: 'Polygon',
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    symbol: 'POL',
    explorer: 'https://polygonscan.com',
  },
  80002: {
    name: 'Polygon Amoy',
    rpc: 'https://polygon-amoy-bor-rpc.publicnode.com',
    // El RPC oficial (rpc-amoy.polygon.technology) ya no existe (el dominio no
    // resuelve) y MetaMask lo trae por defecto, dejando la wallet colgada. Se
    // listan varios RPC que funcionan; la wallet usa el primero y prueba el resto.
    rpcs: [
      'https://polygon-amoy-bor-rpc.publicnode.com',
      'https://polygon-amoy.drpc.org',
      'https://polygon-amoy.api.onfinality.io/public',
      'https://polygon-amoy-public.nodies.app',
      'https://80002.rpc.thirdweb.com',
    ],
    symbol: 'POL',
    explorer: 'https://amoy.polygonscan.com',
  },
};

// Cambia (o añade) la red en la wallet para que coincida con el contrato.
async function ensureChain(wallet, chainId) {
  const hex = '0x' + Number(chainId).toString(16);
  try {
    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    });
    return true;
  } catch (err) {
    // 4902 = la wallet no conoce esa red; la añadimos.
    const code = err && err.code;
    const meta = KNOWN_CHAINS[Number(chainId)];
    if ((code === 4902 || code === -32603) && meta) {
      try {
        await wallet.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: hex,
            chainName: meta.name,
            nativeCurrency: { name: meta.symbol, symbol: meta.symbol, decimals: 18 },
            rpcUrls: meta.rpcs || [meta.rpc],
            blockExplorerUrls: [meta.explorer],
          }],
        });
        return true;
      } catch {
        toast(`No se pudo añadir la red ${meta.name} en tu wallet`);
        return false;
      }
    }
    if (code === 4001) return false; // el usuario canceló
    toast(`Cambia tu wallet a la red ${chainId}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Interfaz
// ─────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Timbre de llamada entrante, generado con WebAudio (sin archivos externos).
let ringCtx = null;
let ringTimer = null;
let vibrarTimer = null;
let tituloAntesDeLlamar = null;

// El navegador deja el AudioContext en pausa hasta que el usuario toca algo, así
// que una llamada entrante sin gesto previo entraba en silencio. Se desbloquea
// en el primer toque de la sesión.
function desbloquearAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ringCtx = ringCtx || new AC();
    if (ringCtx.state === 'suspended') ringCtx.resume().catch(() => {});
  } catch {}
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, desbloquearAudio, { once: true, passive: true }));

function ringtone() {
  stopRingtone();
  desbloquearAudio();
  try {
    if (!ringCtx) return;
    const sonar = () => {
      const osc = ringCtx.createOscillator();
      const gain = ringCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, ringCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ringCtx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ringCtx.currentTime + 0.5);
      osc.connect(gain).connect(ringCtx.destination);
      osc.start();
      osc.stop(ringCtx.currentTime + 0.55);
    };
    sonar();
    ringTimer = setInterval(sonar, 1600);
  } catch {}
}

// En móvil el aviso del sistema y la vibración llegan aunque la pantalla esté
// apagada; el timbre del navegador no.
function vibrarTimbre() {
  if (typeof navigator.vibrate !== 'function') return;
  const patron = [500, 350, 500, 350, 500];
  navigator.vibrate(patron);
  vibrarTimer = setInterval(() => navigator.vibrate(patron), 2500);
}

function avisarLlamadaEntrante(from, video) {
  tituloAntesDeLlamar = tituloAntesDeLlamar || document.title;
  document.title = video ? '📹 Videollamada entrante' : '📞 Llamada entrante';
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  const peer = state.peers[from] || {};
  const options = {
    body: `${peer.name || 'Alguien'} te llama${video ? ' por vídeo' : ''}`,
    tag: `wt-call-${from}`,
    requireInteraction: true,
  };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification('Whataka', options))
      .catch(() => { try { new Notification('Whataka', options); } catch { /* ignorado */ } });
    return;
  }
  try { new Notification('Whataka', options); } catch { /* ignorado */ }
}

function stopRingtone() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  if (vibrarTimer) clearInterval(vibrarTimer);
  vibrarTimer = null;
  if (typeof navigator.vibrate === 'function') navigator.vibrate(0);
  if (tituloAntesDeLlamar !== null) {
    document.title = tituloAntesDeLlamar;
    tituloAntesDeLlamar = null;
  }
}

function openModal(title, html) {
  // Agranda el emoji inicial del titulo (p. ej. "🤲🏽") sin tocar el resto.
  const el = $('#modal-title');
  const m = String(title).match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)\s+([\s\S]*)$/u);
  if (m) el.innerHTML = `<span class="emoji-big">${m[1]}</span> ${escapeHtml(m[2])}`;
  else el.textContent = title;
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

  // Alternar barras de cabecera y buscador según la pestaña activa estilo QuantumCall / Whataka
  const actDash = $('#bar-actions-dashboard');
  const actChats = $('#bar-actions-chats');
  const actSettings = $('#bar-actions-settings');
  const searchBox = $('#dash-search-container');

  if (actDash && actChats && actSettings) {
    actDash.style.display = (target === 'tab-dashboard') ? 'flex' : 'none';
    actChats.style.display = (target === 'tab-chats') ? 'flex' : 'none';
    actSettings.style.display = (target === 'tab-settings') ? 'flex' : 'none';
    if (target !== 'tab-dashboard' && target !== 'tab-chats' && target !== 'tab-settings') {
      actDash.style.display = 'flex';
    }
  }

  if (searchBox) {
    searchBox.style.display = (target === 'tab-chats') ? 'flex' : 'none';
  }

  if (target === 'tab-dashboard') renderDashboard();
  if (target === 'tab-chats') renderChats();
  if (target === 'tab-calls') renderCalls();
  if (target === 'tab-status') renderStatus();
}

function renderDashboard() {
  let unreadCount = 0;
  let lastMessageSnippet = 'New from Whataka';
  const peers = Object.keys(state.messages || {});
  peers.forEach((p) => {
    const msgs = state.messages[p] || [];
    msgs.forEach((m) => {
      if (m.from !== state.identity.peerId && !m.read) unreadCount++;
    });
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      if (last.text) lastMessageSnippet = last.text.slice(0, 24);
    }
  });

  const badge = $('#dash-msg-badge');
  if (badge) {
    badge.textContent = unreadCount > 0 ? String(unreadCount) : (peers.length > 0 ? String(peers.length) : '3');
  }
  const sub = $('#dash-msg-sub');
  if (sub && lastMessageSnippet) {
    sub.textContent = lastMessageSnippet;
  }

  const syncList = $('#dash-sync-list');
  if (syncList && state.peers) {
    const knownPeers = Object.keys(state.peers).filter((id) => id !== state.identity.peerId);
    if (knownPeers.length > 0) {
      syncList.innerHTML = knownPeers.slice(0, 2).map((id) => {
        const p = state.peers[id] || {};
        const name = p.name || `Peer ${shortPeer(id, 6, 4)}`;
        const initial = (name || 'P').charAt(0).toUpperCase();
        const msgs = state.messages[id] || [];
        const lastMsg = msgs.length ? (msgs[msgs.length - 1].text || 'Archivo adjunto') : 'Recent files messages at…';
        return `
          <div class="dash-sync-item" data-peer="${id}">
            <div class="sync-avatar">${initial}</div>
            <div class="dash-sync-info">
              <h5>${escapeHtml(name)}</h5>
              <p>${escapeHtml(lastMsg)}</p>
            </div>
          </div>
        `;
      }).join('');
      syncList.querySelectorAll('.dash-sync-item').forEach((row) => {
        row.addEventListener('click', () => openChat(row.dataset.peer));
      });
    }
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.toggle('active', s.id === id);
  });
  if (id !== 'chat-screen') toggleEmojiPanel(false);
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
      return { id, name, last, photo: peer.photo };
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
        ${avatarInner(r.photo)}
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

  let lastDay = '';
  const bubbles = msgs.map((m) => {
    const out = m.from === state.identity.peerId;
    const day = new Date(m.ts).toDateString();
    let chip = '';
    if (day !== lastDay) {
      lastDay = day;
      chip = `<span class="date-chip">${dayLabel(m.ts)}</span>`;
    }
    const tick = out ? tickDeEntrega(m) : '';
    const sticker = m.kind === 'sticker';
    return `${chip}
      <div class="msg-bubble ${out ? 'out' : 'in'}${sticker ? ' sticker' : ''}">
        ${renderBubbleContent(m)}
        <span class="msg-time">${timeLabel(m.ts)}${tick}</span>
      </div>`;
  }).join('');
  area.innerHTML = bubbles;
  area.scrollTop = area.scrollHeight;
}

// Dibuja el cuerpo de una burbuja según el tipo de contenido.
// El tick dice lo que de verdad pasó: en cola, entregado o fallido.
function tickDeEntrega(m) {
  if (m.delivery === 'fallido') return '<span class="tick fail"><i class="fa-solid fa-triangle-exclamation"></i></span>';
  if (m.delivery === 'entregado') return '<span class="tick read"><i class="fa-solid fa-check-double"></i></span>';
  if (m.delivery === 'pendiente') return '<span class="tick"><i class="fa-regular fa-clock"></i></span>';
  return '<span class="tick"><i class="fa-solid fa-check"></i></span>';
}

function renderBubbleContent(m) {
  const cap = m.caption ? `<span class="bubble-cap">${escapeHtml(m.caption)}</span>` : '';
  switch (m.kind) {
    case 'image':
      return `<div class="bubble-media"><img src="${escapeHtml(m.data)}" alt="Imagen"></div>${cap}`;
    case 'audio':
      return `<audio controls preload="metadata" src="${escapeHtml(m.data)}"></audio>${cap}`;
    case 'video':
      return `<div class="bubble-media"><video controls preload="metadata" style="width:100%;display:block" src="${escapeHtml(m.data)}"></video></div>${cap}`;
    case 'sticker':
      return renderSticker(m.data);
    case 'location':
      return `<div class="bubble-loc"><i class="fa-solid fa-location-dot"></i><div>${escapeHtml(m.data)}</div></div>${cap}`;
    case 'contact':
      return `<div class="bubble-card"><h5><i class="fa-solid fa-address-card"></i> ${escapeHtml(m.data.name)}</h5><div style="font-size:12px;color:var(--text-muted)">${escapeHtml(m.data.peerId)}</div></div>${cap}`;
    case 'document':
      return `<div class="bubble-card"><h5><i class="fa-solid fa-file-lines"></i> ${escapeHtml(m.data.name)}</h5><div style="font-size:12px;color:var(--text-muted)">${escapeHtml(m.data.size || '')}</div></div>${cap}`;
    case 'poll':
      return `<div class="bubble-card"><h5><i class="fa-solid fa-square-poll-vertical"></i> ${escapeHtml(m.data.question)}</h5><ul>${m.data.options.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}</ul></div>${cap}`;
    case 'event':
      return `<div class="bubble-card"><h5><i class="fa-solid fa-calendar-days"></i> ${escapeHtml(m.data.title)}</h5><div style="font-size:12.5px;color:var(--text-muted)">${escapeHtml(m.data.date)}${m.data.time ? ' · ' + escapeHtml(m.data.time) : ''}</div></div>${cap}`;
    default:
      return escapeHtml(m.text || '');
  }
}

function renderProfile() {
  const id = state.identity.peerId;
  $('#display-username').textContent = state.profile.name;
  $('#display-peer-short').textContent = `Peer ID: ${shortPeer(id, 14, 8)}`;
  $('#full-peer-display').textContent = id;
  $('#relay-display').textContent = RELAY_HTTP;
  const wcEl = $('#wc-display');
  if (wcEl) wcEl.textContent = wcProjectId() ? 'Project ID configurado' : 'Sin Project ID (toca para añadir)';
  applyAvatar($('#my-avatar-media'), state.profile.photo);
  const status = $('#photo-status');
  if (status) status.textContent = state.profile.photo
    ? 'Toca para cambiar o quitar tu foto'
    : 'Añade una foto que verán tus contactos';
}

function renderStatus() {
  const feed = $('#status-feed');
  const items = readStore(STORE.status, []);
  const base = `
    <div class="status-item">
      <div class="avatar ring-purple">🛡️</div>
      <div>
        <h4>Sistema Whataka P2P</h4>
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

// Historial de llamadas (se guarda al iniciar cada llamada o videollamada).
function renderCalls() {
  const list = $('#calls-list');
  if (!list) return;
  const calls = readStore(STORE.calls, []);
  if (!calls.length) {
    const ids = Object.keys(state.peers);
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-phone-volume"></i>
        Aún no hay llamadas.<br>Abre un chat y toca <strong>📞</strong> o <strong>🎥</strong>.
      </div>` +
      ids.map((id) => {
        const peer = state.peers[id] || {};
        const name = peer.name || `Peer ${shortPeer(id, 8, 4)}`;
        return `
          <div class="call-row" data-peer="${escapeHtml(id)}">
            <div class="avatar purple-bg">${avatarInner(peer.photo)}</div>
            <div class="call-info">
              <h4>${escapeHtml(name)}</h4>
              <p><i class="fa-solid fa-phone"></i> Llamada P2P cifrada</p>
            </div>
            <button class="call-action" title="Llamar"><i class="fa-solid fa-phone"></i></button>
          </div>`;
      }).join('');
    bindCallRows();
    return;
  }
  list.innerHTML = calls.map((c) => `
    <div class="call-row" data-peer="${escapeHtml(c.peerId)}">
      <div class="avatar purple-bg">${avatarInner(c.photo)}</div>
      <div class="call-info">
        <h4>${escapeHtml(c.name)}</h4>
        <p class="${c.missed ? 'missed' : ''}">
          <i class="fa-solid fa-${c.video ? 'video' : 'phone'}${c.missed ? '-slash' : ''}"></i>
          ${timeLabel(c.ts)}
        </p>
      </div>
      <button class="call-action" title="Llamar"><i class="fa-solid fa-phone"></i></button>
    </div>`).join('');
  bindCallRows();
}

function bindCallRows() {
  document.querySelectorAll('#calls-list .call-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.peer;
      if (id) openChat(id);
    });
  });
}

function logCall(peerId, video) {
  const peer = state.peers[peerId] || {};
  const calls = readStore(STORE.calls, []);
  calls.unshift({
    peerId,
    name: peer.name || `Peer ${shortPeer(peerId, 8, 4)}`,
    photo: peer.photo,
    video: !!video,
    missed: false,
    ts: Date.now(),
  });
  writeStore(STORE.calls, calls.slice(0, 60));
  renderCalls();
}
function miningUnits() {
  const uptime = BigInt(Math.floor((Date.now() - state.startedAt) / 60000));
  const store = BigInt(Object.values(state.messages).reduce((n, arr) => n + arr.length, 0));
  return {
    relay: BigInt(state.relayUnits),
    store,
    uptime,
    call: 0n,
    reputation: 0n,
  };
}

function miningScore(units) {
  return units.relay * WEIGHTS.relay
    + units.store * WEIGHTS.store
    + units.uptime * WEIGHTS.uptime
    + units.call * WEIGHTS.call
    + units.reputation * WEIGHTS.reputation;
}

function renderMining() {
  const units = miningUnits();
  state.storeUnits = Number(units.store);
  const score = miningScore(units);

  $('#m-relay').textContent = String(state.relayUnits);
  $('#m-uptime').textContent = String(units.uptime);
  $('#m-store').textContent = String(units.store);
  $('#m-score').textContent = score.toString();

  const badge = $('#node-status');
  if (state.connected) {
    badge.className = 'badge-live';
    badge.textContent = '● NODO ACTIVO EN RED';
  } else {
    badge.className = 'badge-live off';
    badge.textContent = '● RELÉ DESCONECTADO';
  }

  renderNivel();
  renderDonaciones();
  refreshMiningStatus();
}

// Quien paga es el relé, así que la vista enseña sus números en cuanto llegan.
// Los locales se quedan solo como respaldo mientras responde.
async function refreshMiningStatus() {
  try {
    const res = await fetch(`${RELAY_HTTP}/api/mining/status/${state.identity.peerId}`);
    if (!res.ok) return;
    const data = await res.json();
    $('#m-relay').textContent = data.units.relay;
    $('#m-uptime').textContent = data.units.uptime;
    $('#m-store').textContent = data.units.store;
    $('#m-score').textContent = data.score;
  } catch {
    /* sin relé se muestran los números locales */
  }
}

// ─────────────────────────────────────────────────────────────
// Niveles de estatus
// ─────────────────────────────────────────────────────────────

// Puntos propios (pago/actividad). Los referidos NO se suman aquí porque su
// escala es distinta; suben el nivel por su cuenta (ver nivelActual()).
function puntosNivel() {
  return Number(readStore(STORE.nivel, 0)) || 0;
}

// Nivel efectivo: el MEJOR entre el que dan los puntos (pago/actividad) y el
// que dan los referidos. Así quien invita sube el MISMO nivel (Bronce, Plata,
// Oro, Platino, Diamante) sin pagar nada.
function nivelActual() {
  const api = window.WhaTakaNiveles;
  if (!api) return null;
  let nivel = api.nivelDe(puntosNivel());
  const ref = apiReferidos();
  if (ref) {
    const e = ref.estatusPorInvitados(misInvitados());
    if (e.nivelId) {
      const porRef = api.NIVELES.find((n) => n.id === e.nivelId);
      if (porRef && porRef.puntos > nivel.puntos) nivel = porRef;
    }
  }
  return nivel;
}

function sumarPuntos(extra) {
  const total = puntosNivel() + Math.max(0, Number(extra) || 0);
  writeStore(STORE.nivel, total);
  renderNivel();
  return total;
}

function renderNivel() {
  const api = window.WhaTakaNiveles;
  const badge = $('#nivel-badge');
  if (!api || !badge) return;

  const nivel = nivelActual();
  badge.textContent = `${nivel.emoji} ${nivel.nombre}`;
  badge.style.color = nivel.color;

  const texto = $('#nivel-progreso-texto');
  const barra = $('#nivel-progreso-barra');
  const ref = apiReferidos();
  const nInv = misInvitados();
  // Si los referidos ya nos dan un nivel, mostramos el progreso por invitados;
  // si no, el de puntos. Así el aviso coincide con la vía que manda.
  const viaRef = ref && ref.estatusPorInvitados(nInv).nivelId
    && api.NIVELES.find((x) => x.id === ref.estatusPorInvitados(nInv).nivelId) === nivel;

  if (viaRef) {
    const p = ref.progresoEstatus(nInv);
    if (texto) {
      texto.textContent = p.siguiente
        ? `${nInv} invitados · ${p.faltan} para ${p.siguiente.nombre}`
        : `${nInv} invitados · estatus máximo`;
    }
    if (barra) barra.style.width = `${p.porcentaje}%`;
    return;
  }

  const p = api.progreso(puntosNivel());
  if (texto) {
    texto.textContent = p.siguiente
      ? `${puntosNivel()} puntos · ${p.faltan} para ${p.siguiente.nombre}`
      : `${puntosNivel()} puntos · nivel máximo`;
  }
  if (barra) barra.style.width = `${p.porcentaje}%`;
}

function verNiveles() {
  const api = window.WhaTakaNiveles;
  if (!api) return;
  const puntos = puntosNivel();
  const actual = nivelActual().id;
  const filas = api.todosLosNiveles().map((n) => {
    const activo = n.id === actual ? ' · ← estás aquí' : '';
    const beneficios = n.beneficios.map((b) => `· ${b}`).join('<br>');
    const precio = n.precioUsd === 0 ? 'Gratis' : `${n.precioUsd} $ (pago único)`;
    return `
      <div style="border-left:4px solid ${n.color}; padding:8px 12px; margin:8px 0; background:rgba(255,255,255,.05); border-radius:6px;">
        <strong style="color:${n.color}">${n.emoji} ${n.nombre}${activo}</strong>
        <div style="font-size:12px; opacity:.85; margin:4px 0;">${n.puntos} puntos · ${precio}</div>
        <div style="font-size:13px;">${beneficios}</div>
      </div>`;
  }).join('');
  const ref = apiReferidos();
  const filasRef = ref ? ref.ESTATUS.filter((e) => e.nivelId).map((e) => {
    const activo = e.nivelId === actual ? ' · ← estás aquí' : '';
    return `<div style="font-size:13px; margin:4px 0; color:${e.color};">${e.emoji} <strong>${e.invitados} invitados</strong> → ${e.nombre}${activo}</div>`;
  }).join('') : '';
  openModal('Niveles Whataka', `
    <p style="font-size:13px; opacity:.85; margin-bottom:8px;">
      Sube de nivel con un pago único, o <strong>invitando gente</strong> si no puedes pagar.
      Con el dinero se compran WTK y se queman: menos tokens en circulación y más valor para todos.
    </p>
    ${filas}
    ${filasRef ? `<h5 class="sub-header">Subir de nivel invitando (sin pagar)</h5>${filasRef}` : ''}
    <p style="font-size:12px; opacity:.7; margin-top:10px;">
      Los niveles no son una inversión ni prometen ganancias: son ventajas dentro de la app.
    </p>`);
}

// ─────────────────────────────────────────────────────────────
// Referidos: compartir la app y subir de nivel sin pagar
// ─────────────────────────────────────────────────────────────

// Invitar no da dinero ni tokens: solo estatus y puntos de nivel. Es la vía de
// quien no puede pagar para llegar a Bronce, Plata, Oro, Platino o Diamante.

function apiReferidos() {
  return window.WhaTakaReferidos;
}

// Dirección donde vive la app, sin index.html ni barra final.
function baseUrlApp() {
  return location.href.replace(/[?#].*$/, '').replace(/index\.html$/, '').replace(/\/+$/, '');
}

function misInvitados() {
  return Number(readStore(STORE.invitados, 0)) || 0;
}

// Guarda el conteo de invitados y los puntos que aportan a los niveles.
function guardarInvitados(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  writeStore(STORE.invitados, k);
  const api = apiReferidos();
  if (api) writeStore(STORE.refPuntos, api.puntosPorInvitados(k));
}

let refPosicion = null;

// Pide al relé cuántos invitados tengo y en qué puesto voy.
async function refrescarReferidos() {
  if (!state.identity) return;
  try {
    const res = await fetch(`${RELAY_HTTP}/api/referrals/${state.identity.peerId}`);
    if (!res.ok) return;
    const data = await res.json();
    refPosicion = data.posicion;
    guardarInvitados(data.invitados);
    renderNivel();
    pintarResumenReferidos();
  } catch {
    /* sin conexión: seguimos con lo guardado */
  }
}

function pintarResumenReferidos() {
  const el = $('#ref-resumen');
  const api = apiReferidos();
  if (!el || !api) return;
  const n = misInvitados();
  const e = api.estatusPorInvitados(n);
  el.textContent = `${e.emoji} ${e.nombre} · ${n} invitado${n === 1 ? '' : 's'} · ${api.puntosPorInvitados(n)} puntos`;
}

// Si llegamos por un enlace de invitación, avisamos al relé firmando con
// nuestra clave. Solo se hace una vez por instalación.
async function registrarPadrino() {
  const padrino = readStore(STORE.padrino, null);
  if (!padrino || readStore(STORE.padrinoHecho, false)) return;
  if (!state.identity || padrino === state.identity.peerId) {
    localStorage.removeItem(STORE.padrino);
    return;
  }
  const api = apiReferidos();
  if (!api) return;
  try {
    const mensaje = api.mensajeInvitacion(state.identity.peerId, padrino);
    const signature = await signText(state.signKey, mensaje);
    const res = await fetch(`${RELAY_HTTP}/api/referrals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invitado: state.identity.peerId,
        padrino,
        signPub: state.identity.signPub,
        signature,
      }),
    });
    // 409 = ya tenía padrino: no reintentamos.
    if (res.ok || res.status === 409) {
      writeStore(STORE.padrinoHecho, true);
      localStorage.removeItem(STORE.padrino);
    }
  } catch {
    /* se reintentará en el próximo arranque */
  }
}

function verReferidos() {
  const api = apiReferidos();
  if (!api) return;
  const peerId = state.identity.peerId;
  const enlace = api.enlaceInvitacion(baseUrlApp(), peerId);
  const codigo = api.codigoInvitacion(peerId);
  const n = misInvitados();
  const e = api.estatusPorInvitados(n);
  const p = api.progresoEstatus(n);

  const filas = api.ESTATUS.map((s) => {
    const activo = s.id === e.id ? ' · ← estás aquí' : '';
    const nota = s.invitados === 0
      ? 'Empieza a invitar'
      : `${s.invitados}+ invitados${s.nivelId ? ` → nivel ${s.nombre}` : ''}`;
    return `
      <div style="border-left:4px solid ${s.color}; padding:6px 12px; margin:6px 0; background:rgba(255,255,255,.05); border-radius:6px;">
        <strong style="color:${s.color}">${s.emoji} ${s.nombre}${activo}</strong>
        <div style="font-size:12px; opacity:.85;">${nota}</div>
      </div>`;
  }).join('');

  const progresoTexto = p.siguiente
    ? `Te faltan ${p.faltan} invitado${p.faltan === 1 ? '' : 's'} para ${p.siguiente.emoji} ${p.siguiente.nombre}`
    : '¡Estás en el estatus máximo!';
  const puesto = refPosicion ? ` · puesto #${refPosicion}` : '';

  openModal('Invita y sube de nivel', `
    <p style="font-size:13px; opacity:.9; margin-bottom:6px;">
      Comparte Whataka con quien quieras. <strong>Aquí no se gana dinero</strong>: subes de
      estatus y de nivel. Cada persona que entre con tu enlace te da
      <strong>${api.PUNTOS_POR_INVITADO} puntos</strong>, así que puedes llegar a
      Bronce, Plata, Oro, Platino o Diamante <strong>sin pagar nada</strong>.
    </p>

    <button class="primary-btn" id="ref-manual" style="width:100%; margin:6px 0 12px;">
      <i class="fa-solid fa-book-open"></i> Abrir el manual de uso
    </button>

    <div style="text-align:center; margin:12px 0;">
      <div style="font-size:26px; color:${e.color};">${e.emoji} ${e.nombre}</div>
      <div style="font-size:12px; opacity:.8;">${e.frase}</div>
      <div style="font-size:13px; margin-top:6px;">${n} invitado${n === 1 ? '' : 's'} · ${api.puntosPorInvitados(n)} puntos${puesto}</div>
      <div style="height:8px; background:rgba(255,255,255,.12); border-radius:4px; margin:8px 0 4px; overflow:hidden;">
        <div style="height:100%; width:${p.porcentaje}%; background:linear-gradient(90deg,${e.color},${(p.siguiente && p.siguiente.color) || e.color});"></div>
      </div>
      <div style="font-size:12px; opacity:.8;">${progresoTexto}</div>
    </div>

    <label style="font-size:12px; opacity:.8;">Tu enlace de invitación</label>
    <div class="mono-text" id="ref-enlace" style="font-size:12px; word-break:break-all; background:rgba(0,0,0,.25); padding:8px; border-radius:6px; margin:4px 0 10px;">${escapeHtml(enlace)}</div>

    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
      <button class="primary-btn" id="ref-compartir" style="flex:1; min-width:140px;">
        <i class="fa-solid fa-share-nodes"></i> Compartir enlace
      </button>
      <button class="primary-btn" id="ref-copiar" style="flex:1; min-width:120px;">
        <i class="fa-solid fa-copy"></i> Copiar
      </button>
      <button class="primary-btn" id="ref-codigo" style="flex:1; min-width:120px;">
        <i class="fa-solid fa-hashtag"></i> Código: ${escapeHtml(codigo)}
      </button>
    </div>

    <h5 class="sub-header">Estatus por invitaciones</h5>
    ${filas}

    <p style="font-size:12px; opacity:.7; margin-top:10px;">
      Los referidos solo dan estatus y posición dentro de Whataka: no son una inversión,
      no dan tokens ni dinero y no prometen ganancias.
    </p>`);

  $('#ref-manual').addEventListener('click', () => {
    window.open(new URL('manual.html', location.href).href, '_blank', 'noopener');
  });

  const compartir = async () => {
    const texto = api.textoCompartir(peerId, baseUrlApp());
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Whataka', text: texto, url: enlace });
        return;
      } catch {
        /* el usuario canceló o no se puede: probamos copiar */
      }
    }
    try {
      await navigator.clipboard.writeText(texto);
      toast('Enlace copiado para compartir');
    } catch {
      toast(enlace);
    }
  };
  const btnCompartir = $('#ref-compartir');
  const btnCopiar = $('#ref-copiar');
  const btnCodigo = $('#ref-codigo');
  if (btnCompartir) btnCompartir.addEventListener('click', compartir);
  if (btnCopiar) btnCopiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(enlace);
      toast('Enlace copiado');
    } catch {
      toast(enlace);
    }
  });
  if (btnCodigo) btnCodigo.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      toast('Código copiado');
    } catch {
      toast(codigo);
    }
  });

  refrescarReferidos();
}

// ─────────────────────────────────────────────────────────────
// Donaciones finalistas (pagar Render + Porkbun)
// ─────────────────────────────────────────────────────────────

// Enlace de cobro de donaciones en dinero (PayPal.me del creador).
const DONACION_PAYPAL = 'https://www.paypal.me/whataka';

// Donaciones en WTK: transferencia ERC-20 directa, sin custodia.
const WTK_CONTRACT = '0x57C997a406a0295dEb8A16117969873AAf4B41Fb';

// Dirección del token WTK en uso. Se prefiere la que anuncia el relé (así al
// pasar de Amoy a Polygon real solo hay que cambiar MINING_CONTRACT en Render,
// sin tocar la app). Si el relé aún no responde, se usa la de Amoy.
function tokenWtk() {
  const cfg = state.miningConfig;
  return (cfg && cfg.contract) ? cfg.contract : WTK_CONTRACT;
}

// Red donde vive el WTK, según el relé.
function redWtk() {
  const cfg = state.miningConfig;
  const id = cfg ? Number(cfg.chainId) : 80002;
  return KNOWN_CHAINS[id] || { name: `red ${id}`, chainId: id };
}

// Respaldo por si el relé no publica cartera de donaciones. El destino real lo
// fija el relé con la variable DONATION_WALLET (ver /api/donations/config).
const DONACION_CARTERA_RESPALDO = '0xAdd0f33B4680289892F001BAC049b9579548b5d9';

let donacionConfigCache = null;
async function loadDonationConfig() {
  if (donacionConfigCache) return donacionConfigCache;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${RELAY_HTTP}/api/donations/config`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    donacionConfigCache = await res.json();
  } catch (err) {
    console.warn('Donaciones: no se pudo leer la config del relé', err);
    donacionConfigCache = { wallet: null, configured: false };
  }
  return donacionConfigCache;
}

// Dirección a la que van las donaciones (la del administrador).
async function destinoDonaciones() {
  const cfg = await loadDonationConfig();
  return (cfg && cfg.wallet) || DONACION_CARTERA_RESPALDO;
}

// Registra en el relé la cartera del usuario, firmando con su wallet para
// demostrar que es suya. No es obligatorio: si el usuario cancela, no pasa nada.
async function registrarCartera(address) {
  try {
    const api = window.WhaTakaDonaciones;
    if (!api || !api.mensajeRegistroCartera) return false;
    const wallet = getWalletProvider();
    if (!wallet) return false;
    const provider = new ethers.BrowserProvider(wallet);
    const signer = await provider.getSigner();
    const mensaje = api.mensajeRegistroCartera(state.identity.peerId, address);
    const signature = await signer.signMessage(mensaje);
    const res = await fetch(`${RELAY_HTTP}/api/wallets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId: state.identity.peerId, address, signature }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Registro de cartera', err.error || res.status);
      return false;
    }
    return true;
  } catch (err) {
    // El usuario puede rechazar la firma (4001): no es un error que deba molestar.
    if (!err || err.code !== 4001) console.warn('Registro de cartera', err);
    return false;
  }
}
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Envía una donación en WTK desde la wallet del usuario a la cartera del creador.
async function donarEnWtk(wtk) {
  const api = window.WhaTakaDonaciones;
  if (!api) return;
  let wallet = getWalletProvider();
  if (!wallet) {
    const addr = await connectWallet();
    if (!addr) return;
    wallet = getWalletProvider();
  }
  if (!wallet) {
    toast('Necesitas una wallet para donar en WTK');
    return;
  }
  try {
    const cfg = await loadMiningConfig();
    const chainId = cfg ? cfg.chainId : 80002;
    const provider = new ethers.BrowserProvider(wallet);
    const onChain = Number(await provider.send('eth_chainId', []));
    if (onChain !== Number(chainId)) {
      const ok = await ensureChain(wallet, chainId);
      if (!ok) throw new Error('cambia la wallet a la red del WTK');
    }
    const signer = await provider.getSigner();
    const token = new ethers.Contract(tokenWtk(), ERC20_ABI, signer);
    const unidades = api.aUnidadesWtk(wtk);
    const saldo = await token.balanceOf(await signer.getAddress());
    if (saldo < unidades) {
      toast(`No tienes ${api.formatearWtk(wtk)} (tienes ${ethers.formatUnits(saldo, 18)})`);
      return;
    }
    toast(`Enviando ${api.formatearWtk(wtk)}… confirma en tu wallet`);
    const destino = await destinoDonaciones();
    const tx = await token.transfer(destino, unidades);
    toast(`Donación enviada ${tx.hash.slice(0, 12)}… esperando confirmación`);
    await tx.wait();
    toast(`¡Gracias! Donaste ${api.formatearWtk(wtk)} 💚`);
    closeModal();
  } catch (err) {
    console.warn('Donación WTK', err);
    if (err && err.code === 4001) toast('Donación cancelada');
    else toast(`No se pudo donar: ${err.shortMessage || err.message || 'error'}`);
  }
}

function renderDonaciones() {
  const api = window.WhaTakaDonaciones;
  const lbl = $('#donaciones-coste');
  if (!api || !lbl) return;
  const costes = api.todosLosCostes().map((c) => `${c.emoji} ${c.nombre.split(' ')[0]}`).join(' + ');
  lbl.textContent = `${costes}: ${api.formatearUsd(api.costeMensual())}/mes`;
}

function verDonaciones() {
  const api = window.WhaTakaDonaciones;
  if (!api) return;
  const costes = api.todosLosCostes().map((c) => `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,.1);">
      <span>${c.emoji} ${c.nombre}</span>
      <strong>${api.formatearUsd(c.usdMes)}/mes</strong>
    </div>`).join('');
  const botones = api.IMPORTES_SUGERIDOS.map((imp) => `
    <a href="${DONACION_PAYPAL}/${imp}" target="_blank" rel="noopener"
       style="display:block; text-align:center; padding:10px; margin:6px 0; border-radius:8px;
              background:linear-gradient(90deg,#1dcb5d,#15be1c); color:#fff; font-weight:700; text-decoration:none;">
      Donar ${api.formatearUsd(imp)} con PayPal — ${api.textoMeses(imp)}
    </a>`).join('');
  openModal('🤲🏽 Mantén Whataka viva', `
    <p style="font-size:13px; opacity:.9; margin-bottom:10px;">
      Whataka es gratis. Si quieres, puedes ayudar a pagar lo que cuesta mantenerla
      en marcha. <strong>Es 100% voluntario</strong>: si no donas, la app sigue igual.
    </p>
    <div style="background:rgba(255,255,255,.05); border-radius:8px; padding:10px; margin-bottom:12px;">
      ${costes}
      <div style="display:flex; justify-content:space-between; padding-top:8px;">
        <strong>Total para mantenerla</strong>
        <strong style="color:#1dcb5d;">${api.formatearUsd(api.costeMensual())}/mes</strong>
      </div>
    </div>
    <p style="font-size:12px; opacity:.8; margin-bottom:6px;">
      Donación con <strong>PayPal</strong>. Va <strong>directa</strong> a pagar Render (el
      servidor) y Porkbun (el dominio). Sin intermediarios ni comisiones.
    </p>
    ${botones}
    <p style="font-size:12px; opacity:.85; margin:14px 0 4px;">
      ¿Prefieres donar en cripto? La donación en WTK (Polygon) se hace desde la
      cartera, sin custodia, en la Sala de donaciones.
    </p>
    <button class="primary-btn sala-morado" id="donar-ir-sala" style="width:100%;">💜 Donar en WTK (cripto)</button>
    <p style="font-size:11px; opacity:.65; margin-top:12px;">
      Donación voluntaria, no es una inversión ni da ventajas ni promete ganancias.
    </p>`);
  $('#donar-ir-sala').addEventListener('click', () => { closeModal(); abrirSala(); });
}

// ─────────────────────────────────────────────────────────────
// Sala de donaciones (pantalla propia)
// ─────────────────────────────────────────────────────────────
// No se llama "billetera" a propósito: es una sala de donaciones. El envío y la
// recepción son donaciones en WTK (transferencia directa, sin custodia) y el
// cambio a otro token lo hace el usuario en un DEX, nunca la app.

function abrirSala() {
  renderSala();
  pintaDestinoDonaciones();
  showScreen('sala-screen');
}

// Muestra a qué cartera van las donaciones (la del administrador).
async function pintaDestinoDonaciones() {
  const el = $('#sala-destino');
  if (!el) return;
  const dir = await destinoDonaciones();
  el.textContent = `Destino de las donaciones: ${dir}`;
}

function renderSala() {
  const api = window.WhaTakaDonaciones;
  if (!api) return;

  const set = (id, txt) => { const el = $('#' + id); if (el) el.textContent = txt; };
  const lista = (id, pasos) => {
    const el = $('#' + id);
    if (el) el.innerHTML = pasos.map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  };

  set('sala-intro', api.SALA_TEXTO.intro);
  set('sala-legal', api.SALA_TEXTO.avisoLegal);
  set('sala-dex-aviso', api.DEX.aviso);

  const costes = api.todosLosCostes().map((c) => `
    <div class="sala-coste-row">
      <span>${c.emoji} ${c.nombre}</span>
      <strong>${api.formatearUsd(c.usdMes)}/mes</strong>
    </div>`).join('') + `
    <div class="sala-coste-row">
      <strong>Total para mantenerla</strong>
      <strong style="color:#1dcb5d;">${api.formatearUsd(api.costeMensual())}/mes</strong>
    </div>`;
  const box = $('#sala-costes');
  if (box) box.innerHTML = costes;

  lista('sala-guia-enviar', api.GUIA_ENVIAR);
  lista('sala-guia-recibir', api.GUIA_RECIBIR);
  lista('sala-guia-cambiar', api.GUIA_CAMBIAR);

  pintaMiDireccion();
}

// Muestra la dirección de la cartera conectada (para RECIBIR donaciones).
function pintaMiDireccion() {
  const el = $('#sala-mi-dir');
  if (!el) return;
  const btn = $('#sala-conectar');
  if (state.wallet) {
    el.textContent = state.wallet;
    el.style.color = 'var(--purple-glow)';
    if (btn) btn.innerHTML = '✅ Cartera conectada';
  } else {
    el.textContent = 'Conecta tu cartera para ver tu dirección';
    el.style.color = 'var(--text-dim)';
    if (btn) btn.innerHTML = '🦊 Conectar cartera';
  }
}

async function conectarCarteraSala() {
  const addr = state.wallet || (await connectWallet());
  pintaMiDireccion();
  if (addr) toast('Cartera lista para recibir donaciones');
}

// Modal propio de la sala para ENVIAR una donación en WTK (solo WTK).
async function verEnviarWtk() {
  const api = window.WhaTakaDonaciones;
  if (!api) return;
  // Necesitamos la config del relé para saber en qué red está el WTK (Amoy o
  // Polygon real) y pintar el aviso correcto.
  await loadMiningConfig();
  const botones = api.IMPORTES_WTK.map((imp) => `
    <button class="btn-donar-wtk" data-wtk="${imp}"
       style="display:block; width:100%; text-align:center; padding:11px; margin:7px 0; border-radius:10px;
              border:none; cursor:pointer; background:linear-gradient(90deg,#8247e5,#6a2fd8); color:#fff; font-weight:700;">
      Donar ${api.formatearWtk(imp)}
    </button>`).join('');
  openModal('💜 Enviar donación en WTK', `
    <p style="font-size:13px; opacity:.9; margin-bottom:10px;">
      Elige cuántos WTK quieres donar. El token va <strong>directo</strong> de tu
      cartera a la del creador, en una sola transacción. La app no lo toca.
    </p>
    ${botones}
    <p style="font-size:11.5px; opacity:.7; margin-top:12px;">
      Necesitas estar en ${redWtk().name} y tener WTK en tu cartera.
      Donación voluntaria: no es una inversión ni promete ganancias.
    </p>`);
  document.querySelectorAll('#modal-body .btn-donar-wtk').forEach((b) => {
    b.addEventListener('click', () => donarEnWtk(Number(b.dataset.wtk)));
  });
}

async function copiarMiDireccion() {
  if (!state.wallet) {
    const addr = await connectWallet();
    pintaMiDireccion();
    if (!addr) return;
  }
  try {
    await navigator.clipboard.writeText(state.wallet);
    toast('Dirección copiada 📋');
  } catch {
    toast('No se pudo copiar; mantén pulsado para copiarla');
  }
}

function abrirDex() {
  const api = window.WhaTakaDonaciones;
  if (!api) return;
  try { window.open(api.DEX.url, '_blank', 'noopener'); } catch { /* bloqueado */ }
  toast(`Abriendo ${api.DEX.nombre}…`);
}

// ─────────────────────────────────────────────────────────────
// Café ☕ ($1) + stickers animados
// ─────────────────────────────────────────────────────────────

const COFFEE_URL = `${DONACION_PAYPAL}/1`;

// Reparte los emojis "spark" alrededor del sticker base en círculo.
function posicionesSpark(n) {
  return Array.from({ length: n }, (_, i) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { dx: Math.round(Math.cos(ang) * 46), dy: Math.round(Math.sin(ang) * 46) };
  });
}

// Pinta un sticker. Si `data` es un id del catálogo, sale animado; si no
// (mensajes antiguos con un emoji suelto), se muestra tal cual.
function renderSticker(data) {
  const api = window.WhaTakaStickers;
  const st = api && api.porId(data);
  if (!st) return `<span class="bubble-sticker">${escapeHtml(data)}</span>`;
  const sparks = (st.spark || []).map((e, i, arr) => {
    const p = posicionesSpark(arr.length)[i];
    return `<span class="st-spark" style="--dx:${p.dx}px; --dy:${p.dy}px">${e}</span>`;
  }).join('');
  return `<span class="st-wrap ${st.anim}">
      ${sparks}
      <span class="st-base">${st.emoji}</span>
    </span>`;
}

// Muestra el selector de stickers (reutiliza el modal) y, al elegir uno,
// lo envía al chat abierto. `intro` permite añadir un texto arriba.
function elegirSticker(intro) {
  const api = window.WhaTakaStickers;
  if (!api) return;
  const secciones = api.porCategorias().map((c) => `
    <div style="margin-bottom:10px">
      <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:6px">${c.emoji} ${c.nombre}</div>
      <div class="sticker-grid">
        ${c.stickers.map((s) => `<button class="pick-sticker" data-id="${s.id}" title="${escapeHtml(s.label)}">${s.emoji}</button>`).join('')}
      </div>
    </div>`).join('');
  openModal('Elige un sticker', `
    <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px">
      ${intro || 'Toca uno para enviarlo al chat abierto.'}
    </p>
    ${secciones}`);
  document.querySelectorAll('#modal-body .pick-sticker').forEach((b) => {
    b.addEventListener('click', () => {
      if (!state.activePeer) {
        toast('Abre un chat para enviar el sticker');
        return;
      }
      sendAttachment('sticker', b.dataset.id);
      closeModal();
      toast('Sticker enviado 🎉');
    });
  });
}

// Café ☕: un solo toque. Abre el pago de $1 en PayPal y, a la vez, el selector
// de stickers. Nota: PayPal SIEMPRE pide al usuario autorizar el pago; un enlace
// paypal.me no puede debitar sin esa confirmación (eso solo lo permite la API
// de PayPal Business con un acuerdo de facturación previo).
function verCafe() {
  try { window.open(COFFEE_URL, '_blank', 'noopener'); } catch { /* bloqueado */ }
  toast('☕ Abriendo el pago de $1…');
  elegirSticker('¡Gracias por el café! Mientras se abre PayPal, elige un sticker para enviar.');
}

// ─────────────────────────────────────────────────────────────
// Red
// ─────────────────────────────────────────────────────────────

// Aviso permanente de estado del relé: sin él, un relé inalcanzable solo se
// notaba en la consola y las llamadas no sonaban sin explicación.
function pintaAvisoRelay() {
  const banner = $('#net-banner');
  if (!banner) return;
  if (state.connected) {
    banner.hidden = true;
    return;
  }
  const texto = $('#net-banner-text');
  const fix = $('#net-fix');
  const personalizado = Boolean(readStore(STORE.relay, ''));
  banner.hidden = false;
  if (texto) {
    texto.textContent = state.relayIntentos >= 2
      ? (personalizado
        ? 'No se puede conectar con el relé configurado. Las llamadas y mensajes no funcionarán.'
        : 'No se puede conectar con el relé. Reintentando… (el servidor gratuito puede tardar hasta un minuto en despertar)')
      : 'Conectando con el relé…';
  }
  if (fix) fix.hidden = !(personalizado && state.relayIntentos >= 2);
}

// Si la propia página la sirve el relé (whataka.vip), se usa su mismo origen:
// así la conexión no depende del subdominio de Render. En GitHub Pages el
// sondeo responde 404 al instante y se mantiene el relé oficial.
async function adoptarRelayPropio() {
  // Se consulta el valor actual: ?relay= ya se guardó antes de llegar aquí.
  if (readStore(STORE.relay, '')) return;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  const origen = location.origin;
  if (!origen || origen === RELAY_HTTP) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${origen}/health`, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || data.service !== 'whataka-relay') return;
    RELAY_HTTP = origen;
    RELAY_WS = origen.replace(/^http/, 'ws');
  } catch {}
}

let reconexionTimer = null;
let latidoTimer = null;

// Espera progresiva: 1, 2, 4, 8… hasta 30 s. Reintentar cada 4 s fijos castiga
// al servidor cuando se cae y no ayuda a reconectar antes.
function programaReconexion() {
  if (reconexionTimer) return;
  const escalon = Math.min(state.relayIntentos, 5);
  const espera = Math.min(1000 * 2 ** escalon, 30000) + Math.random() * 400;
  reconexionTimer = setTimeout(() => {
    reconexionTimer = null;
    connect();
  }, espera);
}

// El móvil vuelve de segundo plano o recupera cobertura: reconectar ya, sin
// esperar el turno del temporizador.
function reconectaYa() {
  if (state.connected) return;
  if (state.socket && state.socket.readyState <= WebSocket.OPEN) return;
  if (reconexionTimer) {
    clearTimeout(reconexionTimer);
    reconexionTimer = null;
  }
  connect();
}

function empezarLatido() {
  paraLatido();
  // Muchos NAT móviles cortan una conexión muda a los 30-60 s.
  latidoTimer = setInterval(() => {
    if (!sendRaw({ t: 'ping' })) paraLatido();
  }, 25000);
}

function paraLatido() {
  if (latidoTimer) clearInterval(latidoTimer);
  latidoTimer = null;
}

window.addEventListener('online', reconectaYa);
window.addEventListener('pageshow', reconectaYa);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconectaYa();
});

function connect() {
  if (state.socket && state.socket.readyState <= WebSocket.OPEN) return;
  let socket;
  try {
    socket = new WebSocket(`${RELAY_WS}/relay`);
  } catch (err) {
    console.warn('No se pudo abrir el relé', err);
    return;
  }
  state.socket = socket;

  // El relé gratuito tarda hasta un minuto en despertar y el navegador puede
  // dejar el saludo colgado sin avisar: si no abre en 15 s, se reintenta.
  const perro = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      try { socket.close(); } catch {}
    }
  }, 15000);

  socket.addEventListener('open', () => {
    clearTimeout(perro);
    state.connected = true;
    state.relayIntentos = 0;
    empezarLatido();
    pintaAvisoRelay();
    sendRaw({
      t: 'hello',
      id: state.identity.peerId,
      name: state.profile.name,
      photo: state.profile.photo || null,
      signPub: state.identity.signPub,
      agreePub: state.identity.agreePub,
    });
    renderMining();
    renderStatus();
    renderChats();
  });

  socket.addEventListener('close', () => {
    clearTimeout(perro);
    state.connected = false;
    state.online.clear();
    state.relayIntentos += 1;
    paraLatido();
    pintaAvisoRelay();
    renderMining();
    renderStatus();
    renderChats();
    programaReconexion();
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

function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Marca el estado real de un mensaje enviado: en cola, entregado o fallido.
function marcarEntrega(peerId, ids, estado) {
  if (!peerId || !ids || !ids.length) return;
  const lista = state.messages[peerId] || [];
  let tocado = false;
  for (const m of lista) {
    if (!ids.includes(m.id)) continue;
    if (m.delivery === 'entregado') continue;
    m.delivery = estado;
    tocado = true;
  }
  if (!tocado) return;
  writeStore(STORE.messages, state.messages);
  if (state.activePeer === peerId) renderChat();
  renderChats();
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
      (msg.peers || []).forEach((p) => rememberPeer(p.id, p.name, p.agreePub, p.photo));
      renderChats();
      refreshChatHeader();
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
    case 'queued': {
      marcarEntrega(msg.to, [msg.id], 'pendiente');
      break;
    }
    case 'delivered': {
      marcarEntrega(msg.from, msg.ids || [], 'entregado');
      break;
    }
    case 'undelivered': {
      marcarEntrega(msg.to, [msg.id], 'fallido');
      toast('No entregado: el buzón de ese contacto está lleno', 6000);
      break;
    }
    case 'call': {
      recibirSenal(msg).catch((err) => console.warn('Señal de llamada ilegible', err));
      break;
    }
    default:
      break;
  }
}

function rememberPeer(id, name, agreePub, photo) {
  if (!id || id === state.identity.peerId) return;
  const peer = state.peers[id] || {};
  peer.name = name || peer.name || `Peer ${shortPeer(id, 8, 4)}`;
  if (agreePub) {
    peer.agreePub = agreePub;
    state.keyCache[id] = agreePub;
  }
  if (photo !== undefined && photo !== null) peer.photo = photo;
  peer.lastSeen = Date.now();
  state.peers[id] = peer;
  writeStore(STORE.peers, state.peers);
  writeStore(STORE.keys, state.keyCache);
}

function requestKey(peerId) {
  // La clave del contacto no cambia: si ya la tenemos, no hace falta preguntar
  // y se puede escribir aunque esté desconectado.
  const conocida = state.keyCache[peerId] || state.peers[peerId]?.agreePub;
  if (conocida) return Promise.resolve(conocida);
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
  toggleComposerState();
  const entry = { from: state.identity.peerId, text, ts: Date.now() };
  await dispatchEntry(peerId, entry);
}

// Guarda la entrada, repinta y la entrega cifrada al contacto.
async function dispatchEntry(peerId, entry) {
  if (!entry.id) entry.id = nuevoId();
  entry.delivery = 'enviando';
  (state.messages[peerId] = state.messages[peerId] || []).push(entry);
  writeStore(STORE.messages, state.messages);
  renderChat();
  renderChats();

  try {
    const theirPub = await requestKey(peerId);
    const key = await sessionKey(state.agreeKey, theirPub, state.identity.peerId, peerId);
    const payload = { ts: entry.ts, name: state.profile.name, photo: state.profile.photo || null };
    if (entry.kind) { payload.kind = entry.kind; payload.data = entry.data; }
    else payload.text = entry.text;
    if (entry.caption) payload.text = entry.caption;
    const sealed = await encryptPayload(key, payload);
    const ok = sendRaw({ t: 'msg', id: entry.id, to: peerId, iv: sealed.iv, ct: sealed.ct });
    if (!ok) throw new Error('Sin conexión con el relé');
    entry.delivery = 'enviado';
    renderChat();
    state.relayUnits += 1;
    renderMining();
  } catch (err) {
    entry.delivery = 'fallido';
    if (state.activePeer === peerId) renderChat();
    toast(`No entregado: ${err.message}`);
  }
}

// Envía un adjunto (imagen, audio, ubicación, contacto, documento, encuesta o evento).
async function sendAttachment(kind, data, caption) {
  const peerId = state.activePeer;
  if (!peerId) return;
  const entry = { from: state.identity.peerId, ts: Date.now(), kind, data, caption: caption || '' };
  await dispatchEntry(peerId, entry);
}

// ─────────────────────────────────────────────────────────────
// Composer: emojis, stickers, adjuntos, cámara y notas de voz
// ─────────────────────────────────────────────────────────────

const MEDIA_MAX = 250000; // tamano maximo de un dataURL de medio (base64)

const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰',
  '😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥳','🤩','🥺',
  '😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥱','😤','😠','😡','🤬',
  '🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐',
  '👍','👎','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚',
  '👏','🙌','🤝','🙏','💪','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯',
  '🔥','✨','⭐','🌟','🎉','🎊','🥳','🎁','🥭','🍕','🍔','🍟','☕','🍺','🍻','🥂',
];

const ATTACH_ACTIONS = [
  { id: 'gallery', label: 'Galería', icon: 'fa-image', color: '#8e44ad' },
  { id: 'camera', label: 'Cámara', icon: 'fa-camera', color: '#e91e63' },
  { id: 'location', label: 'Ubicación', icon: 'fa-location-dot', color: '#1e88e5' },
  { id: 'contact', label: 'Contacto', icon: 'fa-address-card', color: '#43a047' },
  { id: 'document', label: 'Documento', icon: 'fa-file-lines', color: '#6d4c41' },
  { id: 'poll', label: 'Encuesta', icon: 'fa-square-poll-vertical', color: '#f0932b' },
  { id: 'event', label: 'Evento', icon: 'fa-calendar-days', color: '#00acc1' },
];

// Muestra u oculta el botón de enviar según haya texto escrito.
function toggleComposerState() {
  const bar = $('#input-bar');
  const val = $('#msg-input').value.trim();
  bar.classList.toggle('has-text', val.length > 0);
}

// Conecta los botones de la barra de escritura (emoji, clip, cámara, micro, enviar).
function bindComposer() {
  const send = $('#btn-send-msg');
  const input = $('#msg-input');
  if (!send || !input) return;
  send.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
  input.addEventListener('input', toggleComposerState);
  const emoji = $('#btn-emoji');
  const attach = $('#btn-attach');
  const cam = $('#btn-camera');
  const mic = $('#btn-mic');
  if (emoji) emoji.addEventListener('click', () => toggleEmojiPanel());
  if (attach) attach.addEventListener('click', openAttachMenu);
  if (cam) cam.addEventListener('click', openCamera);
  if (mic) mic.addEventListener('click', toggleRecording);
  document.querySelectorAll('.emoji-tabs button').forEach((b) => {
    b.addEventListener('click', () => renderEmojiBody(b.dataset.panel));
  });
  toggleComposerState();
}

function toggleEmojiPanel(force) {
  const panel = $('#emoji-panel');
  const open = force !== undefined ? force : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  if (open) renderEmojiBody('emoji');
}

function renderEmojiBody(kind) {
  const body = $('#emoji-body');
  document.querySelectorAll('.emoji-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.panel === kind);
  });
  if (kind === 'stickers') {
    const api = window.WhaTakaStickers;
    const items = api ? api.todos() : [];
    body.className = 'sticker-grid';
    body.innerHTML = items.map((s) => `<button data-sid="${s.id}" title="${escapeHtml(s.label)}">${s.emoji}</button>`).join('');
    body.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => sendAttachment('sticker', btn.dataset.sid));
    });
    return;
  }
  body.className = 'emoji-grid';
  body.innerHTML = EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('');
  body.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('#msg-input');
      input.value += btn.dataset.e;
      input.focus();
      toggleComposerState();
    });
  });
}

function openAttachMenu() {
  const grid = ATTACH_ACTIONS.map((a) => `
    <button class="attach-item" data-act="${a.id}">
      <span class="attach-ic" style="background:${a.color}"><i class="fa-solid ${a.icon}"></i></span>
      <span>${a.label}</span>
    </button>`).join('');
  openModal('Adjuntar', `<div class="attach-grid">${grid}</div>`);
  document.querySelectorAll('#modal-body .attach-item').forEach((el) => {
    el.addEventListener('click', () => {
      closeModal();
      handleAttach(el.dataset.act);
    });
  });
}

function handleAttach(act) {
  switch (act) {
    case 'gallery': return pickFile('image/*', 'image');
    case 'camera': return openCamera();
    case 'location': return shareLocation();
    case 'contact': return shareContact();
    case 'document': return pickFile('*/*', 'document');
    case 'poll': return askPoll();
    case 'event': return askEvent();
    default: break;
  }
}

// Lee un archivo local y lo envía cifrado (imagen o documento).
function pickFile(accept, kind) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (kind === 'document') {
      const size = file.size > 1024 * 1024
        ? `${(file.size / 1048576).toFixed(1)} MB`
        : `${Math.max(1, Math.round(file.size / 1024))} KB`;
      sendAttachment('document', { name: file.name, size });
      return;
    }
    compressImage(file, 1080, 0.7).then((dataUrl) => {
      if (dataUrl.length > MEDIA_MAX) {
        toast('Imagen demasiado grande para el relé');
        return;
      }
      sendAttachment('image', dataUrl);
    }).catch(() => toast('No se pudo procesar la imagen'));
  });
  input.click();
}

function openCamera() {
  openModal('Cámara', `
    <p>Toma una foto con la cámara del dispositivo.</p>
    <input type="file" id="cam-input" accept="image/*" capture="environment" class="modal-input">
    <div class="modal-btn-row"><button class="ghost-btn" id="cam-cancel">Cerrar</button></div>`);
  $('#cam-cancel').addEventListener('click', closeModal);
  $('#cam-input').addEventListener('change', () => {
    const file = $('#cam-input').files && $('#cam-input').files[0];
    if (!file) return;
    compressImage(file, 1080, 0.7).then((dataUrl) => {
      closeModal();
      if (dataUrl.length > MEDIA_MAX) { toast('Imagen demasiado grande'); return; }
      sendAttachment('image', dataUrl);
    }).catch(() => toast('No se pudo procesar la imagen'));
  });
}

// Redimensiona y comprime una imagen a un dataURL JPEG.
function compressImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen inválida')); };
    img.src = url;
  });
}

function shareLocation() {
  if (!navigator.geolocation) { toast('Ubicación no disponible'); return; }
  toast('Obteniendo ubicación…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const text = `Lat ${latitude.toFixed(5)}, Lng ${longitude.toFixed(5)}\nhttps://maps.google.com/?q=${latitude},${longitude}`;
      sendAttachment('location', text);
    },
    () => toast('No se pudo obtener la ubicación'),
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

function shareContact() {
  const peers = Object.keys(state.peers);
  if (!peers.length) { toast('No tienes contactos que compartir'); return; }
  const opts = peers.map((id) => {
    const p = state.peers[id] || {};
    const name = p.name || `Peer ${shortPeer(id, 8, 4)}`;
    return `<button class="contact-pick primary-btn" data-peer="${escapeHtml(id)}" style="width:100%;margin-bottom:8px">${escapeHtml(name)}</button>`;
  }).join('');
  openModal('Compartir contacto', `<div>${opts}</div>`);
  document.querySelectorAll('.contact-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.peer;
      const p = state.peers[id] || {};
      closeModal();
      sendAttachment('contact', { name: p.name || shortPeer(id, 8, 4), peerId: id });
    });
  });
}

function askPoll() {
  openModal('Crear encuesta', `
    <input class="modal-input" id="poll-q" placeholder="Pregunta">
    <input class="modal-input" id="poll-a" placeholder="Opción 1">
    <input class="modal-input" id="poll-b" placeholder="Opción 2">
    <input class="modal-input" id="poll-c" placeholder="Opción 3 (opcional)">
    <div class="modal-btn-row">
      <button class="ghost-btn" id="poll-cancel">Cancelar</button>
      <button class="primary-btn" id="poll-ok">Enviar</button>
    </div>`);
  $('#poll-cancel').addEventListener('click', closeModal);
  $('#poll-ok').addEventListener('click', () => {
    const q = $('#poll-q').value.trim();
    const options = ['#poll-a', '#poll-b', '#poll-c'].map((s) => $(s).value.trim()).filter(Boolean);
    if (!q || options.length < 2) { toast('Pregunta y al menos 2 opciones'); return; }
    closeModal();
    sendAttachment('poll', { question: q, options });
  });
}

function askEvent() {
  openModal('Crear evento', `
    <input class="modal-input" id="ev-title" placeholder="Título del evento">
    <input class="modal-input" id="ev-date" type="date">
    <input class="modal-input" id="ev-time" type="time">
    <div class="modal-btn-row">
      <button class="ghost-btn" id="ev-cancel">Cancelar</button>
      <button class="primary-btn" id="ev-ok">Enviar</button>
    </div>`);
  $('#ev-cancel').addEventListener('click', closeModal);
  $('#ev-ok').addEventListener('click', () => {
    const title = $('#ev-title').value.trim();
    const date = $('#ev-date').value;
    const time = $('#ev-time').value;
    if (!title || !date) { toast('Título y fecha obligatorios'); return; }
    closeModal();
    sendAttachment('event', { title, date, time });
  });
}

// ─────────────────────────────────────────────────────────────
// Notas de voz
// ─────────────────────────────────────────────────────────────

let recorder = null;
let recChunks = [];
let recTimer = null;
let recStart = 0;
let recStream = null;

async function toggleRecording() {
  if (recorder && recorder.state === 'recording') { stopRecording(true); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Micrófono no disponible (requiere HTTPS)');
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('Permiso de micrófono denegado');
    return;
  }
  recorder = new MediaRecorder(recStream, { audioBitsPerSecond: 16000 });
  recChunks = [];
  recorder.addEventListener('dataavailable', (e) => { if (e.data.size) recChunks.push(e.data); });
  recorder.addEventListener('stop', onRecordingStop);
  recorder.start();
  recStart = Date.now();
  showRecordingUI();
}

function showRecordingUI() {
  const bar = $('#input-bar');
  bar.dataset.prev = bar.innerHTML;
  bar.innerHTML = `
    <div class="rec-bar">
      <span class="rec-dot"></span>
      <span class="rec-time" id="rec-time">0:00</span>
      <span class="rec-hint">Grabando… toca ✓ para enviar</span>
    </div>
    <button class="icon-btn" id="rec-cancel" title="Cancelar"><i class="fa-solid fa-trash"></i></button>
    <button class="send-circle" id="rec-send" title="Enviar"><i class="fa-solid fa-check"></i></button>`;
  $('#rec-cancel').addEventListener('click', () => stopRecording(false));
  $('#rec-send').addEventListener('click', () => stopRecording(true));
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    const el = $('#rec-time');
    if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 60) stopRecording(true);
  }, 500);
}

function stopRecording(send) {
  if (!recorder) return;
  recorder._send = send;
  if (recorder.state !== 'inactive') recorder.stop();
}

function onRecordingStop() {
  clearInterval(recTimer);
  recTimer = null;
  const send = recorder && recorder._send;
  if (recStream) recStream.getTracks().forEach((t) => t.stop());
  recStream = null;
  const blob = new Blob(recChunks, { type: recChunks[0] ? recChunks[0].type : 'audio/webm' });
  recChunks = [];
  restoreComposer();
  if (!send || !blob.size) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    if (String(dataUrl).length > MEDIA_MAX) { toast('Nota de voz demasiado larga'); return; }
    sendAttachment('audio', dataUrl);
  };
  reader.readAsDataURL(blob);
}

function restoreComposer() {
  const bar = $('#input-bar');
  if (bar.dataset.prev) {
    bar.innerHTML = bar.dataset.prev;
    delete bar.dataset.prev;
    bindComposer();
    toggleComposerState();
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

  // El buzón puede reenviar si el acuse se perdió: se descarta el repetido.
  if (msg.id && (state.messages[from] || []).some((m) => m.id === msg.id)) {
    sendRaw({ t: 'ack', ids: [msg.id] });
    return;
  }

  rememberPeer(from, data.name, agreePub, data.photo);
  (state.messages[from] = state.messages[from] || []).push({
    id: msg.id || null,
    from,
    text: data.text || '',
    kind: data.kind || null,
    data: data.data || null,
    ts: data.ts || Date.now(),
  });
  writeStore(STORE.messages, state.messages);
  state.relayUnits += 1;
  // Acuse: mientras no llegue, el relé guarda el sobre y lo reintenta.
  if (msg.id) sendRaw({ t: 'ack', ids: [msg.id] });

  if (state.activePeer === from) renderChat();
  else {
    const nombre = state.peers[from]?.name || shortPeer(from);
    toast(`Nuevo mensaje de ${nombre}`);
    notifyIncoming(from, nombre);
  }
  renderChats();
  renderMining();
}

// ─────────────────────────────────────────────────────────────
// Acciones de interfaz
// ─────────────────────────────────────────────────────────────

function refreshChatHeader() {
  const peerId = state.activePeer;
  if (!peerId) return;
  const peer = state.peers[peerId] || {};
  $('#active-chat-name').textContent = peer.name || `Peer ${shortPeer(peerId, 8, 4)}`;
  $('#active-chat-sub').textContent = state.online.has(peerId)
    ? 'en línea · cifrado de extremo a extremo'
    : 'cifrado de extremo a extremo';
  applyAvatar($('#active-chat-avatar'), peer.photo);
}

function openChat(peerId) {
  state.activePeer = peerId;
  refreshChatHeader();
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

function applyMyPhoto(photo) {
  state.profile.photo = photo || null;
  writeStore(STORE.profile, state.profile);
  renderProfile();
  if (state.connected) {
    sendRaw({
      t: 'hello',
      id: state.identity.peerId,
      name: state.profile.name,
      photo: state.profile.photo || null,
      signPub: state.identity.signPub,
      agreePub: state.identity.agreePub,
    });
  }
}

function askPhoto() {
  const has = !!state.profile.photo;
  openModal('Foto de perfil', `
    <p>Elige una imagen cuadrada. Se recorta al centro y se envía cifrada a tus contactos.</p>
    <input type="file" id="photo-input" accept="image/*" class="modal-input">
    <div class="modal-btn-row">
      <button class="ghost-btn" id="photo-cancel">Cancelar</button>
      ${has ? '<button class="ghost-btn" id="photo-remove">Quitar</button>' : ''}
    </div>`);

  const input = $('#photo-input');
  $('#photo-cancel').addEventListener('click', closeModal);
  if (has) {
    $('#photo-remove').addEventListener('click', () => {
      applyMyPhoto(null);
      closeModal();
      toast('Foto eliminada');
    });
  }
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const photo = await compressPhoto(file);
      applyMyPhoto(photo);
      closeModal();
      toast('Foto actualizada');
    } catch (err) {
      toast(err.message);
    }
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
      sendRaw({ t: 'hello', id: state.identity.peerId, name, photo: state.profile.photo || null, signPub: state.identity.signPub, agreePub: state.identity.agreePub });
    }
    closeModal();
    toast('Nombre actualizado');
  });
}

function askWalletConnect() {
  openModal('WalletConnect', `
    <p>Pega tu <strong>Project ID</strong> gratuito de WalletConnect (cloud.reown.com).
    Con él, Whataka conecta MetaMask desde este mismo navegador, sin abrir la app dentro de MetaMask.</p>
    <input class="modal-input" id="wc-input" value="${escapeHtml(wcProjectId())}" placeholder="Project ID de WalletConnect">
    <p class="hint-text">Cómo conseguirlo: entra en cloud.reown.com → crea un proyecto → copia el Project ID.</p>
    <div class="modal-btn-row">
      <button class="ghost-btn" id="wc-clear">Borrar</button>
      <button class="primary-btn" id="wc-save">Guardar</button>
    </div>`);
  $('#wc-clear').addEventListener('click', () => {
    localStorage.removeItem(STORE.wc);
    closeModal();
    renderProfile();
    toast('Project ID borrado');
  });
  $('#wc-save').addEventListener('click', () => {
    const v = $('#wc-input').value.trim();
    if (!v) {
      toast('Escribe un Project ID válido');
      return;
    }
    writeStore(STORE.wc, v);
    closeModal();
    renderProfile();
    toast('Project ID guardado');
  });
}

function askRelay() {
  openModal('Nodo relé', `
    <p>Dirección del relé que transporta tus sobres cifrados. Déjala vacía para usar el relé oficial.</p>
    <input class="modal-input" id="relay-input" value="${escapeHtml(readStore(STORE.relay, '') || '')}" placeholder="${escapeHtml(DEFAULT_RELAY)}">
    <div class="modal-btn-row">
      <button class="ghost-btn" id="relay-cancel">Cancelar</button>
      <button class="primary-btn" id="relay-save">Guardar y reconectar</button>
    </div>`);
  $('#relay-cancel').addEventListener('click', closeModal);
  $('#relay-save').addEventListener('click', () => {
    const res = RELAY_URL.analizar($('#relay-input').value, OPCIONES_RELAY);
    if (!res.utilizable) {
      toast(res.motivo || 'Esa dirección no sirve para conectar');
      return;
    }
    if (res.url) writeStore(STORE.relay, res.url);
    else localStorage.removeItem(STORE.relay);
    closeModal();
    toast(res.motivo || 'Reconectando…');
    setTimeout(() => location.reload(), 600);
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

function voiceCall(video = false) {
  iniciarLlamada(video).catch((err) => {
    console.error('Llamada', err);
    toast('No se pudo iniciar la llamada');
  });
}

// ─────────────────────────────────────────────────────────────
// LLAMADAS P2P (WebRTC): audio y vídeo directos entre pares.
// El relé solo intercambia la negociación (offer/answer/ICE); el
// audio y el vídeo viajan cifrados (DTLS-SRTP) entre los dos.
// ─────────────────────────────────────────────────────────────
const LL = window.WhaTakaLlamadas;
const call = {
  maquina: LL ? LL.crear() : null,
  pc: null,
  localStream: null,
  remoteStream: null,
  timer: null,
  esperandoRespuesta: null, // temporizador de "sin respuesta"
  video: false,
  esLlamante: false,
  muteado: false,
  camaraApagada: false,
  mediosListos: false, // llegó al menos una pista remota
  descripcionRemota: false, // ya aplicamos offer/answer
  icePendientes: [], // candidatos ICE que llegaron antes de tener la conexión
  hayTurn: false, // el relé publicó un servidor TURN
  vigia: null, // temporizador que evita quedarse en «Conectando…» para siempre
  candidatosEnviados: 0,
  candidatosRecibidos: 0,
  reintentoIce: false,
};
// Aviso tocado en la notificación del sistema antes de que llegue la oferta.
let avisoPendiente = null;

const CALL_RING_SECONDS = 45;
// Margen para que el audio empiece a fluir tras contestar. Si no ocurre, se
// avisa y se cuelga: mejor un mensaje claro que una pantalla congelada.
const CALL_CONNECT_SECONDS = 30;
// Un corte de red de unos segundos es normal en el móvil; no es una llamada
// terminada. Se le da este margen antes de tocar nada.
const CALL_DISCONNECT_GRACE_MS = 8000;
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// Pide al relé los servidores ICE (incluye TURN si está configurado). Si falla,
// se usan los STUN de arriba. Se llama antes de cada llamada: al arrancar el
// relé gratuito puede estar dormido y entonces la sesión se quedaba sin TURN.
async function cargarIceServers() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${RELAY_HTTP}/api/ice`, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
      RTC_CONFIG.iceServers = data.iceServers;
      call.hayTurn = data.iceServers.some((s) => String(s.urls || '').includes('turn:')
        || (Array.isArray(s.urls) && s.urls.some((u) => String(u).includes('turn:'))));
    }
  } catch {}
}

function callEl(id) { return document.getElementById(id); }

function mostrarOverlayLlamada(mostrar) {
  const o = callEl('call-overlay');
  if (!o) return;
  o.classList.toggle('open', mostrar);
  if (mostrar) {
    reproduceVideo(callEl('call-local-video'));
    reproduceVideo(callEl('call-remote-video'));
  }
}

function pintaCabeceraLlamada(peerId) {
  const peer = (peerId && state.peers[peerId]) || {};
  const name = peer.name || (peerId ? `Peer ${shortPeer(peerId, 8, 4)}` : 'Contacto');
  const av = callEl('call-avatar');
  if (av) av.innerHTML = avatarInner(peer.photo);
  const n = callEl('call-name');
  if (n) n.textContent = name;
}

function setEstadoLlamada(texto) {
  const s = callEl('call-status');
  if (s) s.textContent = texto;
}

function arrancaTimerLlamada() {
  paraTimerLlamada();
  call.timer = setInterval(() => {
    const t = callEl('call-timer');
    if (t && call.maquina) t.textContent = LL.formatearDuracion(call.maquina.duracion());
  }, 1000);
}

function paraTimerLlamada() {
  if (call.timer) clearInterval(call.timer);
  call.timer = null;
  const t = callEl('call-timer');
  if (t) t.textContent = '';
}

async function pedirMedios(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Tu navegador no permite usar cámara ni micrófono aquí. Abre la app en una pestaña normal (no incrustada) y por HTTPS.');
  }
  const constraints = video
    ? { audio: true, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } }
    : { audio: true, video: false };
  return navigator.mediaDevices.getUserMedia(constraints);
}

// Un <video> que recibió su stream estando oculto se queda en el primer fotograma
// (pasa sobre todo en iPhone): hay que darle al play cuando ya se ve.
function reproduceVideo(el) {
  if (!el) return;
  const intento = el.play();
  if (intento && intento.catch) intento.catch(() => {});
}

function pintaVideoLocal() {
  const lv = callEl('call-local-video');
  const o = callEl('call-overlay');
  const fuente = call.videoMostrado || call.localStream;
  if (lv && fuente) {
    if (lv.srcObject !== fuente) lv.srcObject = fuente;
    if (o) o.classList.toggle('local-on', call.video);
    reproduceVideo(lv);
  }
}

// ── Efectos de vídeo (fondos y filtros) ─────────────────────────────────────
// El efecto se dibuja en un lienzo y se envía el lienzo: el otro lado no nota
// nada y la llamada sigue siendo P2P.

function preparaEfectos() {
  if (call.efectos) return true;
  if (!window.WhatakaEfectos) { toast('Los efectos no se cargaron: recarga la app'); return false; }
  if (!call.localStream) return false;
  // El lienzo lee de un vídeo aparte: si leyera del que muestra el resultado,
  // se dibujaría a sí mismo.
  const fuente = document.createElement('video');
  fuente.muted = true;
  fuente.playsInline = true;
  fuente.autoplay = true;
  fuente.srcObject = call.localStream;
  reproduceVideo(fuente);
  const efectos = window.WhatakaEfectos.crear(fuente);
  if (!efectos.stream) {
    fuente.srcObject = null;
    toast('Este navegador no permite efectos en la llamada');
    return false;
  }
  efectos.ponFiltro(call.filtroElegido || 'normal');
  call.efectosFuente = fuente;
  call.efectos = efectos;
  return true;
}

async function enviaEfectosAlOtroLado() {
  if (!call.efectos || !call.pc) return;
  const pista = call.efectos.stream.getVideoTracks()[0];
  if (!pista) return;
  for (const emisor of call.pc.getSenders()) {
    if (emisor.track && emisor.track.kind === 'video') {
      try { await emisor.replaceTrack(pista); } catch { /* la llamada sigue con la cámara */ }
    }
  }
  call.videoMostrado = call.efectos.stream;
  pintaVideoLocal();
}

async function vuelveALaCamara() {
  const emisores = call.pc ? call.pc.getSenders() : [];
  const pista = call.localStream ? call.localStream.getVideoTracks()[0] : null;
  if (pista) {
    for (const emisor of emisores) {
      if (emisor.track && emisor.track.kind === 'video') {
        try { await emisor.replaceTrack(pista); } catch { /* nada que restaurar */ }
      }
    }
  }
  if (call.efectos) { try { call.efectos.parar(); } catch { /* ya parado */ } }
  if (call.efectosFuente) { call.efectosFuente.srcObject = null; }
  call.efectos = null;
  call.efectosFuente = null;
  call.videoMostrado = null;
  pintaVideoLocal();
}

function marcaEfectosActivos() {
  const fondo = call.fondoElegido || 'ninguno';
  const filtro = call.filtroElegido || 'normal';
  document.querySelectorAll('#call-efectos-fondos [data-efecto]').forEach((b) => {
    b.classList.toggle('activo', b.dataset.efecto === fondo);
  });
  document.querySelectorAll('#call-efectos-filtros [data-efecto]').forEach((b) => {
    b.classList.toggle('activo', b.dataset.efecto === filtro);
  });
  // El lápiz se enciende cuando hay algo puesto: si no, nadie recuerda que
  // lleva un fondo detrás.
  const lapiz = callEl('call-efectos-btn');
  if (lapiz) lapiz.classList.toggle('activo', fondo !== 'ninguno' || filtro !== 'normal');
}

function pintaBotonesEfectos() {
  const filaFondos = document.getElementById('call-efectos-fondos');
  const filaFiltros = document.getElementById('call-efectos-filtros');
  if (!window.WhatakaEfectos) return;

  if (filaFondos && !filaFondos.dataset.listo) {
    window.WhatakaEfectos.FONDOS.forEach((fondo) => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'call-efecto';
      boton.dataset.efecto = fondo.id;
      const muestra = document.createElement('canvas');
      muestra.className = 'call-efecto-muestra';
      muestra.width = 112;
      muestra.height = 112;
      const ctx = muestra.getContext('2d');
      if (fondo.id === 'ninguno') {
        ctx.fillStyle = '#243a52';
        ctx.fillRect(0, 0, 112, 112);
        ctx.strokeStyle = 'rgba(255,255,255,.45)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(30, 82);
        ctx.lineTo(82, 30);
        ctx.stroke();
      } else {
        window.WhatakaEfectos.pintaFondo(ctx, fondo.id, null, 112, 112);
      }
      const texto = document.createElement('span');
      texto.textContent = fondo.nombre;
      boton.append(muestra, texto);
      boton.addEventListener('click', () => aplicaFondo(fondo.id));
      filaFondos.appendChild(boton);
    });
    filaFondos.dataset.listo = '1';
  }

  if (filaFiltros && !filaFiltros.dataset.listo) {
    window.WhatakaEfectos.FILTROS.forEach((filtro) => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'call-efecto';
      boton.dataset.efecto = filtro.id;
      const muestra = document.createElement('div');
      muestra.className = 'call-efecto-muestra';
      muestra.style.background = filtro.muestra;
      if (filtro.css !== 'none') muestra.style.filter = filtro.css;
      const texto = document.createElement('span');
      texto.textContent = filtro.nombre;
      boton.append(muestra, texto);
      boton.addEventListener('click', () => aplicaFiltro(filtro.id));
      filaFiltros.appendChild(boton);
    });
    filaFiltros.dataset.listo = '1';
  }

  marcaEfectosActivos();
}

async function aplicaFondo(id) {
  const boton = document.querySelector(`#call-efectos-fondos [data-efecto="${id}"]`);
  if (id === 'ninguno') {
    call.fondoElegido = 'ninguno';
    if (call.efectos) await aplicaEfectosActuales();
    marcaEfectosActivos();
    return;
  }
  if (!preparaEfectos()) return;
  if (!window.SelfieSegmentation) {
    // El modelo de segmentación son varios megas: solo se descarga la primera
    // vez y conviene avisar de que tarda.
    toast('Preparando el fondo: la primera vez tarda unos segundos', 5000);
  }
  if (boton) { boton.disabled = true; boton.classList.add('pensando'); }
  try {
    await call.efectos.ponFondo(id);
    call.fondoElegido = id;
    await enviaEfectosAlOtroLado();
  } catch (err) {
    console.warn('fondo', err);
    toast('No se pudo poner el fondo. Necesita conexión la primera vez.');
  } finally {
    if (boton) { boton.disabled = false; boton.classList.remove('pensando'); }
    marcaEfectosActivos();
  }
}

async function aplicaFiltro(id) {
  call.filtroElegido = id;
  if (!call.efectos && id === 'normal' && (call.fondoElegido || 'ninguno') === 'ninguno') {
    marcaEfectosActivos();
    return;
  }
  if (!preparaEfectos()) return;
  call.efectos.ponFiltro(id);
  await aplicaEfectosActuales();
  marcaEfectosActivos();
}

// Con todo en "normal" no hay nada que dibujar: se devuelve la cámara y se
// apaga el lienzo, que gasta batería para nada.
async function aplicaEfectosActuales() {
  const sinNada = (call.fondoElegido || 'ninguno') === 'ninguno' && (call.filtroElegido || 'normal') === 'normal';
  if (sinNada) { await vuelveALaCamara(); return; }
  if (call.efectos) await enviaEfectosAlOtroLado();
}

function abrePanelEfectos() {
  if (!call.video) { toast('Los efectos son para las videollamadas'); return; }
  const panel = document.getElementById('call-efectos');
  if (!panel) return;
  pintaBotonesEfectos();
  panel.hidden = false;
}

function cierraPanelEfectos() {
  const panel = document.getElementById('call-efectos');
  if (panel) panel.hidden = true;
}

function enviaSenal(kind, payload) {
  if (!call.maquina || !call.maquina.peer) return;
  sendRaw({
    t: 'call',
    to: call.maquina.peer,
    callId: call.maquina.callId,
    kind,
    video: call.video,
    payload: payload || null,
  });
}

function creaPeerConnection(peerId) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    call.candidatosEnviados += 1;
    enviaSenal('ice', { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
  };
  pc.ontrack = (e) => {
    call.remoteStream = e.streams[0];
    const rv = callEl('call-remote-video');
    const o = callEl('call-overlay');
    if (rv) {
      rv.srcObject = call.remoteStream;
      if (o) o.classList.toggle('has-remote', call.video);
      reproduceVideo(rv);
    }
    call.mediosListos = true;
    quizasActivarLlamada();
  };
  pc.onconnectionstatechange = () => {
    const estado = pc.connectionState;
    if (estado === 'connected') {
      if (call.vigia) { clearTimeout(call.vigia); call.vigia = null; }
      call.reintentoIce = false;
      quizasActivarLlamada();
      return;
    }
    if (estado === 'failed') {
      // Un primer fallo puede ser un cambio de red: se reintenta el ICE antes
      // de rendirse. Sin TURN, dos redes móviles con NAT estricto no tienen
      // camino directo, y eso hay que decirlo con claridad.
      if (!call.reintentoIce) {
        call.reintentoIce = true;
        try { pc.restartIce(); } catch {}
        vigilaConexion(15);
        return;
      }
      const pista = call.hayTurn
        ? 'No se pudo conectar la llamada. Prueba con otra red (Wi-Fi).'
        : 'No se pudo conectar la llamada: las dos redes no dejan el enlace directo y el relé no tiene servidor TURN. Prueba con Wi-Fi.';
      const foto = diagnosticoLlamada();
      terminaLlamada('sin_conexion', pista);
      avisaFalloLlamada(pista, foto);
      return;
    }
    if (estado === 'disconnected') {
      // En el móvil esto pasa al cambiar de antena o al bloquear la pantalla:
      // se espera un poco y, si no vuelve, se reintenta el ICE.
      if (call.corteRed) clearTimeout(call.corteRed);
      call.corteRed = setTimeout(() => {
        call.corteRed = null;
        if (!call.pc || call.pc.connectionState === 'connected') return;
        try { call.pc.restartIce(); } catch {}
        vigilaConexion(CALL_CONNECT_SECONDS);
      }, CALL_DISCONNECT_GRACE_MS);
      return;
    }
    if (estado === 'closed' && call.maquina && call.maquina.estado === 'activa') {
      terminaLlamada('terminada', 'Llamada finalizada');
    }
  };
  if (call.localStream) {
    call.localStream.getTracks().forEach((t) => pc.addTrack(t, call.localStream));
  }
  call.pc = pc;
  return pc;
}

// Si en este tiempo la llamada no llega a «connected», se cierra con un aviso
// claro en vez de dejar la pantalla en «Conectando…» para siempre.
function vigilaConexion(segundos) {
  if (call.vigia) clearTimeout(call.vigia);
  call.vigia = setTimeout(() => {
    call.vigia = null;
    if (!call.pc || call.pc.connectionState === 'connected') return;
    if (!call.maquina || call.maquina.estado !== 'conectando') return;
    const pista = call.hayTurn
      ? 'No se pudo conectar la llamada. Prueba con otra red (Wi-Fi o datos).'
      : 'No se pudo conectar la llamada: las dos redes no dejan el enlace directo y falta un servidor TURN. Prueba con Wi-Fi.';
    const foto = diagnosticoLlamada();
    terminaLlamada('sin_conexion', pista);
    avisaFalloLlamada(pista, foto);
  }, segundos * 1000);
}

// Radiografía de la llamada: sirve para saber qué falló sin adivinar.
function diagnosticoLlamada() {
  const pc = call.pc;
  const red = (navigator.connection && navigator.connection.effectiveType) || 'desconocida';
  return [
    `hora: ${new Date().toISOString()}`,
    `estado: ${call.maquina ? call.maquina.estado : 'sin llamada'}`,
    `conexión: ${pc ? pc.connectionState : '—'}`,
    `hielo: ${pc ? pc.iceConnectionState : '—'}`,
    `recolección: ${pc ? pc.iceGatheringState : '—'}`,
    `señalización: ${pc ? pc.signalingState : '—'}`,
    `candidatos enviados: ${call.candidatosEnviados}`,
    `candidatos recibidos: ${call.candidatosRecibidos}`,
    `servidor TURN: ${call.hayTurn ? 'sí' : 'no'}`,
    `red: ${red}`,
    `navegador: ${navigator.userAgent}`,
  ].join('\n');
}

function mostrarDiagnosticoLlamada() {
  const caja = callEl('call-diag');
  const texto = callEl('call-diag-texto');
  if (!caja || !texto) return;
  texto.textContent = diagnosticoLlamada();
  caja.hidden = false;
}

// Cuando la llamada se cae sola, la pantalla de llamada desaparece; el
// diagnóstico se enseña en una ventana para que se pueda copiar y enviar.
function avisaFalloLlamada(motivo, texto) {
  if (!texto) texto = diagnosticoLlamada();
  openModal('📵 La llamada no conectó', `
    <p>${escapeHtml(motivo)}</p>
    <p class="hint-text">Si vuelve a pasar, copia este diagnóstico y mándalo: dice exactamente en qué paso se quedó.</p>
    <pre id="diag-modal-texto" style="white-space:pre-wrap;word-break:break-word;background:#0f1722;border:1px solid #22364a;border-radius:10px;padding:10px;font-size:11px;color:#cfe0ef;max-height:38vh;overflow:auto">${escapeHtml(texto)}</pre>
    <div class="modal-btn-row">
      <button class="ghost-btn" id="diag-modal-cerrar">Cerrar</button>
      <button class="primary-btn" id="diag-modal-copiar">Copiar diagnóstico</button>
    </div>`);
  const cerrar = document.getElementById('diag-modal-cerrar');
  if (cerrar) cerrar.addEventListener('click', closeModal);
  const copiar = document.getElementById('diag-modal-copiar');
  if (copiar) {
    copiar.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(texto);
        copiar.textContent = 'Copiado ✓';
      } catch {
        const r = document.createRange();
        r.selectNodeContents(document.getElementById('diag-modal-texto'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        copiar.textContent = 'Seleccionado: copia a mano';
      }
    });
  }
}

// Aplica los candidatos ICE que llegaron antes de estar lista la conexión.
// Debe llamarse después de aplicar la descripción remota.
function aplicarIcePendientes() {
  if (!call.pc || !call.descripcionRemota || !call.icePendientes.length) return;
  const pendientes = call.icePendientes;
  call.icePendientes = [];
  pendientes.forEach((c) => { call.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}); });
}

async function iniciarLlamada(video) {
  if (!LL) { toast('El módulo de llamadas no cargó. Recarga la app.'); return; }
  const peerId = state.activePeer;
  if (!peerId) { toast('Abre un chat para llamar a alguien'); return; }
  if (!state.connected) { toast('Sin conexión con el relé'); return; }
  if (call.maquina && !call.maquina.terminada && call.maquina.estado !== 'inactiva') {
    toast('Ya hay una llamada en curso');
    return;
  }
  const online = state.online.has(peerId);
  if (!online) {
    const nombre = (state.peers[peerId] && state.peers[peerId].name) || 'El contacto';
    // No es un error: el relé guarda la llamada y le repica el teléfono hasta
    // que abra Whataka o se canse el que llama.
    toast(`${nombre} no está conectado ahora: le aviso para que abra Whataka`, 6000);
  }

  try {
    call.localStream = await pedirMedios(video);
  } catch (err) {
    toast(err.message || 'No se pudo acceder al micrófono/cámara');
    return;
  }

  await cargarIceServers();
  call.maquina = LL.crear();
  call.video = !!video;
  call.esLlamante = true;
  call.muteado = false;
  call.camaraApagada = false;
  call.mediosListos = false;
  call.descripcionRemota = false;
  call.icePendientes = [];
  call.maquina.iniciar({ callId: LL.nuevoCallId(), peer: peerId, video });
  if (peerId) logCall(peerId, video);

  pintaCabeceraLlamada(peerId);
  mostrarOverlayLlamada(true);
  const o = callEl('call-overlay');
  if (o) o.classList.remove('has-remote');
  setEstadoLlamada(video ? 'Videollamada… llamando' : 'Llamando…');
  pintaVideoLocal();
  sincronizaBotonesLlamada();

  const pc = creaPeerConnection(peerId);
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
  await pc.setLocalDescription(offer);
  enviaSenal('offer', { sdp: pc.localDescription });

  esperaRespuesta(CALL_RING_SECONDS);
}

// Con la app cerrada el teléfono necesita despertar, abrir el navegador y
// conectar: se le da más margen que a una llamada a alguien ya conectado.
function esperaRespuesta(segundos) {
  if (call.esperandoRespuesta) clearTimeout(call.esperandoRespuesta);
  call.esperandoRespuesta = setTimeout(() => {
    if (call.maquina && call.maquina.estado === 'llamando') {
      terminaLlamada('sin_conexion', 'El contacto no contestó');
    }
  }, segundos * 1000);
}

async function aceptarLlamada() {
  if (!call.maquina || call.maquina.estado !== 'sonando') return;
  // Se calla al instante: pedir el micrófono tarda y el timbre seguiría sonando.
  stopRingtone();
  // El móvil solo deja sonar el audio si se pide dentro del toque del usuario.
  // Se hace aquí, antes de cualquier espera, o la llamada se queda muda.
  reproduceVideo(callEl('call-remote-video'));
  try {
    call.localStream = await pedirMedios(call.video);
  } catch (err) {
    enviaSenal('reject', { motivo: 'sin_permiso' });
    terminaLlamada('terminada', err.message || 'No se pudo acceder al micrófono/cámara');
    return;
  }
  call.maquina.aceptar();
  call.esLlamante = false;
  callEl('call-incoming').hidden = true;
  setEstadoLlamada('Conectando…');
  pintaVideoLocal();
  sincronizaBotonesLlamada();

  try {
    await cargarIceServers();
    const pc = creaPeerConnection(call.maquina.peer);
    // La oferta ya la guardamos al recibirla.
    if (!call._offerSdp) throw new Error('la oferta de la llamada ya no está disponible');
    await pc.setRemoteDescription(new RTCSessionDescription(call._offerSdp));
    call.descripcionRemota = true;
    aplicarIcePendientes();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    enviaSenal('answer', { sdp: pc.localDescription });
    vigilaConexion(CALL_CONNECT_SECONDS);
    quizasActivarLlamada();
  } catch (err) {
    // Antes esto se quedaba colgado en «Conectando…» sin decir nada.
    console.warn('no se pudo contestar', err);
    enviaSenal('hangup', {});
    terminaLlamada('sin_conexion', 'No se pudo contestar la llamada. Inténtalo otra vez.');
  }
}

function rechazarLlamada() {
  enviaSenal('reject', {});
  terminaLlamada('rechazada', 'Llamada rechazada');
}

function colgarLlamada() {
  enviaSenal('hangup', {});
  terminaLlamada('terminada', 'Llamada finalizada');
}

async function recibirSenal(msg) {
  if (!LL) return;
  const kind = msg.kind;
  if (kind === 'offer') {
    // Si ya hay una llamada activa, avisamos de que está ocupado.
    if (call.maquina && !call.maquina.terminada && call.maquina.estado !== 'inactiva') {
      sendRaw({ t: 'call', to: msg.from, callId: msg.callId, kind: 'busy' });
      return;
    }
    // Aviso al relé: la llamada ya está en pantalla, deja de repicar.
    sendRaw({ t: 'call', to: msg.from, callId: msg.callId, kind: 'recibida' });
    call.maquina = LL.crear();
    call.video = !!msg.video;
    call.esLlamante = false;
    call.muteado = false;
    call.camaraApagada = false;
    call.mediosListos = false;
    call.descripcionRemota = false;
    call.icePendientes = [];
    call._offerSdp = msg.payload && msg.payload.sdp;
    call.maquina.recibir({ callId: msg.callId, peer: msg.from, video: msg.video });
    pintaCabeceraLlamada(msg.from);
    mostrarOverlayLlamada(true);
    const o = callEl('call-overlay');
    if (o) o.classList.remove('has-remote', 'local-on');
    setEstadoLlamada(msg.video ? 'Videollamada entrante' : 'Llamada entrante');
    const inc = callEl('call-incoming');
    if (inc) inc.hidden = false;
    const acc = callEl('call-actions');
    if (acc) acc.style.display = 'none';
    // Sonido de timbre (si el navegador lo permite), vibración y aviso del
    // sistema: con la pantalla apagada el timbre solo no se oye.
    ringtone();
    vibrarTimbre();
    avisarLlamadaEntrante(msg.from, msg.video);
    // Se abrió la app tocando "Contestar" en el aviso del sistema.
    if (avisoPendiente && avisoPendiente.contestar
      && (!avisoPendiente.callId || avisoPendiente.callId === msg.callId)) {
      avisoPendiente = null;
      setTimeout(() => { aceptarLlamada().catch(() => {}); }, 400);
    }
    return;
  }
  if (kind === 'answer') {
    if (!call.pc || !call.maquina) return;
    try {
      await call.pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
    } catch (err) {
      console.warn('respuesta no aplicable', err);
      terminaLlamada('sin_conexion', 'La llamada se cortó antes de conectar. Inténtalo otra vez.');
      return;
    }
    call.descripcionRemota = true;
    aplicarIcePendientes();
    call.maquina.conectar();
    setEstadoLlamada('Conectando…');
    vigilaConexion(CALL_CONNECT_SECONDS);
    quizasActivarLlamada();
    return;
  }
  if (kind === 'ice') {
    if (!msg.payload || !msg.payload.candidate) return;
    const cand = msg.payload.candidate;
    // Sin conexión, o con la descripción remota aún sin aplicar, no se puede
    // añadir el candidato todavía: se guarda para aplicarlo en cuanto se pueda.
    call.candidatosRecibidos += 1;
    if (!call.pc || !call.descripcionRemota) { call.icePendientes.push(cand); return; }
    try { await call.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
    return;
  }
  if (kind === 'reject') { terminaLlamada('rechazada', 'El contacto rechazó la llamada'); return; }
  if (kind === 'busy') { terminaLlamada('rechazada', 'El contacto está en otra llamada'); return; }
  if (kind === 'hangup') { terminaLlamada('terminada', 'El contacto colgó'); return; }
  if (kind === 'offline') {
    // El teléfono puede estar cerrado: el relé ya le está mandando el aviso.
    setEstadoLlamada('Avisando al contacto…');
    esperaRespuesta(90);
    return;
  }
  if (kind === 'sin_aviso') {
    setEstadoLlamada('Esperando a que abra Whataka…');
    toast('No puedo despertar su teléfono: tiene que abrir Whataka una vez y aceptar los avisos. La llamada le espera un minuto y medio.', 10000);
    esperaRespuesta(90);
    return;
  }
}

function activarLlamada() {
  if (!call.maquina || call.maquina.estado === 'activa') return;
  if (call.esperandoRespuesta) { clearTimeout(call.esperandoRespuesta); call.esperandoRespuesta = null; }
  try { call.maquina.activar(); } catch { return; }
  setEstadoLlamada('En llamada');
  arrancaTimerLlamada();
  sincronizaBotonesLlamada();
}

// La llamada se da por "activa" solo cuando hay descripción remota, llegó
// audio/vídeo Y la conexión está establecida. Antes bastaba con la descripción:
// con la red bloqueada la pantalla decía «En llamada» en silencio y parecía
// colgada.
function conexionEstablecida() {
  const pc = call.pc;
  if (!pc) return false;
  const hielo = pc.iceConnectionState;
  return pc.connectionState === 'connected' || hielo === 'connected' || hielo === 'completed';
}

function quizasActivarLlamada() {
  if (!call.maquina || call.maquina.estado === 'activa') return;
  if (call.maquina.estado !== 'conectando') return;
  if (call.descripcionRemota && call.mediosListos && conexionEstablecida()) activarLlamada();
}

function sincronizaBotonesLlamada() {
  const mute = callEl('call-toggle-mute');
  if (mute) {
    mute.classList.toggle('off', call.muteado);
    const i = mute.querySelector('i');
    if (i) i.className = call.muteado ? 'fa-solid fa-microphone-slash' : 'fa-solid fa-microphone';
  }
  const vid = callEl('call-toggle-video');
  if (vid) {
    vid.classList.toggle('off', call.camaraApagada);
    const i = vid.querySelector('i');
    if (i) i.className = call.camaraApagada ? 'fa-solid fa-video-slash' : 'fa-solid fa-video';
    vid.style.display = call.video ? '' : 'none';
  }
  const lapiz = callEl('call-efectos-btn');
  if (lapiz) lapiz.style.display = call.video ? '' : 'none';
  const acc = callEl('call-actions');
  if (acc && (!call.maquina || call.maquina.estado !== 'sonando')) acc.style.display = '';
}

function terminaLlamada(motivo, aviso) {
  if (call.esperandoRespuesta) { clearTimeout(call.esperandoRespuesta); call.esperandoRespuesta = null; }
  if (call.vigia) { clearTimeout(call.vigia); call.vigia = null; }
  if (call.corteRed) { clearTimeout(call.corteRed); call.corteRed = null; }
  call.candidatosEnviados = 0;
  call.candidatosRecibidos = 0;
  call.reintentoIce = false;
  const cajaDiag = callEl('call-diag');
  if (cajaDiag) cajaDiag.hidden = true;
  paraTimerLlamada();
  try {
    if (call.maquina && !call.maquina.terminada) {
      if (motivo === 'rechazada') call.maquina.rechazar();
      else if (motivo === 'sin_conexion') call.maquina.sinConexion();
      else call.maquina.colgar();
    }
  } catch {}
  if (call.pc) {
    try { call.pc.getSenders().forEach((s) => s.track && s.track.stop && s.track.stop()); } catch {}
    try { call.pc.close(); } catch {}
  }
  call.pc = null;
  if (call.localStream) {
    call.localStream.getTracks().forEach((t) => t.stop());
    call.localStream = null;
  }
  call.remoteStream = null;
  call._offerSdp = null;
  call.mediosListos = false;
  call.descripcionRemota = false;
  call.icePendientes = [];
  // Los efectos se van con la llamada: si no, el lienzo seguiría dibujando y
  // gastando batería con la cámara ya apagada.
  if (call.efectos) { try { call.efectos.parar(); } catch {} }
  if (call.efectosFuente) { call.efectosFuente.srcObject = null; }
  call.efectos = null;
  call.efectosFuente = null;
  call.videoMostrado = null;
  call.fondoElegido = 'ninguno';
  call.filtroElegido = 'normal';
  const panelEfectos = document.getElementById('call-efectos');
  if (panelEfectos) panelEfectos.hidden = true;
  const rv = callEl('call-remote-video'); if (rv) rv.srcObject = null;
  const lv = callEl('call-local-video'); if (lv) lv.srcObject = null;
  const inc = callEl('call-incoming'); if (inc) inc.hidden = true;
  const o = callEl('call-overlay'); if (o) o.classList.remove('has-remote', 'local-on');
  mostrarOverlayLlamada(false);
  if (typeof stopRingtone === 'function') stopRingtone();
  if (aviso) toast(aviso, 6000);
  call.maquina = LL ? LL.crear() : null;
}

function alternarMute() {
  if (!call.localStream) return;
  call.muteado = !call.muteado;
  call.localStream.getAudioTracks().forEach((t) => { t.enabled = !call.muteado; });
  sincronizaBotonesLlamada();
}

function alternarCamara() {
  if (!call.localStream || !call.video) return;
  call.camaraApagada = !call.camaraApagada;
  call.localStream.getVideoTracks().forEach((t) => { t.enabled = !call.camaraApagada; });
  sincronizaBotonesLlamada();
}

function conectarBotonesLlamada() {
  const q = (id) => document.getElementById(id);
  if (q('call-hangup')) q('call-hangup').addEventListener('click', colgarLlamada);
  if (q('call-diag-btn')) q('call-diag-btn').addEventListener('click', mostrarDiagnosticoLlamada);
  if (q('call-diag-cerrar')) {
    q('call-diag-cerrar').addEventListener('click', () => { q('call-diag').hidden = true; });
  }
  if (q('call-diag-copiar')) {
    q('call-diag-copiar').addEventListener('click', async () => {
      const texto = (q('call-diag-texto') || {}).textContent || '';
      try {
        await navigator.clipboard.writeText(texto);
        toast('Diagnóstico copiado');
      } catch {
        toast('No se pudo copiar: selecciona el texto a mano');
      }
    });
  }
  if (q('call-accept')) q('call-accept').addEventListener('click', aceptarLlamada);
  if (q('call-reject')) q('call-reject').addEventListener('click', rechazarLlamada);
  if (q('call-toggle-mute')) q('call-toggle-mute').addEventListener('click', alternarMute);
  if (q('call-toggle-video')) q('call-toggle-video').addEventListener('click', alternarCamara);
  if (q('call-efectos-btn')) q('call-efectos-btn').addEventListener('click', abrePanelEfectos);
  if (q('call-efectos-cerrar')) q('call-efectos-cerrar').addEventListener('click', cierraPanelEfectos);
}

async function sendMiningReport() {
  const btn = $('#btn-send-report');
  const log = $('#report-log');
  btn.disabled = true;

  try {
    // 1. Aseguramos wallet conectada.
    if (!state.wallet) {
      log.textContent = 'Conecta tu wallet para reclamar WTK…';
      const addr = await connectWallet();
      if (!addr) return;
    }

    // 2. El relé tiene que estar configurado con contrato y firmante.
    const cfg = await loadMiningConfig();
    if (!cfg) {
      log.textContent = 'La minería on-chain aún no está configurada en el relé.';
      toast('Minería on-chain no disponible');
      return;
    }

    // 3. Pedimos al relé un vale por las unidades que él mismo ha medido.
    log.textContent = 'Solicitando vale firmado al relé…';
    const pedirVale = () => fetch(`${RELAY_HTTP}/api/mining/voucher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: state.wallet, peerId: state.identity.peerId }),
    });
    let voucherRes = await pedirVale();
    if (voucherRes.status === 409) {
      // El relé todavía no tiene esta cartera asociada al nodo: la firmamos.
      log.textContent = 'Firmando la cartera para este nodo…';
      await registrarCartera(state.wallet);
      voucherRes = await pedirVale();
    }
    const voucherData = await voucherRes.json().catch(() => ({}));
    if (!voucherRes.ok) throw new Error(voucherData.error || `HTTP ${voucherRes.status}`);

    // 4. Enviamos la transacción; la wallet firma y el contrato verifica el vale.
    let wallet = getWalletProvider();
    if (!wallet) {
      const addr = await connectWallet();
      if (!addr) return;
      wallet = getWalletProvider();
    }
    if (!wallet) throw new Error('no hay wallet Web3 disponible');
    const provider = new ethers.BrowserProvider(wallet);

    // La wallet tiene que estar en la red del contrato, o la transacción iría a
    // la cadena equivocada (p. ej. Binance en BNB y el contrato en Polygon).
    const onChain = Number(await provider.send('eth_chainId', []));
    if (onChain !== Number(voucherData.chainId)) {
      const ok = await ensureChain(wallet, voucherData.chainId);
      if (!ok) throw new Error('cambia la wallet a la red del contrato');
    }

    const signer = await provider.getSigner();
    const contract = new ethers.Contract(voucherData.contract, MINING_ABI, signer);

    const u = voucherData.units;
    // El importe lo decide el contrato (aplica el halving). Si podemos leerlo,
    // mostramos el número exacto en vez del factor fijo del backend.
    let rewardLabel = voucherData.rewardFormatted;
    try {
      rewardLabel = ethers.formatUnits(
        await contract.rewardFor(u.relay, u.store, u.uptime, u.call, u.reputation),
        18,
      );
    } catch {
      /* el contrato podría no exponer rewardFor; usamos el del backend */
    }

    log.textContent = `Reclamando ${rewardLabel} WTK… confirma en tu wallet`;
    const tx = await contract.claimMiningReward(
      voucherData.reportHash,
      u.relay,
      u.store,
      u.uptime,
      u.call,
      u.reputation,
      voucherData.deadline,
      voucherData.signature,
    );
    log.textContent = `Tx enviada ${tx.hash.slice(0, 12)}… esperando confirmación`;
    await tx.wait();

    log.textContent = `¡Recompensa de ${rewardLabel} WTK enviada a tu wallet! 🪙`;
    toast('WTK reclamados on-chain');

    // 5. Reiniciamos los contadores locales ya cobrados.
    state.relayUnits = 0;
    state.startedAt = Date.now();
    renderMining();
  } catch (err) {
    console.warn('Minería on-chain', err);
    const msg = err.shortMessage || err.reason || err.message || 'error desconocido';
    log.textContent = `No se pudo reclamar: ${msg}`;
    toast('No se pudo reclamar la recompensa');
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────
// Permisos (cámara, micrófono y avisos de mensajes)
// ─────────────────────────────────────────────────────────────

// El navegador lanza un DOMException cuyo `message` viene en inglés ("Permission
// denied") y no dice qué hacer; su `name` sí es estable y está en la spec. Se
// traduce a partir del `name` para que la persona sepa qué le pasa.
const MEDIA_ERROR_MESSAGES = {
  NotAllowedError: 'Permiso denegado. Actívalo en los ajustes del navegador para este sitio y vuelve a intentarlo.',
  PermissionDeniedError: 'Permiso denegado. Actívalo en los ajustes del navegador para este sitio y vuelve a intentarlo.',
  NotFoundError: 'No se encontró ninguna cámara ni micrófono en este dispositivo.',
  DevicesNotFoundError: 'No se encontró ninguna cámara ni micrófono en este dispositivo.',
  NotReadableError: 'La cámara o el micrófono están siendo usados por otra aplicación.',
  TrackStartError: 'La cámara o el micrófono están siendo usados por otra aplicación.',
  OverconstrainedError: 'Este dispositivo no tiene la cámara que se pidió.',
  SecurityError: 'El navegador bloqueó el acceso a la cámara y el micrófono.',
};

function mediaErrorMessage(err) {
  return MEDIA_ERROR_MESSAGES[err && err.name] || 'No se pudo acceder a la cámara o al micrófono.';
}

// Estado actual de un permiso sin provocarlo. `navigator.permissions` no existe
// en todos los navegadores (Safari antiguo), así que si falla se responde
// 'unknown' y la interfaz lo muestra como "No disponible".
async function permissionState(name) {
  if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name });
    return status.state;
  } catch {
    return 'unknown';
  }
}

const PERMISSION_LABELS = {
  granted: 'Concedido', denied: 'Bloqueado', prompt: 'Sin decidir',
  unknown: 'No disponible', unsupported: 'No disponible',
};

function permissionBadge(state) {
  const color = state === 'granted' ? 'var(--success)'
    : state === 'denied' ? 'var(--danger)'
      : 'var(--text-muted)';
  return `<span style="color:${color};font-weight:600">${PERMISSION_LABELS[state] || state}</span>`;
}

// Consultar el estado no basta: para conceder hay que provocar la solicitud del
// sistema. Para cámara y micrófono se abre un flujo de un instante y se cierra;
// solo interesa que el navegador deje el permiso concedido.
async function requestMediaPermission(kind) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Este navegador no permite cámara ni micrófono (requiere HTTPS)');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === 'camera' ? { video: true } : { audio: true },
    );
    stream.getTracks().forEach((t) => t.stop());
    toast(kind === 'camera' ? 'Cámara activada' : 'Micrófono activado');
  } catch (err) {
    toast(mediaErrorMessage(err));
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) { toast('Este navegador no admite avisos'); return; }
  if (Notification.permission === 'granted') { toast('Los avisos ya están activados'); return; }
  if (Notification.permission === 'denied') { toast('Los avisos están bloqueados en el navegador'); return; }
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      const ok = await activarAvisosPush();
      pintaEstadoAvisos();
      toast(ok ? 'Avisos activados: te llamarán con la app cerrada' : 'Avisos concedidos, pero no se pudieron registrar');
      return;
    }
    toast('Avisos no concedidos');
  } catch {
    toast('No se pudo pedir el permiso de avisos');
  }
}

// La clave VAPID llega en base64url; PushManager la exige en bytes.
function claveEnBytes(texto) {
  const relleno = '='.repeat((4 - (texto.length % 4)) % 4);
  const limpio = atob((texto + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(limpio, (c) => c.charCodeAt(0));
}

// Sin esta suscripción el relé no puede despertar el teléfono cuando la app
// está cerrada: solo llegan llamadas con la pestaña abierta.
async function activarAvisosPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const registro = await navigator.serviceWorker.ready;
    const res = await fetch(`${RELAY_HTTP}/api/push/key`, { cache: 'no-store' });
    if (!res.ok) return false;
    const { key } = await res.json();
    if (!key) return false;
    let sub = await registro.pushManager.getSubscription();
    // Si el relé arrancó con otras claves, la suscripción vieja ya no entrega
    // nada: se tira y se pide una nueva.
    if (sub && sub.options && sub.options.applicationServerKey) {
      const actual = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (actual !== key) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) {
      sub = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveEnBytes(key),
      });
    }
    const guardado = await fetch(`${RELAY_HTTP}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId: state.identity.peerId, subscription: sub.toJSON() }),
    });
    return guardado.ok;
  } catch (err) {
    console.warn('No se pudieron activar los avisos de llamada', err);
    return false;
  }
}

// Sin avisos activados nadie puede hacer sonar este teléfono: el recordatorio
// se queda a la vista en la lista de chats hasta que se activan (o se oculta
// unos días).
// Un solo número para todo: el de las URL de index.html, la caché del service
// worker y esta pantalla. Sirve para saber de un vistazo qué copia se está
// usando cuando algo no cuadra. Lo comprueba test/version.test.js.
const WHATAKA_BUILD = '82';

const AVISO_LLAMADAS_CLAVE = 'whataka-aviso-llamadas-oculto';
const AVISO_LLAMADAS_DIAS = 3;

function ocultarAvisoLlamadas(recordar) {
  const caja = document.getElementById('aviso-llamadas');
  if (caja) caja.hidden = true;
  if (recordar) {
    try { localStorage.setItem(AVISO_LLAMADAS_CLAVE, String(Date.now())); } catch { /* modo privado */ }
  }
}

function pintaAvisoLlamadas() {
  const caja = document.getElementById('aviso-llamadas');
  if (!caja) return;
  if (!('Notification' in window)) { caja.hidden = true; return; }
  if (Notification.permission === 'granted') { caja.hidden = true; return; }

  const detalle = document.getElementById('aviso-llamadas-detalle');
  const boton = document.getElementById('aviso-llamadas-activar');
  if (Notification.permission === 'denied') {
    // Bloqueado: volver a pedirlo no abre nada, hay que ir a los ajustes del sitio.
    if (detalle) detalle.textContent = 'Los avisos están bloqueados para Whataka: actívalos en los ajustes del sitio de este navegador.';
    if (boton) boton.hidden = true;
  } else if (esIPhone() && !estaInstalada()) {
    if (detalle) detalle.textContent = 'En iPhone, añade Whataka a la pantalla de inicio y activa los avisos: si no, no puede sonar con la app cerrada.';
  }

  let oculto = 0;
  try { oculto = Number(localStorage.getItem(AVISO_LLAMADAS_CLAVE)) || 0; } catch { /* modo privado */ }
  const dias = (Date.now() - oculto) / 86400000;
  caja.hidden = oculto > 0 && dias < AVISO_LLAMADAS_DIAS;
}

async function activarAvisosDesdeLaLista() {
  await requestNotificationPermission();
  pintaAvisoLlamadas();
  pintaEstadoAvisos();
}

// iOS solo entrega avisos push a las webs añadidas a la pantalla de inicio: sin
// instalar, el teléfono no suena por mucho que el relé avise.
function esIPhone() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function estaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

// Sin permiso de avisos el relé no puede despertar el teléfono: la fila de
// ajustes lo dice en claro en vez de quedarse con un texto genérico.
function pintaEstadoAvisos() {
  const fila = document.getElementById('btn-permissions');
  const texto = document.getElementById('avisos-estado');
  if (!fila || !texto) return;
  const permiso = 'Notification' in window ? Notification.permission : 'no-soportado';
  if (permiso === 'granted') {
    texto.textContent = 'Avisos de llamada activados: te llaman con la app cerrada';
    fila.classList.remove('pendiente');
    return;
  }
  if (esIPhone() && !estaInstalada()) {
    texto.textContent = 'En iPhone: añade Whataka a la pantalla de inicio para recibir llamadas con la app cerrada';
    fila.classList.add('pendiente');
    return;
  }
  texto.textContent = 'Toca aquí para recibir llamadas con la app cerrada';
  fila.classList.add('pendiente');
}

// Dentro de WhatsApp, Instagram o Facebook la cámara y el micrófono no existen:
// su navegador incrustado los niega sin preguntar y no hay ajuste que lo cambie.
function navegadorIncrustado() {
  const ua = navigator.userAgent;
  const m = ua.match(/FBAN|FBAV|Instagram|Line\/|WhatsApp|TikTok|Snapchat/i);
  if (!m) return '';
  return /FBAN|FBAV|Facebook/i.test(m[0]) ? 'Facebook' : m[0].replace(/\/$/, '');
}

// "Bloqueado" no se arregla tocando otra vez: el navegador ya no pregunta y hay
// que devolver el permiso desde sus ajustes. Cada sistema lo esconde en un sitio.
function pasosPermiso() {
  if (esIPhone()) {
    return estaInstalada()
      ? 'Ajustes del iPhone → baja hasta Whataka → activa Cámara y Micrófono.'
      : 'Ajustes del iPhone → Safari → Cámara y Micrófono → Preguntar.';
  }
  if (/Android/i.test(navigator.userAgent)) {
    return 'Toca el candado que está junto a la dirección → Permisos → Cámara y Micrófono → Permitir. Después recarga la app.';
  }
  return 'Toca el candado que está junto a la dirección → Permisos del sitio → Cámara y Micrófono → Permitir. Después recarga la app.';
}

async function showPermissions() {
  const [cam, mic] = await Promise.all([permissionState('camera'), permissionState('microphone')]);
  const notif = ('Notification' in window) ? Notification.permission : 'unsupported';
  const incrustado = navegadorIncrustado();
  const bloqueados = [];
  if (cam === 'denied') bloqueados.push('cámara');
  if (mic === 'denied') bloqueados.push('micrófono');
  openModal('Permisos', `
    ${incrustado ? `<div class="aviso-permiso">Estás abriendo Whataka dentro de ${escapeHtml(incrustado)}.
      Ese navegador no deja usar la cámara ni el micrófono. Abre el enlace en Chrome o en Safari
      y las llamadas funcionarán.</div>` : ''}
    <p>Whataka necesita estos permisos para las llamadas y los avisos.</p>
    <div class="settings-list">
      <div class="setting-item" id="perm-camera">
        <i class="fa-solid fa-camera"></i>
        <div><h4>Cámara</h4><p>Para fotos y videollamadas · ${permissionBadge(cam)}</p></div>
      </div>
      <div class="setting-item" id="perm-microphone">
        <i class="fa-solid fa-microphone"></i>
        <div><h4>Micrófono</h4><p>Para notas de voz y llamadas · ${permissionBadge(mic)}</p></div>
      </div>
      <div class="setting-item" id="perm-notifications">
        <i class="fa-solid fa-bell"></i>
        <div><h4>Avisos de mensajes</h4><p>Para enterarte de un mensaje nuevo · ${permissionBadge(notif)}</p></div>
      </div>
    </div>
    ${bloqueados.length ? `<div class="aviso-permiso">La ${escapeHtml(bloqueados.join(' y el '))} está bloqueada
      para este sitio y el navegador ya no vuelve a preguntar. Para desbloquearla: ${escapeHtml(pasosPermiso())}</div>` : ''}
    <p class="hint-text">Sin estos permisos la app abre igual, pero no se pueden hacer llamadas ni notas de voz.</p>`);
  $('#perm-camera').addEventListener('click', () => requestMediaPermission('camera'));
  $('#perm-microphone').addEventListener('click', () => requestMediaPermission('microphone'));
  $('#perm-notifications').addEventListener('click', () => requestNotificationPermission());
}

// ─────────────────────────────────────────────────────────────
// Copia de la cuenta
// ─────────────────────────────────────────────────────────────
// El Peer ID vive en el almacén de este navegador. Se conserva entre
// actualizaciones, pero se pierde si se borran los datos del sitio, si se
// reinstala la app o si se entra desde otra dirección. Con una copia a mano se
// recupera el mismo código: los contactos y lo minado siguen a nombre de él.
const PREFIJO_CUENTA = 'WHATAKA-CUENTA-1.';

function aTextoB64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function deTextoB64(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function codigoDeCuenta() {
  const id = state.identity;
  if (!id || !id.peerId) return '';
  const { peerId, signPriv, signPub, agreePriv, agreePub } = id;
  return PREFIJO_CUENTA + aTextoB64(JSON.stringify({ peerId, signPriv, signPub, agreePriv, agreePub }));
}

async function restaurarCuenta(texto) {
  const limpio = String(texto || '').replace(/\s+/g, '');
  if (!limpio) { toast('Pega primero el código de la copia'); return; }
  if (!limpio.startsWith(PREFIJO_CUENTA)) { toast('Ese texto no es una copia de Whataka'); return; }
  let datos;
  try {
    datos = JSON.parse(deTextoB64(limpio.slice(PREFIJO_CUENTA.length)));
  } catch {
    toast('La copia está cortada o dañada');
    return;
  }
  const identidad = {
    peerId: datos.peerId,
    signPriv: datos.signPriv,
    signPub: datos.signPub,
    agreePriv: datos.agreePriv,
    agreePub: datos.agreePub,
  };
  if (!(await importIdentity(identidad))) { toast('La copia no es válida'); return; }
  if (state.identity && state.identity.peerId === identidad.peerId) {
    toast('Ya estás usando esa cuenta');
    return;
  }
  if (state.identity) writeStore(`${STORE.identity}.antes`, state.identity);
  writeStore(STORE.identity, identidad);
  toast('Cuenta restaurada. Recargando…');
  setTimeout(() => location.reload(), 900);
}

function showCopiaCuenta() {
  const codigo = codigoDeCuenta();
  const peerId = (state.identity && state.identity.peerId) || '';
  openModal('🔑 Copia de cuenta', `
    <p>Este teléfono tiene el código <b class="mono-text">${escapeHtml(shortPeer(peerId, 14, 8))}</b>.</p>
    <p>Ese código vive solo en este navegador. Se mantiene al actualizar la app, pero
    se pierde si borras los datos del sitio, si desinstalas la app o si entras desde
    otra dirección. Cuando eso pasa, tus contactos y lo minado quedan a nombre del
    código viejo.</p>
    <p><b>Guarda esta copia</b> en un sitio privado: quien la tenga puede usar tu cuenta.</p>
    <textarea id="copia-texto" rows="5" readonly
      style="width:100%;font-family:monospace;font-size:12px;background:var(--surface-2,#16283c);color:var(--text-main);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px">${escapeHtml(codigo)}</textarea>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="primary-btn" id="btn-guardar-copia" style="flex:1">Copiar mi código</button>
    </div>
    <p style="margin-top:22px"><b>Recuperar en este teléfono</b></p>
    <p>Pega aquí el código de la copia y la app vuelve al código anterior.</p>
    <textarea id="copia-entrada" rows="4" placeholder="WHATAKA-CUENTA-1.…"
      style="width:100%;font-family:monospace;font-size:12px;background:var(--surface-2,#16283c);color:var(--text-main);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px"></textarea>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="primary-btn" id="btn-restaurar-copia" style="flex:1">Restaurar cuenta</button>
    </div>
    <p class="hint-text">Al restaurar, la app se recarga con el código recuperado. Después
    hay que volver a tocar Activar en los avisos.</p>
  `);
  $('#btn-guardar-copia').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      toast('Código copiado: guárdalo en un sitio privado');
    } catch {
      $('#copia-texto').select();
      toast('Copia el texto a mano');
    }
  });
  $('#btn-restaurar-copia').addEventListener('click', () => restaurarCuenta($('#copia-entrada').value));
}

// Aviso del sistema al recibir un mensaje cuando la app no está a la vista.
// En móvil el constructor `Notification` no siempre funciona; se prefiere el
// service worker y se cae al constructor solo si aquel no está listo.
function notifyIncoming(from, name) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  const options = { body: `Nuevo mensaje de ${name}`, tag: `wt-${from}` };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification('Whataka', options))
      .catch(() => { try { new Notification('Whataka', options); } catch { /* ignorado */ } });
    return;
  }
  try { new Notification('Whataka', options); } catch { /* ignorado */ }
}

// ─────────────────────────────────────────────────────────────
// Arranque
// ─────────────────────────────────────────────────────────────

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.target));
  });

  const netFix = $('#net-fix');
  if (netFix) {
    netFix.addEventListener('click', () => {
      localStorage.removeItem(STORE.relay);
      toast('Usando el relé oficial…');
      setTimeout(() => location.reload(), 400);
    });
  }

  $('#btn-scan-peer').addEventListener('click', () => askAddPeer());
  $('#fab-new-chat').addEventListener('click', () => askAddPeer());
  $('#btn-open-security').addEventListener('click', showSecurity);
  $('#btn-security-info').addEventListener('click', showSecurity);
  $('#btn-privacy-settings').addEventListener('click', showPrivacy);
  $('#btn-change-name').addEventListener('click', askEditName);
  $('#btn-change-photo').addEventListener('click', askPhoto);
  $('#btn-photo-avatar').addEventListener('click', askPhoto);
  $('#btn-relay').addEventListener('click', askRelay);
  $('#btn-deploy-token').addEventListener('click', () => {
    window.open(new URL('deploy.html', location.href).href, '_blank');
  });
  $('#btn-add-status').addEventListener('click', askStatus);
  $('#btn-voice-call').addEventListener('click', () => voiceCall(false));
  $('#btn-video-call').addEventListener('click', () => voiceCall(true));
  conectarBotonesLlamada();
  $('#btn-verify-keys').addEventListener('click', showPeerSecurity);
  $('#btn-peer-security').addEventListener('click', showPeerSecurity);
  $('#btn-back-chats').addEventListener('click', () => {
    showScreen('home-screen');
    renderChats();
  });
  bindComposer();
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
  $('#btn-practicar').addEventListener('click', () => {
    window.open(new URL('manual.html#practicar', location.href).href, '_blank', 'noopener');
  });
  $('#connect-wallet-box').addEventListener('click', connectWallet);
  $('#btn-connect-wallet').addEventListener('click', connectWallet);
  $('#btn-ver-niveles').addEventListener('click', verNiveles);
  $('#btn-sala').addEventListener('click', abrirSala);
  $('#btn-sala-mining').addEventListener('click', abrirSala);
  $('#btn-back-sala').addEventListener('click', () => showScreen('home-screen'));
  $('#sala-cafe').addEventListener('click', verCafe);
  $('#sala-donar').addEventListener('click', verDonaciones);
  $('#sala-conectar').addEventListener('click', conectarCarteraSala);
  $('#sala-copiar').addEventListener('click', copiarMiDireccion);
  $('#sala-enviar').addEventListener('click', verEnviarWtk);
  $('#sala-dex').addEventListener('click', abrirDex);
  $('#btn-donar').addEventListener('click', verDonaciones);
  $('#coffee-card').addEventListener('click', verCafe);
  $('#btn-walletconnect').addEventListener('click', askWalletConnect);
  const navManual = $('#nav-manual');
  if (navManual) navManual.addEventListener('click', () => {
    window.open(new URL('manual.html', location.href).href, '_blank', 'noopener');
  });
  $('#btn-permissions').addEventListener('click', showPermissions);
  const btnCopiaCuenta = $('#btn-copia-cuenta');
  if (btnCopiaCuenta) btnCopiaCuenta.addEventListener('click', showCopiaCuenta);
  $('#btn-referidos').addEventListener('click', verReferidos);

  // Eventos de la pestaña Dashboard (estilo QuantumCall / Whataka)
  const tileVideo = $('#dash-tile-video');
  if (tileVideo) tileVideo.addEventListener('click', () => switchTab('tab-calls'));
  const tileMsg = $('#dash-tile-messages');
  if (tileMsg) tileMsg.addEventListener('click', () => switchTab('tab-chats'));

  const dashMic = $('#dash-btn-mic');
  if (dashMic) dashMic.addEventListener('click', () => toast('Micrófono listo'));
  const dashHangup = $('#dash-btn-hangup');
  if (dashHangup) dashHangup.addEventListener('click', () => voiceCall(false));
  const dashCam = $('#dash-btn-cam');
  if (dashCam) dashCam.addEventListener('click', () => voiceCall(true));

  const dashContacts = $('#dash-gold-contacts');
  if (dashContacts) dashContacts.addEventListener('click', () => askAddPeer());
  const dashGroup = $('#dash-gold-group');
  if (dashGroup) dashGroup.addEventListener('click', () => askAddPeer());
  const dashShare = $('#dash-gold-share');
  if (dashShare) dashShare.addEventListener('click', () => {
    switchTab('tab-chats');
    toast('Selecciona un contacto para compartir archivos');
  });
  const dashCalendar = $('#dash-gold-calendar');
  if (dashCalendar) dashCalendar.addEventListener('click', abrirSala);

  const dashHeadset = $('#btn-dash-headset');
  if (dashHeadset) dashHeadset.addEventListener('click', showSecurity);
  const searchToggle = $('#btn-search-toggle');
  if (searchToggle) searchToggle.addEventListener('click', () => {
    const box = $('#dash-search-container');
    if (box) {
      box.style.display = box.style.display === 'none' ? 'flex' : 'none';
      if (box.style.display === 'flex') $('#search-input').focus();
    }
  });
}

// Abre las claves de una identidad guardada. Devuelve null si el contenido está
// corrupto o viene de una versión incompatible: antes, un solo byte malo en
// localStorage dejaba la app sin arrancar y sin conexión para siempre.
async function importIdentity(identity) {
  if (!identity || typeof identity.peerId !== 'string' || !/^wt1[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(identity.peerId)) {
    return null;
  }
  try {
    const signKey = await importSignPrivate(identity.signPriv);
    const agreeKey = await importAgreePrivate(identity.agreePriv);
    return { signKey, agreeKey };
  } catch {
    return null;
  }
}

async function boot() {
  let avisoIdentidad = '';
  let identity = readStore(STORE.identity, null);
  let keys = identity ? await importIdentity(identity) : null;
  if (!keys) {
    if (identity) {
      // Se conserva una copia por si el usuario quiere recuperarla a mano.
      writeStore(`${STORE.identity}.rota`, identity);
      avisoIdentidad = 'Tu identidad guardada estaba dañada: se ha creado una nueva. Tus contactos tendrán que añadir tu nuevo Peer ID.';
    }
    identity = await createIdentity();
    writeStore(STORE.identity, identity);
    keys = await importIdentity(identity);
  }
  if (!keys) throw new Error('No se pudo crear la identidad');
  state.identity = identity;
  state.signKey = keys.signKey;
  state.agreeKey = keys.agreeKey;
  state.wallet = readStore(STORE.wallet, null);

  const savedDirectKey = readStore(STORE.directKey, null);
  if (savedDirectKey) {
    initDirectWalletFromKey(savedDirectKey);
  }

  renderProfile();
  renderDashboard();
  renderChats();
  renderStatus();
  renderCalls();
  renderMining();
  updateWalletUI();
  pintarResumenReferidos();
  bindEvents();
  switchTab('tab-dashboard');

  // Referidos: registra la invitación si llegamos por un enlace y refresca el
  // contador desde el relé (cuántos invitados tengo y en qué puesto voy).
  registrarPadrino().then(refrescarReferidos);

  if (params.get('relay')) {
    const limpio = RELAY_URL.normalizar(params.get('relay'), OPCIONES_RELAY);
    if (limpio) writeStore(STORE.relay, limpio);
    else localStorage.removeItem(STORE.relay);
  }

  await adoptarRelayPropio();
  // Antes de conectar: la oferta guardada llega nada más saludar el relé.
  if (params.get('contestar') === '1') {
    avisoPendiente = { callId: params.get('llamada'), contestar: true };
  }
  const chatPedido = params.get('chat');
  if (chatPedido && state.peers[chatPedido]) openChat(chatPedido);
  connect();
  activarAvisosPush();
  pintaEstadoAvisos();
  pintaAvisoLlamadas();
  const etiquetaVersion = document.getElementById('app-version');
  if (etiquetaVersion) etiquetaVersion.textContent = WHATAKA_BUILD;
  const botonAviso = document.getElementById('aviso-llamadas-activar');
  if (botonAviso) botonAviso.addEventListener('click', activarAvisosDesdeLaLista);
  const cerrarAviso = document.getElementById('aviso-llamadas-cerrar');
  if (cerrarAviso) cerrarAviso.addEventListener('click', () => ocultarAvisoLlamadas(true));

  // Si la app ya estaba abierta, el aviso del sistema llega por aquí en vez de
  // por la URL: se contesta igual.
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const dato = event.data || {};
      if (dato.tipo === 'aviso-mensaje') {
        if (dato.de && state.peers[dato.de]) openChat(dato.de);
        return;
      }
      if (dato.tipo !== 'aviso-llamada') return;
      if (!dato.contestar) return;
      if (call.maquina && call.maquina.estado === 'sonando') {
        aceptarLlamada().catch(() => {});
      } else {
        avisoPendiente = { callId: dato.callId, contestar: true };
      }
    });
  }
  pintaAvisoRelay();
  setInterval(renderMining, 30000);
  cargarIceServers();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW', err));
  }

  hideSplash();
  // El aviso espera a que se retire la pantalla de bienvenida, que va encima.
  if (avisoIdentidad) setTimeout(() => toast(avisoIdentidad, 9000), 1000);
}

function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  const elapsed = Date.now() - (window.__wtBootAt || Date.now());
  const wait = Math.max(0, 900 - elapsed);
  setTimeout(() => splash.classList.add('hide'), wait);
}

boot().catch((err) => {
  console.error('Fallo al iniciar Whataka', err);
  hideSplash();
  const pista = location.protocol === 'https:'
    ? 'Recarga la app; si sigue igual, borra los datos del sitio en los ajustes del navegador.'
    : 'Abre la app por HTTPS: sin conexión segura el navegador bloquea las claves.';
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="toast show">No se pudo iniciar Whataka. ${escapeHtml(pista)}</div>`,
  );
});
