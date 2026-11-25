# Whataka 🥭

Mensajería **P2P cifrada de extremo a extremo** instalable como app (PWA).
El servidor es un **relé tonto**: reenvía sobres cifrados y mantiene la
presencia de los nodos, pero nunca ve el texto en claro.

- App: <https://whataka777.github.io/Whataka/>
- Relé: `https://whataka-relay.onrender.com`

> 📄 ¿Vas a lanzar el proyecto en Polygon real? Lee
> [`docs/PLAN-LANZAMIENTO.md`](docs/PLAN-LANZAMIENTO.md): pasos, costes y
> cuánto dinero hace falta.
>
> 📈 ¿Tienes poco capital? Lee
> [`docs/CRECER-CON-POCO-CAPITAL.md`](docs/CRECER-CON-POCO-CAPITAL.md):
> publicidad, patrocinadores, referidos, subvenciones y utilidad del token.
>
> 🔥 ¿Pensando en vender acciones o en quemar tokens? Lee
> [`docs/ACCIONES-Y-QUEMA.md`](docs/ACCIONES-Y-QUEMA.md): por qué lo primero es
> ilegal y por qué lo segundo (suscripción + quema) es una gran idea.
>
> 👑 ¿Cómo funcionan los niveles (Bronce → Diamante)? Lee
> [`docs/NIVELES.md`](docs/NIVELES.md): la escalera, los precios, las ventajas y
> cómo cada pago quema tokens.
>
> 🏦 ¿Se acaban los 100.000.000 de WTK? Lee
> [`docs/FONDO-Y-SUPPLY.md`](docs/FONDO-Y-SUPPLY.md): el minado no crea tokens,
> reparte el fondo, y cómo recargarlo sin acuñar nada nuevo.
>
> 🔄 ¿Comprar y vender WTK dentro de la app y cobrar comisión? Lee
> [`docs/EXCHANGE-Y-RUEDA.md`](docs/EXCHANGE-Y-RUEDA.md): la "rueda" funciona,
> pero exige licencia MiCA (150.000 €). La vía legal y barata es un botón a un DEX.
>
> 🎁 ¿Donaciones (envío y recepción) en vez de compra-venta? Lee
> [`docs/DONACIONES.md`](docs/DONACIONES.md): sin custodia, es legal y no necesita
> licencia; da uso al token, pero no precio. Cuidado con las tres trampas.
>
> 🚨 ¿Donar USDT → cambiar a WTK → donar → cambiar a USDT y retirar? Lee
> [`docs/FLUJO-DONACIONES-Y-CAMBIOS.md`](docs/FLUJO-DONACIONES-Y-CAMBIOS.md): los
> cambios y el retiro son pasos regulados, y el flujo entero parece blanqueo.
>
> 💶 ¿Cobrar una comisión por mantener la app como "donación al creador"? Lee
> [`docs/COMISION-MANTENIMIENTO.md`](docs/COMISION-MANTENIMIENTO.md): cobrar es
> legal, pero una cuota obligatoria NO es una donación. No mezcles las dos.
>
> 🥗 ¿Cómo recibo dinero para subsistir con la app? Lee
> [`docs/COMO-RECIBIR-DINERO.md`](docs/COMO-RECIBIR-DINERO.md): el orden correcto,
> Stripe, cuántos usuarios necesitas y el plan paso a paso.

## Qué incluye

| Capa | Archivo | Qué hace |
| --- | --- | --- |
| Interfaz | `index.html` | PWA estilo WhatsApp en tonos morados con pestañas Chats, Novedades, Minería y Ajustes. |
| Lógica | `app.js` | Identidad, cifrado, chat, estados y reportes de minería. |
| Offline | `sw.js` + `manifest.webmanifest` | Instalación en pantalla de inicio y caché de los recursos propios. |
| Relé | `server.js` | HTTP + WebSocket: presencia, intercambio de claves, reenvío de sobres y verificación de firmas. |

## Criptografía

Todo ocurre en el navegador, con WebCrypto:

- **Identidad**: par ECDSA P-256. El Peer ID (`wt1…`) es `base58(SHA-256(clave pública))`.
- **Intercambio de claves**: ECDH P-256 entre pares.
- **Derivación**: HKDF-SHA256 con sal `hash(peerA|peerB)` ordenado.
- **Mensajes**: AES-256-GCM con IV aleatorio por mensaje.
- **Reportes de minería**: firma ECDSA P-256 (IEEE P1363) verificada en el relé con Node `crypto`.

El relé solo transporta `{iv, ct}`. Sin las claves privadas, el contenido es ruido.

## Cómo usarla

1. Abre <https://whataka777.github.io/Whataka/> en el móvil.
2. En el navegador, pulsa **Añadir a la pantalla de inicio** para instalarla.
3. En **Ajustes**, copia tu **Peer ID** y pásaselo a tu contacto.
4. Añade el Peer ID del otro con el botón **➕**. Ambos deben estar en línea la
   primera vez para intercambiar claves públicas.
5. Escribe: el mensaje sale cifrado y solo el destinatario puede abrirlo.

El Peer ID y las conversaciones viven en `localStorage` del dispositivo.

## Desarrollo

```bash
npm install
npm start          # relé en http://localhost:10000
npm test           # 7 pruebas del relé (presencia, claves, cifrado, firmas)
```

Para probar la app contra un relé local:

```
http://localhost:3000/?relay=http://localhost:10000
```

El parámetro `relay` (o `localStorage['whataka.relay']`) permite apuntar a
cualquier nodo sin recompilar. Sin parámetro se usa el relé de Render.

## Despliegue

**GitHub Pages** — sirve la app estática desde la rama `main` (carpeta raíz).

**Render** — `render.yaml` define el servicio `whataka-relay`:

- Build: `npm install`
- Start: `npm start`
- Health check: `/health`
- `autoDeploy: true` (cada push a `main` redespliega el relé)
- `CANONICAL_HOST` (por defecto `whataka.vip`): las páginas que llegan por el
  subdominio `*.onrender.com` se redirigen al dominio propio. La identidad vive
  en `localStorage`, que es por origen, así que dos direcciones para la misma
  app significan dos Peer ID distintos y contactos que "desaparecen".

El flujo `.github/workflows/keep-alive.yml` saluda al relé cada 5 minutos para
que el plan gratuito de Render no lo duerma: al despertar tarda 30-60 s y las
llamadas en curso se cortan. Un servicio siempre despierto consume ~730 de las
750 horas mensuales del plan gratuito.

## API del relé

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Estado, pares conectados y uptime. |
| `GET` | `/api/peers` | Lista de nodos en línea. |
| `POST` | `/api/mining/report` | Reporte de minería firmado; devuelve `score` y `reward`. |
| `GET` | `/api/mining/:peerId` | Acumulado del nodo. |
| `GET` | `/api/push/key` | Clave pública VAPID para suscribir el móvil. |
| `POST` | `/api/push/subscribe` | Guarda la suscripción push de un Peer ID. |
| `POST` | `/api/push/unsubscribe` | Borra la suscripción de un dispositivo. |
| `WS` | `/relay` | Presencia, `getkey` y reenvío de sobres. |

### Protocolo WebSocket

```jsonc
// cliente → relé
{ "t": "hello",  "id": "wt1…", "name": "Ana", "signPub": "…", "agreePub": "…" }
{ "t": "getkey", "id": "wt1…" }
{ "t": "msg",    "to": "wt1…", "iv": "…", "ct": "…" }

// relé → cliente
{ "t": "presence", "peers": [ … ] }
{ "t": "key",      "id": "wt1…", "agreePub": "…" }
{ "t": "msg",      "from": "wt1…", "iv": "…", "ct": "…" }
```

## Mensajes a quien no está conectado

Un móvil con la app cerrada no mantiene la conexión: el sistema la corta. Para
que eso no pierda mensajes, el relé guarda los sobres cifrados en un buzón y
los entrega en cuanto el contacto vuelve a abrir Whataka.

- El buzón aguarda **7 días** (`BUZON_TTL_MS`), hasta 200 mensajes y 2 MB por
  contacto. Pasado el plazo se borran solos.
- El sobre sigue cifrado de extremo a extremo: el relé guarda el mismo
  criptograma que habría reenviado y no puede leerlo.
- Mientras no llega el acuse del destinatario, el mensaje se reintenta en la
  siguiente conexión. El acuse evita duplicados si el móvil se corta a medias.
- En el chat el estado es real: reloj mientras espera en el buzón, una palomita
  al salir, dos al confirmarse la entrega, y un triángulo rojo si no cupo.
- Al guardar un mensaje el relé manda un aviso push (como mucho uno cada 30 s
  por contacto) para que el teléfono se entere sin abrir la app.

La clave pública del contacto se sirve también cuando está desconectado, así
que se le puede escribir sin esperar a que aparezca. Se conserva en memoria
mientras el relé viva y en el propio móvil, que ya la guardó del primer saludo.

## Reconexión

La app reconecta sola con espera progresiva (1, 2, 4… hasta 30 s) y al instante
cuando el móvil vuelve a primer plano o recupera cobertura. Un latido cada 25 s
mantiene viva la conexión a través de los NAT móviles, que cortan los enlaces
mudos en menos de un minuto.

## Llamadas con la app cerrada

El relé manda un aviso push al teléfono cuando alguien llama y el destinatario
no está conectado. El sistema despierta el service worker, muestra la llamada
con vibración y, al tocar **Contestar**, abre Whataka con la oferta que el relé
dejó guardada (75 segundos). El llamante ya no cuelga al instante: se queda
esperando y ve "Avisando al contacto…".

Para que funcione en un móvil de verdad hacen falta tres cosas:

1. **Claves VAPID en el relé.** Se generan una vez y se pegan en Render:
   `npx web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY` y
   `VAPID_PRIVATE_KEY`. Sin ellas el relé inventa claves al arrancar y cada
   reinicio invalida los avisos (la app las renueva al abrirse, pero mientras
   tanto nadie recibe llamadas).
2. **Permiso de avisos concedido** en la app (menú de permisos).
3. **La app instalada en la pantalla de inicio** en iPhone: iOS solo entrega
   push a PWAs instaladas y desde iOS 16.4.

Límites que no se pueden saltar desde la web: en iPhone el aviso es una
notificación del sistema, no una pantalla de llamada a pantalla completa como
WhatsApp (eso requiere CallKit y una app nativa). En Android el aviso llega con
vibración y botones, pero tampoco puede ocupar la pantalla. Además, si el
teléfono tiene la app cerrada y **nunca** la abrió con los avisos concedidos, el
relé no tiene a dónde mandar el push: esa persona tiene que abrir Whataka una
vez. Y si el relé está dormido (plan gratuito de Render), el aviso sale cuando
el llamante lo despierta al conectar.

## Alcance y límites

- Los estados se guardan en el dispositivo y se comparten con la red; todavía no
  se difunden por GossipSub real.
- Las llamadas y videollamadas son P2P reales con WebRTC: el audio y el vídeo
  van cifrados (DTLS-SRTP) directos entre los dos, y el relé solo reenvía la
  negociación (offer/answer/ICE). Necesitan permiso de micrófono/cámara y, en
  redes móviles o NAT estricto, un servidor TURN (se configura con las variables
  `ICE_TURN_URL`, `ICE_TURN_USERNAME` e `ICE_TURN_CREDENTIAL`; ver `/api/ice`).
- Las recompensas WTK ya son on-chain: el relé firma un vale y el contrato
  `WhaTakaTTC` paga WTK en Polygon Amoy. El lanzamiento en Polygon real (137)
  está planificado en [`docs/PLAN-LANZAMIENTO.md`](docs/PLAN-LANZAMIENTO.md).

## Licencia

MIT — ver `LICENSE`.
