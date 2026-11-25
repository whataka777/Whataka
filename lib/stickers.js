'use strict';

/* Stickers animados de Whataka.
 *
 * Un sticker es un emoji base al que se le da vida con una animación CSS
 * (`anim`). Puede llevar además emojis que salen volando alrededor (`spark`),
 * pensados para "fuegos artificiales" con corazones, confeti, etc.
 *
 * Este módulo es puro: no toca el DOM ni la red. Solo describe qué hay y
 * cómo buscarlo. El dibujado vive en app.js/index.html.
 */

const CATEGORIAS = [
  { id: 'saludos', nombre: 'Saludos', emoji: '👋' },
  { id: 'fiesta', nombre: 'Fiesta', emoji: '🎉' },
  { id: 'amor', nombre: 'Amor', emoji: '💜' },
  { id: 'extras', nombre: 'Extras', emoji: '✨' },
];

// `anim`: clase CSS aplicada al sticker base.
// `spark`: emojis que salen volando (fuegos artificiales).
const STICKERS = [
  // ── Saludos ──
  { id: 'buenos-dias', cat: 'saludos', emoji: '☀️', label: 'Buenos días', anim: 'st-rise', spark: ['🌅', '☕', '🐓'] },
  { id: 'buenas-tardes', cat: 'saludos', emoji: '🌤️', label: 'Buenas tardes', anim: 'st-swing', spark: ['🌞', '🍹'] },
  { id: 'buenas-noches', cat: 'saludos', emoji: '🌙', label: 'Buenas noches', anim: 'st-glow', spark: ['⭐', '✨', '😴'] },
  { id: 'hola', cat: 'saludos', emoji: '👋', label: 'Hola', anim: 'st-wave' },
  { id: 'gracias', cat: 'saludos', emoji: '🙏', label: 'Gracias', anim: 'st-bounce' },
  { id: 'bienvenido', cat: 'saludos', emoji: '🤗', label: 'Bienvenido', anim: 'st-pop' },

  // ── Fiesta ──
  { id: 'fuegos-corazon', cat: 'fiesta', emoji: '💖', label: 'Fuegos de corazones', anim: 'st-pulse', spark: ['❤️', '💖', '💜', '💛', '💚', '🤍'] },
  { id: 'fuegos', cat: 'fiesta', emoji: '🎆', label: 'Fuegos artificiales', anim: 'st-pop', spark: ['✨', '🎇', '🌟', '💥'] },
  { id: 'confeti', cat: 'fiesta', emoji: '🎉', label: 'Confeti', anim: 'st-bounce', spark: ['🎊', '✨', '🎈'] },
  { id: 'cumple', cat: 'fiesta', emoji: '🎂', label: 'Feliz cumpleaños', anim: 'st-swing', spark: ['🎈', '🎁', '🥳'] },
  { id: 'brindis', cat: 'fiesta', emoji: '🥂', label: 'Brindis', anim: 'st-clink', spark: ['🍾', '✨'] },
  { id: 'aplausos', cat: 'fiesta', emoji: '👏', label: 'Aplausos', anim: 'st-clap', spark: ['✨', '⭐'] },

  // ── Amor ──
  { id: 'corazon-latido', cat: 'amor', emoji: '💜', label: 'Corazón latiendo', anim: 'st-beat', spark: ['💜', '🩷', '💫'] },
  { id: 'beso', cat: 'amor', emoji: '😘', label: 'Beso', anim: 'st-pop', spark: ['💋', '💕'] },
  { id: 'abrazo', cat: 'amor', emoji: '🫶', label: 'Abrazo', anim: 'st-pulse', spark: ['💞', '✨'] },
  { id: 'te-quiero', cat: 'amor', emoji: '❤️', label: 'Te quiero', anim: 'st-beat', spark: ['❤️', '💘', '💝'] },

  // ── Extras ──
  { id: 'cafe', cat: 'extras', emoji: '☕', label: 'Café', anim: 'st-steam', spark: ['💨', '♨️'] },
  { id: 'fuego', cat: 'extras', emoji: '🔥', label: 'Fuego', anim: 'st-flicker', spark: ['✨', '🔥'] },
  { id: 'dinero', cat: 'extras', emoji: '💰', label: 'Dinero', anim: 'st-bounce', spark: ['💵', '🪙'] },
  { id: 'mango', cat: 'extras', emoji: '🥭', label: 'Mango Whataka', anim: 'st-swing', spark: ['🥭', '✨'] },
  { id: 'gracias-total', cat: 'extras', emoji: '💯', label: 'Total', anim: 'st-pop', spark: ['✅', '✨'] },
  { id: 'cohete', cat: 'extras', emoji: '🚀', label: 'A tope', anim: 'st-rise', spark: ['💫', '⭐'] },
];

/** Devuelve todos los stickers. */
function todos() {
  return STICKERS.slice();
}

/** Busca un sticker por su id (o null). */
function porId(id) {
  return STICKERS.find((s) => s.id === id) || null;
}

/** Stickers de una categoría. */
function porCategoria(cat) {
  return STICKERS.filter((s) => s.cat === cat);
}

/** Categorías con sus stickers, listas para pintar un panel. */
function porCategorias() {
  return CATEGORIAS.map((c) => ({ ...c, stickers: porCategoria(c.id) }));
}

/** ¿El texto guardado es un id de sticker válido? */
function esStickerId(id) {
  return Boolean(porId(id));
}

/** Normaliza lo que llega de un mensaje al id de sticker, o null si no lo es. */
function normalizar(id) {
  return esStickerId(id) ? id : null;
}

const STICKERS_API = {
  CATEGORIAS,
  STICKERS,
  todos,
  porId,
  porCategoria,
  porCategorias,
  esStickerId,
  normalizar,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = STICKERS_API;
} else if (typeof window !== 'undefined') {
  window.WhaTakaStickers = STICKERS_API;
}
