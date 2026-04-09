// ===== Pixloft Editor Engine — Day 6 =====

// ── DOM refs ──
const canvas        = document.getElementById('mainCanvas');
const ctx           = canvas.getContext('2d');
const canvasArea    = document.getElementById('canvasArea');
const canvasHint    = document.getElementById('canvasHint');
const zoomLabel     = document.getElementById('zoomLabel');

// ── State ──
const state = {
  imageLoaded:  false,
  originalImage: null,
  zoom:         1,
  minZoom:      0.05,
  maxZoom:      10,
  offsetX:      0,
  offsetY:      0,
  isPanning:    false,
  panStartX:    0,
  panStartY:    0,
  panOriginX:   0,
  panOriginY:   0,
  spaceHeld:    false,
  activeTool:   'select',
  dirty:        false,   // needs redraw
  history:      [],
  historyIndex: -1,
  maxHistory:   40,
  params: {
    // Light
    brightness:      0,
    contrast:        0,
    exposure:        0,
    highlights:      0,
    shadows:         0,
    // Color
    saturation:      0,
    vibrance:        0,
    temperature:     0,
    tint:            0,
    // HSL per-hue (hue/sat/lum for each colour band)
    hsl: {
      red:     { hue: 0, sat: 0, lum: 0 },
      orange:  { hue: 0, sat: 0, lum: 0 },
      yellow:  { hue: 0, sat: 0, lum: 0 },
      green:   { hue: 0, sat: 0, lum: 0 },
      aqua:    { hue: 0, sat: 0, lum: 0 },
      blue:    { hue: 0, sat: 0, lum: 0 },
      purple:  { hue: 0, sat: 0, lum: 0 },
      magenta: { hue: 0, sat: 0, lum: 0 },
    },
    // Detail
    sharpness:       0,
    noise_reduction: 0,
    // Effects
    vignette:        0,
    grain:           0,
  },
};

// ── Offscreen canvas stores original pixels ──
let offscreen    = null;
let offscreenCtx = null;

// ── Debounce timer for heavy ops ──
let redrawTimer = null;

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
function init() {
  loadImage(IMAGE_URL);
  bindCanvasEvents();
  bindSliders();
  bindTools();
  bindAccordion();
  bindTopbar();
  bindKeyboard();
}

// ═══════════════════════════════════════════
//  IMAGE LOADING
// ═══════════════════════════════════════════
function loadImage(src) {
  showHint('Loading image...');

  const img      = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    state.originalImage = img;
    state.imageLoaded   = true;

    // Offscreen = permanent store of original pixels
    offscreen        = document.createElement('canvas');
    offscreen.width  = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    offscreenCtx     = offscreen.getContext('2d');
    offscreenCtx.drawImage(img, 0, 0);

    fitToScreen();
    redraw();
    pushHistory();
    drawHistogram();

    showHint('Scroll to zoom · Space+drag to pan · Sliders to edit');
  };

  img.onerror = () => showHint('⚠ Failed to load image');
  img.src      = src;
}

// ═══════════════════════════════════════════
//  PIXEL PROCESSING — CORE ENGINE
// ═══════════════════════════════════════════
function processPixels(srcData) {
  const p    = state.params;
  const data = new Uint8ClampedArray(srcData.data);
  const len  = data.length;

  // ── Pre-compute constants ──
  const brightness  = p.brightness  * 0.8;           // −80 … +80
  const exposure    = p.exposure    * 1.0;            // −100 … +100
  const saturation  = p.saturation  / 100;            // −1 … +1
  const vibrance    = p.vibrance    / 100;            // −1 … +1
  const temperature = p.temperature * 0.3;            // −30 … +30
  const tint        = p.tint        * 0.2;            // −20 … +20
  const highlights  = p.highlights  * 0.6;            // −60 … +60
  const shadows     = p.shadows     * 0.6;            // −60 … +60

  // Contrast uses the photographic S-curve formula
  const cVal    = p.contrast;
  const cFactor = cVal !== 0
    ? (259 * (cVal + 255)) / (255 * (259 - cVal))
    : 1;

  // Build a LUT (Look-Up Table) for brightness + contrast + exposure
  // LUTs are much faster than per-pixel calculations for simple ops
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = i;
    v += exposure;
    v += brightness;
    if (cVal !== 0) v = cFactor * (v - 128) + 128;
    lut[i] = Math.max(0, Math.min(255, v));
  }
  const hslParams   = state.params.hsl;
const hasHslEdits = Object.values(hslParams).some(
  band => band.hue !== 0 || band.sat !== 0 || band.lum !== 0
);

  // ── Per-pixel loop ──
  for (let i = 0; i < len; i += 4) {
    let r = lut[data[i]];
    let g = lut[data[i + 1]];
    let b = lut[data[i + 2]];

   // ── HSL per-hue adjustments ──
const hslParams = state.params.hsl;
const hasHslEdits = Object.values(hslParams).some(
  band => band.hue !== 0 || band.sat !== 0 || band.lum !== 0
);

// inside the for loop, before the clamp, add:

    // ── HSL per-hue ──
    if (hasHslEdits) {
      const hslResult = applyHslToPixel(r, g, b, hslParams);
      r = hslResult.r;
      g = hslResult.g;
      b = hslResult.b;
    }

    // ── Vibrance ──
    if (vibrance !== 0) {
      const vResult = applyVibrance(r, g, b, p.vibrance);
      r = vResult.r;
      g = vResult.g;
      b = vResult.b;
    }

    // ── Highlights & Shadows ──
    // Luma tells us if pixel is bright or dark
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;

    if (highlights !== 0) {
      // Highlights only affect bright pixels (luma > 128)
      const hWeight = Math.max(0, (luma - 128) / 127);
      r += highlights * hWeight;
      g += highlights * hWeight;
      b += highlights * hWeight;
    }

    if (shadows !== 0) {
      // Shadows only affect dark pixels (luma < 128)
      const sWeight = Math.max(0, (128 - luma) / 128);
      r += shadows * sWeight;
      g += shadows * sWeight;
      b += shadows * sWeight;
    }

    // ── White Balance ──
    if (temperature !== 0) {
      r += temperature;    // warm = more red
      b -= temperature;    // warm = less blue
    }
    if (tint !== 0) {
      g += tint;           // tint shifts green channel
    }

    // ── Saturation ──
    if (saturation !== 0) {
      const grey = 0.299 * r + 0.587 * g + 0.114 * b;
      r = grey + (r - grey) * (1 + saturation);
      g = grey + (g - grey) * (1 + saturation);
      b = grey + (b - grey) * (1 + saturation);
    }

    // ── Vibrance ──
    // Vibrance is "smart saturation" — boosts dull colours
    // more than already-saturated ones, and protects skin tones
    if (vibrance !== 0) {
      const maxC  = Math.max(r, g, b);
      const minC  = Math.min(r, g, b);
      const sat   = maxC === 0 ? 0 : (maxC - minC) / maxC;
      const boost = vibrance * (1 - sat);   // less boost for already-saturated
      const grey2 = 0.299 * r + 0.587 * g + 0.114 * b;
      r = grey2 + (r - grey2) * (1 + boost);
      g = grey2 + (g - grey2) * (1 + boost);
      b = grey2 + (b - grey2) * (1 + boost);
    }

    // ── Clamp to 0–255 ──
    data[i]     = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
    // data[i + 3] = alpha, untouched
  }

  return new ImageData(data, srcData.width, srcData.height);
}

// ═══════════════════════════════════════════
//  HSL COLOUR SPACE HELPERS
// ═══════════════════════════════════════════

// RGB (0–255) → HSL (h: 0–360, s: 0–1, l: 0–1)
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max  = Math.max(r, g, b);
    const min  = Math.min(r, g, b);
    const diff = max - min;
    let h = 0, s = 0;
    const l = (max + min) / 2;
  
    if (diff !== 0) {
      s = diff / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = ((g - b) / diff + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / diff + 2) / 6;               break;
        case b: h = ((r - g) / diff + 4) / 6;               break;
      }
    }
    return { h: h * 360, s, l };
  }
  
  // HSL → RGB (0–255)
  function hslToRgb(h, s, l) {
    h /= 360;
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
      g: Math.round(hue2rgb(p, q, h)       * 255),
      b: Math.round(hue2rgb(p, q, h - 1/3) * 255),
    };
  }
  
  // Hue range definitions for each colour band
  // Each band has a centre hue and a soft falloff range
  const HUE_BANDS = {
    red:     { center: 0,   range: 30 },
    orange:  { center: 30,  range: 25 },
    yellow:  { center: 60,  range: 25 },
    green:   { center: 120, range: 40 },
    aqua:    { center: 180, range: 30 },
    blue:    { center: 220, range: 30 },
    purple:  { center: 280, range: 30 },
    magenta: { center: 320, range: 30 },
  };
  
  // How much a pixel's hue belongs to a given band (0–1)
  // Uses a smooth cosine falloff so edits blend naturally
  function hueWeight(pixelHue, bandCenter, bandRange) {
    let diff = Math.abs(pixelHue - bandCenter);
    if (diff > 180) diff = 360 - diff;  // wrap around 360°
    if (diff > bandRange) return 0;
    return Math.cos((diff / bandRange) * (Math.PI / 2));
  }
  
  // Apply HSL per-hue adjustments to one pixel
  // Returns { r, g, b } with adjustments applied
  function applyHslToPixel(r, g, b, hslParams) {
    const { h, s, l } = rgbToHsl(r, g, b);
  
    // Skip fully desaturated pixels (no hue to adjust)
    if (s < 0.02) return { r, g, b };
  
    let dHue = 0, dSat = 0, dLum = 0;
  
    // Accumulate weighted adjustments from all bands
    for (const [band, { center, range }] of Object.entries(HUE_BANDS)) {
      const w = hueWeight(h, center, range);
      if (w === 0) continue;
  
      const adj = hslParams[band];
      dHue += adj.hue * w;
      dSat += adj.sat * w;
      dLum += adj.lum * w;
    }
  
    // Red band wraps — also check near 360°
    const wRed2 = hueWeight(h, 360, HUE_BANDS.red.range);
    if (wRed2 > 0) {
      const adj = hslParams.red;
      dHue += adj.hue * wRed2;
      dSat += adj.sat * wRed2;
      dLum += adj.lum * wRed2;
    }
  
    if (dHue === 0 && dSat === 0 && dLum === 0) return { r, g, b };
  
    // Apply shifts (scale to reasonable ranges)
    const newH = (h + dHue * 1.8 + 360) % 360;  // ±180° max shift
    const newS = Math.max(0, Math.min(1, s + dSat / 100));
    const newL = Math.max(0, Math.min(1, l + dLum / 200));
  
    return hslToRgb(newH, newS, newL);
  }
  
  // ═══════════════════════════════════════════
  //  VIBRANCE ENGINE
  //  Smart saturation that protects skin tones
  // ═══════════════════════════════════════════
  function applyVibrance(r, g, b, amount) {
    if (amount === 0) return { r, g, b };
  
    const { h, s, l } = rgbToHsl(r, g, b);
  
    // Skin tone detection: hues 0–50° (reds/oranges)
    // with moderate saturation — boost these less
    const isSkinTone = h >= 0 && h <= 50 && s > 0.1 && s < 0.8;
    const skinProtect = isSkinTone ? 0.4 : 1.0;
  
    // Vibrance boost is inversely proportional to existing saturation
    // Already-saturated colours get boosted less
    const boost = (amount / 100) * (1 - s) * skinProtect;
  
    const newS = Math.max(0, Math.min(1, s + boost));
    const result = hslToRgb(h, newS, l);
    return result;
  }

// ═══════════════════════════════════════════
//  REDRAW
// ═══════════════════════════════════════════
function redraw() {
  if (!state.imageLoaded) return;

  const area    = canvasArea.getBoundingClientRect();
  canvas.width  = area.width;
  canvas.height = area.height;

  // Draw checkerboard background
  drawCheckerboard();

  // Apply zoom + pan transform
  ctx.save();
  ctx.translate(state.offsetX, state.offsetY);
  ctx.scale(state.zoom, state.zoom);

  // Get original pixels, process them, draw
  const srcData = offscreenCtx.getImageData(
    0, 0, offscreen.width, offscreen.height
  );
  // temp canvas for processed image
if (!state._processedCanvas) {
    state._processedCanvas = document.createElement('canvas');
    state._processedCtx = state._processedCanvas.getContext('2d');
  }
  
  state._processedCanvas.width  = offscreen.width;
  state._processedCanvas.height = offscreen.height;
  
  const processed = processPixels(srcData);
  state._processedCtx.putImageData(processed, 0, 0);
  
  // draw using drawImage (respects zoom/pan)
  ctx.drawImage(state._processedCanvas, 0, 0);

  ctx.restore();
}

// Debounced redraw — prevents janking during rapid slider input
function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(redraw, 8); // ~120fps cap
}

function drawCheckerboard() {
  const size = 14;
  for (let y = 0; y < canvas.height; y += size) {
    for (let x = 0; x < canvas.width; x += size) {
      ctx.fillStyle = ((x / size + y / size) % 2 === 0)
        ? '#1a1a1e' : '#141418';
      ctx.fillRect(x, y, size, size);
    }
  }
}

// ═══════════════════════════════════════════
//  FIT TO SCREEN / ZOOM
// ═══════════════════════════════════════════
function fitToScreen() {
  if (!state.imageLoaded) return;
  const area    = canvasArea.getBoundingClientRect();
  const padding = 80;
  const scaleX  = (area.width  - padding) / offscreen.width;
  const scaleY  = (area.height - padding) / offscreen.height;
  state.zoom    = Math.min(scaleX, scaleY, 1);
  state.offsetX = (area.width  - offscreen.width  * state.zoom) / 2;
  state.offsetY = (area.height - offscreen.height * state.zoom) / 2;
  updateZoomLabel();
  redraw();
}

function zoomTo(newZoom, originX, originY) {
  newZoom       = Math.max(state.minZoom, Math.min(state.maxZoom, newZoom));
  const ratio   = newZoom / state.zoom;
  state.offsetX = originX - ratio * (originX - state.offsetX);
  state.offsetY = originY - ratio * (originY - state.offsetY);
  state.zoom    = newZoom;
  updateZoomLabel();
  redraw();
}

function updateZoomLabel() {
  zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
}

// ═══════════════════════════════════════════
//  HISTOGRAM
// ═══════════════════════════════════════════
let histTimer = null;

function drawHistogram() {
  clearTimeout(histTimer);
  histTimer = setTimeout(_drawHistogram, 60);
}

function _drawHistogram() {
  if (!state.imageLoaded) return;

  const hCanvas = document.getElementById('histogramCanvas');
  if (!hCanvas) return;
  const hCtx = hCanvas.getContext('2d');
  const w = hCanvas.width;
  const h = hCanvas.height;

  // Sample from processed pixels
  const srcData   = offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  const processed = processPixels(srcData);
  const data      = processed.data;

  const rBins = new Uint32Array(256);
  const gBins = new Uint32Array(256);
  const bBins = new Uint32Array(256);
  const lBins = new Uint32Array(256); // luminance

  // Sample every 4th pixel for speed
  for (let i = 0; i < data.length; i += 16) {
    rBins[data[i]]++;
    gBins[data[i + 1]]++;
    bBins[data[i + 2]]++;
    lBins[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])]++;
  }

  const max = Math.max(
    ...Array.from(rBins), ...Array.from(gBins),
    ...Array.from(bBins), ...Array.from(lBins)
  );

  hCtx.clearRect(0, 0, w, h);

  // Draw luminance first (behind), then RGB
  [
    [lBins, 'rgba(255,255,255,0.12)'],
    [rBins, 'rgba(255, 75, 75, 0.5)'],
    [gBins, 'rgba(75, 200, 75, 0.5)'],
    [bBins, 'rgba(75, 130, 255, 0.5)'],
  ].forEach(([bins, color]) => {
    hCtx.beginPath();
    hCtx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - (bins[i] / max) * (h - 2);
      i === 0 ? hCtx.moveTo(x, y) : hCtx.lineTo(x, y);
    }
    hCtx.lineTo(w, h);
    hCtx.closePath();
    hCtx.fillStyle = color;
    hCtx.fill();
  });

  // Clipping indicator lines
  hCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  hCtx.lineWidth   = 0.5;
  hCtx.beginPath();
  hCtx.moveTo(0, 0); hCtx.lineTo(w, 0);
  hCtx.moveTo(0, h); hCtx.lineTo(w, h);
  hCtx.stroke();
}

// ═══════════════════════════════════════════
//  SLIDER BINDING
// ═══════════════════════════════════════════
function bindSliders() {
  document.querySelectorAll('.adj-slider').forEach(slider => {
    const valEl   = slider.nextElementSibling;
    const row     = slider.closest('.slider-row');

    // Update value display and track fill on every move
    slider.addEventListener('input', () => {
      const param = slider.dataset.param;
      const value = parseInt(slider.value);
      state.params[param] = value;

      // Update value label
      valEl.textContent  = value > 0 ? `+${value}` : `${value}`;
      valEl.style.color  = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';

      // Highlight active row
      row.classList.toggle('slider-row--active', value !== 0);

      // Update slider track fill
      updateSliderTrack(slider);

      // Redraw canvas
      scheduleRedraw();
      drawHistogram();
    });

    // Push to history when user finishes dragging
    slider.addEventListener('change', pushHistory);

    // Double-click label to reset that slider
    const label = row.querySelector('label');
    if (label) {
      label.style.cursor = 'pointer';
      label.title        = 'Double-click to reset';
      label.addEventListener('dblclick', () => {
        slider.value            = 0;
        state.params[slider.dataset.param] = 0;
        valEl.textContent       = '0';
        valEl.style.color       = 'var(--text-muted)';
        row.classList.remove('slider-row--active');
        updateSliderTrack(slider);
        scheduleRedraw();
        drawHistogram();
        pushHistory();
      });
    }
  });
}

// Fills slider track from center (for −100…+100 sliders)
// and from left (for 0…100 sliders)
function updateSliderTrack(slider) {
  const min = parseInt(slider.min);
  const max = parseInt(slider.max);
  const val = parseInt(slider.value);

  let pct;
  if (min < 0) {
    // Bidirectional slider — fill from center
    const center = (0 - min) / (max - min) * 100;
    const pos    = (val - min) / (max - min) * 100;
    const left   = Math.min(center, pos);
    const width  = Math.abs(pos - center);
    slider.style.background = `linear-gradient(
      to right,
      var(--bg-3) 0%,
      var(--bg-3) ${left}%,
      var(--accent) ${left}%,
      var(--accent) ${left + width}%,
      var(--bg-3) ${left + width}%,
      var(--bg-3) 100%
    )`;
  } else {
    // Unidirectional slider — fill from left
    pct = (val / max) * 100;
    slider.style.background = `linear-gradient(
      to right,
      var(--accent) 0%,
      var(--accent) ${pct}%,
      var(--bg-3) ${pct}%,
      var(--bg-3) 100%
    )`;
  }
}

// Init all slider tracks on load
function initSliderTracks() {
  document.querySelectorAll('.adj-slider').forEach(updateSliderTrack);
}

// ═══════════════════════════════════════════
//  HISTORY — UNDO / REDO
// ═══════════════════════════════════════════
function pushHistory() {
    state.history = state.history.slice(0, state.historyIndex + 1);
    // Deep copy including hsl nested object
    state.history.push({
      ...state.params,
      hsl: JSON.parse(JSON.stringify(state.params.hsl)),
    });
    if (state.history.length > state.maxHistory) state.history.shift();
    state.historyIndex = state.history.length - 1;
    updateHistoryBtns();
  }
  

  function restoreHistory(params) {
    state.params = {
      ...params,
      hsl: JSON.parse(JSON.stringify(params.hsl)),
    };
    syncSliders();
    updateHslDots();
    redraw();
    drawHistogram();
    updateHistoryBtns();
  }

function syncSliders() {
  document.querySelectorAll('.adj-slider').forEach(slider => {
    const param = slider.dataset.param;
    if (state.params[param] === undefined) return;
    const value          = state.params[param];
    slider.value         = value;
    const valEl          = slider.nextElementSibling;
    valEl.textContent    = value > 0 ? `+${value}` : `${value}`;
    valEl.style.color    = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
    slider.closest('.slider-row')
      .classList.toggle('slider-row--active', value !== 0);
    updateSliderTrack(slider);
  });
}

function updateHistoryBtns() {
  const u = document.getElementById('btnUndo');
  const r = document.getElementById('btnRedo');
  if (u) u.disabled = state.historyIndex <= 0;
  if (r) r.disabled = state.historyIndex >= state.history.length - 1;
}

// ═══════════════════════════════════════════
//  CANVAS EVENTS — ZOOM & PAN
// ═══════════════════════════════════════════
function bindCanvasEvents() {
  // Resize
  new ResizeObserver(() => {
    if (state.imageLoaded) redraw();
  }).observe(canvasArea);

  // Wheel zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect   = canvas.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const my     = e.clientY - rect.top;
    zoomTo(state.zoom * (e.deltaY > 0 ? 0.9 : 1.1), mx, my);
  }, { passive: false });

  // Pan — mousedown
  canvas.addEventListener('mousedown', e => {
    if (e.button === 1 || state.spaceHeld) {
      e.preventDefault();
      state.isPanning  = true;
      state.panStartX  = e.clientX;
      state.panStartY  = e.clientY;
      state.panOriginX = state.offsetX;
      state.panOriginY = state.offsetY;
      canvas.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', e => {
    if (!state.isPanning) return;
    state.offsetX = state.panOriginX + (e.clientX - state.panStartX);
    state.offsetY = state.panOriginY + (e.clientY - state.panStartY);
    redraw();
  });

  window.addEventListener('mouseup', () => {
    if (state.isPanning) {
      state.isPanning     = false;
      canvas.style.cursor = state.spaceHeld ? 'grab' : 'crosshair';
    }
  });

  // Pinch zoom
  let lastPinch = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 2) lastPinch = pinchDist(e);
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const d   = pinchDist(e);
    const rect = canvas.getBoundingClientRect();
    const cx  = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    const cy  = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
    zoomTo(state.zoom * d / lastPinch, cx, cy);
    lastPinch = d;
  }, { passive: false });

  // Double-click zoom
  canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect();
    zoomTo(state.zoom < 1.5 ? 2 : 1, e.clientX - rect.left, e.clientY - rect.top);
  });
}

function pinchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// Space to pan
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    state.spaceHeld     = true;
    canvas.style.cursor = 'grab';
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    state.spaceHeld     = false;
    canvas.style.cursor = 'crosshair';
  }
});

// ═══════════════════════════════════════════
//  TOOLS
// ═══════════════════════════════════════════
function bindTools() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTool = btn.dataset.tool;
      const hints = {
        select: 'Select tool active',
        crop:   'Crop — coming Day 10',
        rotate: 'Rotate — coming Day 10',
        flip:   'Flip — coming Day 10',
      };
      showHint(hints[state.activeTool] || '');
    });
  });
}

// ═══════════════════════════════════════════
//  ACCORDION
// ═══════════════════════════════════════════
function bindAccordion() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.parentElement;
      const body    = section.querySelector('.accordion-body');
      const isOpen  = section.classList.contains('open');
      section.classList.toggle('open', !isOpen);
      body.style.display = isOpen ? 'none' : 'block';
    });
  });
}

// ═══════════════════════════════════════════
//  TOPBAR
// ═══════════════════════════════════════════
function bindTopbar() {
  const cx = () => canvas.width  / 2;
  const cy = () => canvas.height / 2;

  document.getElementById('btnZoomIn') .addEventListener('click', () => zoomTo(state.zoom * 1.25, cx(), cy()));
  document.getElementById('btnZoomOut').addEventListener('click', () => zoomTo(state.zoom * 0.80, cx(), cy()));
  document.getElementById('btnFit')   .addEventListener('click', fitToScreen);
  document.getElementById('btnUndo')  .addEventListener('click', undo);
  document.getElementById('btnRedo')  .addEventListener('click', redo);

  // Reset all
  document.getElementById('btnReset').addEventListener('click', () => {
    Object.keys(state.params).forEach(k => {
      if (k !== 'hsl') state.params[k] = 0;
    });
    // Reset all hsl bands
    Object.keys(state.params.hsl).forEach(band => {
      state.params.hsl[band] = { hue: 0, sat: 0, lum: 0 };
    });
    syncSliders();
    updateHslDots();
  
    // Reset HSL sliders display
    document.querySelectorAll('.hsl-slider').forEach(s => {
      s.value = 0;
      s.nextElementSibling.textContent = '0';
      s.nextElementSibling.style.color = 'var(--text-muted)';
      updateSliderTrack(s);
    });
  
    redraw();
    drawHistogram();
    pushHistory();
    showHint('All edits reset ↺');
  });

  // Before / After
  let showingBefore = false;
  document.getElementById('btnBefore').addEventListener('click', () => {
    showingBefore = !showingBefore;
    const btn = document.getElementById('btnBefore');

    if (showingBefore) {
      // Show original unedited image
      const area    = canvasArea.getBoundingClientRect();
      canvas.width  = area.width;
      canvas.height = area.height;
      drawCheckerboard();
      ctx.save();
      ctx.translate(state.offsetX, state.offsetY);
      ctx.scale(state.zoom, state.zoom);
      ctx.drawImage(state.originalImage, 0, 0);
      ctx.restore();
      btn.classList.add('active');
      btn.textContent = '◨ After';
    } else {
      redraw();
      btn.classList.remove('active');
      btn.textContent = '◧ Before';
    }
  });

  // Export placeholder
  document.getElementById('btnExport').addEventListener('click', () => {
    showHint('Export coming Day 16 ✦');
  });
}

// ═══════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════
function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y')                { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey)  { e.preventDefault(); redo(); }

    switch (e.key) {
      case '0': fitToScreen();                            break;
      case '1': zoomTo(1, cx, cy);                       break;
      case '2': zoomTo(2, cx, cy);                       break;
      case '+':
      case '=': zoomTo(state.zoom * 1.25, cx, cy);       break;
      case '-': zoomTo(state.zoom * 0.80, cx, cy);       break;
      case 'b':
      case 'B': document.getElementById('btnBefore').click(); break;
      case 'r':
      case 'R': document.getElementById('btnReset').click();  break;
    }
  });
}

// ═══════════════════════════════════════════
//  HINT
// ═══════════════════════════════════════════
let hintTimer = null;
function showHint(msg) {
  canvasHint.textContent   = msg;
  canvasHint.style.opacity = '1';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    canvasHint.style.opacity = '0';
  }, 2500);
}
canvasHint.style.transition = 'opacity 0.4s';

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
init();
initSliderTracks();