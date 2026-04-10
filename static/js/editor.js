// ===== Pixloft Editor Engine — Day 8 =====

// ── DOM refs ──
const canvas     = document.getElementById('mainCanvas');
const ctx        = canvas.getContext('2d');
const canvasArea = document.getElementById('canvasArea');
const canvasHint = document.getElementById('canvasHint');
const zoomLabel  = document.getElementById('zoomLabel');

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
    // HSL per-hue
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

// ── Debounce timer ──
let redrawTimer = null;

// ── Active HSL band ──
let activeHueBand = 'all';

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
function init() {
  loadImage(IMAGE_URL);
  bindCanvasEvents();
  bindSliders();
  bindHslTabs();
  bindTools();
  bindAccordion();
  bindTopbar();
  bindKeyboard();
  bindWhiteBalance();
}

// ═══════════════════════════════════════════
//  IMAGE LOADING
// ═══════════════════════════════════════════
function loadImage(src) {
  showHint('Loading image...');

  const img       = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    state.originalImage = img;
    state.imageLoaded   = true;

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
  img.src     = src;
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
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h)         * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

// Hue band definitions — center hue and falloff range in degrees
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

// How much a pixel belongs to a band — smooth cosine falloff (0–1)
function hueWeight(pixelHue, bandCenter, bandRange) {
  let diff = Math.abs(pixelHue - bandCenter);
  if (diff > 180) diff = 360 - diff; // wrap around 360°
  if (diff > bandRange) return 0;
  return Math.cos((diff / bandRange) * (Math.PI / 2));
}

// Apply per-hue HSL adjustments to a single pixel
function applyHslToPixel(r, g, b, hslParams) {
  const { h, s, l } = rgbToHsl(r, g, b);

  // Skip fully desaturated pixels — no hue to adjust
  if (s < 0.02) return { r, g, b };

  let dHue = 0, dSat = 0, dLum = 0;

  // Accumulate weighted contributions from each band
  for (const [band, { center, range }] of Object.entries(HUE_BANDS)) {
    const w = hueWeight(h, center, range);
    if (w === 0) continue;
    const adj = hslParams[band];
    dHue += adj.hue * w;
    dSat += adj.sat * w;
    dLum += adj.lum * w;
  }

  // Red band also wraps near 360°
  const wRed2 = hueWeight(h, 360, HUE_BANDS.red.range);
  if (wRed2 > 0) {
    dHue += hslParams.red.hue * wRed2;
    dSat += hslParams.red.sat * wRed2;
    dLum += hslParams.red.lum * wRed2;
  }

  if (dHue === 0 && dSat === 0 && dLum === 0) return { r, g, b };

  const newH = (h + dHue * 1.8 + 360) % 360;
  const newS = Math.max(0, Math.min(1, s + dSat / 100));
  const newL = Math.max(0, Math.min(1, l + dLum / 200));

  return hslToRgb(newH, newS, newL);
}

// Vibrance — smart saturation that protects skin tones
function applyVibrance(r, g, b, amount) {
  if (amount === 0) return { r, g, b };

  const { h, s, l } = rgbToHsl(r, g, b);

  // Skin tone hues (0–50°) with moderate saturation get less boost
  const isSkinTone  = h >= 0 && h <= 50 && s > 0.1 && s < 0.8;
  const skinProtect = isSkinTone ? 0.4 : 1.0;

  // Less boost for already-saturated pixels
  const boost = (amount / 100) * (1 - s) * skinProtect;
  const newS  = Math.max(0, Math.min(1, s + boost));

  return hslToRgb(h, newS, l);
}

// ═══════════════════════════════════════════
//  WHITE BALANCE ENGINE
//  Based on a physics-derived colour temperature
//  curve (Planckian locus approximation)
// ═══════════════════════════════════════════

// Convert slider value (−100…+100) to Kelvin (2000K…12000K)
// Center (0) = 6500K (daylight)
function sliderToKelvin(value) {
    // Exponential mapping so steps feel perceptually even
    if (value >= 0) {
      return 6500 + value * 55; // 6500K → 12000K
    } else {
      return 6500 + value * 45; // 6500K → 2000K
    }
  }
  
  // Planckian locus — compute R/G/B multipliers for a given colour
  // temperature in Kelvin. Based on Tanner Helland's algorithm.
  function kelvinToRgbMultipliers(kelvin) {
    const temp = kelvin / 100;
    let r, g, b;
  
    // ── Red ──
    if (temp <= 66) {
      r = 1.0;
    } else {
      r = 329.698727446 * Math.pow(temp - 60, -0.1332047592) / 255;
      r = Math.max(0, Math.min(1, r));
    }
  
    // ── Green ──
    if (temp <= 66) {
      g = (99.4708025861 * Math.log(temp) - 161.1195681661) / 255;
    } else {
      g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492) / 255;
    }
    g = Math.max(0, Math.min(1, g));
  
    // ── Blue ──
    if (temp >= 66) {
      b = 1.0;
    } else if (temp <= 19) {
      b = 0.0;
    } else {
      b = (138.5177312231 * Math.log(temp - 10) - 305.0447927307) / 255;
      b = Math.max(0, Math.min(1, b));
    }
  
    return { r, g, b };
  }
  
  // Build a 3×3 colour correction matrix from temperature + tint
  // Returns multipliers for R, G, B channels
  function buildWbMatrix(temperature, tint) {
    if (temperature === 0 && tint === 0) {
      return { r: 1, g: 1, b: 1, label: { r: '1.00', g: '1.00', b: '1.00' } };
    }
  
    const kelvin = sliderToKelvin(temperature);
  
    // Get the RGB curve for this colour temperature
    const curve6500 = kelvinToRgbMultipliers(6500); // neutral reference
    const curveTgt  = kelvinToRgbMultipliers(kelvin);
  
    // Normalise against the neutral reference so 6500K = 1.0
    let rMul = curveTgt.r / curve6500.r;
    let gMul = curveTgt.g / curve6500.g;
    let bMul = curveTgt.b / curve6500.b;
  
    // Tint shifts green vs magenta
    // Positive tint = more green, negative = more magenta
    const tintShift = tint / 100 * 0.25;
    gMul += tintShift;
    rMul -= tintShift * 0.5;
    bMul -= tintShift * 0.5;
  
    // Normalise so the average multiplier stays near 1
    // (prevents overall brightness change from WB)
    const avg = (rMul + gMul + bMul) / 3;
    rMul /= avg;
    gMul /= avg;
    bMul /= avg;
  
    return {
      r: rMul,
      g: gMul,
      b: bMul,
      label: {
        r: rMul.toFixed(2),
        g: gMul.toFixed(2),
        b: bMul.toFixed(2),
      },
    };
  }
  
  // Apply WB matrix to a single pixel — fast multiply
  function applyWbMatrix(r, g, b, matrix) {
    return {
      r: Math.max(0, Math.min(255, r * matrix.r)),
      g: Math.max(0, Math.min(255, g * matrix.g)),
      b: Math.max(0, Math.min(255, b * matrix.b)),
    };
  }
  
  // Update the matrix readout in the UI
  function updateWbMatrixDisplay(matrix) {
    const grid = document.getElementById('wbMatrixGrid');
    if (!grid) return;
  
    const rEl = grid.querySelector('.wm-r');
    const gEl = grid.querySelector('.wm-g');
    const bEl = grid.querySelector('.wm-b');
  
    if (rEl) {
      rEl.textContent = `R×${matrix.label.r}`;
      rEl.style.color = matrix.r > 1.01 ? '#ff8080'
                      : matrix.r < 0.99 ? '#8080ff'
                      : 'var(--text-muted)';
    }
    if (gEl) {
      gEl.textContent = `G×${matrix.label.g}`;
      gEl.style.color = matrix.g > 1.01 ? '#80cc80'
                      : matrix.g < 0.99 ? '#cc80cc'
                      : 'var(--text-muted)';
    }
    if (bEl) {
      bEl.textContent = `B×${matrix.label.b}`;
      bEl.style.color = matrix.b > 1.01 ? '#80aaff'
                      : matrix.b < 0.99 ? '#ffaa80'
                      : 'var(--text-muted)';
    }
  }

// ═══════════════════════════════════════════
//  PIXEL PROCESSING — CORE ENGINE
// ═══════════════════════════════════════════
function processPixels(srcData) {
  const p    = state.params;
  const data = new Uint8ClampedArray(srcData.data);
  const len  = data.length;

  // Pre-compute scaled values
  const brightness  = p.brightness * 0.8;   // ±80
  const exposure    = p.exposure   * 1.0;   // ±100
  const saturation  = p.saturation / 100;   // ±1
  const highlights  = p.highlights  * 0.6;  // ±60
  const shadows     = p.shadows     * 0.6;  // ±60

  // Contrast — photographic S-curve formula
  const cVal    = p.contrast;
  const cFactor = cVal !== 0
    ? (259 * (cVal + 255)) / (255 * (259 - cVal))
    : 1;

  // LUT for brightness + exposure + contrast (fast path)
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = i + exposure + brightness;
    if (cVal !== 0) v = cFactor * (v - 128) + 128;
    lut[i] = Math.max(0, Math.min(255, v));
  }

  // Check if any HSL band has edits — skip expensive HSL loop if not
  const hslParams   = p.hsl;
  const hasHslEdits = Object.values(hslParams).some(
    band => band.hue !== 0 || band.sat !== 0 || band.lum !== 0
  );

  // ── Per-pixel loop ──
  for (let i = 0; i < len; i += 4) {
    // Apply LUT (brightness + exposure + contrast)
    let r = lut[data[i]];
    let g = lut[data[i + 1]];
    let b = lut[data[i + 2]];

    // Luma for highlights/shadows weighting
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;

    // Highlights — only affect bright pixels
    if (highlights !== 0) {
      const w = Math.max(0, (luma - 128) / 127);
      r += highlights * w;
      g += highlights * w;
      b += highlights * w;
    }

    // Shadows — only affect dark pixels
    if (shadows !== 0) {
      const w = Math.max(0, (128 - luma) / 128);
      r += shadows * w;
      g += shadows * w;
      b += shadows * w;
    }

// White balance — colour matrix transform
if (state._wbMatrix && (p.temperature !== 0 || p.tint !== 0)) {
    const wb = applyWbMatrix(r, g, b, state._wbMatrix);
    r = wb.r; g = wb.g; b = wb.b;
  }

    // Global saturation
    if (saturation !== 0) {
      const grey = 0.299 * r + 0.587 * g + 0.114 * b;
      r = grey + (r - grey) * (1 + saturation);
      g = grey + (g - grey) * (1 + saturation);
      b = grey + (b - grey) * (1 + saturation);
    }

    // Per-hue HSL adjustments
    if (hasHslEdits) {
      const res = applyHslToPixel(r, g, b, hslParams);
      r = res.r; g = res.g; b = res.b;
    }

    // Vibrance — smart saturation
    if (p.vibrance !== 0) {
      const res = applyVibrance(r, g, b, p.vibrance);
      r = res.r; g = res.g; b = res.b;
    }

    // Clamp 0–255
    data[i]     = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
    // alpha (data[i+3]) untouched
  }

  return new ImageData(data, srcData.width, srcData.height);
}

// ═══════════════════════════════════════════
//  REDRAW
// ═══════════════════════════════════════════
function redraw() {
  if (!state.imageLoaded) return;

  // Pre-compute WB matrix once per redraw (not per pixel)
  state._wbMatrix = buildWbMatrix(state.params.temperature, state.params.tint);
  updateWbMatrixDisplay(state._wbMatrix);

  const area    = canvasArea.getBoundingClientRect();
  canvas.width  = area.width;
  canvas.height = area.height;

  drawCheckerboard();

  ctx.save();
  ctx.translate(state.offsetX, state.offsetY);
  ctx.scale(state.zoom, state.zoom);

  // Process pixels then draw via temp canvas (so zoom/pan works correctly)
  const srcData   = offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  const processed = processPixels(srcData);

  if (!state._tmpCanvas) {
    state._tmpCanvas    = document.createElement('canvas');
    state._tmpCtx       = state._tmpCanvas.getContext('2d');
  }
  state._tmpCanvas.width  = offscreen.width;
  state._tmpCanvas.height = offscreen.height;
  state._tmpCtx.putImageData(processed, 0, 0);
  ctx.drawImage(state._tmpCanvas, 0, 0);

  ctx.restore();
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(redraw, 8);
}

function drawCheckerboard() {
  const size = 14;
  for (let y = 0; y < canvas.height; y += size) {
    for (let x = 0; x < canvas.width; x += size) {
      ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#1a1a1e' : '#141418';
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
  const w    = hCanvas.width;
  const h    = hCanvas.height;

  const srcData   = offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  const processed = processPixels(srcData);
  const data      = processed.data;

  const rBins = new Uint32Array(256);
  const gBins = new Uint32Array(256);
  const bBins = new Uint32Array(256);
  const lBins = new Uint32Array(256);

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

  [
    [lBins, 'rgba(255,255,255,0.12)'],
    [rBins, 'rgba(255, 75, 75, 0.5)'],
    [gBins, 'rgba(75, 200, 75, 0.5)'],
    [bBins, 'rgba(75, 130, 255, 0.5)'],
  ].forEach(([bins, color]) => {
    hCtx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - (bins[i] / max) * (h - 2);
      i === 0 ? hCtx.moveTo(x, y) : hCtx.lineTo(x, y);
    }
    hCtx.lineTo(w, h);
    hCtx.lineTo(0, h);
    hCtx.closePath();
    hCtx.fillStyle = color;
    hCtx.fill();
  });
}

// ═══════════════════════════════════════════
//  SLIDER BINDING — regular adjustment sliders
// ═══════════════════════════════════════════
function bindSliders() {
  document.querySelectorAll('.adj-slider:not(.hsl-slider)').forEach(slider => {
    const valEl = slider.nextElementSibling;
    const row   = slider.closest('.slider-row');

    slider.addEventListener('input', () => {
      const param = slider.dataset.param;
      const value = parseInt(slider.value);
      state.params[param] = value;

      valEl.textContent = value > 0 ? `+${value}` : `${value}`;
      valEl.style.color = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
      row.classList.toggle('slider-row--active', value !== 0);
      updateSliderTrack(slider);
      scheduleRedraw();
      drawHistogram();
    });

    slider.addEventListener('change', pushHistory);

    // Double-click label resets this slider
    const label = row.querySelector('label');
    if (label) {
      label.style.cursor = 'pointer';
      label.title        = 'Double-click to reset';
      label.addEventListener('dblclick', () => {
        slider.value = 0;
        state.params[slider.dataset.param] = 0;
        valEl.textContent = '0';
        valEl.style.color = 'var(--text-muted)';
        row.classList.remove('slider-row--active');
        updateSliderTrack(slider);
        scheduleRedraw();
        drawHistogram();
        pushHistory();
      });
    }
  });
}

// ── Slider track fill ──
function updateSliderTrack(slider) {
  const min = parseInt(slider.min);
  const max = parseInt(slider.max);
  const val = parseInt(slider.value);

  if (min < 0) {
    // Bidirectional — fill from center
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
    // Unidirectional — fill from left
    const pct = (val / max) * 100;
    slider.style.background = `linear-gradient(
      to right,
      var(--accent) 0%,
      var(--accent) ${pct}%,
      var(--bg-3) ${pct}%,
      var(--bg-3) 100%
    )`;
  }
}

function initSliderTracks() {
  document.querySelectorAll('.adj-slider').forEach(updateSliderTrack);
}

// ═══════════════════════════════════════════
//  HSL TAB BINDING
// ═══════════════════════════════════════════
function bindHslTabs() {
  const tabs    = document.querySelectorAll('.hsl-tab');
  const sliders = document.querySelectorAll('.hsl-slider');

  // Tab click — switch active band and load its values into sliders
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeHueBand = tab.dataset.hue;

      if (activeHueBand === 'all') {
        // Show zeros for "All" view
        sliders.forEach(s => {
          s.value = 0;
          const valEl       = s.nextElementSibling;
          valEl.textContent = '0';
          valEl.style.color = 'var(--text-muted)';
          updateSliderTrack(s);
        });
      } else {
        // Load this band's current values
        const band = state.params.hsl[activeHueBand];
        sliders.forEach(s => {
          const key   = s.dataset.hsl;
          const value = band[key];
          s.value                   = value;
          s.nextElementSibling.textContent = value > 0 ? `+${value}` : `${value}`;
          s.nextElementSibling.style.color = value !== 0
            ? 'var(--accent)' : 'var(--text-muted)';
          updateSliderTrack(s);
        });
      }
    });
  });

  // HSL slider input
  sliders.forEach(slider => {
    const valEl = slider.nextElementSibling;

    slider.addEventListener('input', () => {
      const key   = slider.dataset.hsl;
      const value = parseInt(slider.value);

      if (activeHueBand === 'all') {
        // Apply to all 8 bands equally
        Object.keys(state.params.hsl).forEach(band => {
          state.params.hsl[band][key] = value;
        });
      } else {
        state.params.hsl[activeHueBand][key] = value;
      }

      valEl.textContent = value > 0 ? `+${value}` : `${value}`;
      valEl.style.color = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
      updateSliderTrack(slider);
      updateHslDots();
      scheduleRedraw();
      drawHistogram();
    });

    slider.addEventListener('change', pushHistory);

    // Double-click label resets this HSL slider
    const label = slider.closest('.slider-row')?.querySelector('label');
    if (label) {
      label.style.cursor = 'pointer';
      label.title        = 'Double-click to reset';
      label.addEventListener('dblclick', () => {
        const key = slider.dataset.hsl;
        slider.value              = 0;
        valEl.textContent         = '0';
        valEl.style.color         = 'var(--text-muted)';

        if (activeHueBand === 'all') {
          Object.keys(state.params.hsl).forEach(b => {
            state.params.hsl[b][key] = 0;
          });
        } else {
          state.params.hsl[activeHueBand][key] = 0;
        }

        updateSliderTrack(slider);
        updateHslDots();
        scheduleRedraw();
        drawHistogram();
        pushHistory();
      });
    }
  });
}

// Light up a coloured dot when a band has any non-zero edit
function updateHslDots() {
  document.querySelectorAll('.hsl-dot').forEach(dot => {
    const band   = dot.dataset.hue;
    const p      = state.params.hsl[band];
    const active = p.hue !== 0 || p.sat !== 0 || p.lum !== 0;
    dot.classList.toggle('hsl-dot--active', active);
  });
}

// ═══════════════════════════════════════════
//  HISTORY — UNDO / REDO
// ═══════════════════════════════════════════
function pushHistory() {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push({
    ...state.params,
    hsl: JSON.parse(JSON.stringify(state.params.hsl)),
  });
  if (state.history.length > state.maxHistory) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateHistoryBtns();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreHistory(state.history[state.historyIndex]);
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  restoreHistory(state.history[state.historyIndex]);
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
  document.querySelectorAll('.adj-slider:not(.hsl-slider)').forEach(slider => {
    const param = slider.dataset.param;
    if (state.params[param] === undefined) return;
    const value          = state.params[param];
    slider.value         = value;
    const valEl          = slider.nextElementSibling;
    valEl.textContent    = value > 0 ? `+${value}` : `${value}`;
    valEl.style.color    = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
    slider.closest('.slider-row').classList.toggle('slider-row--active', value !== 0);
    updateSliderTrack(slider);
  });

  // Also sync HSL sliders for current active band
  if (activeHueBand !== 'all') {
    const band = state.params.hsl[activeHueBand];
    document.querySelectorAll('.hsl-slider').forEach(s => {
      const key             = s.dataset.hsl;
      const value           = band[key];
      s.value               = value;
      s.nextElementSibling.textContent = value > 0 ? `+${value}` : `${value}`;
      s.nextElementSibling.style.color = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
      updateSliderTrack(s);
    });
  }
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
  new ResizeObserver(() => {
    if (state.imageLoaded) redraw();
  }).observe(canvasArea);

  // Scroll to zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomTo(
      state.zoom * (e.deltaY > 0 ? 0.9 : 1.1),
      e.clientX - rect.left,
      e.clientY - rect.top
    );
  }, { passive: false });

  // Pan — middle mouse or space+drag
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
    const d    = pinchDist(e);
    const rect = canvas.getBoundingClientRect();
    const cx   = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    const cy   = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
    zoomTo(state.zoom * d / lastPinch, cx, cy);
    lastPinch = d;
  }, { passive: false });

  // Double-click zoom
  canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect();
    zoomTo(
      state.zoom < 1.5 ? 2 : 1,
      e.clientX - rect.left,
      e.clientY - rect.top
    );
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
  document.getElementById('btnFit')    .addEventListener('click', fitToScreen);
  document.getElementById('btnUndo')   .addEventListener('click', undo);
  document.getElementById('btnRedo')   .addEventListener('click', redo);

  // Reset all edits including HSL
  document.getElementById('btnReset').addEventListener('click', () => {
    Object.keys(state.params).forEach(k => {
      if (k !== 'hsl') state.params[k] = 0;
    });
    Object.keys(state.params.hsl).forEach(band => {
      state.params.hsl[band] = { hue: 0, sat: 0, lum: 0 };
    });

    syncSliders();
    updateHslDots();

    // Reset HSL sliders visually
    document.querySelectorAll('.hsl-slider').forEach(s => {
      s.value                          = 0;
      s.nextElementSibling.textContent = '0';
      s.nextElementSibling.style.color = 'var(--text-muted)';
      updateSliderTrack(s);
    });

    redraw();
    drawHistogram();
    pushHistory();
    showHint('All edits reset ↺');
  });

  // Before / After toggle
  let showingBefore = false;
  document.getElementById('btnBefore').addEventListener('click', () => {
    showingBefore = !showingBefore;
    const btn = document.getElementById('btnBefore');

    if (showingBefore) {
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' &&  e.shiftKey) { e.preventDefault(); redo(); }

    switch (e.key) {
      case '0': fitToScreen();                       break;
      case '1': zoomTo(1, cx, cy);                  break;
      case '2': zoomTo(2, cx, cy);                  break;
      case '+':
      case '=': zoomTo(state.zoom * 1.25, cx, cy);  break;
      case '-': zoomTo(state.zoom * 0.80, cx, cy);  break;
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
//  WHITE BALANCE PRESETS & BINDING
// ═══════════════════════════════════════════
function bindWhiteBalance() {
    // Preset buttons
    document.querySelectorAll('.wb-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const temp = parseInt(btn.dataset.temp);
        const tint = parseInt(btn.dataset.tint);
  
        // Apply to state
        state.params.temperature = temp;
        state.params.tint        = tint;
  
        // Sync sliders
        const tempSlider = document.querySelector('.adj-slider[data-param="temperature"]');
        const tintSlider = document.querySelector('.adj-slider[data-param="tint"]');
  
        if (tempSlider) {
          tempSlider.value = temp;
          const valEl      = tempSlider.nextElementSibling;
          valEl.textContent = temp > 0 ? `+${temp}` : `${temp}`;
          valEl.style.color = temp !== 0 ? 'var(--accent)' : 'var(--text-muted)';
          tempSlider.closest('.slider-row')
            .classList.toggle('slider-row--active', temp !== 0);
          updateSliderTrack(tempSlider);
        }
  
        if (tintSlider) {
          tintSlider.value  = tint;
          const valEl       = tintSlider.nextElementSibling;
          valEl.textContent = tint > 0 ? `+${tint}` : `${tint}`;
          valEl.style.color = tint !== 0 ? 'var(--accent)' : 'var(--text-muted)';
          tintSlider.closest('.slider-row')
            .classList.toggle('slider-row--active', tint !== 0);
          updateSliderTrack(tintSlider);
        }
  
        // Update active preset highlight
        document.querySelectorAll('.wb-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
  
        scheduleRedraw();
        drawHistogram();
        pushHistory();
        showHint(`White balance: ${btn.textContent}`);
      });
    });
  
    // Live Kelvin readout on temperature slider
    const tempSlider = document.querySelector('.adj-slider[data-param="temperature"]');
    if (tempSlider) {
      tempSlider.addEventListener('input', () => {
        const kelvin = Math.round(sliderToKelvin(parseInt(tempSlider.value)));
        showHint(`${kelvin.toLocaleString()}K`);
        // Deactivate preset buttons when manual slider is used
        document.querySelectorAll('.wb-preset').forEach(b => b.classList.remove('active'));
      });
    }
  }

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
init();
initSliderTracks();