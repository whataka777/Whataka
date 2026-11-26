// Efectos de vídeo para las videollamadas: fondos y filtros aplicados al
// fotograma que sale hacia el otro lado.
//
// La cámara se redibuja en un lienzo y lo que se envía es el lienzo
// (canvas.captureStream), no la cámara. Así el otro lado ve el efecto sin
// enterarse de nada y la llamada sigue siendo P2P y cifrada.
//
// Los fondos necesitan saber qué píxeles son persona: eso lo resuelve
// MediaPipe Selfie Segmentation, que se carga solo cuando hace falta. Los
// filtros de color no dependen de él y funcionan siempre.
(function () {
  'use strict';

  const ANCHO = 640;
  const ALTO = 360;
  const FPS = 24;
  const CADA_MASCARA_MS = 90;

  const FILTROS = [
    { id: 'normal', nombre: 'Normal', css: 'none', muestra: 'linear-gradient(135deg,#7d97ae,#3a556f)' },
    { id: 'calido', nombre: 'Cálido', css: 'saturate(1.15) sepia(.18) brightness(1.05)', muestra: 'linear-gradient(135deg,#f6b26b,#c96a3c)' },
    { id: 'frio', nombre: 'Frío', css: 'saturate(1.05) hue-rotate(-14deg) brightness(1.04)', muestra: 'linear-gradient(135deg,#8fd3ff,#3f6fa8)' },
    { id: 'bw', nombre: 'B/N', css: 'grayscale(1) contrast(1.12)', muestra: 'linear-gradient(135deg,#d8d8d8,#4a4a4a)' },
    { id: 'vintage', nombre: 'Vintage', css: 'sepia(.5) contrast(1.06) saturate(.85) brightness(1.02)', muestra: 'linear-gradient(135deg,#d9b48f,#7a5c3e)' },
    { id: 'comic', nombre: 'Cómic', css: 'saturate(1.9) contrast(1.4)', muestra: 'linear-gradient(135deg,#ffd166,#ef476f)' },
    { id: 'suave', nombre: 'Suave', css: 'brightness(1.08) saturate(1.06) blur(.6px)', muestra: 'linear-gradient(135deg,#ffd9e8,#c2a4ff)' },
    { id: 'noche', nombre: 'Noche', css: 'brightness(.82) contrast(1.18) hue-rotate(8deg)', muestra: 'linear-gradient(135deg,#2b3a67,#101a33)' },
  ];

  const FONDOS = [
    { id: 'ninguno', nombre: 'Sin fondo' },
    { id: 'desenfoque', nombre: 'Desenfocado' },
    { id: 'estudio', nombre: 'Estudio' },
    { id: 'oficina', nombre: 'Oficina' },
    { id: 'atardecer', nombre: 'Atardecer' },
    { id: 'playa', nombre: 'Playa' },
    { id: 'bosque', nombre: 'Bosque' },
    { id: 'noche', nombre: 'Noche' },
  ];

  const filtroPorId = (id) => FILTROS.find((f) => f.id === id) || FILTROS[0];

  function degradado(ctx, w, h, paradas) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    paradas.forEach(([pos, color]) => g.addColorStop(pos, color));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function circulo(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fondos dibujados a mano: nada de imágenes que descargar. Cada uno ocupa
  // pocas líneas y se ve igual en el lienzo pequeño de la miniatura y a tamaño
  // de llamada.
  function pintaFondo(ctx, id, video, w, h) {
    if (id === 'desenfoque') {
      if (video) {
        ctx.save();
        ctx.filter = 'blur(16px) brightness(.9) saturate(1.05)';
        ctx.drawImage(video, -w * 0.08, -h * 0.08, w * 1.16, h * 1.16);
        ctx.restore();
      } else {
        degradado(ctx, w, h, [[0, '#5c7183'], [1, '#2d3f4f']]);
      }
      return;
    }
    if (id === 'estudio') {
      degradado(ctx, w, h, [[0, '#f2f5f8'], [1, '#b9c6d2']]);
      return;
    }
    if (id === 'oficina') {
      degradado(ctx, w, h, [[0, '#e8edf2'], [1, '#9fb0c0']]);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillRect(w * 0.08, h * 0.12, w * 0.34, h * 0.44);
      ctx.fillStyle = 'rgba(120,150,180,.45)';
      ctx.fillRect(w * 0.08, h * 0.34, w * 0.34, h * 0.02);
      ctx.fillRect(w * 0.24, h * 0.12, w * 0.02, h * 0.44);
      return;
    }
    if (id === 'atardecer') {
      degradado(ctx, w, h, [[0, '#3b1f5e'], [0.45, '#b8456f'], [0.75, '#f0824a'], [1, '#ffc16b']]);
      circulo(ctx, w * 0.7, h * 0.62, h * 0.12, 'rgba(255,224,150,.85)');
      return;
    }
    if (id === 'playa') {
      degradado(ctx, w, h, [[0, '#8fd0f0'], [0.55, '#d9f0f7'], [0.58, '#2f9ec4'], [1, '#1b6f92']]);
      circulo(ctx, w * 0.2, h * 0.2, h * 0.09, 'rgba(255,246,200,.9)');
      ctx.fillStyle = '#f0dfae';
      ctx.fillRect(0, h * 0.78, w, h * 0.22);
      return;
    }
    if (id === 'bosque') {
      degradado(ctx, w, h, [[0, '#0f2d1e'], [0.6, '#1d5236'], [1, '#0b1f14']]);
      ctx.fillStyle = 'rgba(10,40,25,.85)';
      for (let i = 0; i < 7; i += 1) {
        const x = (i + 0.5) * (w / 7);
        const alto = h * (0.45 + (i % 3) * 0.12);
        ctx.beginPath();
        ctx.moveTo(x, h - alto);
        ctx.lineTo(x - w * 0.06, h);
        ctx.lineTo(x + w * 0.06, h);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    if (id === 'noche') {
      degradado(ctx, w, h, [[0, '#0a1230'], [1, '#1c2a55']]);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 40; i += 1) {
        const x = ((i * 97) % 100) / 100 * w;
        const y = ((i * 53) % 100) / 100 * h * 0.6;
        ctx.fillRect(x, y, 1.6, 1.6);
      }
      circulo(ctx, w * 0.82, h * 0.2, h * 0.06, 'rgba(240,245,255,.9)');
      return;
    }
    ctx.clearRect(0, 0, w, h);
  }

  let promesaSegmentacion = null;

  function cargaSegmentacion() {
    if (promesaSegmentacion) return promesaSegmentacion;
    promesaSegmentacion = new Promise((resolve, reject) => {
      if (window.SelfieSegmentation) { resolve(window.SelfieSegmentation); return; }
      const script = document.createElement('script');
      script.src = './vendor/mediapipe/selfie_segmentation.js';
      script.onload = () => {
        if (window.SelfieSegmentation) resolve(window.SelfieSegmentation);
        else reject(new Error('la segmentación no se cargó'));
      };
      script.onerror = () => reject(new Error('no se pudo descargar la segmentación'));
      document.head.appendChild(script);
    });
    return promesaSegmentacion;
  }

  function crear(video) {
    const lienzo = document.createElement('canvas');
    lienzo.width = ANCHO;
    lienzo.height = ALTO;
    const ctx = lienzo.getContext('2d', { alpha: false });

    const persona = document.createElement('canvas');
    persona.width = ANCHO;
    persona.height = ALTO;
    const pctx = persona.getContext('2d');

    const estado = { filtro: 'normal', fondo: 'ninguno', mascara: null, parado: false };
    let segmentador = null;
    let enviando = false;
    let ultimaMascara = 0;
    let ultimoDibujo = 0;
    let raf = 0;
    let vigilante = 0;

    function dibuja() {
      if (estado.parado) return;
      ultimoDibujo = Date.now();
      const w = ANCHO;
      const h = ALTO;
      const filtro = filtroPorId(estado.filtro).css;

      if (video.readyState < 2) return;

      if (estado.fondo === 'ninguno') {
        ctx.filter = filtro;
        ctx.drawImage(video, 0, 0, w, h);
        ctx.filter = 'none';
        return;
      }

      pintaFondo(ctx, estado.fondo, video, w, h);

      // La persona va en un lienzo aparte para recortarla con la máscara sin
      // tocar el fondo ya pintado.
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.globalCompositeOperation = 'source-over';
      pctx.filter = 'none';
      pctx.clearRect(0, 0, w, h);
      if (estado.mascara) {
        pctx.filter = 'blur(2px)';
        pctx.drawImage(estado.mascara, 0, 0, w, h);
        pctx.filter = filtro;
        pctx.globalCompositeOperation = 'source-in';
        pctx.drawImage(video, 0, 0, w, h);
        pctx.filter = 'none';
        pctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(persona, 0, 0);
      }
    }

    function pideMascara() {
      if (!segmentador || enviando) return;
      const ahora = Date.now();
      if (ahora - ultimaMascara < CADA_MASCARA_MS) return;
      ultimaMascara = ahora;
      enviando = true;
      try {
        segmentador.send({ image: video })
          .catch(() => {})
          .finally(() => { enviando = false; });
      } catch {
        enviando = false;
      }
    }

    function bucle() {
      if (estado.parado) return;
      dibuja();
      if (estado.fondo !== 'ninguno') pideMascara();
      raf = requestAnimationFrame(bucle);
    }

    function arranca() {
      estado.parado = false;
      raf = requestAnimationFrame(bucle);
      // En segundo plano el navegador frena requestAnimationFrame: este
      // vigilante mantiene el vídeo saliendo, aunque sea a menos fotogramas.
      vigilante = setInterval(() => {
        if (estado.parado) return;
        if (Date.now() - ultimoDibujo > 400) dibuja();
      }, 500);
    }

    async function ponFondo(id) {
      if (!FONDOS.some((f) => f.id === id)) return false;
      if (id !== 'ninguno') {
        if (!segmentador) {
          const SelfieSegmentation = await cargaSegmentacion();
          segmentador = new SelfieSegmentation({
            locateFile: (archivo) => `./vendor/mediapipe/${archivo}`,
          });
          segmentador.setOptions({ modelSelection: 1, selfieMode: false });
          segmentador.onResults((resultados) => {
            if (resultados && resultados.segmentationMask) estado.mascara = resultados.segmentationMask;
          });
        }
      }
      estado.fondo = id;
      return true;
    }

    function ponFiltro(id) {
      if (!FILTROS.some((f) => f.id === id)) return false;
      estado.filtro = id;
      return true;
    }

    function parar() {
      estado.parado = true;
      if (raf) cancelAnimationFrame(raf);
      if (vigilante) clearInterval(vigilante);
      if (segmentador && segmentador.close) {
        try { segmentador.close(); } catch { /* ya estaba cerrado */ }
      }
      segmentador = null;
    }

    const stream = typeof lienzo.captureStream === 'function' ? lienzo.captureStream(FPS) : null;

    arranca();

    return {
      lienzo,
      stream,
      ponFondo,
      ponFiltro,
      parar,
      estado: () => ({ ...estado }),
      tieneMascara: () => Boolean(estado.mascara),
      fotogramas: () => ultimoDibujo,
    };
  }

  window.WhatakaEfectos = { FILTROS, FONDOS, crear, pintaFondo };
})();
