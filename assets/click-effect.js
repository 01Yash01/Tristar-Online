/**
 * Click animation (Theme settings > Animations): a wave through a hidden field. Each click or tap pops a dot under
 * the pointer and sends a wave through a grid of small characters, binary digits or pixels, as the Style setting
 * picks: cells light up as the wave front reaches them, flicker while it passes and fade behind it, and a softer
 * second wave follows. The cells take the text color of the section under the pointer unless a wave color is set;
 * the accent color marks the dot and the wave front.
 *
 * A mouse shows it on press; touch and pen show it on release, so scrolling with a finger never triggers it.
 * Keyboard activation has no pointer position and shows nothing.
 *
 * Built to stay smooth on busy pages. Each wave draws on a small canvas that is made once, while the page is idle,
 * and reused: a click only notes the pointer, the next animation frame does the work, and no classes or elements
 * change, so the page is never restyled for it. The layer joins the top layer only while a dialog or popover is
 * open, so the wave also shows above the cart drawer or Quick Add.
 *
 * The wave is decorative: hidden from assistive technology, it never takes pointer events or focus, and it is
 * skipped when the shopper prefers reduced motion. Styles and settings live in snippets/click-effect.liquid.
 */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Waves on screen at once; rapid clicking beyond this restarts the oldest one */
const MAX_WAVES = 4;

/** How long the softer second wave trails the first, in milliseconds */
const ECHO_DELAY = 200;

/** How long the dot under the pointer lasts, in milliseconds */
const DOT_DURATION = 380;

/**
 * The looks the Style setting offers. Cell sizes, in CSS pixels, are for waves 240px across and up; smaller waves
 * use slightly smaller cells. The grid is fixed to the viewport, so every click reveals the same field.
 * @type {Record<string, { glyphs: string, width: number, height: number, font: number }>}
 */
const STYLES = {
  glyphs: { glyphs: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', width: 8, height: 12, font: 9.5 },
  binary: { glyphs: '01', width: 8, height: 12, font: 9.5 },
  // No characters: one rounded square per cell, drawn larger the brighter the cell, like a lit pixel
  pixels: { glyphs: '', width: 8, height: 8, font: 0 },
};
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** Tallest cell, in CSS pixels; canvases leave this much room around the wave */
const MAX_CELL = 12;

/** Device pixels per CSS pixel, capped: sharper canvases cost memory without a visible gain at this size */
const MAX_PIXEL_RATIO = 2;

/** Fallbacks match the setting defaults in config/settings_schema.json */
const DEFAULT_SIZE = 150;
const DEFAULT_STYLE = 'pixels';
const DEFAULT_ACCENT = '#E9C46A';

/**
 * Length of a wave, in milliseconds: one second for a 240px wave, a little shorter for smaller ones so they keep
 * the same lively pace.
 * @param {number} radius
 */
function waveDuration(radius) {
  return 700 + radius * 2.5;
}

/**
 * The cell grid and sprites for a style at a wave size.
 * @param {string} style
 * @param {number} radius
 */
function cellLook(style, radius) {
  const base = STYLES[style] ?? STYLES[DEFAULT_STYLE] ?? { glyphs: '', width: 7, height: 7, font: 0 };
  const scale = Math.min(1, Math.max(0.75, radius / 120));
  return {
    style,
    glyphs: base.glyphs,
    width: Math.round(base.width * scale),
    height: Math.round(base.height * scale),
    font: base.font * scale,
  };
}

/**
 * @typedef {object} Wave
 * @property {HTMLCanvasElement} canvas
 * @property {CanvasRenderingContext2D | null} context
 * @property {number} half - Half the canvas size, in CSS pixels
 * @property {number} ratio - Device pixels per CSS pixel the canvas is sized for
 * @property {Float32Array} cellX - Top-left corner of each character inside the canvas, in CSS pixels
 * @property {Float32Array} cellY
 * @property {Float32Array} cellDistance - Distance from the pointer
 * @property {Float32Array} cellEdge - Fade towards the edge of the wave, from 0 to 1
 * @property {Uint32Array} cellSeed - Picks each cell's character
 * @property {number} cellCount
 * @property {number} cellWidth - In CSS pixels
 * @property {number} cellHeight
 * @property {number} glyphCount - Characters to pick from; pixels have one sprite
 * @property {boolean} pixels - Whether cells are pixels, which grow with their brightness
 * @property {number} start - From performance.now()
 * @property {number} duration - In milliseconds
 * @property {number} radius - In CSS pixels
 * @property {HTMLCanvasElement | null} waveGlyphs - Cell sprites in the wave color
 * @property {HTMLCanvasElement | null} accentGlyphs - Cell sprites in the accent color
 * @property {string} accent
 * @property {boolean} glow - Light along the wave front, on dark sections only
 * @property {boolean} active
 */

/**
 * @typedef {object} PendingClick
 * @property {number} x
 * @property {number} y
 * @property {Element} target - The element under the pointer, for its section colors
 * @property {number} start
 */

/** @type {HTMLElement | undefined} */
let layer;

/** Whether the layer is in the top layer, above an open dialog or popover */
let raised = false;

/** Theme settings, read when the waves are prepared, and on every click in the theme editor */
const settings = { radius: DEFAULT_SIZE / 2, style: DEFAULT_STYLE, accent: DEFAULT_ACCENT, wave: '' };

/** @type {Wave[]} */
const waves = [];

/** @type {PendingClick[]} */
const pending = [];

let frameRequest = 0;

/** @type {Map<string, HTMLCanvasElement>} */
const spriteCache = new Map();

/** @type {CanvasRenderingContext2D | null | undefined} */
let colorProbe;

/**
 * Normalizes any CSS color to `#rrggbb` or `rgba(...)`, or returns '' when it isn't a color.
 * @param {string} value
 */
function normalizeColor(value) {
  const color = value.trim();
  if (!color) return '';
  if (colorProbe === undefined) colorProbe = document.createElement('canvas').getContext('2d');
  if (!colorProbe) return '';
  colorProbe.fillStyle = '#000';
  colorProbe.fillStyle = color;
  const first = String(colorProbe.fillStyle);
  colorProbe.fillStyle = '#fff';
  colorProbe.fillStyle = color;
  // An invalid color leaves the previous fill in place, so the two reads differ
  return first === String(colorProbe.fillStyle) ? first : '';
}

/**
 * Red, green, blue and alpha of a normalized color.
 * @param {string} color
 * @returns {[number, number, number, number]}
 */
function channels(color) {
  if (color.startsWith('#')) {
    const value = parseInt(color.slice(1, 7), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 1];
  }
  const [r = 0, g = 0, b = 0, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b, a];
}

/**
 * Relative luminance, from 0 for black to 1 for white.
 * @param {string} color
 */
function luminance(color) {
  const [r, g, b] = channels(color);
  const linear = (/** @type {number} */ channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * WCAG contrast ratio of two normalized colors.
 * @param {string} first
 * @param {string} second
 */
function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Hue, saturation and lightness of a normalized color.
 * @param {string} color
 * @returns {[number, number, number]} Hue in degrees; saturation and lightness from 0 to 1
 */
function toHsl(color) {
  const [r, g, b] = channels(color).map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = (r - g) / delta + 4;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  return [hue * 60, saturation, lightness];
}

/**
 * Keeps a color's hue but moves its lightness away from the background until the two contrast enough, so gold
 * stays gold on a light page instead of fading into it.
 * @param {string} color
 * @param {string} background
 * @param {number} ratio - Minimum contrast ratio
 */
function separate(color, background, ratio) {
  if (contrast(color, background) >= ratio) return color;
  const [hue, saturation, start] = toHsl(color);
  const step = luminance(background) < 0.2 ? 0.04 : -0.04;
  let result = color;
  for (let lightness = start + step; lightness > 0 && lightness < 1; lightness += step) {
    result = normalizeColor(`hsl(${hue} ${saturation * 100}% ${lightness * 100}%)`) || result;
    if (contrast(result, background) >= ratio) break;
  }
  return result;
}

/**
 * A normalized color with its alpha scaled.
 * @param {string} color
 * @param {number} alpha
 */
function withAlpha(color, alpha) {
  const [r, g, b, a] = channels(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha * a))})`;
}

/**
 * The first opaque-enough color among custom properties of the given styles.
 * @param {string} property
 * @param {CSSStyleDeclaration[]} styles
 */
function readColor(property, ...styles) {
  for (const style of styles) {
    const color = normalizeColor(style.getPropertyValue(property));
    if (color && channels(color)[3] >= 0.5) return color;
  }
  return '';
}

/** Reads the style, size and colors set under Theme settings > Animations */
function readSettings() {
  const rootStyle = getComputedStyle(document.documentElement);
  const size = parseFloat(rootStyle.getPropertyValue('--click-effect-size'));
  const style = rootStyle.getPropertyValue('--click-effect-style').trim();
  settings.radius = Math.max(40, (Number.isFinite(size) && size > 0 ? size : DEFAULT_SIZE) / 2);
  settings.style = style in STYLES ? style : DEFAULT_STYLE;
  settings.accent = readColor('--click-effect-accent-color', rootStyle) || DEFAULT_ACCENT;
  settings.wave = readColor('--click-effect-wave-color', rootStyle);
}

/**
 * Colors for a wave, from the settings and the section under the pointer. Without a wave color, the characters
 * take the section's text color, so they always contrast with it. A chosen wave color is lightened on dark
 * sections and the accent is deepened on light ones, so neither fades into the background.
 * @param {Element} target
 */
function colorsFor(target) {
  // Section colors are inherited custom properties, so the clicked element carries its section's values
  const style = getComputedStyle(target);
  const background = readColor('--color-background', style) || '#ffffff';
  const foreground = readColor('--color-foreground', style) || normalizeColor(style.color) || '#000000';

  return {
    wave: separate(settings.wave || foreground, background, 3),
    accent: separate(settings.accent, background, 2.5),
    glow: luminance(background) < 0.2,
  };
}

/**
 * Cell sprites in one color, side by side: one per character, or a single pixel. Drawn once per color, pixel ratio
 * and look.
 * @param {string} color
 * @param {number} ratio
 * @param {ReturnType<typeof cellLook>} look
 */
function glyphSprites(color, ratio, look) {
  const key = `${color}|${ratio}|${look.style}|${look.width}x${look.height}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const { glyphs, width, height } = look;
  const sprites = document.createElement('canvas');
  sprites.width = Math.max(1, glyphs.length) * width * ratio;
  sprites.height = height * ratio;
  const context = sprites.getContext('2d');
  if (context) {
    context.scale(ratio, ratio);
    context.fillStyle = color;
    if (glyphs) {
      context.font = `500 ${look.font}px ${FONT_FAMILY}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (let index = 0; index < glyphs.length; index += 1) {
        context.fillText(glyphs.charAt(index), index * width + width / 2, height / 2 + 0.5);
      }
    } else {
      // A pixel: a softly rounded square with space around it, like the grid of a screen
      const size = Math.min(width, height) * 0.7;
      const inset = (width - size) / 2;
      context.beginPath();
      if (typeof context.roundRect === 'function') context.roundRect(inset, inset, size, size, size * 0.25);
      else context.rect(inset, inset, size, size);
      context.fill();
    }
  }

  // Only a few colors are ever in use; drop the oldest beyond that
  const oldest = spriteCache.keys().next();
  if (spriteCache.size >= 8 && !oldest.done) spriteCache.delete(oldest.value);
  spriteCache.set(key, sprites);
  return sprites;
}

/** Device pixels per CSS pixel for the canvases */
function pixelRatio() {
  return Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
}

/**
 * Sizes a wave's canvas for a radius and pixel ratio. Only runs when either changes, since resizing also clears it.
 * @param {Wave} wave
 * @param {number} radius
 * @param {number} ratio
 */
function sizeWave(wave, radius, ratio) {
  const half = Math.ceil(radius + MAX_CELL);
  if (wave.half === half && wave.ratio === ratio) return;
  wave.half = half;
  wave.ratio = ratio;
  wave.canvas.width = Math.ceil(half * 2 * ratio);
  wave.canvas.height = Math.ceil(half * 2 * ratio);
  wave.canvas.style.width = `${half * 2}px`;
  wave.canvas.style.height = `${half * 2}px`;
}

/**
 * Builds the fixed, zero-size layer with all its canvases, sized, and adds it to the page in one step. Runs once
 * while the page is idle: on busy pages any element added to the page can restyle much of it, so clicks add none.
 */
function prepare() {
  if (reducedMotion.matches || layer?.isConnected) return;
  readSettings();
  const ratio = pixelRatio();
  const element = document.createElement('div');
  element.className = 'click-effect';
  element.setAttribute('aria-hidden', 'true');
  waves.length = 0;
  for (let count = 0; count < MAX_WAVES; count += 1) {
    const wave = createWave();
    sizeWave(wave, settings.radius, ratio);
    element.append(wave.canvas);
    waves.push(wave);
  }
  document.body.append(element);
  layer = element;
  raised = false;
}

/** Whether a dialog or popover is open; it would cover a layer that isn't in the top layer */
function topLayerInUse() {
  try {
    return document.querySelector('dialog[open], :popover-open:not(.click-effect)') !== null;
  } catch {
    return document.querySelector('dialog[open]') !== null;
  }
}

/** Lifts the layer into the top layer while a dialog or popover is open, so the wave shows above it */
function raiseLayer() {
  if (!layer || raised || typeof layer.showPopover !== 'function' || !topLayerInUse()) return;
  try {
    layer.setAttribute('popover', 'manual');
    layer.showPopover();
    raised = true;
  } catch {
    // Outside the top layer the wave still shows above the page itself
    layer.removeAttribute('popover');
  }
}

/** Returns the layer to the page once no wave is running */
function lowerLayer() {
  if (!raised || !layer) return;
  raised = false;
  try {
    layer.hidePopover();
  } catch {
    // Already closed
  }
  layer.removeAttribute('popover');
}

/** @returns {Wave} */
function createWave() {
  const canvas = document.createElement('canvas');
  canvas.className = 'click-effect__canvas';
  // Hidden while idle so the browser doesn't composite an empty canvas every frame. An inline style rather than
  // the hidden attribute, which :has() rules on the page watch
  canvas.style.visibility = 'hidden';
  return {
    canvas,
    context: canvas.getContext('2d'),
    half: 0,
    ratio: 0,
    cellX: new Float32Array(0),
    cellY: new Float32Array(0),
    cellDistance: new Float32Array(0),
    cellEdge: new Float32Array(0),
    cellSeed: new Uint32Array(0),
    cellCount: 0,
    cellWidth: 0,
    cellHeight: 0,
    glyphCount: 1,
    pixels: false,
    start: 0,
    duration: 0,
    radius: 0,
    waveGlyphs: null,
    accentGlyphs: null,
    accent: DEFAULT_ACCENT,
    glow: false,
    active: false,
  };
}

/**
 * A free canvas, or the oldest running one when all are busy.
 * @returns {Wave | undefined}
 */
function takeWave() {
  const free = waves.find((wave) => !wave.active);
  if (free) return free;
  return waves.reduce((oldest, wave) => (wave.start < oldest.start ? wave : oldest), waves[0]);
}

/**
 * Small, stable hash for a grid cell.
 * @param {number} column
 * @param {number} row
 */
function hashCell(column, row) {
  let hash = Math.imul(column, 374761393) ^ Math.imul(row, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Sets up a wave for a click.
 * @param {PendingClick} click
 */
function startWave({ x: pointerX, y: pointerY, target, start }) {
  const wave = takeWave();
  if (!wave) return;
  // In the theme editor the settings can change without a reload
  if (window.Shopify?.designMode) readSettings();
  const { radius } = settings;
  const ratio = pixelRatio();
  // Page zoom can change the pixel ratio after the canvases were made
  sizeWave(wave, radius, ratio);
  const { half, canvas } = wave;
  const x = Math.round(pointerX);
  const y = Math.round(pointerY);
  const { wave: waveColor, accent, glow } = colorsFor(target.isConnected ? target : document.body);
  const look = cellLook(settings.style, radius);
  const { width, height } = look;
  raiseLayer();

  // Cells inside the wave, on the grid fixed to the viewport
  const left = x - half;
  const top = y - half;
  const firstColumn = Math.floor((x - radius) / width);
  const lastColumn = Math.ceil((x + radius) / width);
  const firstRow = Math.floor((y - radius) / height);
  const lastRow = Math.ceil((y + radius) / height);
  const capacity = (lastColumn - firstColumn + 1) * (lastRow - firstRow + 1);
  if (wave.cellX.length < capacity) {
    wave.cellX = new Float32Array(capacity);
    wave.cellY = new Float32Array(capacity);
    wave.cellDistance = new Float32Array(capacity);
    wave.cellEdge = new Float32Array(capacity);
    wave.cellSeed = new Uint32Array(capacity);
  }
  let count = 0;
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cellLeft = column * width;
      const cellTop = row * height;
      const distance = Math.hypot(cellLeft + width / 2 - x, cellTop + height / 2 - y);
      if (distance > radius) continue;
      const edge = Math.min(1, (radius - distance) / (radius * 0.3));
      wave.cellX[count] = cellLeft - left;
      wave.cellY[count] = cellTop - top;
      wave.cellDistance[count] = distance;
      wave.cellEdge[count] = edge * edge * (3 - 2 * edge);
      wave.cellSeed[count] = hashCell(column, row);
      count += 1;
    }
  }

  wave.cellCount = count;
  wave.cellWidth = width;
  wave.cellHeight = height;
  wave.glyphCount = Math.max(1, look.glyphs.length);
  wave.pixels = !look.glyphs;
  wave.radius = radius;
  wave.duration = waveDuration(radius);
  wave.waveGlyphs = glyphSprites(waveColor, ratio, look);
  wave.accentGlyphs = glyphSprites(accent, ratio, look);
  wave.accent = accent;
  wave.glow = glow;
  wave.start = start;
  wave.active = true;
  canvas.style.transform = `translate(${left}px, ${top}px)`;
  canvas.style.visibility = 'visible';
}

/**
 * Radius of a wave front: fast out of the pointer, easing as it spreads.
 * @param {number} time - Milliseconds since the wave left the pointer
 * @param {number} radius - Radius of the whole effect
 * @param {number} duration - Length of the wave
 */
function frontRadius(time, radius, duration) {
  if (time < 0) return -Infinity;
  return radius * 1.15 * (1 - Math.exp(-time / (duration * 0.3)));
}

/**
 * Brightness of a cell at a distance from a wave front: a crisp leading edge and a soft trail.
 * @param {number} offset - Distance past the front, in pixels; negative behind it
 * @param {number} lead - Width of the leading edge, in pixels
 * @param {number} trail - Width of the trail, in pixels
 */
function band(offset, lead, trail) {
  const scaled = offset / (offset >= 0 ? lead : trail);
  return Math.exp(-scaled * scaled);
}

/**
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} value
 */
function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** @param {number} t - From 0 to 1 */
function easeOutBack(t) {
  const overshoot = 1.7;
  const shifted = t - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

/**
 * Draws one frame of a wave.
 * @param {Wave} wave
 * @param {number} now
 */
function draw(wave, now) {
  const { context, ratio, radius, half, duration, waveGlyphs, accentGlyphs, cellWidth, cellHeight } = wave;
  if (!context || !waveGlyphs || !accentGlyphs) return;
  const time = Math.max(0, now - wave.start);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, half * 2, half * 2);

  const front = frontRadius(time, radius, duration);
  const echo = frontRadius(time - ECHO_DELAY, radius, duration);
  const fade = 1 - smoothstep(duration * 0.45, duration, time);
  const flicker = Math.floor(time / 55);
  const spriteWidth = cellWidth * ratio;
  const spriteHeight = cellHeight * ratio;
  // The band keeps a few cells' depth even on small waves, so the ring never breaks up
  const lead = Math.max(3, radius * 0.05);
  const trail = Math.max(8, radius * 0.12);

  // Soft light along the main front, under the characters, gone before the front reaches the edge
  const light = wave.glow ? 0.14 * fade * (1 - smoothstep(radius * 0.7, radius * 1.02, front)) : 0;
  if (light > 0.005 && front > 4) {
    const inner = Math.max(0, front - radius * 0.16);
    const outer = front + radius * 0.05;
    const glow = context.createRadialGradient(half, half, inner, half, half, outer);
    glow.addColorStop(0, withAlpha(wave.accent, 0));
    glow.addColorStop(0.75, withAlpha(wave.accent, light));
    glow.addColorStop(1, withAlpha(wave.accent, 0));
    context.fillStyle = glow;
    // Only the ring the light covers, not the whole disc inside it
    context.beginPath();
    context.arc(half, half, outer, 0, Math.PI * 2);
    context.arc(half, half, inner, 0, Math.PI * 2, true);
    context.fill();
  }

  // Beyond these distances from a front a cell is invisible, so most cells skip the math entirely
  const ahead = lead * 2.6;
  const behind = trail * 2.6;

  for (let index = 0; index < wave.cellCount; index += 1) {
    const distance = wave.cellDistance[index] ?? 0;
    const fromFront = distance - front;
    const fromEcho = distance - echo;
    const main = fromFront > ahead || fromFront < -behind ? 0 : band(fromFront, lead, trail);
    const second = fromEcho > ahead || fromEcho < -behind ? 0 : band(fromEcho, lead, trail) * 0.4;
    if (main === 0 && second === 0) continue;
    const edge = wave.cellEdge[index] ?? 0;
    const alpha = Math.min(1, (main + second) * fade * edge);
    if (alpha < 0.04) continue;

    const seed = wave.cellSeed[index] ?? 0;
    // Characters flicker while the front passes, then settle
    const glyph = (main > 0.35 ? seed + flicker : seed) % wave.glyphCount;
    let x = wave.cellX[index] ?? 0;
    let y = wave.cellY[index] ?? 0;
    let width = cellWidth;
    let height = cellHeight;
    if (wave.pixels) {
      // A pixel grows with its brightness, so the wave front reads as a raised ridge
      const grow = 0.45 + 0.55 * Math.min(1, main + second);
      x += (cellWidth * (1 - grow)) / 2;
      y += (cellHeight * (1 - grow)) / 2;
      width = cellWidth * grow;
      height = cellHeight * grow;
    }

    context.globalAlpha = alpha;
    context.drawImage(waveGlyphs, glyph * spriteWidth, 0, spriteWidth, spriteHeight, x, y, width, height);

    // The leading edge glints in the accent color; pixels keep it to a thin line, as they read bolder than text
    if (main > (wave.pixels ? 0.55 : 0.4) && fromFront > -radius * (wave.pixels ? 0.04 : 0.08)) {
      context.globalAlpha = Math.min(1, main * fade * edge);
      context.drawImage(accentGlyphs, glyph * spriteWidth, 0, spriteWidth, spriteHeight, x, y, width, height);
    }
  }
  context.globalAlpha = 1;

  // The dot under the pointer pops in, then shrinks away
  if (time < DOT_DURATION) {
    const grow = easeOutBack(Math.min(1, time / 90));
    const settle = 1 - smoothstep(90, DOT_DURATION, time);
    const dotRadius = Math.min(7, Math.max(4, radius * 0.045)) * (0.55 + 0.45 * grow) * (0.6 + 0.4 * settle);
    context.globalAlpha = settle;
    context.fillStyle = wave.accent;
    context.beginPath();
    context.arc(half, half, dotRadius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }
}

/**
 * Clears and hides a finished wave's canvas; it stays in the page, ready for the next click.
 * @param {Wave} wave
 */
function clearWave(wave) {
  wave.active = false;
  wave.canvas.style.visibility = 'hidden';
  if (!wave.context) return;
  wave.context.setTransform(1, 0, 0, 1, 0, 0);
  wave.context.clearRect(0, 0, wave.canvas.width, wave.canvas.height);
}

/** @param {number} now */
function tick(now) {
  frameRequest = 0;
  if (pending.length && !layer?.isConnected) prepare();
  for (const click of pending.splice(0)) startWave(click);

  let running = false;
  for (const wave of waves) {
    if (!wave.active) continue;
    if (now - wave.start >= wave.duration) {
      clearWave(wave);
      continue;
    }
    draw(wave, now);
    running = true;
  }

  if (running) frameRequest = requestAnimationFrame(tick);
  else lowerLayer();
}

/**
 * Notes a click; the next animation frame starts its wave, so the click itself does no work.
 * @param {PointerEvent} event
 */
function queueWave(event) {
  if (reducedMotion.matches) return;
  pending.push({
    x: event.clientX,
    y: event.clientY,
    target: event.target instanceof Element ? event.target : document.body,
    start: performance.now(),
  });
  if (pending.length > MAX_WAVES) pending.shift();
  if (!frameRequest) frameRequest = requestAnimationFrame(tick);
}

// Capture phase, so components that stop propagation still get the animation
document.addEventListener(
  'pointerdown',
  (event) => {
    if (event.pointerType === 'mouse' && event.isPrimary && event.button === 0) queueWave(event);
  },
  { capture: true, passive: true }
);

document.addEventListener(
  'pointerup',
  (event) => {
    if (event.pointerType !== 'mouse' && event.isPrimary) queueWave(event);
  },
  { capture: true, passive: true }
);

// Build the layer while the page is idle, so even the first click adds nothing to the page
if ('requestIdleCallback' in window) window.requestIdleCallback(prepare, { timeout: 4000 });
else setTimeout(prepare, 2000);
