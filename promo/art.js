// Generated artwork and data binding shared by the promo pages. Avatars and album covers are
// drawn as SVG from a seed, so every fictional user and song gets its own stable picture
// without using anyone's real photo or artwork.

(() => {

// Muted, varied palettes: background from, background to, light shape, accent shape.
const PALETTES = [
  ['#1d6f8a', '#0e2340', '#ffcf7a', '#3de0ff'],
  ['#6b3a2e', '#20131f', '#ffe2a8', '#e9825a'],
  ['#2f5d3a', '#0f1f17', '#e4f7b0', '#5ee3a1'],
  ['#34407f', '#121530', '#ffd9ae', '#8fa8ff'],
  ['#7a2e3b', '#1f0e14', '#ffd5c8', '#ff7b6b'],
  ['#4a5059', '#16181d', '#f1f2f4', '#9aa3b2'],
  ['#8a6a1d', '#2a1d06', '#fff0c2', '#f5b544'],
  ['#1f5f5b', '#0b1d1c', '#c9fff4', '#3fd6c0'],
];

function hash(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(seed) {
  let s = hash(seed) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function palette(seed) {
  return PALETTES[hash(seed) % PALETTES.length];
}

function avatarSvg(seed) {
  const r = rng(seed);
  const [from, to, light, accent] = palette(seed);
  const id = `a${hash(seed)}`;
  const style = Math.floor(r() * 4);
  let shapes;
  if (style === 0) {
    shapes = `<circle cx="${62 + r() * 20}" cy="${30 + r() * 12}" r="${15 + r() * 6}" fill="${light}"/>
      <path d="M0 ${70 + r() * 8} Q 45 ${44 + r() * 10} 100 ${66 + r() * 10} V100 H0Z" fill="${accent}"/>`;
  } else if (style === 1) {
    shapes = `<circle cx="50" cy="56" r="${28 + r() * 6}" fill="none" stroke="${accent}" stroke-width="9"/>
      <circle cx="50" cy="56" r="9" fill="${light}"/>`;
  } else if (style === 2) {
    shapes = `<rect x="-20" y="${40 + r() * 10}" width="140" height="16" fill="${accent}" transform="rotate(-24 50 50)"/>
      <rect x="-20" y="${66 + r() * 8}" width="140" height="9" fill="${light}" transform="rotate(-24 50 50)"/>`;
  } else {
    shapes = `<path d="M50 ${18 + r() * 8} L ${84 - r() * 6} 80 H ${16 + r() * 6} Z" fill="${accent}"/>
      <circle cx="50" cy="${62 + r() * 6}" r="8" fill="${light}"/>`;
  }
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#${id})"/>${shapes}</svg>`;
}

/** Square album cover: layered horizon bands, rings or bars. */
function coverSvg(seed) {
  const r = rng(`cover:${seed}`);
  const [from, to, light, accent] = palette(`cover:${seed}`);
  const id = `c${hash(seed)}`;
  const style = Math.floor(r() * 3);
  let shapes = '';
  if (style === 0) {
    const sun = 30 + r() * 30;
    shapes += `<circle cx="${30 + r() * 40}" cy="${sun}" r="${16 + r() * 8}" fill="${light}"/>`;
    for (let i = 0; i < 5; i++) shapes += `<rect x="0" y="${58 + i * 9}" width="100" height="${3 + i}" fill="${accent}" opacity="${0.35 + i * 0.13}"/>`;
  } else if (style === 1) {
    for (let i = 5; i > 0; i--) shapes += `<circle cx="${50 + r() * 4}" cy="${50 + r() * 4}" r="${i * 9}" fill="none" stroke="${i % 2 ? accent : light}" stroke-width="3" opacity="${0.4 + i * 0.1}"/>`;
  } else {
    for (let i = 0; i < 9; i++) {
      const h = 14 + r() * 56;
      shapes += `<rect x="${8 + i * 9.5}" y="${86 - h}" width="5.5" height="${h}" rx="2.5" fill="${i % 3 === 0 ? light : accent}"/>`;
    }
  }
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#${id})"/>${shapes}</svg>`;
}

/** The bot's mark: a lowercase "r" drawn as a stem and a shoulder, with a signal dot. */
function logoSvg() {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none">
    <path d="M21 48 V28 Q21 18 32 18 H38" stroke="var(--accent, #3de0ff)" stroke-width="7" stroke-linecap="round"/>
    <circle cx="44.5" cy="44" r="5" fill="var(--accent, #3de0ff)"/>
  </svg>`;
}

function botAvatarSvg() {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="none">
    <defs><linearGradient id="botbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14233f"/><stop offset="1" stop-color="#070b14"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#botbg)"/>
    <path d="M34 74 V45 Q34 30 50 30 H58" stroke="#3de0ff" stroke-width="10" stroke-linecap="round"/>
    <circle cx="68" cy="68" r="7" fill="#3de0ff"/>
  </svg>`;
}

/**
 * Fills the page from its PROMO constants and draws the artwork. Resolves once fonts and images
 * are ready, which is what the export script waits for.
 */
async function render(vars) {
  for (const el of document.querySelectorAll('[data-var]')) {
    const value = vars[el.dataset.var];
    if (value === undefined) throw new Error(`missing PROMO value "${el.dataset.var}"`);
    el.textContent = value;
  }
  for (const el of document.querySelectorAll('[data-avatar]')) el.innerHTML = avatarSvg(el.dataset.avatar);
  for (const el of document.querySelectorAll('[data-cover]')) el.innerHTML = coverSvg(el.dataset.cover);
  for (const el of document.querySelectorAll('[data-bot-avatar]')) el.innerHTML = botAvatarSvg();
  for (const el of document.querySelectorAll('[data-logo]')) el.innerHTML = logoSvg();

  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? img.decode().catch(() => {}) : new Promise((done) => img.addEventListener('load', done, { once: true })))));
  document.documentElement.dataset.ready = 'true';
}

window.Promo = { render, avatarSvg, coverSvg, logoSvg, botAvatarSvg };
})();
