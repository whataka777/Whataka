/* Normalización de la dirección del relé (puro, sin navegador).
 *
 * La app se sirve por HTTPS, así que un `ws://` o un `http://localhost` guardado
 * en localStorage deja el WebSocket bloqueado o apuntando a una máquina que no
 * existe en el móvil: la app se queda "desconectada" para siempre y sin pista.
 * Aquí se decide qué dirección es realmente utilizable.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhaTakaRelayUrl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOSTS_LOCALES = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'];

  function quitaBarras(valor) {
    return String(valor || '').trim().replace(/\/+$/, '');
  }

  // Host de una URL http(s); null si no se puede leer.
  function hostDe(url) {
    const m = /^https?:\/\/([^/?#]+)/i.exec(url);
    if (!m) return null;
    return m[1].replace(/:\d+$/, '').toLowerCase();
  }

  function esLocal(url) {
    const host = hostDe(url);
    return host !== null && HOSTS_LOCALES.includes(host);
  }

  // Devuelve la dirección utilizable o '' para usar la oficial.
  //  - 'http://' pasa a 'https://' si la página es https (si no, el navegador
  //    bloquea el WebSocket por contenido mixto).
  //  - localhost / 127.0.0.1 solo valen si la propia app se abre en local
  //    (desarrollo); desde el móvil apuntan a una máquina que no existe.
  function normalizar(valor, opciones) {
    const opts = opciones || {};
    const oficial = quitaBarras(opts.oficial || '');
    let url = quitaBarras(valor);
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) return '';
    if (esLocal(url) && !opts.permiteLocal) return '';
    if (opts.protocolo === 'https:' && /^http:\/\//i.test(url)) {
      url = 'https://' + url.slice('http://'.length);
    }
    if (url === oficial) return '';
    return url;
  }

  // Motivo legible para avisar al usuario; '' si no hay nada que contar.
  function motivoAjuste(valor, opciones) {
    const opts = opciones || {};
    const url = quitaBarras(valor);
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) return 'La dirección debe empezar por http:// o https://';
    if (esLocal(url) && !opts.permiteLocal) return 'Una dirección local no funciona desde otro dispositivo';
    if (opts.protocolo === 'https:' && /^http:\/\//i.test(url)) return 'Se ha cambiado a https:// para que el navegador no bloquee la conexión';
    if (url === quitaBarras(opts.oficial || '')) return '';
    return '';
  }

  // Resultado completo para el formulario de ajustes.
  //   utilizable: la dirección escrita tiene sentido (se puede guardar o vaciar)
  //   url: lo que hay que guardar ('' = usar la oficial)
  //   motivo: aviso para el usuario, '' si no hay nada que decir
  function analizar(valor, opciones) {
    const o = opciones || {};
    const url = quitaBarras(valor);
    const motivo = motivoAjuste(url, o);
    const sintaxisOk = /^https?:\/\//i.test(url) && (o.permiteLocal || !esLocal(url));
    return {
      utilizable: !url || sintaxisOk,
      url: normalizar(url, o),
      motivo,
    };
  }

  return { normalizar, motivoAjuste, analizar, esLocal, hostDe };
});
