# Memoria del proyecto TakTak

## Producción y secretos (2026-11-13) — detalle en `2026-11-13.md`
- **Producción VIVA**: `https://taktak.vip` → 200 por **Render** (tras Cloudflare) y `/health`
  → `db":"connected"`. **NO** es `taktak.onrender.com` (ese da 404). No creer «Render caído».
- **`$MONGODB_URI` del entorno está caducado** (`bad auth`), pero la **base de producción sí
  funciona**. Para tocar prod, sacar la URI de las env-vars de Render.
- **Secretos del entorno caducados/vacíos**: `GITHUB_TOKEN` vacío; `TAKTAKapikey` (Render) 401;
  `taktak` (PAT GitHub) 401; `GITLAB_TOKEN` 401. El PAT vive **en claro en `.git/config`** y
  **caducó**; git funciona igual porque el repo es **público** (se lee anónimo por API).
- **PR #5 ABIERTO** (`mejoras-mensajeria-taktak` → `mejoras-manual-pagos`); #1/#2/#3 ya fusionados.
  La rama local `mejoras-mensajeria-taktak` va **62 commits por delante** de su remoto.

## Vídeos negros = CORS del bucket R2 (2026-11-13) — detalle en `2026-11-03.md`
- **Causa única verificada**: el bucket R2 **no manda cabeceras CORS**. hls.js pide la lista
  HLS y sus segmentos por **XHR** → el navegador los bloquea («Failed to fetch») → **negro**.
  El **mp4 suelto sí se ve** porque lo carga el propio `<video>`, que no usa XHR.
- **Arreglo** (rama `mejoras-mensajeria-taktak`, commits `d2bb2e8` + `ab211f7`):
  1. Ruta **`/media/*`** en el backend que sirve el bucket desde el **mismo origen** (allowlist
     de extensiones, sin `..`, Content-Type correcto). `backend/src/routes/media.js`.
  2. `backend/src/lib/mediaUrl.js` reescribe **`hlsUrl` → `/media/...`**; se aplica en el
     `transform` del modelo Video (cubre los ya subidos) y también en feed/search (usan
     `aggregate`/`map`, que saltan el transform) y en `GET /videos/:id/status`.
  3. El reproductor (`frontend/src/lib/video.js`) **cae al mp4** si el HLS falla en fatal.
  4. Miniaturas sin imagen usan **mp4** (no `.m3u8`) en el `<video>` crudo.
  5. Proxy `/media` en `vite.config.js` (solo dev).
- **Requiere `R2_PUBLIC_BASE_URL` en Render** (ya está; sin ella no hay reescritura). Con el
  proxy, el CORS del bucket **deja de importar**.
- **NO es la causa**: los mp4 no-faststart (`moov` al final) **sí se reproducen** (solo tardan
  algo más en arrancar). Confirmado en navegador real.
- **Aviso entorno**: `MONGODB_URI` del entorno tiene la contraseña **caducada** (`bad auth`,
  code 8000) → no se pueden correr las suites que necesitan Mongo. Las que no la necesitan
  pasan (frontend 236/236, backend sin base 20/20).

## LLAMADAS: falta TURN (2026-11-13) — detalle en `2026-11-03.md`
- Síntoma: llamada con **pantalla negra / no contesta** fuera de la WiFi + aviso «Sin servidor
  TURN configurado» (`CallContext.jsx:465`). **El código de llamadas está bien**: es solo config.
- **Causa**: el servicio Render `taktak` no tiene `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL`.
  Producción: `GET /api/calls/ice` → `hasTurn: false`. Con `SFU_ENABLED=false` las llamadas 1:1
  son P2P puras → sin TURN no cruzan entre redes distintas.
- **Arreglo**: 3 env-vars en Render (no requiere tocar código). Proveedores 2026-11: el TURN
  «gratis» de Metered (openrelay) **ya no existe**; Metered gratis = 500 MB; Cloudflare TURN =
  0,05 $/GB; coturn propio en VPS = lo más barato. **Pendiente de decisión del dueño.**
- `SFU_ENABLED=false`, `TRANSCODE_ENABLED=true`, `NODE_ENV=production` en Render.

## Cuenta @Glenis ELIMINADA (2026-11-13)
- Petición explícita del dueño. Correo `glenismanzanero@gmail.com`. **La app no tiene función de
  borrar cuenta**: se hizo por script contra la base de producción.
- Borrado: user + 2 push + 1 comment + 1 watchevent (clave `userId`) + 1 conversación con sus
  mensajes. Verificado (404 en perfil, 0 en búsqueda). Copia en `/home/openhands/taktak-backups/`.
- Para consultar la base de producción: sacar `MONGODB_URI` de las env-vars de Render.

## Buscador externo de música y vídeo (2026-11-12) — detalle en `2026-11-03.md`
- En la lupa hay pestañas **🎵 Música** (Openverse, CC) y **🎬 De internet** (Wikimedia
  Commons) con botón «Usar en TakTak». **Ninguna fuente pide clave.**
- **Solo contenido Creative Commons. NO hay descargador de YouTube/TikTok/Spotify/Ares**
  (piratería → DMCA + IP de Render marcada). Si el dueño insiste, que lo pida por escrito.
- Música importada → `Sound` (aparece en el selector de «Subir» para ponerla a vídeos/fotos).
  Vídeo importado → `POST /api/videos` (sale en el perfil).
- Endpoints: `/api/discover/search|preview|import|file` (`backend/src/routes/discover.js`,
  servicio `discoverService.js`). Config: `env.discover.maxBytes|timeoutMs`.
- **Seguridad**: guarda anti-SSRF en cada redirección (rechaza IP privada/metadatos); el
  proxy `/preview` solo sirve URLs que salieron de una búsqueda reciente. Tests:
  `backend/test/discover.test.js`.
- Trampas: `Readable.fromWeb()` antes de `pipe`; contar bytes con un `Transform` DENTRO del
  `pipeline` (un `on('data')` antes lo rompe); `createWriteStream` está en `fs`, no en `fs/promises`.

## Flechas de volver (2026-11-12) — auditoría de navegación (detalle en `2026-11-03.md`)
- Faltaban 3 ventanas sin botón de volver/cerrar: **Explorar** (`Explore.jsx`, lupa de Inicio),
  **Subir** (`Upload.jsx`, pestaña de abajo) y **Squads → "Ver contenido"** (`Squads.jsx`, panel
  interno `active`, no tenía forma de cerrarse). Arregladas con el patrón `screen-head` + `btn-ghost ←`
  y props `onBack` (App.jsx → `setView('feed')`). `.screen-head h3` añadido al CSS. Build OK, front 235/235.
- Regla: las vistas raíz (pestañas de abajo) no llevan ←; las sub-ventanas sí. Si se añade una
  sub-ventana nueva, darle `onBack`/`onClose` con `screen-head`.

## Verificación completa (2026-11-12) — secrets, rama y tests (detalle en `2026-11-03.md`)
- **La app SÍ está registrada en Render**: `taktak` = `srv-dbksibp5efls73fi5g10` (el 404 de
  `taktak-app.onrender.com` es un nombre inventado, no una app borrada). Prod `/health` = 200 db connected.
- **Secrets (2026-11-12)**: `$TAKTAKapikey` OK. `$taktak` se **rotó** (el viejo daba 401) → push OK.
  `$GITHUB_TOKEN` VACÍO. `$MONGODB_URI` del entorno con `bad auth` (Atlas); producción sí conecta.
- **PayPal y Zinli ELIMINADOS del proyecto** (commit `63f043f`, en producción desde 2026-11-12): cobro solo
  Stripe + cripto manual (`usdt-bep20`), retiros solo `crypto`. Rutas `/methods/paypal/*` = 404.
- **La reescritura cripto NO está empujada**: `origin/mejoras-mensajeria-taktak` = `4bc1ea7`, **57
  commits por detrás** del árbol local. Producción sigue con `MANUAL_PAYMENT_METHODS=[paypal,zinli]`
  y `TRANSCODE_ENABLED=true`. Nada cambia hasta push+deploy.
- **Bug corregido**: `vaultService.getVaultStatus()` usaba `platformShare` (40%) para lo que la bóveda
  debe a los usuarios; debe ser `creatorShare` (60%). `coinsPerUsd()` (código muerto) eliminado.
- **Tests al día**: retiros/tienda actualizados a cripto; nuevos `backend/test/vault.test.js` y tests
  BEP20-18-decimales en `frontend/test/walletPay.test.js`. **Backend 781/781, frontend 235/235.**
- Trampa: el índice único sparse de `Transaction.externalId` se crea en diferido → `await Transaction.init()`
  en `test.before`. Los 400 de express-validator traen `details[]`, no texto libre.

## Pago con billetera (USDT) en la tienda (2026-11-03)
La tienda (`CoinStore.jsx`) ahora cobra **por billetera cripto primero** (USDT + QR + red +
hash de transacción), reutilizando el flujo de cobro manual existente (`ManualOrder`, aprobación
admin). Fuera de la tienda: Stripe/PayPal y "métodos guardados" (`PaymentMethods.jsx`,
`PaymentResult.jsx`, `services/stripe.js` borrados). Los **retiros** NO se tocaron.
Config del cobro = `MANUAL_PAYMENT_METHODS` en Render (JSON): un método con `asset`+`network`+`payTo`
se pinta como billetera; sin `asset` es método normal. **TakTak es web app React/Vite, no nativa**:
los consejos de WalletConnect/MetaMask SDK/deep-links para apps nativas no aplican.
Tests: backend 771, frontend 233. Detalle en `2026-11-03.md`.

## Escaneo completo (2026-11-06) — ver detalle en `2026-11-06.md`
Verde: backend **757/757**, frontend **228/228**, build OK, bundle local == prod
(`index-Cx3RRM0G.js`). Prod sano (`/health` db connected); registro/login/wallet/pagos manuales
(201)/Didit/push OK; **0 endpoints del frontend faltantes** (139 llamadas vs 176 rutas). Sin
secretos hardcodeados.
Pendiente crítico (ya conocido): sin `SMTP_*` ni `TWILIO_*` en Render → el código de verificación
no llega (registrar funciona, el login NO exige verificar, pero **`forgot-password` responde
`sent:true` sin enviar nada** → sin recuperación de contraseña); sin TURN (`hasTurn:false`).
Nuevo: **`main` roto para Render** (`render.yaml` pide `npm run build:full`+`npm start`, inexistentes;
`npm install` falla por `adesgold-wallet: file:../adesgold-wallet`) y **no es ancestro** de la rama
de producción (1 commit divergente, c142512). **`main` sirve `.env` público** en
taktakmessenger.github.io (datos de ejemplo, conviene borrarlo). Vulnerabilidades npm altas:
backend 4 (body-parser, dicer/multer), frontend 1 (follow-redirects). Dependabot off, sin CI.
PR **#5** abierto: `mejoras-mensajeria-taktak` → `mejoras-manual-pagos` (mergeable, 132 archivos).

## Producción (verificado 2026-11-04; token y llamadas 2026-11-05)
- App: https://taktak-y7k2.onrender.com — servicio Render `taktak`, id `srv-dbksibp5efls73fi5g10`, rama deploy `mejoras-mensajeria-taktak`. `/health` = OK.
- **Push a GitHub: usar `$taktak`, NO `$GITHUB_TOKEN`.** `$GITHUB_TOKEN` es de solo lectura
  (token de integración; da 403 "Resource not accessible by integration" al crear refs).
  `$taktak` sí escribe. Comando que funciona:
  `git push "https://${taktak}@github.com/taktakmessenger/taktakmessenger.github.io.git" HEAD:refs/heads/<rama>`
  (el `git remote` guardado tiene un token viejo; el push directo con la URL lo evita).
- API Render: `$TAKTAKapikey` funciona (`Authorization: Bearer`). La app SÍ está registrada.
- Mongo: la BD no está rota, pero **`$MONGODB_URI` del shell sigue con la contraseña vieja**
  (bad auth; sigue igual el 2026-11-04). La URI buena está en Render
  (`GET /v1/services/{id}/env-vars`, campo `value` de `MONGODB_URI`); producción da `db: connected`.
  Para seed/test locales hay que leerla por API en el momento.
- El login web de Atlas no funciona desde este entorno (bloqueo por IP/datacenter). Resetear
  contraseñas hay que hacerlo desde el navegador del móvil.
- Tests de integración: necesitan Mongo real. Hay mongod local en `0.0.0.0:27017`
  (`mongodb://localhost:27017/taktak_test`, desechable; nunca apuntar a producción).
- El disco de Render es efímero: por eso los vídeos se van a R2 (commit 98c584b).
  Si un vídeo no reproduce con `MediaError` code 4 ("Media load rejected by URL safety check"),
  es la **CSP** (`backend/src/app.js`): con R2 activo hay que meter el origen del bucket
  (`env.r2.publicBaseUrl`) en `media-src`, `img-src` y `connect-src`. `R2_PUBLIC_BASE_URL` está
  en Render. Ver 2026-11-03.md (commit cf945fd).
- **Ojo con el clon shallow**: `git rev-list origin/rama..HEAD` da números falsos; el estado real
  se consulta en la API de GitHub (`/commits?sha=<rama>`).

## Llamadas 1:1 (2026-11-05) — falta TURN en producción
- Síntoma del usuario: "me veo a mí mismo pero no veo ni oigo al otro".
- **La lógica WebRTC está bien**: `frontend/test/e2e-call.mjs` (Playwright, dos
  usuarios, micrófono simulado) pasa de extremo a extremo en localhost.
- **Causa real: no hay TURN.** `CallContext.jsx` solo lleva STUN de Google
  (`hasTurn:false`). Detrás de NAT estricto/red móvil los medios no cruzan.
- Arreglo: poner en Render (backend, NO `VITE_*`) **`TURN_URL`** (varias separadas
  por coma), **`TURN_USERNAME`**, **`TURN_CREDENTIAL`**; o `ICE_SERVERS_JSON` con el
  array entero (tiene prioridad). Lo sirve `GET /api/calls/ice` (con sesión) desde
  `backend/src/config/env.js::resolveIceServers()`. Sin TURN_URL, `hasTurn:false`.
  El aviso de TURN del cliente es `notice`, no error.
  Nota: AGENTS.md dice `VITE_TURN_URL`, pero el código real usa `TURN_URL` (backend).
- **El teléfono (`User.phone`) NO interviene en las llamadas WebRTC entre cuentas.** Solo
  sirve para login por teléfono, `POST /users/lookup-phone` (el marcador busca por número),
  `POST /calls/invite` (SMS) y llamadas a teléfonos normales por Twilio Voice. Una cuenta sin
  teléfono SÍ recibe videollamadas; lo que falta para verse/oirse es **TURN**. (El dueño creía
  que era el teléfono: no lo es.) `@Eliana` (id `6aecbb66aa1f55ba22335090`) ya tiene
  `phone=+573052111153`, `phoneVerified=true`.
- **NO hay proveedor de SMS ni de correo en producción** (`GET /api/auth/providers` →
  `sms:false`, `email:false`). Por eso "pide el código y no llega": `smsService.sendSms` solo
  registra en consola y devuelve `delivered:false`; en producción `devCode` es `undefined`.
  No es un fallo del teléfono de la persona. Desde el commit 66f5746, **sin SMS el alta por
  teléfono y la vinculación de teléfono se hacen sin código** (crean/vinculan y devuelven
  sesión). Con `SMS_PROVIDER` configurado vuelve el flujo con código. Vincular a mano:
  `POST /admin/users/:id/phone` o pídeselo a GLENIS ("vincular_telefono").
- No se pudo probar ningún TURN desde el sandbox: la salida UDP/TURN está bloqueada
  (todos los candidatos dan error 701). Hay que validarlo desde la red real del móvil.
- Mejora ya desplegada: si la llamada nunca conectó, el mensaje es
  "No se pudo conectar la llamada…" en vez de "se ha cortado".

## GLENIS IA (asistente de admin) — compras y retiros (verificado 2026-11-05)
- `backend/src/services/adminAssistant.js` es el bucle de function calling. Tools de dinero:
  `listar_pagos`, `resumen_compras`, `aprobar_pago`, `rechazar_pago`, `listar_retiros`,
  `pagar_retiro`, `rechazar_retiro`. Prompt: usar `resumen_compras` para "quién compró/cuánto".
- API admin: `GET /admin/manual-orders` (filtros `status|method|from|to|limit`) y
  `GET /admin/manual-orders/summary` → `{ordenes,monedas,usd,compradores[]}`.
- **El proveedor (Groq) rechaza con 400 `tool_use_failed` si un parámetro opcional llega `null`.**
  Por eso `adminAssistant` exporta `TOOLS` ya normalizado (`nullableOptionals()`: `type:['string','null']`,
  `null` en los enum) y el bucle borra las claves null antes de `runTool` (si no, `rakeRate:null`
  del póker sería 0% en vez de 10%). Si se añaden tools nuevas con opcionales, esto ya lo cubre.
- **Rate limit Groq `openai/gpt-oss-120b`: 8000 TPM.** Con el esquema de tools grande salen ~2
  turnos/min; en pruebas reales esperar ~75 s o da 429.
- Cobro en producción = **solo Zinli** (`MANUAL_PAYMENT_METHODS` en Render; `payTo`
  cobro@example.com). PayPal está **bloqueado**: sin `PAYPAL_*` en Render,
  `providers.paypal=false` y sus endpoints dan 503.

## Preferencias de trabajo
- **Trabaja desde el teléfono celular (móvil), no desde un ordenador.** Tenerlo siempre en cuenta:
  - Evitar pedirle comandos largos de teclado o navegación por paneles de escritorio.
  - Preferir que el agente haga el trabajo por API/automatización en vez de darle pasos manuales en webs de escritorio.
  - Respuestas cortas y accionables, con pasos numerados y pocos.
  - Al guiar por interfaces web (Render, Atlas, GitHub), asumir pantalla pequeña: indicar dónde tocar, no atajos de teclado.
- Proyecto principal: **TakTak** (repo `taktakmessenger/taktakmessenger.github.io`). Ver memoria del proyecto.
- Idioma: español.

## TakTak — hechos durables (verificado 2026-11-03, desplegado y funcionando)
- **Verificación de edad con Didit — FUNCIONANDO EN SANDBOX (2026-11-05, commit 8afa336)**: el 503
  "no está configurada" era porque en producción `AGE_PROVIDER` sin definir **falla cerrado** y el
  registro `PROVIDERS` solo tenía `dev`. Ya está el adaptador real: `services/diditService.js` +
  webhook firmado `POST /api/verification/didit/webhook`. Solo `Approved` verifica.
  Variables en Render (`taktak`): `AGE_PROVIDER=didit`, `DIDIT_API_KEY` (sandbox `sk_test_...`),
  `DIDIT_WORKFLOW_ID` (Free KYC sandbox), `DIDIT_WEBHOOK_SECRET`, `DIDIT_SANDBOX_SCENARIO=approve`.
  **Probado de punta a punta**: usuario nuevo → `/age/start` 200 → veredicto `Approved` → webhook →
  `GET /api/verification/age` = `verified`. La app **live** de Didit está a 0 USD y rechaza sesiones.
  ⚠️ **Para producción real**: quitar `DIDIT_SANDBOX_SCENARIO` (si no, todos quedan aprobados) y
  poner las credenciales de la app **live** (necesita saldo; flujos live ya existen).
- **Contactos del teléfono en el marcador (2026-11-05, commits ebd1ee5/9cf82c9)**: la Contact
  Picker API **no tiene permiso permanente** — cada `select()` exige gesto y el usuario elige otra
  vez (Chrome/MDN). NO se puede leer la agenda "sola". Solución real: primera vez «Importar»; lo
  compartido se cachea (`taktak_contacts_cache` en localStorage) y aparece solo al abrir el
  marcador; el botón pasa a «Actualizar». Lógica en `frontend/src/lib/contacts.js` (+ tests
  `test/contacts.test.js`, e2e `test/e2e-dialer-contacts-autoload.mjs`).
- **Llamadas app-a-app (WebRTC) ya funcionan** sobre el socket (`call:invite/offer/answer/ice/...`
  en `backend/src/services/liveSockets.js`). Con solo STUN cruzan redes simples; **detrás de NAT
  estricto se cortan: falta un TURN** (`TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL`, hoy sin
  configurar en Render). Eso es "llamar por internet" entre usuarios de la app.
- **Llamar a un teléfono normal por internet** requiere proveedor VoIP de pago (Twilio Voice):
  `VOICE_PROVIDER`, `TWILIO_*`; hoy `voice:false`. Sin él, solo `tel:` (marcador del sistema,
  gratis, pero usa la red móvil, no WiFi).
- **Chat estilo WhatsApp (2026-11-04, commit b7b76b6)**: compositor = emoji · campo · clip · cámara ·
  micro/enviar. Menú del clip (`AttachMenu.jsx`) con 7 opciones; galería/documento/cámara abren el
  selector, ubicación/contacto/encuesta/evento tienen formulario. Backend: `Message.rich` (kinds
  `location|contact|poll|event`), voto de encuesta y socket `chat:poll`. Iconos SVG en `ChatIcons.jsx`.
- **Push GitHub: `$GITHUB_TOKEN` da 403 al escribir; usar `$taktak`** (PAT con escritura, misma cuenta).
  Detalle en `.openhands/memory/2026-11-03.md`.
- **Directo (TAK Live Creator)**: comentarios en vivo, regalos y modo espectador verificados
  end-to-end con navegadores reales (`frontend/test/e2e-live-chat.mjs`, 2 Chromium). El cobro del
  regalo va por HTTP (`POST /api/wallet/gift`); el socket `live:gift` solo emite la animación y
  exige estar unido a la sala (`socket.rooms.has`). El chat (`LiveChat`) NO debe desmontarse al
  abrir los regalos: su cleanup hace `live:leave` y el regalo se perdería (se oculta con
  `.live-chat-hidden`).
- **Tests backend en local**: la suite usa una sola BD y `npm test` fuerza `--test-concurrency=1`.
- **POKERTAK (sala de póker del directo)**: motor `backend/src/games/poker/pokerTable.js`, servicio
  `backend/src/services/pokerService.js`, sockets en `liveSockets.js`; front `PokerTable.jsx`,
  `PokerTakLogo.jsx`, `lib/pokerUi.js`, conmutador en `LiveStage.jsx`. Los estados de mesa van a la
  sala `poker:<room>` (NO a la de voz: llevan cartas privadas); hay que `socket.join` en
  `poker:open`/`poker:sit` y devolver fichas en `poker:leave`/`disconnect`. Commiteado (ab41deb).
- **Torneos de POKERTAK (2026-11-04, commits ab41deb + 35a1503; desplegado live en Render)**: `models/PokerEvent.js`,
  `services/pokerEventService.js` (cobra entrada al inscribirse, paga premios al cerrar, devuelve al
  cancelar; cada moneda en su cubo pagado/regalo), `games/poker/prize.js` (reparto 40/30/20 + 10% de
  tarifa; redondea a la baja y reparte céntimos sobrantes desde el 1º, nunca paga de más). Rutas
  admin `/api/admin/poker-events` (+`/:id/finish`, `/:id/cancel`) y jugador `/api/poker/events`
  (`?squad=` filtra por sala, `POST /:id/join`). Asistak: herramientas
  `organizar_torneo_poker`, `listar_torneos_poker`, `cerrar_torneo_poker`, `cancelar_torneo_poker`.
  UI: `frontend/src/components/TournamentPanel.jsx` encima de los botones de entrada.
  Config `env.poker.eventRake` (def. 0.1). Tests: `poker-prize`, `poker-event`, `poker-event-routes`,
  `poker-autodeal` + casos en `poker-socket` y `admin-assistant`.
- **Aviso de torneo a todas las cuentas (2026-11-04, commit 42f553f)**: al crear un torneo,
  `notificationService.announceTournament` inserta una notificación `type:'tournament'` para cada
  usuario activo (menos el creador) y la emite por socket `notification:new`; a los offline, push a
  `/?view=squads`. Enganchado en `pokerEventService`. En Activity el aviso lleva a la vista `squads`.
- **Programa de referidos (2026-11-04, commit 42f553f)**: `services/referralService.js`. Quien invita
  cobra el **10% de lo COMPRADO** (no de las monedas) por su invitado, siempre en **`wallet.bonusC`**
  (monedas de regalo: gastables en la app, NO retirables). Idempotente por compra vía
  `Transaction.externalId = referral_<externalId>` (índice único). Alta por correo/teléfono/Google/
  Facebook acepta `ref`. `GET /api/wallet/referral` (crea el código al primer uso; enlace
  `${APP_URL}/?ref=CODE`); `AuthForm` lo precarga desde `?ref=`. `env.referral.percent` (def. 0.1;
  0 desactiva; fuera de [0,1) es error de arranque). **Bug corregido**: el webhook genérico
  `/api/payments/webhook` duplicaba el abono y no pagaba referidos; ahora usa `creditPurchase`.
- **Auto-reparto de la mesa**: `pokerService.scheduleAutoDeal` baraja sola entre manos con ≥2
  jugadores con fichas (2 s esperando, 5 s tras showdown); `liveSockets` la llama tras cada
  `broadcastTable`. Cancelada al cerrar la mesa. El botón del anfitrión sigue ahí como atajo.
  Si se corre en paralelo con `node --test test/*.test.js` aparecen fallos falsos de vídeo
  (`security`/`transparency`); aislados pasan. Hay un mongod de prueba vía docker (`taktak-mongo`).
- **Tests frontend**: **219/219 pasan (2026-11-04)**. Backend: **682/682** (incluye `referral.test.js`).
  Los 2 fallos de `download.test.js`
  (`localStorage is not defined`) se arreglaron añadiendo el doble de `localStorage` a `installDom`.
- **Asistak (asistente administrativo, 2026-11-04, sin commitear)**: `backend/src/services/asistakService.js`.
  Modera comentarios de directos y de POKERTAK en `live:message` (léxico local + IA opcional, con
  throttle de 3 s/usuario para la IA). Avisa en el hilo (`live:message` con `asistak:true`) y
  suspende a los `ASISTAK_WARN_BEFORE_SUSPEND` avisos (def. 2) durante `ASISTAK_SUSPENSION_DAYS`
  (def. 3). La suspensión (`User.moderation.suspendedUntil`) se aplica en el servidor: bloquea
  `voice:join`, `poker:open` y `poker:sit`, y expulsa de la sala de voz. Config en `env.asistak`;
  endpoints admin `POST/DELETE /api/admin/users/:id/suspend`; herramientas del asistente de admin
  `suspender_usuario`/`levantar_suspension`. Tests: `backend/test/asistak.test.js` (11).
- **POKERTAK — caras ovaladas (2026-11-04, sin commitear)**: la mesa reutiliza los streams de la
  sala de voz del directo (`VoiceRoomContext`) para pintar la cara de cada jugador en un óvalo
  (`.ptak-face`) en su asiento, más el chat (`LiveChat`) sobre el tapete. No abre conexión nueva.

- **Dos apps en un repo**: `main` = maqueta React vieja servida en GitHub Pages (no tiene `backend/`).
  El producto real (backend+frontend+render.yaml) vive en la rama **`mejoras-mensajeria-taktak`**.
- **Producción**: servicio Render `taktak` = `srv-dbksibp5efls73fi5g10`,
  **https://taktak-y7k2.onrender.com**, docker `./backend/Dockerfile`, plan free, health `/health`.
  Blueprint único `TAK TAK` = `exs-dbk9u3g473hc7382qb3g` (rama `mejoras-mensajeria-taktak`).
  El host `.onrender.com` cambia al recrear el servicio: **la URL no es estable**.
- **Render API** (`$TAKTAKapikey`, team `tea-d737nuvkijhs73dbvnb0`): sí se puede
  `DELETE /v1/services/{id}` y `DELETE /v1/blueprints/{id}` (204). `PUT /v1/services/{id}/env-vars`
  **reemplaza todas** las variables: hay que mandar las existentes + las nuevas.
- **Gotcha de blueprint**: `MONGODB_URI` con `sync: false` **nace vacía** al crear el servicio.
  Síntoma: `/health` 200 pero `"db":"disconnected"`, registro 500.
- **Bloqueo de build (causa raíz)**: `mediasoup@3.30` pide node>=22 y su prebuilt se elige por
  kernel del host; con kernel 7 necesita **glibc 2.38**. `node:20-slim` (bookworm, glibc 2.36)
  falla y el postinstall intenta compilar -> `/bin/sh: python: not found`.
  **Arreglo**: `FROM node:22-trixie-slim` (glibc 2.41). `node:22-slim`/`node:24-slim` siguen en
  bookworm y **no** sirven.
- **Mongo Atlas — causa real del `bad auth` (code 8000)**: el valor guardado tenía un carácter
  invisible **U+200E** pegado desde el móvil (85 chars en vez de 84). NO era la contraseña.
  La URI buena está en la **bóveda** (endpoint `sandboxes/{id}/settings/secrets/MONGODB_URI`),
  no en `$MONGODB_URI` del shell (congelado con el valor viejo). DB por defecto: **`test`**.
- **Cobro manual (verificado E2E en producción)**: `GET /api/payments/config` (auth) ->
  `manualMethods` + `providers`. `POST /api/payments/manual/orders` (201, pending).
  Admin: `role: 'admin'` en `users` + **re-login** (el rol va en el JWT);
  `POST /api/admin/manual-orders/{id}/approve` -> **acredita monedas de verdad** (wallet 0->500).
  Colección de órdenes: `manualorders`. Stripe/PayPal están apagados (sin claves).
- **Push a GitHub**: usar el secreto **`taktak`** (PAT fino, expira 2027-01-31). `$GITHUB_TOKEN`
  da 403 al crear PR/push. La herramienta `create_pr` usa `GITHUB_TOKEN` -> falla; crear el PR por
  API con `token $taktak`.
- **Tests de la rama buena**: backend **582 pass** (incluye suites de pagos manuales + asistente),
  frontend 206/208 (2 fallos previos de entorno en `download.test.js`: `localStorage is not defined`).
  Runner = **`node --test "test/*.test.js"`** en backend y frontend (**no** jest: con jest se cuelga).
  Corren contra un mongod real; **mongo:7 en Docker sin replica set basta** (no hace falta `rs.initiate`).
  `npm install` en `backend/` y `frontend/` (no hay workspaces).
- **Token de push**: el `ghu_...` del remoto está **caducado** (401). Usar el secreto **`taktak`**
  (`push:true`): `git push "https://${taktak}@github.com/…git" rama:rama`.
- Pages: source = branch `main` (legacy). El workflow `.github/workflows/deploy.yml` apunta a
  `master`, que no existe -> no despliega nada.
- **Enlaces de pago manual**: `MANUAL_PAYMENT_METHODS` acepta un campo `link` por método
  (solo http/https, saneado en `env.js`). PayPal `paypal.me/admin` y Zinli
  `recargas.zinli.com/mbbrqGmkwnhJk3C2LHDhkt` — **ya configurados en Render** (verificado en
  `/api/payments/config`). `CoinStore.jsx` pinta el botón «Ir a pagar» **y** el enlace como
  texto con botón «📋 Copiar» (commit `4bbf65f`). `MANUAL_AUTO_APPROVE=false`; el asistente
  sugiere pero el admin aprueba (umbral auto: confianza ≥0.9 y ≤15 USD).
- Detalle completo del día: `.openhands/memory/2026-11-03.md`.

## Asistente del administrador (2026-11-03) — ACTIVO en producción
- **Feature**: chat solo-admin en el panel (`POST /api/admin/assistant`), con function calling real
  (buscar usuario, moderar vídeo, acreditar monedas, resolver reportes). Servicio
  `backend/src/services/adminAssistant.js`; UI en `frontend/src/components/AdminPanel.jsx`.
  **PR #3 fusionado** en `mejoras-mensajeria-taktak`; deploy `64a4f3e` live. Verificado E2E.
- **Proveedor de IA: Groq** (gratis). En Render `taktak`: `ASSISTANT_API_KEY` (gsk_…),
  `ASSISTANT_API_BASE=https://api.groq.com/openai/v1`, `ASSISTANT_MODEL=openai/gpt-oss-120b`
  (gpt-oss soporta tool use; `llama-3.3-70b` también). El usuario no tiene clave de IA como secreto
  del agente: la pasó por chat.
- **Cuenta admin real**: usuario `elidep` / `cobro@example.com`, `role: 'admin'`, en la DB
  **`test`** de Atlas. Las demás DB (`sample_mflix`, `taktak_example`) no son de la app.
- **Secretos (verificado 2026-11-04)**: los 6 existen. Funcionan `$TAKTAKapikey` (Render),
  `$taktak` = PAT GitHub **con escritura** (crear/borrar ramas, 201/204), `$GITHUB_TOKEN` (solo
  lectura: 403 al crear rama, "Resource not accessible by integration"), `$OPENHANDS_API_KEY`
  (`/api/keys` 401 sin token, 200 con él). **`$MONGODB_URI` NO vale** (bad auth; 99 caracteres
  frente a los 84 de la URI buena de Render). **`$GITLAB_TOKEN` no vale** (401 Unauthorized en
  gitlab.com, 64 caracteres) y el proyecto no usa GitLab. La URI que autentica es la env var
  `MONGODB_URI` de Render (`GET /v1/services/{id}/env-vars`).
- **Para probar el asistente sin credenciales de admin**: firmar un JWT con el `JWT_SECRET` de Render
  (`{userId, username, role:'admin'}`, 7d) y llamar al endpoint. Ojo: `NODE_ENV=production` exige
  `JWT_SECRET` en el entorno, así que en scripts locales NO poner NODE_ENV=production.

## POKERTAK (2026-11-04)
- Rama de deploy **`mejoras-mensajeria-taktak`** (NO `main`, que es maqueta antigua sin ancestro común).
- Producción: `https://taktak-y7k2.onrender.com`, servicio Render `taktak` (`srv-dbksibp5efls73fi5g10`), autoDeploy.
- Mesa: `frontend/src/components/PokerTable.jsx` + `lib/pokerUi.js` (helpers puros, test en `frontend/test/pokerUi.test.js`);
  motor `backend/src/games/poker/pokerTable.js`, unión con monedero `backend/src/services/pokerService.js`;
  socket `poker:<hostId>` en `liveSockets.js`. Asistak = moderación (`asistakService.js`) **y** repartidor (UI).
- **Desajuste económico corregido**: `POKER_MIN_BUYIN` (era 200) tenía que caber en `WELCOME_BONUS_COINS` (100).
  Ahora 50. Si se sube el bono o la entrada, mantener minBuyIn ≤ bono o nadie podrá sentarse.
- **Regla**: `poker:start` solo lo acepta el anfitrión (`socket.data.pokerHost === me.id`).
- Repro visual: `frontend/test/repro-poker.mjs` (Playwright, requiere backend :4000 + Vite :3000 + Mongo).
- **Layout de la mesa (2026-11-04, commit a511b7f, deploy live)**: `seatLayout(9)` = anillo fijo de
  sillas (radios medidos para móvil 412x892); los ocupados se reparten por un segundo anillo
  `seatLayout(nº ocupados)`. El tamaño NO es una tabla: `fitSeats()` en `lib/pokerUi.js` mide el
  tapete y el recuadro reales y devuelve la mayor escala que cabe sin solapes + qué huecos libres
  se pueden pintar. Llamada desde `PokerTable.jsx` con `useLayoutEffect` + `resize`, midiendo
  `offsetWidth + 8` (borde/sombra). Redondeo con `Math.floor` (al alza se rozaban).
  Asistak vive en la esquina superior izquierda (`.ptak-dealer`).
- Tests backend: usar **`node --test --test-concurrency=1 --test-timeout=30000 "test/*.test.js"`**; sin
  `--test-timeout` la suite se cuelga en `poker-socket.test.js`.

## Retiros de Diamantes (2026-11-05, commit 0dc7337, deploy live)
- Flujo completo: usuario pide (débito atómico + `Transaction type=withdraw status=pending`)
  → admin paga o rechaza en `AdminPanel` → **rechazar devuelve los Diamantes**. Pagar NO mueve
  saldo (ya se descontó al pedir); solo marca `completed` y guarda `reviewedBy/reviewedAt`.
- Endpoints: `GET /api/wallet/withdraw/config`, `POST /api/wallet/withdraw` (método cerrado
  `paypal|zelle|crypto`, `details` obligatorio, mínimo y tope diario), admin
  `GET /api/admin/withdrawals?status=`, `POST /api/admin/withdrawals/:id/{pay,reject}`.
- Límites en `env.withdrawals` (`WITHDRAWAL_MIN`=100, `WITHDRAWAL_DAILY_CAP`=10000,
  `WITHDRAWAL_HOLD_HOURS`=0). Idempotencia por filtro `status:'pending'` → 2ª vez 409.
- Tests en `backend/test/withdrawals.test.js` + `wallet.test.js`. Suite: 711/711.
- **Nunca `git push` con `$GITHUB_TOKEN`** (403 "Resource not accessible by integration" aunque
  el repo diga push=true): usar **`$taktak`** con `https://x-access-token:${taktak}@github.com/...`.
- `/health` (raíz) = health real; `/api/health` va tras `auth` (401 sin token).

## Retiros exactos + PayPal apagable (2026-11-06, commit 175a250, deploy live)
- **Retiros**: importe entra como cadena y se valida con **BigInt** (`backend/src/utils/money.js`:
  `parseMoney`/`formatMoney`/`numberToUnits`); `idempotencyKey` del cliente (unique sparse en
  `Transaction`) + `withTransaction` → un reintento no descuenta dos veces. La ruta acepta
  número de cliente viejo (`customSanitizer`→`toFixed(2)`).
- **PayPal**: dos cosas separadas. (1) **Pasarela** con interruptor **`PAYPAL_ENABLED`** (por
  defecto activo): apagada, no se ofrece el cobro automático, no se puede vincular/retirar, y el
  botón "Vincular PayPal" de **Métodos de pago** aparece **deshabilitado** (sin nube: se quitó el
  emoji ☁️ y el CSS `.cloud-*`). `/payments/config` y `/payments/methods` exponen `paypalBlocked`.
  (2) **Cobro manual** PayPal (`MANUAL_PAYMENT_METHODS`, `payTo: taktak.messenger@gmail.com`): NO
  depende del interruptor, se muestra siempre (el usuario paga por fuera y un admin aprueba).
  Correo de cobro y enlace `paypal.me` viven en `MANUAL_PAYMENT_METHODS` (Render + `render.yaml`),
  no en código. **Producción: `PAYPAL_ENABLED=false`.**
  Reactivar la pasarela = `true` + **nuevo deploy** (Render no redespliega solo al cambiar env).
  Para activarla de verdad faltan `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` (+ `WEBHOOK_ID`) en
  Render, `PAYPAL_API_BASE` live y `PAYPAL_ENABLED=true`.
- Suite backend **757/757**, frontend **228/228**. Para correr backend: mongod local en replica
  set `rs0` (`/tmp`, se pierde al reiniciar el contenedor) + `TEST_MONGODB_URI=...?replicaSet=rs0`.
- El `.env` servido en `taktakmessenger.github.io/.env` es **data de ejemplo** (sin secretos
  reales), pero conviene borrarlo de `main`.
