# MediaPipe Selfie Segmentation

Archivos copiados tal cual del paquete npm `@mediapipe/selfie_segmentation`
versión `0.1.1675465747`, que es la que publica Google:

    npm pack @mediapipe/selfie_segmentation

Se sirven desde aquí, y no desde un CDN, para que los efectos funcionen sin
conexión y sin depender de un tercero. Solo se descargan cuando alguien abre el
panel de efectos de una videollamada; no se precargan al arrancar la app.

- Licencia: Apache 2.0 — https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE
- Documentación: https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter

Solo se incluye la variante SIMD del binario WebAssembly (unos 6 MB), que es la
que usan los navegadores actuales. Si un navegador muy antiguo no la soporta,
los fondos no se pueden aplicar y la app lo dice; los filtros de color siguen
funcionando porque no dependen de MediaPipe.
