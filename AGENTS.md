# Notas para quien trabaje en este repositorio

PWA de mensajería P2P (estilo WhatsApp) con llamadas WebRTC, minería WTK y
avisos push. Se sirve desde un único servicio de Node (`server.js`), que hace de
relé y de servidor de estáticos. Todo el texto que ve el usuario va **en
español**; la marca se escribe **Whataka**.

## Comandos

```bash
npm test                  # 165 pruebas, sin navegador
node server.js            # PORT=10099 para pruebas locales
node test/repro-llamada.mjs        # e2e real con Playwright (necesita el relé en 10099)
node test/repro-efectos.mjs        # e2e de la vista propia y los fondos
```

Los `test/repro-*.mjs` abren dos navegadores con cámara falsa, llaman de uno a
otro y comprueban lo que llega al otro lado leyendo píxeles del vídeo. Sirven
para no dar por bueno "a mí me funciona".

## Versión

Un solo número, en tres sitios: las URL `?v=` de `index.html`, `CACHE` de
`sw.js` y `WHATAKA_BUILD` de `app.js`. `test/version.test.js` falla si uno se
queda atrás, que es la causa clásica de "desplegué y sigo viendo lo viejo". Al
tocar cualquier estático, sube los tres. La versión se ve en Ajustes → ABOUT,
que es lo que se le pregunta al usuario para saber qué copia tiene.

## Despliegue

Producción es `https://whataka.vip`, servida por Render desde `main` de
`github.com/whataka777/Whataka` (servicio `whataka-relay`,
`srv-dbrneam7bikc73b2iu2g`). El push es todo lo que hace falta: el despliegue lo
lanza `.github/workflows/deploy-render.yml`, porque el webhook de Render hacia el
repositorio nunca llegó. Ese flujo usa el secreto `RENDER_API_KEY`; si se rota la
clave de Render hay que actualizarlo o los envíos se quedan sin publicar con un
401 silencioso (así estuvo producción congelada en la versión 50 durante días).

El token de la app de OpenHands (`ghu_…`) es de **solo lectura**: `git push` da
403. Para publicar hace falta un PAT con *Contents: Read and write*.

`.github/workflows/keep-alive.yml` saluda al relé cada cinco minutos: el plan
gratuito de Render duerme la instancia a los ~15 minutos sin tráfico y entonces
la app tarda medio minuto en abrir y las llamadas en curso se cortan.

Variables de entorno que importan en Render:

- `VAPID_SEED` — sin ella el relé inventa claves nuevas al arrancar y **todas
  las suscripciones push dejan de valer** en cada despliegue. Con ella,
  `/api/push/key` responde `efimeras: false`.
- `CANONICAL_HOST` — el dominio único (`whataka.vip`); sin él se acaba con dos
  identidades porque `localStorage` es por origen.
- `REPORT_SIGNER_KEY` — la clave del firmante de vales de minería. **Falta**, así
  que `/api/mining/config` dice `configured: false` y los vales devuelven 503.
  Tiene que ser la clave privada de `0xa5f1711dc508fe8b256f1a8a834cff2a47f41186`,
  la que el contrato tiene como `reportSigner`.

Después de desplegar, cada persona tiene que abrir la app y tocar **Activar**
en la franja de avisos una vez; sin ese gesto el navegador no deja que el
teléfono suene con la app cerrada.

## Estado de la cadena (26/11)

El token vivo es **whataka coin (wtk)**, desplegado el 26/11/2026 en Amoy:
`0x57C997a406a0295dEb8A16117969873AAf4B41Fb`, 18 decimales, 100.000.000 de
suministro **dentro del propio contrato** como fondo de minería.

| Dato | Valor |
|---|---|
| Dueño | `0x8416Ca157c5f24c188F06673eBF37FB902B767c2` (cartera del usuario) |
| Firmante de vales | `0x2a7F39bDF3dAe21c240536C4d26c05De0087127a` (clave en Render) |
| Render | `MINING_CONTRACT` y `REPORT_SIGNER_KEY` apuntan aquí |

El contrato anterior (`0x4b0C9d8233DeFa8EcDF28D7a2bAa3EDaa4C8252B`) quedó muerto:
su firmante (`0xA5f1…1186`) y su dueño (`0xAdd0…b5d9`) perdieron la clave, así que
no se puede reconfigurar y sus 90 millones están congelados. Era dinero de prueba.

La clave del firmante también vive en `REPORT_SIGNER_KEY_PENDIENTE` como copia.
`whataka.vip/deploy.html` despliega el token desde el móvil y deja dueño a quien
firma; `npm run compile` necesita `solc` (ya está en devDependencies).

## El manual

`manual.html` es la guía del usuario: trece capítulos y siete ilustraciones
vectoriales en SVG (nada de emojis dentro de las figuras, para que se vean en
cualquier pantalla y al imprimir). Se abre desde el 📖 al final de la barra
inferior, después de la tuerca. Cualquier función nueva tiene que aparecer ahí:
`test/manual.test.js` comprueba las secciones, las ilustraciones y el botón.

## Cuentas de los teléfonos

El Peer ID se genera en el móvil y vive en `localStorage` (`whataka.identity`),
sin ataduras a la versión: **actualizar la app no cambia el código**. Se pierde
al borrar los datos del sitio, al desinstalar la app o al cambiar de dirección
web, porque cada origen tiene su propio almacén. Ahí es donde el usuario ve que
"le han dado otro código".

Por eso existe **Ajustes → Copia de cuenta**: genera un texto
`WHATAKA-CUENTA-1.<base64>` con el Peer ID y sus claves, y lo restaura con
`restaurarCuenta()`. El Peer ID suelto no sirve para recuperar nada: identifica
la cuenta pero no lleva las claves privadas.

`recuperar.html` se sirve a propósito desde el subdominio de Render, sin la
redirección al dominio oficial, para que quien tenga la cuenta guardada en ese
origen pueda sacarla antes de mudarse.

Los datos del relé (`peers`, `ledger`, `wallets`, `mining`, `referrals`) están en
memoria: **cada despliegue o arranque en frío los borra**. Es la razón de fondo
por la que lo minado no se puede prometer a largo plazo todavía.

## Dominio

DNS en Porkbun: el apex va por A a `216.24.57.18` y `216.24.57.16`, y
`www` por CNAME a `whataka-relay.onrender.com`. Los dos están verificados en
Render (`POST /v1/services/{id}/custom-domains/{nombre}/verify` fuerza la
comprobación cuando se queda en `unverified`). No hay registros MX, así que
`hola@whataka.vip` no recibe correo; es solo la dirección de contacto que el
relé da a los servicios de avisos.

GitHub Pages publica una copia en `https://whataka777.github.io/Whataka/`. Es
otro origen: otra identidad guardada y sin `/api` detrás, así que `index.html`
manda esa visita al dominio oficial en cuanto arranca.

## Efectos de vídeo

`lib/efectos.js` dibuja el fotograma en un lienzo (fondo + filtro) y lo que se
envía por `replaceTrack` es el lienzo, así que el efecto viaja dentro de la
llamada cifrada. Los fondos con recorte usan MediaPipe Selfie Segmentation
servido desde `vendor/mediapipe/` (~6 MB, solo se descarga al elegir un fondo).
Los filtros de color no dependen de él.
