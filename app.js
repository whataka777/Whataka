/* WhaTaka — PWA de mensajería P2P con cifrado de extremo a extremo.
   El relé solo transporta sobres cifrados: nunca ve el texto en claro. */

'use strict';

window.__wtBootAt = Date.now();

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
  nivel: 'whataka.nivel',
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
    // Registramos la cartera en el relé (firma del dueño) para que quede
    // asociada a este Peer ID. Si el usuario no firma, seguimos igual.
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
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Timbre de llamada entrante, generado con WebAudio (sin archivos externos).
let ringCtx = null;
let ringTimer = null;
function ringtone() {
  stopRingtone();
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ringCtx = ringCtx || new AC();
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
function stopRingtone() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
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
  if (target === 'tab-calls') renderCalls();
  if (target === 'tab-status') renderStatus();
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
    // Ticks estilo WhatsApp: enviado (✓) o leído (✓✓) si el peer ya tiene clave.
    const tick = out
      ? `<span class="tick${state.online.has(peerId) ? ' read' : ''}"><i class="fa-solid fa-check${state.online.has(peerId) ? '-double' : ''}"></i></span>`
      : '';
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
}

// ─────────────────────────────────────────────────────────────
// Niveles de estatus
// ─────────────────────────────────────────────────────────────

// Puntos del usuario: los que ha acumulado pagando o usando la app.
function puntosNivel() {
  return Number(readStore(STORE.nivel, 0)) || 0;
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
  const p = api.progreso(puntosNivel());
  badge.textContent = `${p.actual.emoji} ${p.actual.nombre}`;
  badge.style.color = p.actual.color;
  const texto = $('#nivel-progreso-texto');
  if (texto) {
    texto.textContent = p.siguiente
      ? `${puntosNivel()} puntos · ${p.faltan} para ${p.siguiente.nombre}`
      : `${puntosNivel()} puntos · nivel máximo`;
  }
  const barra = $('#nivel-progreso-barra');
  if (barra) barra.style.width = `${p.porcentaje}%`;
}

function verNiveles() {
  const api = window.WhaTakaNiveles;
  if (!api) return;
  const puntos = puntosNivel();
  const actual = api.nivelDe(puntos).id;
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
  openModal('Niveles WhaTaka', `
    <p style="font-size:13px; opacity:.85; margin-bottom:8px;">
      Sube de nivel con un pago único. Con tu dinero se compran WTK y se queman:
      menos tokens en circulación y más valor para todos.
    </p>
    ${filas}
    <p style="font-size:12px; opacity:.7; margin-top:10px;">
      Los niveles no son una inversión ni prometen ganancias: son ventajas dentro de la app.
    </p>`);
}

// ─────────────────────────────────────────────────────────────
// Donaciones finalistas (pagar Render + Porkbun)
// ─────────────────────────────────────────────────────────────

// Enlace de cobro de donaciones en dinero (PayPal.me del creador).
const DONACION_PAYPAL = 'https://www.paypal.me/whataka';

// Donaciones en WTK: transferencia ERC-20 directa, sin custodia.
// El token WTK vive en Polygon Amoy y su dueño es la cartera que recibe.
const WTK_CONTRACT = '0x4b0C9d8233DeFa8EcDF28D7a2bAa3EDaa4C8252B';
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
      if (!ok) throw new Error('cambia la wallet a Polygon Amoy');
    }
    const signer = await provider.getSigner();
    const token = new ethers.Contract(WTK_CONTRACT, ERC20_ABI, signer);
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
  openModal('🤲🏽 Mantén WhaTaka viva', `
    <p style="font-size:13px; opacity:.9; margin-bottom:10px;">
      WhaTaka es gratis. Si quieres, puedes ayudar a pagar lo que cuesta mantenerla
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
function verEnviarWtk() {
  const api = window.WhaTakaDonaciones;
  if (!api) return;
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
      Necesitas estar en ${api.RED_WTK.nombre} y tener WTK en tu cartera.
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
  toggleComposerState();
  const entry = { from: state.identity.peerId, text, ts: Date.now() };
  await dispatchEntry(peerId, entry);
}

// Guarda la entrada, repinta y la entrega cifrada al contacto.
async function dispatchEntry(peerId, entry) {
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
    const ok = sendRaw({ t: 'msg', to: peerId, iv: sealed.iv, ct: sealed.ct });
    if (!ok) throw new Error('Sin conexión con el relé');
    state.relayUnits += 1;
    renderMining();
  } catch (err) {
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

  rememberPeer(from, data.name, agreePub, data.photo);
  (state.messages[from] = state.messages[from] || []).push({
    from,
    text: data.text || '',
    kind: data.kind || null,
    data: data.data || null,
    ts: data.ts || Date.now(),
  });
  writeStore(STORE.messages, state.messages);
  state.relayUnits += 1;

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
  iniciarLlamada(video);
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
};

const CALL_RING_SECONDS = 45;
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// Pide al relé los servidores ICE (incluye TURN si está configurado). Si falla,
// se usan los STUN de arriba.
async function cargarIceServers() {
  try {
    const res = await fetch(`${RELAY_HTTP}/api/ice`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
      RTC_CONFIG.iceServers = data.iceServers;
    }
  } catch {}
}

function callEl(id) { return document.getElementById(id); }

function mostrarOverlayLlamada(mostrar) {
  const o = callEl('call-overlay');
  if (!o) return;
  o.classList.toggle('open', mostrar);
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

function pintaVideoLocal() {
  const lv = callEl('call-local-video');
  const o = callEl('call-overlay');
  if (lv && call.localStream) {
    lv.srcObject = call.localStream;
    if (o) o.classList.toggle('local-on', call.video);
  }
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
    if (e.candidate) enviaSenal('ice', { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
  };
  pc.ontrack = (e) => {
    call.remoteStream = e.streams[0];
    const rv = callEl('call-remote-video');
    const o = callEl('call-overlay');
    if (rv) {
      rv.srcObject = call.remoteStream;
      if (o) o.classList.toggle('has-remote', call.video);
    }
    call.mediosListos = true;
    quizasActivarLlamada();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') terminaLlamada('sin_conexion', 'No se pudo conectar la llamada');
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      if (call.maquina && call.maquina.estado === 'activa') terminaLlamada('terminada', 'Llamada finalizada');
    }
  };
  if (call.localStream) {
    call.localStream.getTracks().forEach((t) => pc.addTrack(t, call.localStream));
  }
  call.pc = pc;
  return pc;
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
  const peerId = state.activePeer;
  if (!peerId) { toast('Abre un chat para llamar a alguien'); return; }
  if (!state.connected) { toast('Sin conexión con el relé'); return; }
  if (call.maquina && !call.maquina.terminada && call.maquina.estado !== 'inactiva') {
    toast('Ya hay una llamada en curso');
    return;
  }
  const online = state.online.has(peerId);
  if (!online) { toast('El contacto no está en línea'); }

  try {
    call.localStream = await pedirMedios(video);
  } catch (err) {
    toast(err.message || 'No se pudo acceder al micrófono/cámara');
    return;
  }

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

  call.esperandoRespuesta = setTimeout(() => {
    if (call.maquina && call.maquina.estado === 'llamando') {
      terminaLlamada('sin_conexion', 'El contacto no contestó');
    }
  }, CALL_RING_SECONDS * 1000);
}

async function aceptarLlamada() {
  if (!call.maquina || call.maquina.estado !== 'sonando') return;
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

  const pc = creaPeerConnection(call.maquina.peer);
  // La oferta ya la guardamos al recibirla.
  if (call._offerSdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(call._offerSdp));
    call.descripcionRemota = true;
    aplicarIcePendientes();
  }
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  enviaSenal('answer', { sdp: pc.localDescription });
  quizasActivarLlamada();
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
  const kind = msg.kind;
  if (kind === 'offer') {
    // Si ya hay una llamada activa, avisamos de que está ocupado.
    if (call.maquina && !call.maquina.terminada && call.maquina.estado !== 'inactiva') {
      sendRaw({ t: 'call', to: msg.from, callId: msg.callId, kind: 'busy' });
      return;
    }
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
    // Sonido de timbre (si el navegador lo permite).
    if (typeof ringtone === 'function') ringtone();
    return;
  }
  if (kind === 'answer') {
    if (!call.pc || !call.maquina) return;
    await call.pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
    call.descripcionRemota = true;
    aplicarIcePendientes();
    call.maquina.conectar();
    setEstadoLlamada('Conectando…');
    quizasActivarLlamada();
    return;
  }
  if (kind === 'ice') {
    if (!msg.payload || !msg.payload.candidate) return;
    const cand = msg.payload.candidate;
    // Sin conexión, o con la descripción remota aún sin aplicar, no se puede
    // añadir el candidato todavía: se guarda para aplicarlo en cuanto se pueda.
    if (!call.pc || !call.descripcionRemota) { call.icePendientes.push(cand); return; }
    try { await call.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
    return;
  }
  if (kind === 'reject') { terminaLlamada('rechazada', 'El contacto rechazó la llamada'); return; }
  if (kind === 'busy') { terminaLlamada('rechazada', 'El contacto está en otra llamada'); return; }
  if (kind === 'hangup') { terminaLlamada('terminada', 'El contacto colgó'); return; }
  if (kind === 'offline') { terminaLlamada('sin_conexion', 'El contacto no está en línea'); return; }
}

function activarLlamada() {
  if (!call.maquina || call.maquina.estado === 'activa') return;
  if (call.esperandoRespuesta) { clearTimeout(call.esperandoRespuesta); call.esperandoRespuesta = null; }
  try { call.maquina.activar(); } catch { return; }
  setEstadoLlamada('En llamada');
  arrancaTimerLlamada();
  sincronizaBotonesLlamada();
}

// La llamada se da por "activa" solo cuando ya se aplicó la descripción remota
// y llegó audio/vídeo. Así da igual el orden en que pasen ambas cosas.
function quizasActivarLlamada() {
  if (!call.maquina || call.maquina.estado === 'activa') return;
  if (call.maquina.estado !== 'conectando') return;
  if (call.descripcionRemota && call.mediosListos) activarLlamada();
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
  const acc = callEl('call-actions');
  if (acc && (!call.maquina || call.maquina.estado !== 'sonando')) acc.style.display = '';
}

function terminaLlamada(motivo, aviso) {
  if (call.esperandoRespuesta) { clearTimeout(call.esperandoRespuesta); call.esperandoRespuesta = null; }
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
  const rv = callEl('call-remote-video'); if (rv) rv.srcObject = null;
  const lv = callEl('call-local-video'); if (lv) lv.srcObject = null;
  const inc = callEl('call-incoming'); if (inc) inc.hidden = true;
  const o = callEl('call-overlay'); if (o) o.classList.remove('has-remote', 'local-on');
  mostrarOverlayLlamada(false);
  if (typeof stopRingtone === 'function') stopRingtone();
  if (aviso) toast(aviso);
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
  if (q('call-accept')) q('call-accept').addEventListener('click', aceptarLlamada);
  if (q('call-reject')) q('call-reject').addEventListener('click', rechazarLlamada);
  if (q('call-toggle-mute')) q('call-toggle-mute').addEventListener('click', alternarMute);
  if (q('call-toggle-video')) q('call-toggle-video').addEventListener('click', alternarCamara);
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
    toast(result === 'granted' ? 'Avisos activados' : 'Avisos no concedidos');
  } catch {
    toast('No se pudo pedir el permiso de avisos');
  }
}

async function showPermissions() {
  const [cam, mic] = await Promise.all([permissionState('camera'), permissionState('microphone')]);
  const notif = ('Notification' in window) ? Notification.permission : 'unsupported';
  openModal('Permisos', `
    <p>WhaTaka necesita estos permisos para las llamadas y los avisos.</p>
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
    <p class="hint-text">Si algo aparece bloqueado, ábrelo en los ajustes del navegador para este sitio.</p>`);
  $('#perm-camera').addEventListener('click', () => requestMediaPermission('camera'));
  $('#perm-microphone').addEventListener('click', () => requestMediaPermission('microphone'));
  $('#perm-notifications').addEventListener('click', () => requestNotificationPermission());
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
      .then((reg) => reg.showNotification('WhaTaka', options))
      .catch(() => { try { new Notification('WhaTaka', options); } catch { /* ignorado */ } });
    return;
  }
  try { new Notification('WhaTaka', options); } catch { /* ignorado */ }
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
  $('#btn-permissions').addEventListener('click', showPermissions);
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
  cargarIceServers();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW', err));
  }

  hideSplash();
}

function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  const elapsed = Date.now() - (window.__wtBootAt || Date.now());
  const wait = Math.max(0, 900 - elapsed);
  setTimeout(() => splash.classList.add('hide'), wait);
}

boot().catch((err) => {
  console.error('Fallo al iniciar WhaTaka', err);
  hideSplash();
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="toast show">No se pudo iniciar el almacén criptográfico. Abre la app por HTTPS.</div>',
  );
});
