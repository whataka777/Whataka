// Disfraces para las videollamadas: gafas, sombreros, máscaras, zombi, pájaro…
//
// Todo se dibuja a mano con formas del lienzo: no hay imágenes que descargar y
// se ve igual de nítido en la miniatura que a tamaño de llamada. La posición
// sale de los 68 puntos de la cara que da el detector (lib/efectos.js).
//
// El sistema de coordenadas de cada disfraz está en «unidades de ojo»: el ojo
// derecho está en (-0.5, 0) y el izquierdo en (0.5, 0), el eje X va de sien a
// sien y el Y hacia abajo. Así cada pieza se escribe una vez y sirve para
// cualquier cara, tamaño o inclinación.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhaTakaDisfraces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CATALOGO = [
    { id: 'ninguno', nombre: 'Ninguno', color: '#243a52' },
    { id: 'gafas', nombre: 'Gafas', color: '#1b1d22' },
    { id: 'gafas3d', nombre: 'Gafas 3D', color: '#3a7bd5' },
    { id: 'sombrero', nombre: 'Sombrero', color: '#6b4a2f' },
    { id: 'corona', nombre: 'Corona', color: '#e8b84b' },
    { id: 'gato', nombre: 'Gato', color: '#3b3b44' },
    { id: 'perro', nombre: 'Perro', color: '#8a6a4a' },
    { id: 'bigote', nombre: 'Bigote', color: '#3a2a20' },
    { id: 'calavera', nombre: 'Calavera', color: '#e9eef2' },
    { id: 'zombi', nombre: 'Zombi', color: '#6f9e4f' },
    { id: 'pajaro', nombre: 'Pájaro', color: '#f2c94c' },
    { id: 'pirata', nombre: 'Pirata', color: '#c0392b' },
    { id: 'payaso', nombre: 'Payaso', color: '#e74c3c' },
    { id: 'diablo', nombre: 'Diablo', color: '#a3242a' },
    { id: 'vikingo', nombre: 'Vikingo', color: '#8d99ae' },
  ];

  const porId = (id) => CATALOGO.find((d) => d.id === id) || CATALOGO[0];

  function media(puntos) {
    const n = puntos.length || 1;
    return {
      x: puntos.reduce((s, p) => s + p.x, 0) / n,
      y: puntos.reduce((s, p) => s + p.y, 0) / n,
    };
  }

  // Pasa un punto de la imagen a coordenadas del disfraz (unidades de ojo).
  function aLocal(p, punto) {
    const dx = punto.x - p.centroOjos.x;
    const dy = punto.y - p.centroOjos.y;
    const cos = Math.cos(-p.angulo);
    const sin = Math.sin(-p.angulo);
    return {
      x: (dx * cos - dy * sin) / p.distanciaOjos,
      y: (dx * sin + dy * cos) / p.distanciaOjos,
    };
  }

  // Los 68 puntos vienen en píxeles de la imagen. Aquí se sacan las medidas que
  // necesitan los disfraces: centro y tamaño de los ojos, inclinación de la
  // cabeza y dónde caen nariz, boca y mentón.
  function puntosCara(puntos) {
    if (!Array.isArray(puntos) || puntos.length < 68) return null;
    const ojoDer = media(puntos.slice(36, 42));
    const ojoIzq = media(puntos.slice(42, 48));
    const cejaDer = media(puntos.slice(17, 22));
    const cejaIzq = media(puntos.slice(22, 27));
    const dx = ojoIzq.x - ojoDer.x;
    const dy = ojoIzq.y - ojoDer.y;
    const distanciaOjos = Math.hypot(dx, dy);
    if (!distanciaOjos) return null;

    const centroOjos = { x: (ojoDer.x + ojoIzq.x) / 2, y: (ojoDer.y + ojoIzq.y) / 2 };
    const anchoCara = Math.hypot(puntos[16].x - puntos[0].x, puntos[16].y - puntos[0].y) || distanciaOjos * 2.2;
    const menton = puntos[8];
    const altoCara = Math.hypot(menton.x - cejaDer.x, menton.y - cejaDer.y) || distanciaOjos * 2.4;

    const cara = {
      ojoDer,
      ojoIzq,
      centroOjos,
      cejaDer,
      cejaIzq,
      nariz: puntos[30],
      boca: media([puntos[48], puntos[51], puntos[54], puntos[57]]),
      menton,
      distanciaOjos,
      angulo: Math.atan2(dy, dx),
      anchoCara,
      altoCara,
    };
    cara.cejaDerLocal = aLocal(cara, cejaDer);
    cara.cejaIzqLocal = aLocal(cara, cejaIzq);
    cara.narizLocal = aLocal(cara, cara.nariz);
    cara.bocaLocal = aLocal(cara, cara.boca);
    cara.mentonLocal = aLocal(cara, menton);
    return cara;
  }

  // Medidas de una cara corriente, para dibujar las miniaturas del selector
  // sin necesidad de una foto ni del detector.
  function puntosSinteticos(centro = { x: 56, y: 52 }, distanciaOjos = 30) {
    return {
      centroOjos: centro,
      ojoDer: { x: centro.x - distanciaOjos / 2, y: centro.y },
      ojoIzq: { x: centro.x + distanciaOjos / 2, y: centro.y },
      distanciaOjos,
      angulo: 0,
      anchoCara: distanciaOjos * 2.6,
      altoCara: distanciaOjos * 3.1,
      cejaDerLocal: { x: -0.5, y: -0.62 },
      cejaIzqLocal: { x: 0.5, y: -0.62 },
      narizLocal: { x: 0, y: 0.62 },
      bocaLocal: { x: 0, y: 1.05 },
      mentonLocal: { x: 0, y: 1.95 },
    };
  }

  // ── Ayudas de dibujo ──────────────────────────────────────────────────────
  function redondeado(ctx, x, y, ancho, alto, radio) {
    const r = Math.min(radio, ancho / 2, alto / 2);
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, ancho, alto, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + ancho - r, y);
    ctx.quadraticCurveTo(x + ancho, y, x + ancho, y + r);
    ctx.lineTo(x + ancho, y + alto - r);
    ctx.quadraticCurveTo(x + ancho, y + alto, x + ancho - r, y + alto);
    ctx.lineTo(x + r, y + alto);
    ctx.quadraticCurveTo(x, y + alto, x, y + alto - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function elipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    else ctx.arc(x, y, Math.max(Math.abs(rx), Math.abs(ry)), 0, Math.PI * 2);
  }

  function triangulo(ctx, a, b, c) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }

  // Pone el lienzo en coordenadas del disfraz y llama al dibujo.
  function conMarco(ctx, cara, dibujo) {
    ctx.save();
    ctx.translate(cara.centroOjos.x, cara.centroOjos.y);
    ctx.rotate(cara.angulo || 0);
    ctx.scale(cara.distanciaOjos, cara.distanciaOjos);
    dibujo();
    ctx.restore();
  }

  // Silueta de la cara para las máscaras: desde un poco por encima de las
  // cejas hasta la punta de la barbilla, que es lo que dan los puntos.
  const CEJA_ARRIBA = -0.75;
  function caraElipse(cara) {
    const abajo = cara.mentonLocal ? cara.mentonLocal.y : 1.9;
    return {
      cy: (CEJA_ARRIBA + abajo) / 2,
      ry: (abajo - CEJA_ARRIBA) / 2,
      rx: ((cara.anchoCara || cara.distanciaOjos * 2.6) / 2) / cara.distanciaOjos * 0.92,
    };
  }

  // ── Cada disfraz ─────────────────────────────────────────────────────────
  function pintaGafas(ctx, cara, lentes, reflejo) {
    conMarco(ctx, cara, () => {
      ctx.fillStyle = '#111318';
      ctx.strokeStyle = '#111318';
      ctx.lineWidth = 0.06;
      // patillas
      ctx.beginPath(); ctx.moveTo(-0.74, -0.04); ctx.lineTo(-1.0, -0.12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.74, -0.04); ctx.lineTo(1.0, -0.12); ctx.stroke();
      // lentes
      for (const cx of [-0.5, 0.5]) {
        redondeado(ctx, cx - 0.29, -0.21, 0.58, 0.42, 0.16);
        ctx.fillStyle = lentes;
        ctx.fill();
        ctx.lineWidth = 0.05;
        ctx.strokeStyle = '#0a0b0e';
        ctx.stroke();
        if (reflejo) {
          ctx.fillStyle = 'rgba(255,255,255,.28)';
          ctx.beginPath();
          ctx.moveTo(cx - 0.2, 0.08);
          ctx.lineTo(cx + 0.02, -0.16);
          ctx.lineTo(cx + 0.14, -0.16);
          ctx.lineTo(cx - 0.08, 0.08);
          ctx.closePath();
          ctx.fill();
        }
      }
      // puente
      ctx.strokeStyle = '#0a0b0e';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(-0.2, -0.02);
      ctx.quadraticCurveTo(0, -0.12, 0.2, -0.02);
      ctx.stroke();
    });
  }

  function pintaSombrero(ctx, cara) {
    conMarco(ctx, cara, () => {
      ctx.fillStyle = '#6b4a2f';
      elipse(ctx, 0, -0.72, 1.25, 0.19);
      ctx.fill();
      ctx.fillStyle = '#7d5738';
      redondeado(ctx, -0.55, -1.5, 1.1, 0.8, 0.2);
      ctx.fill();
      ctx.fillStyle = '#3f2a1a';
      redondeado(ctx, -0.56, -0.9, 1.12, 0.18, 0.06);
      ctx.fill();
    });
  }

  function pintaCorona(ctx, cara) {
    conMarco(ctx, cara, () => {
      const base = -0.66;
      const alto = 0.6;
      ctx.beginPath();
      ctx.moveTo(-0.8, base);
      ctx.lineTo(-0.8, base - alto);
      ctx.lineTo(-0.5, base - alto * 0.45);
      ctx.lineTo(-0.28, base - alto * 1.15);
      ctx.lineTo(0, base - alto * 0.5);
      ctx.lineTo(0.28, base - alto * 1.15);
      ctx.lineTo(0.5, base - alto * 0.45);
      ctx.lineTo(0.8, base - alto);
      ctx.lineTo(0.8, base);
      ctx.closePath();
      ctx.fillStyle = '#e8b84b';
      ctx.fill();
      ctx.strokeStyle = '#b98c26';
      ctx.lineWidth = 0.04;
      ctx.stroke();
      ctx.fillStyle = '#d43f5a';
      for (const x of [-0.5, 0, 0.5]) {
        elipse(ctx, x, base - 0.16, 0.08, 0.08);
        ctx.fill();
      }
    });
  }

  function pintaGato(ctx, cara) {
    conMarco(ctx, cara, () => {
      ctx.fillStyle = '#3b3b44';
      for (const signo of [-1, 1]) {
        triangulo(ctx, { x: signo * 0.28, y: -0.6 }, { x: signo * 0.7, y: -0.95 }, { x: signo * 0.68, y: -0.22 });
        ctx.fill();
        ctx.fillStyle = '#f0a6b5';
        triangulo(ctx, { x: signo * 0.38, y: -0.56 }, { x: signo * 0.63, y: -0.82 }, { x: signo * 0.62, y: -0.34 });
        ctx.fill();
        ctx.fillStyle = '#3b3b44';
      }
      // bigotes
      ctx.strokeStyle = 'rgba(20,20,24,.85)';
      ctx.lineWidth = 0.035;
      for (const signo of [-1, 1]) {
        for (let i = 0; i < 3; i += 1) {
          const y = cara.narizLocal.y + 0.02 + i * 0.1;
          ctx.beginPath();
          ctx.moveTo(signo * 0.12, y);
          ctx.lineTo(signo * 0.85, y - 0.06 + i * 0.06);
          ctx.stroke();
        }
      }
      // nariz de gato
      ctx.fillStyle = '#e8788f';
      triangulo(ctx, { x: -0.09, y: cara.narizLocal.y - 0.04 }, { x: 0.09, y: cara.narizLocal.y - 0.04 }, { x: 0, y: cara.narizLocal.y + 0.09 });
      ctx.fill();
    });
  }

  function pintaPerro(ctx, cara) {
    conMarco(ctx, cara, () => {
      ctx.fillStyle = '#8a6a4a';
      for (const signo of [-1, 1]) {
        ctx.save();
        ctx.translate(signo * 0.92, -0.12);
        ctx.rotate(signo * 0.28);
        elipse(ctx, 0, 0, 0.2, 0.5);
        ctx.fill();
        ctx.restore();
      }
      // hocico y nariz
      ctx.fillStyle = '#e8d7c3';
      elipse(ctx, 0, cara.bocaLocal.y - 0.28, 0.3, 0.22);
      ctx.fill();
      ctx.fillStyle = '#241a12';
      elipse(ctx, 0, cara.narizLocal.y + 0.02, 0.12, 0.09);
      ctx.fill();
      ctx.strokeStyle = '#241a12';
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.moveTo(0, cara.narizLocal.y + 0.1);
      ctx.lineTo(0, cara.bocaLocal.y - 0.12);
      ctx.stroke();
    });
  }

  function pintaBigote(ctx, cara) {
    conMarco(ctx, cara, () => {
      const y = cara.bocaLocal.y - 0.16;
      ctx.fillStyle = '#3a2a20';
      for (const signo of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.quadraticCurveTo(signo * 0.35, y - 0.18, signo * 0.62, y - 0.02);
        ctx.quadraticCurveTo(signo * 0.36, y + 0.16, 0, y + 0.1);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  function pintaCalavera(ctx, cara) {
    conMarco(ctx, cara, () => {
      const e = caraElipse(cara);
      ctx.fillStyle = 'rgba(238,243,247,.95)';
      elipse(ctx, 0, e.cy, e.rx, e.ry);
      ctx.fill();
      // cuencas
      ctx.fillStyle = '#1b1f26';
      for (const cx of [-0.5, 0.5]) {
        elipse(ctx, cx, -0.02, 0.24, 0.26);
        ctx.fill();
      }
      // nariz
      triangulo(ctx, { x: -0.1, y: cara.narizLocal.y - 0.02 }, { x: 0.1, y: cara.narizLocal.y - 0.02 }, { x: 0, y: cara.narizLocal.y + 0.2 });
      ctx.fill();
      // dientes
      ctx.fillStyle = '#f7fafc';
      redondeado(ctx, -0.34, cara.bocaLocal.y - 0.12, 0.68, 0.3, 0.06);
      ctx.fill();
      ctx.strokeStyle = '#8d99a6';
      ctx.lineWidth = 0.02;
      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * 0.13, cara.bocaLocal.y - 0.12);
        ctx.lineTo(i * 0.13, cara.bocaLocal.y + 0.18);
        ctx.stroke();
      }
    });
  }

  function pintaZombi(ctx, cara) {
    conMarco(ctx, cara, () => {
      const e = caraElipse(cara);
      ctx.fillStyle = 'rgba(96,148,72,.45)';
      elipse(ctx, 0, e.cy, e.rx, e.ry);
      ctx.fill();
      // ojeras y ojos rojos
      for (const cx of [-0.5, 0.5]) {
        ctx.fillStyle = 'rgba(28,38,24,.75)';
        elipse(ctx, cx, 0.04, 0.27, 0.24);
        ctx.fill();
        ctx.fillStyle = '#e03a2f';
        elipse(ctx, cx, -0.02, 0.1, 0.1);
        ctx.fill();
        ctx.fillStyle = '#1a0a08';
        elipse(ctx, cx, -0.02, 0.04, 0.04);
        ctx.fill();
      }
      // costurones
      ctx.strokeStyle = 'rgba(40,30,26,.85)';
      ctx.lineWidth = 0.035;
      for (const signo of [-1, 1]) {
        for (let i = 0; i < 3; i += 1) {
          const x = signo * (0.72 + i * 0.11);
          const y = 0.45 + i * 0.12;
          ctx.beginPath();
          ctx.moveTo(x, y - 0.1);
          ctx.lineTo(x, y + 0.1);
          ctx.stroke();
        }
      }
      // boca cosida
      ctx.strokeStyle = 'rgba(52,20,20,.9)';
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(-0.34, cara.bocaLocal.y);
      ctx.lineTo(0.34, cara.bocaLocal.y);
      ctx.stroke();
      ctx.lineWidth = 0.025;
      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * 0.14, cara.bocaLocal.y - 0.1);
        ctx.lineTo(i * 0.14, cara.bocaLocal.y + 0.1);
        ctx.stroke();
      }
    });
  }

  function pintaPajaro(ctx, cara) {
    conMarco(ctx, cara, () => {
      // pico
      ctx.fillStyle = '#f2a03d';
      triangulo(ctx, { x: -0.13, y: cara.narizLocal.y - 0.14 }, { x: 0.13, y: cara.narizLocal.y - 0.14 }, { x: 0, y: cara.narizLocal.y + 0.26 });
      ctx.fill();
      ctx.fillStyle = '#d9822b';
      triangulo(ctx, { x: -0.09, y: cara.narizLocal.y + 0.1 }, { x: 0.09, y: cara.narizLocal.y + 0.1 }, { x: 0, y: cara.narizLocal.y + 0.28 });
      ctx.fill();
      // plumero
      ctx.fillStyle = '#f2c94c';
      for (let i = -1; i <= 1; i += 1) {
        ctx.save();
        ctx.translate(i * 0.3, -0.95);
        ctx.rotate(i * 0.4);
        elipse(ctx, 0, -0.12, 0.09, 0.34);
        ctx.fill();
        ctx.restore();
      }
      // plumón bajo el pico
      ctx.fillStyle = 'rgba(242,201,76,.9)';
      elipse(ctx, 0, cara.bocaLocal.y - 0.35, 0.34, 0.14);
      ctx.fill();
    });
  }

  function pintaPirata(ctx, cara) {
    conMarco(ctx, cara, () => {
      // pañuelo
      ctx.fillStyle = '#c0392b';
      redondeado(ctx, -1.0, -1.0, 2.0, 0.34, 0.1);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for (let i = -2; i <= 2; i += 1) {
        elipse(ctx, i * 0.38, -0.84, 0.05, 0.05);
        ctx.fill();
      }
      // parche
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.moveTo(-0.95, -0.55);
      ctx.lineTo(0.3, 0.3);
      ctx.stroke();
      ctx.fillStyle = '#1a1a1a';
      redondeado(ctx, -0.78, -0.26, 0.56, 0.46, 0.1);
      ctx.fill();
    });
  }

  function pintaPayaso(ctx, cara) {
    conMarco(ctx, cara, () => {
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (const signo of [-1, 1]) {
        elipse(ctx, signo * 0.72, 0.5, 0.24, 0.18);
        ctx.fill();
      }
      ctx.fillStyle = '#e74c3c';
      elipse(ctx, 0, cara.narizLocal.y + 0.04, 0.17, 0.17);
      ctx.fill();
      // sonrisa pintada
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(0, cara.bocaLocal.y - 0.25, 0.55, 0.35 * Math.PI, 0.65 * Math.PI);
      ctx.stroke();
    });
  }

  function pintaDiablo(ctx, cara) {
    conMarco(ctx, cara, () => {
      ctx.fillStyle = '#a3242a';
      for (const signo of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(signo * 0.42, -0.62);
        ctx.quadraticCurveTo(signo * 0.72, -1.3, signo * 0.5, -1.5);
        ctx.quadraticCurveTo(signo * 0.95, -1.32, signo * 0.78, -0.52);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  function pintaVikingo(ctx, cara) {
    conMarco(ctx, cara, () => {
      // casco
      ctx.fillStyle = '#8d99ae';
      ctx.beginPath();
      ctx.arc(0, -0.42, 0.95, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6b7688';
      redondeado(ctx, -0.98, -0.5, 1.96, 0.18, 0.05);
      ctx.fill();
      // cuernos
      ctx.fillStyle = '#efe3c8';
      for (const signo of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(signo * 0.86, -0.62);
        ctx.quadraticCurveTo(signo * 1.35, -1.15, signo * 1.12, -1.55);
        ctx.quadraticCurveTo(signo * 1.3, -1.0, signo * 0.98, -0.45);
        ctx.closePath();
        ctx.fill();
      }
      // remache
      ctx.fillStyle = '#c9ced8';
      elipse(ctx, 0, -0.95, 0.09, 0.09);
      ctx.fill();
    });
  }

  const DIBUJOS = {
    gafas: (ctx, cara) => pintaGafas(ctx, cara, '#1b1d22', true),
    gafas3d: (ctx, cara) => {
      pintaGafas(ctx, cara, '#3a7bd5', false);
      conMarco(ctx, cara, () => {
        ctx.fillStyle = 'rgba(220,60,60,.85)';
        redondeado(ctx, -0.79, -0.21, 0.58, 0.42, 0.16);
        ctx.fill();
      });
    },
    sombrero: pintaSombrero,
    corona: pintaCorona,
    gato: pintaGato,
    perro: pintaPerro,
    bigote: pintaBigote,
    calavera: pintaCalavera,
    zombi: pintaZombi,
    pajaro: pintaPajaro,
    pirata: pintaPirata,
    payaso: pintaPayaso,
    diablo: pintaDiablo,
    vikingo: pintaVikingo,
  };

  // Dibuja el disfraz sobre el fotograma ya pintado.
  function pintaDisfraz(ctx, id, cara) {
    const dibujo = DIBUJOS[id];
    if (!dibujo || !cara) return false;
    dibujo(ctx, cara);
    return true;
  }

  // Miniatura del selector: una cara sencilla con el disfraz puesto.
  function pintaMuestra(ctx, id, tamano = 112) {
    const cara = puntosSinteticos({ x: tamano / 2, y: tamano * 0.46 }, tamano * 0.27);
    ctx.save();
    ctx.fillStyle = '#f0d3b8';
    ctx.beginPath();
    ctx.arc(tamano / 2, tamano * 0.52, tamano * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3c2f2a';
    for (const signo of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cara.centroOjos.x + signo * cara.distanciaOjos / 2, cara.centroOjos.y, tamano * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    if (id !== 'ninguno') pintaDisfraz(ctx, id, cara);
    ctx.restore();
  }

  return {
    CATALOGO,
    porId,
    puntosCara,
    puntosSinteticos,
    pintaDisfraz,
    pintaMuestra,
  };
});
