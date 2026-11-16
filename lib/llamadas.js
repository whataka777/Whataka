/* Máquina de estados de una llamada P2P (pura, sin navegador).
 *
 * El transporte real (WebRTC) y la interfaz viven en app.js; aquí solo está la
 * lógica de estados, para poder probarla sin cámara ni red.
 *
 *   inactiva -> llamando  -> conectando -> activa -> terminada
 *                    \-> sonando -/         \-> rechazada / sin_conexion
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhaTakaLlamadas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ESTADOS = {
    INACTIVA: 'inactiva',
    LLAMANDO: 'llamando',     // yo llamo, el otro aún no ha contestado
    SONANDO: 'sonando',       // me llaman, yo aún no he contestado
    CONECTANDO: 'conectando', // ambos aceptaron, se negocian los medios
    ACTIVA: 'activa',         // audio/vídeo fluyendo
    TERMINADA: 'terminada',   // colgada por cualquiera
    RECHAZADA: 'rechazada',
    SIN_CONEXION: 'sin_conexion',
  };

  // Transiciones permitidas. Cualquier cambio fuera de esta tabla es un error
  // (protege de dobles toques y de mensajes que llegan tarde).
  const TRANSICIONES = {
    inactiva: ['llamando', 'sonando'],
    llamando: ['conectando', 'rechazada', 'sin_conexion', 'terminada'],
    sonando: ['conectando', 'rechazada', 'terminada'],
    conectando: ['activa', 'terminada', 'sin_conexion'],
    activa: ['terminada'],
    terminada: [],
    rechazada: [],
    sin_conexion: [],
  };

  function esFinal(estado) {
    return TRANSICIONES[estado] && TRANSICIONES[estado].length === 0;
  }

  function crear(ahora = Date.now) {
    let estado = ESTADOS.INACTIVA;
    let callId = null;
    let peer = null;
    let video = false;
    let iniciadaEn = null;
    let conectadaEn = null;
    let terminadaEn = null;
    let motivo = null;

    function puedeIrA(siguiente) {
      return (TRANSICIONES[estado] || []).includes(siguiente);
    }

    function irA(siguiente, extra = {}) {
      if (!puedeIrA(siguiente)) {
        throw new Error(`Transición inválida: ${estado} -> ${siguiente}`);
      }
      estado = siguiente;
      if (extra.callId) callId = extra.callId;
      if (extra.peer) peer = extra.peer;
      if (typeof extra.video === 'boolean') video = extra.video;
      if (extra.motivo) motivo = extra.motivo;
      const t = ahora();
      if (siguiente === ESTADOS.LLAMANDO || siguiente === ESTADOS.SONANDO) iniciadaEn = t;
      if (siguiente === ESTADOS.ACTIVA) conectadaEn = t;
      if (esFinal(siguiente)) terminadaEn = t;
      return estado;
    }

    return {
      ESTADOS,
      get estado() { return estado; },
      get callId() { return callId; },
      get peer() { return peer; },
      get video() { return video; },
      get motivo() { return motivo; },
      get activa() { return estado === ESTADOS.ACTIVA; },
      get enCurso() { return ![ESTADOS.INACTIVA, ...Object.keys(TRANSICIONES).filter(esFinal)].includes(estado); },
      get terminada() { return esFinal(estado); },

      iniciar({ callId: id, peer: p, video: v = false }) {
        return irA(ESTADOS.LLAMANDO, { callId: id, peer: p, video: v });
      },
      recibir({ callId: id, peer: p, video: v = false }) {
        return irA(ESTADOS.SONANDO, { callId: id, peer: p, video: v });
      },
      // El otro aceptó (yo llamaba) o yo acepté (me llamaban): a negociar.
      conectar() { return irA(ESTADOS.CONECTANDO); },
      aceptar() { return irA(ESTADOS.CONECTANDO); },
      activar() { return irA(ESTADOS.ACTIVA); },
      colgar() { return irA(ESTADOS.TERMINADA); },
      rechazar() { return irA(ESTADOS.RECHAZADA); },
      sinConexion() { return irA(ESTADOS.SIN_CONEXION); },

      // Segundos desde que se conectó (0 si aún no).
      duracion(t = ahora()) {
        if (!conectadaEn) return 0;
        return Math.max(0, Math.floor((t - conectadaEn) / 1000));
      },
      resumen() {
        return { estado, callId, peer, video, iniciadaEn, conectadaEn, terminadaEn, motivo };
      },
    };
  }

  // "1:05" / "12:03" para el temporizador de la interfaz.
  function formatearDuracion(segundos) {
    const s = Math.max(0, Math.floor(segundos));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  // Identificador de llamada único sin depender de crypto del navegador.
  function nuevoCallId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return { ESTADOS, TRANSICIONES, crear, formatearDuracion, nuevoCallId, esFinal };
});
