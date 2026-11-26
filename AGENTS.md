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
`autoDeploy: true`). Un push a `main` publica.

El token de la app de OpenHands (`ghu_…`) es de **solo lectura**: `git push` da
403. Para publicar hace falta un PAT con *Contents: Read and write* sobre ese
repositorio.

Variables de entorno que importan en Render:

- `VAPID_SEED` — sin ella el relé inventa claves nuevas al arrancar y **todas
  las suscripciones push dejan de valer** en cada despliegue. Con ella,
  `/api/push/key` responde `efimeras: false`. Ya está puesta.
- `CANONICAL_HOST` — el dominio único; sin él se acaba con dos identidades
  porque `localStorage` es por origen.
- `ICE_TURN_*` — solo si hace falta TURN para redes móviles estrictas.

Después de desplegar, cada persona tiene que abrir la app y tocar **Activar**
en la franja de avisos una vez; sin ese gesto el navegador no deja que el
teléfono suene con la app cerrada.

## Efectos de vídeo

`lib/efectos.js` dibuja el fotograma en un lienzo (fondo + filtro) y lo que se
envía por `replaceTrack` es el lienzo, así que el efecto viaja dentro de la
llamada cifrada. Los fondos con recorte usan MediaPipe Selfie Segmentation
servido desde `vendor/mediapipe/` (~6 MB, solo se descarga al elegir un fondo).
Los filtros de color no dependen de él.
