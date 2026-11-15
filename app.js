/* WhaTaka — PWA de mensajería P2P con cifrado de extremo a extremo.
   El relé solo transporta sobres cifrados: nunca ve el texto en claro. */

'use strict';

// ─────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────

const DEFAULT_RELAY = 'https://whataka-relay.onrender.com';

// Project ID de Reown/WalletConnect Cloud (gratuito). Con él, la app conecta
// con MetaMask desde el navegador normal del móvil: no hace falta abrir
// WhaTaka dentro de MetaMask. Si está vacío, se usa el que el usuario pegue
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
  wc: 'whataka.wcProjectId',
  calls: 'whataka.calls',
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

// Un enlace compartido con ?relay=… se adopta y se guarda, y luego se quita de
// la barra de direcciones para que el ajuste "Nodo relé" pueda cambiarlo.
const relayParam = params.get('relay');
if (relayParam) {
  localStorage.setItem(STORE.relay, JSON.stringify(relayParam.replace(/\/+$/, '')));
  params.delete('relay');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
}

const RELAY_HTTP = (readStore(STORE.relay, DEFAULT_RELAY) || DEFAULT_RELAY).replace(/\/+$/, '');
const RELAY_WS = RELAY_HTTP.replace(/^http/, 'ws');

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

// ─────────────────────────────────────────────────────────────
// Estado de la aplicación
// ─────────────────────────────────────────────────────────────

const state = {
  identity: null,
  signKey: null,
  agreeKey: null,
  profile: readStore(STORE.profile, { name: 'Usuario WhaTaka', photo: null }),
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
    status.textContent = 'Wallet conectada 🟢';
    sub.textContent = shortPeer(state.wallet, 6, 4);
  } else {
    status.textContent = '🦊 Conectar wallet';
    sub.textContent = 'Vincular wallet para cobrar WTK on-chain';
  }
}

// Devuelve el proveedor Web3 disponible. Con MetaMask y Brave Wallet a la vez,
// ambos inyectan su propio objeto en window.ethereum.providers; elegimos uno de
// forma estable (Brave primero, luego MetaMask) en vez de dejar que decida el
// orden de carga, que cambia entre navegaciones y rompe la conexión.
function getWalletProvider() {
  // Binance Wallet se inyecta a veces como window.BinanceChain y a veces dentro
  // de window.ethereum.providers. Lo preferimos si está, porque su provider de
  // window.ethereum puede ser en realidad el de otra wallet.
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
  // Sin wallet inyectada, si ya abrimos una sesión WalletConnect, esa manda.
  return state.wcProvider || null;
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
  // El bundle de WalletConnect referencia process.env.NODE_ENV; en el
  // navegador `process` no existe y lanzaría ReferenceError.
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
      name: 'WhaTaka',
      description: 'Mensajería P2P cifrada y minería WTK',
      url: location.origin,
      icons: [`${location.origin}/icons/icon-192.png`],
    },
  });
  state.wcProvider = provider;
  return provider;
}

// Abre WhaTaka dentro de la app de MetaMask (deep link). Es el respaldo cuando
// no hay Project ID de WalletConnect: ahí MetaMask sí inyecta su proveedor.
function openInMetaMask() {
  const target = location.href.replace(/^https?:\/\//, '');
  window.location.href = METAMASK_DEEPLINK + target;
}

async function connectWallet() {
  const cfg = await loadMiningConfig();
  const chainId = cfg ? cfg.chainId : 80002;
  let wallet = getWalletProvider();

  // 1. Wallet inyectada (MetaMask dentro de su navegador, Brave, etc.).
  if (!wallet) {
    // 2. WalletConnect: conecta MetaMask desde el navegador normal del móvil.
    try {
      wallet = await openWcSession(chainId);
    } catch (err) {
      console.warn('WalletConnect', err);
      wallet = null;
    }
  }

  // 3. Sin nada disponible: ofrecemos abrir la app dentro de MetaMask.
  if (!wallet) {
    if (!wcProjectId()) {
      openModal('Conectar wallet', `
        <p>Para conectar MetaMask desde este navegador hay dos caminos:</p>
        <p><strong>Opción A (recomendada).</strong> Abre WhaTaka dentro de MetaMask con un toque.</p>
        <button class="primary-btn" id="wc-open-mm">🦊 Abrir WhaTaka en MetaMask</button>
        <p class="hint-text">Si no se abre, toca los tres puntos de MetaMask → Navegador y pega la dirección.</p>
        <hr style="border-color:var(--border-color);margin:14px 0">
        <p><strong>Opción B.</strong> Pega tu <em>Project ID</em> gratuito de WalletConnect (cloud.reown.com)
        y podrás conectar sin salir de este navegador.</p>
        <input class="modal-input" id="wc-pid-input" placeholder="Project ID de WalletConnect">
        <button class="primary-btn" id="wc-pid-save">Guardar Project ID</button>`);
      $('#wc-open-mm').addEventListener('click', openInMetaMask);
      $('#wc-pid-save').addEventListener('click', () => {
        const v = $('#wc-pid-input').value.trim();
        if (!v) {
          toast('Escribe un Project ID válido');
          return;
        }
        writeStore(STORE.wc, v);
        renderProfile();
        closeModal();
        toast('Project ID guardado; reintentando…');
        setTimeout(() => connectWallet(), 300);
      });
      return null;
    }
    toast('No hay wallet disponible para conectar');
    return null;
  }

  try {
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
            rpcUrls: [meta.rpc],
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
  if (target === 'tab-calls') renderCalls();
  if (target === 'tab-status') renderStatus();
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
    // Ticks estilo WhatsApp: enviado (✓) o leído (✓✓) si el peer ya tiene clave.
    const tick = out
      ? `<span class="tick${state.online.has(peerId) ? ' read' : ''}"><i class="fa-solid fa-check${state.online.has(peerId) ? '-double' : ''}"></i></span>`
      : '';
    return `${chip}
      <div class="msg-bubble ${out ? 'out' : 'in'}">
        ${escapeHtml(m.text)}
        <span class="msg-time">${timeLabel(m.ts)}${tick}</span>
      </div>`;
  }).join('');
  area.innerHTML = bubbles;
  area.scrollTop = area.scrollHeight;
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

// Registro local de llamadas (solo diseño: refleja el historial P2P).
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
      photo: state.profile.photo || null,
      signPub: state.identity.signPub,
      agreePub: state.identity.agreePub,
    });
    renderMining();
    renderStatus();
    renderChats();
  });

  socket.addEventListener('close', () => {
    state.connected = false;
    state.online.clear();
    renderMining();
    renderStatus();
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
    const sealed = await encryptPayload(key, { text, ts: entry.ts, name: state.profile.name, photo: state.profile.photo || null });
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

  rememberPeer(from, data.name, agreePub, data.photo);
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
    Con él, WhaTaka conecta MetaMask desde este mismo navegador, sin abrir la app dentro de MetaMask.</p>
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
    const value = $('#relay-input').value.trim().replace(/\/+$/, '');
    if (value && !/^https?:\/\//.test(value)) {
      toast('La dirección debe empezar por http:// o https://');
      return;
    }
    if (value) writeStore(STORE.relay, value);
    else localStorage.removeItem(STORE.relay);
    closeModal();
    toast('Reconectando…');
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
  const peerId = state.activePeer;
  const peer = (peerId && state.peers[peerId]) || {};
  const name = peer.name || (peerId ? `Peer ${shortPeer(peerId, 8, 4)}` : 'tu contacto');
  const kind = video ? 'Videollamada P2P' : 'Llamada P2P';
  if (peerId) logCall(peerId, video);
  openModal(kind, `
    <div style="text-align:center;padding:6px 0 2px">
      <div class="avatar purple-bg" style="width:74px;height:74px;font-size:32px;margin:0 auto 12px">${avatarInner(peer.photo)}</div>
      <h4 style="font-size:17px;color:var(--text-strong);font-weight:500">${escapeHtml(name)}</h4>
      <p style="color:var(--text-muted);font-size:13px;margin-top:4px">
        ${video ? '<i class="fa-solid fa-video"></i> ' : '<i class="fa-solid fa-phone"></i> '}cifrado de extremo a extremo
      </p>
    </div>
    <p>Las llamadas P2P cifradas necesitan el canal de señalización WebRTC.</p>
    <p>Esta versión incluye el transporte y el cifrado de mensajes; la capa de audio y vídeo se conecta al mismo relé.</p>
    <p class="hint-text">Próximamente: audio y vídeo directos entre pares.</p>`);
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

    const units = miningUnits();
    const score = miningScore(units);
    if (score === 0n) {
      log.textContent = 'Aún no acumulaste unidades de minería.';
      return;
    }

    // 3. Pedimos al relé un vale firmado para nuestras unidades.
    log.textContent = 'Solicitando vale firmado al relé…';
    const reportHash = ethers.keccak256(
      ethers.toUtf8Bytes(`${state.identity.peerId}:${randomHex(8)}`),
    );
    const voucherRes = await fetch(`${RELAY_HTTP}/api/mining/voucher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: state.wallet,
        peerId: state.identity.peerId,
        reportHash,
        relayUnits: units.relay.toString(),
        storeUnits: units.store.toString(),
        uptimeUnits: units.uptime.toString(),
        callUnits: units.call.toString(),
        reputationUnits: units.reputation.toString(),
      }),
    });
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
  $('#btn-change-photo').addEventListener('click', askPhoto);
  $('#btn-photo-avatar').addEventListener('click', askPhoto);
  $('#btn-relay').addEventListener('click', askRelay);
  $('#btn-deploy-token').addEventListener('click', () => {
    window.open(new URL('deploy.html', location.href).href, '_blank');
  });
  $('#btn-add-status').addEventListener('click', askStatus);
  $('#btn-voice-call').addEventListener('click', () => voiceCall(false));
  $('#btn-video-call').addEventListener('click', () => voiceCall(true));
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
  $('#connect-wallet-box').addEventListener('click', connectWallet);
  $('#btn-connect-wallet').addEventListener('click', connectWallet);
  $('#btn-walletconnect').addEventListener('click', askWalletConnect);
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
  state.wallet = readStore(STORE.wallet, null);

  renderProfile();
  renderChats();
  renderStatus();
  renderCalls();
  renderMining();
  updateWalletUI();
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
