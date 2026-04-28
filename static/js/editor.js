// ===== Pixloft Editor Engine — Day 13 =====

let largeImageWarningShown = false;

// ── DOM refs ──
const canvas     = document.getElementById('mainCanvas');
const ctx        = canvas.getContext('2d');
const canvasArea = document.getElementById('canvasArea');
const canvasHint = document.getElementById('canvasHint');
const zoomLabel  = document.getElementById('zoomLabel');

// ── State ──
const state = {
  imageLoaded:   false,
  originalImage: null,
  zoom:          1,
  minZoom:       0.05,
  maxZoom:       10,
  offsetX:       0,
  offsetY:       0,
  isPanning:     false,
  panStartX:     0,
  panStartY:     0,
  panOriginX:    0,
  panOriginY:    0,
  spaceHeld:     false,
  activeTool:    'select',
  history:       [],
  historyIndex:  -1,
  maxHistory:    40,
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
    // Tone curve
    curve: {
      luma: [[0,0],[0.25,0.25],[0.75,0.75],[1,1]],
      r:    [[0,0],[0.25,0.25],[0.75,0.75],[1,1]],
      g:    [[0,0],[0.25,0.25],[0.75,0.75],[1,1]],
      b:    [[0,0],[0.25,0.25],[0.75,0.75],[1,1]],
    },
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
    sharpen_radius:  1,
    sharpen_detail:  25,
    noise_reduction: 0,
    noise_detail:    50,
    noise_contrast:  0,
    // Effects
    vignette:          0,
    vignette_size:     50,
    vignette_feather:  50,
    vignette_roundness:50,
    grain:             0,
    grain_size:        25,
    grain_roughness:   50,
    // Transform
    rotation:        0,
    flipH:           false,
    flipV:           false,
    crop:            null,
  },
};

// ── Offscreen canvas ──
let offscreen    = null;
let offscreenCtx = null;

// ── Timers ──
let redrawTimer = null;
let histTimer   = null;
let hintTimer   = null;

// ── UI state ──
let activeHueBand = 'all';
let rotSlider     = null;
let rotVal        = null;

// ── Tone curve state ──
let activeCurveChannel = 'luma';
let curveCanvas        = null;
let curveCtx           = null;
let curveDragging      = null;
let curveHover         = null;

// ── Preset state ──
let activePresetCategory = 'all';
let customPresets        = [];
const PRESETS_LS_KEY     = 'pixloft_presets';

// ── LocalStorage key ──
const LS_KEY = `pixloft_state_${typeof IMAGE_ID !== 'undefined' ? IMAGE_ID : 'default'}`;

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
  bindHistoryPanel();
  bindKeyboard();
  bindWhiteBalance();
  initCurveCanvas();
  bindCurveChannels();
  bindPresets(); 
  bindExportModal();
  bindHistogramControls();
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
    offscreenCtx     = offscreen.getContext('2d', { willReadFrequently: true });
    offscreenCtx.drawImage(img, 0, 0);

    fitToScreen();
    redraw();
    pushHistory();
    drawHistogram();

    // Try to restore auto-saved session
    const restored = autoLoad();
    if (restored) {
      syncSliders();
      updateHslDots();
      if (curveCanvas) drawCurveCanvas();
      redraw();
      drawHistogram();
      pushHistory();
      showHint('↩ Restored your last session');
    } else {
      showHint('Scroll to zoom · Space+drag to pan · Sliders to edit');
    }

    updateHistoryPanel();
    // Render preset thumbnails now that image is loaded
    renderPresetGrid();

    if (!largeImageWarningShown && img.naturalWidth * img.naturalHeight > 4000000) {
      console.warn('Pixloft: large image — sharpening/noise reduction may be slow');
      largeImageWarningShown = true;
    }
  };

  img.onerror = () => showHint('⚠ Failed to load image');
  img.src     = src;
}

// ═══════════════════════════════════════════
//  HSL COLOUR SPACE HELPERS
// ═══════════════════════════════════════════
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const diff = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (diff !== 0) {
    s = diff / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / diff + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / diff + 2) / 6; break;
      case b: h = ((r - g) / diff + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
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

function hueWeight(pixelHue, bandCenter, bandRange) {
  let diff = Math.abs(pixelHue - bandCenter);
  if (diff > 180) diff = 360 - diff;
  if (diff > bandRange) return 0;
  return Math.cos((diff / bandRange) * (Math.PI / 2));
}

function applyHslToPixel(r, g, b, hslParams) {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < 0.02) return { r, g, b };
  let dHue = 0, dSat = 0, dLum = 0;
  for (const [band, { center, range }] of Object.entries(HUE_BANDS)) {
    const w = hueWeight(h, center, range);
    if (w === 0) continue;
    dHue += hslParams[band].hue * w;
    dSat += hslParams[band].sat * w;
    dLum += hslParams[band].lum * w;
  }
  const wRed2 = hueWeight(h, 360, HUE_BANDS.red.range);
  if (wRed2 > 0) {
    dHue += hslParams.red.hue * wRed2;
    dSat += hslParams.red.sat * wRed2;
    dLum += hslParams.red.lum * wRed2;
  }
  if (dHue === 0 && dSat === 0 && dLum === 0) return { r, g, b };
  return hslToRgb(
    (h + dHue * 1.8 + 360) % 360,
    Math.max(0, Math.min(1, s + dSat / 100)),
    Math.max(0, Math.min(1, l + dLum / 200))
  );
}

function applyVibrance(r, g, b, amount) {
  if (amount === 0) return { r, g, b };
  const { h, s, l } = rgbToHsl(r, g, b);
  const skinProtect = (h >= 0 && h <= 50 && s > 0.1 && s < 0.8) ? 0.4 : 1.0;
  const newS = Math.max(0, Math.min(1, s + (amount / 100) * (1 - s) * skinProtect));
  return hslToRgb(h, newS, l);
}

// ═══════════════════════════════════════════
//  WHITE BALANCE ENGINE
// ═══════════════════════════════════════════
function sliderToKelvin(v) {
  return v >= 0 ? 6500 + v * 55 : 6500 + v * 45;
}

function kelvinToRgbMultipliers(kelvin) {
  const t = kelvin / 100;
  const r = t <= 66 ? 1.0
    : Math.max(0, Math.min(1, 329.698727446 * Math.pow(t - 60, -0.1332047592) / 255));
  const g = t <= 66
    ? Math.max(0, Math.min(1, (99.4708025861 * Math.log(t) - 161.1195681661) / 255))
    : Math.max(0, Math.min(1, 288.1221695283 * Math.pow(t - 60, -0.0755148492) / 255));
  const b = t >= 66 ? 1.0 : t <= 19 ? 0.0
    : Math.max(0, Math.min(1, (138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255));
  return { r, g, b };
}

function buildWbMatrix(temperature, tint) {
  if (temperature === 0 && tint === 0)
    return { r: 1, g: 1, b: 1, label: { r: '1.00', g: '1.00', b: '1.00' } };
  const ref = kelvinToRgbMultipliers(6500);
  const tgt = kelvinToRgbMultipliers(sliderToKelvin(temperature));
  let rM = tgt.r / ref.r, gM = tgt.g / ref.g, bM = tgt.b / ref.b;
  const ts = tint / 100 * 0.25;
  gM += ts; rM -= ts * 0.5; bM -= ts * 0.5;
  const avg = (rM + gM + bM) / 3;
  rM /= avg; gM /= avg; bM /= avg;
  return {
    r: rM, g: gM, b: bM,
    label: { r: rM.toFixed(2), g: gM.toFixed(2), b: bM.toFixed(2) },
  };
}

function applyWbMatrix(r, g, b, m) {
  return {
    r: Math.max(0, Math.min(255, r * m.r)),
    g: Math.max(0, Math.min(255, g * m.g)),
    b: Math.max(0, Math.min(255, b * m.b)),
  };
}

function updateWbMatrixDisplay(matrix) {
  const grid = document.getElementById('wbMatrixGrid');
  if (!grid) return;
  const rEl = grid.querySelector('.wm-r');
  const gEl = grid.querySelector('.wm-g');
  const bEl = grid.querySelector('.wm-b');
  if (rEl) { rEl.textContent = `R×${matrix.label.r}`; rEl.style.color = matrix.r > 1.01 ? '#ff8080' : matrix.r < 0.99 ? '#8080ff' : 'var(--text-muted)'; }
  if (gEl) { gEl.textContent = `G×${matrix.label.g}`; gEl.style.color = matrix.g > 1.01 ? '#80cc80' : matrix.g < 0.99 ? '#cc80cc' : 'var(--text-muted)'; }
  if (bEl) { bEl.textContent = `B×${matrix.label.b}`; bEl.style.color = matrix.b > 1.01 ? '#80aaff' : matrix.b < 0.99 ? '#ffaa80' : 'var(--text-muted)'; }
}

// ═══════════════════════════════════════════
//  TONE CURVE ENGINE
// ═══════════════════════════════════════════
function cubicSplineInterpolate(points, x) {
  const n = points.length;
  if (n === 0) return x;
  if (n === 1) return points[0][1];
  if (x <= points[0][0])   return points[0][1];
  if (x >= points[n-1][0]) return points[n-1][1];

  let i = 0;
  while (i < n - 2 && points[i+1][0] < x) i++;

  const p0 = points[Math.max(0, i-1)];
  const p1 = points[i];
  const p2 = points[i+1];
  const p3 = points[Math.min(n-1, i+2)];

  const t  = (x - p1[0]) / (p2[0] - p1[0]);
  const t2 = t * t;
  const t3 = t2 * t;
  const m1 = (p2[1] - p0[1]) * 0.5;
  const m2 = (p3[1] - p1[1]) * 0.5;

  const y = (2*t3 - 3*t2 + 1) * p1[1]
          + (t3 - 2*t2 + t)   * m1
          + (-2*t3 + 3*t2)    * p2[1]
          + (t3 - t2)          * m2;

  return Math.max(0, Math.min(1, y));
}

function buildCurveLut(points) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(cubicSplineInterpolate(points, i / 255) * 255);
  }
  return lut;
}

function isCurveDefault(points) {
  const def = [[0,0],[0.25,0.25],[0.75,0.75],[1,1]];
  if (points.length !== def.length) return false;
  return points.every((p, i) =>
    Math.abs(p[0] - def[i][0]) < 0.001 && Math.abs(p[1] - def[i][1]) < 0.001
  );
}

function applyCurves(imageData) {
  const curves  = state.params.curve;
  const hasLuma = !isCurveDefault(curves.luma);
  const hasR    = !isCurveDefault(curves.r);
  const hasG    = !isCurveDefault(curves.g);
  const hasB    = !isCurveDefault(curves.b);
  if (!hasLuma && !hasR && !hasG && !hasB) return imageData;

  const lumaLut = hasLuma ? buildCurveLut(curves.luma) : null;
  const rLut    = hasR    ? buildCurveLut(curves.r)    : null;
  const gLut    = hasG    ? buildCurveLut(curves.g)    : null;
  const bLut    = hasB    ? buildCurveLut(curves.b)    : null;

  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i+1], b = data[i+2];
    if (lumaLut) { r = lumaLut[r]; g = lumaLut[g]; b = lumaLut[b]; }
    if (rLut) r = rLut[r];
    if (gLut) g = gLut[g];
    if (bLut) b = bLut[b];
    data[i] = r; data[i+1] = g; data[i+2] = b;
  }
  return new ImageData(data, imageData.width, imageData.height);
}

// ── Curve canvas UI ──
function initCurveCanvas() {
  curveCanvas = document.getElementById('curveCanvas');
  if (!curveCanvas) return;
  curveCtx = curveCanvas.getContext('2d');

  curveCanvas.addEventListener('mousedown',   onCurveMouseDown);
  curveCanvas.addEventListener('mousemove',   onCurveMouseMove);
  curveCanvas.addEventListener('mouseup',     onCurveMouseUp);
  curveCanvas.addEventListener('mouseleave',  onCurveMouseLeave);
  curveCanvas.addEventListener('dblclick',    onCurveDoubleClick);
  curveCanvas.addEventListener('contextmenu', onCurveRightClick);

  drawCurveCanvas();
}

function canvasToCurve(cx, cy) {
  const pad = 16;
  const w   = curveCanvas.width  - pad * 2;
  const h   = curveCanvas.height - pad * 2;
  return [
    Math.max(0, Math.min(1, (cx - pad) / w)),
    Math.max(0, Math.min(1, 1 - (cy - pad) / h)),
  ];
}

function curveToCanvas(x, y) {
  const pad = 16;
  const w   = curveCanvas.width  - pad * 2;
  const h   = curveCanvas.height - pad * 2;
  return [pad + x * w, pad + (1 - y) * h];
}

function getActivePoints() {
  return state.params.curve[activeCurveChannel];
}

function findClosestPoint(cx, cy, radius = 10) {
  const pts = getActivePoints();
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = curveToCanvas(pts[i][0], pts[i][1]);
    if (Math.sqrt((cx - px)**2 + (cy - py)**2) < radius) return i;
  }
  return -1;
}

function getCurveCoords(e) {
  const rect  = curveCanvas.getBoundingClientRect();
  const scaleX = curveCanvas.width  / rect.width;
  const scaleY = curveCanvas.height / rect.height;
  return [
    (e.clientX - rect.left) * scaleX,
    (e.clientY - rect.top)  * scaleY,
  ];
}

function onCurveMouseDown(e) {
  const [cx, cy] = getCurveCoords(e);
  const idx      = findClosestPoint(cx, cy);

  if (idx >= 0) {
    curveDragging = idx;
  } else {
    const [nx, ny] = canvasToCurve(cx, cy);
    const pts      = getActivePoints();
    pts.push([nx, ny]);
    pts.sort((a, b) => a[0] - b[0]);
    pts[0][0] = 0; pts[pts.length-1][0] = 1;
    curveDragging = pts.findIndex(p =>
      Math.abs(p[0] - nx) < 0.005 && Math.abs(p[1] - ny) < 0.005
    );
    scheduleRedraw(); drawHistogram();
  }

  drawCurveCanvas();
  e.preventDefault();
}

function onCurveMouseMove(e) {
  const [cx, cy] = getCurveCoords(e);

  if (curveDragging !== null) {
    const pts      = getActivePoints();
    const [nx, ny] = canvasToCurve(cx, cy);
    const isFirst  = curveDragging === 0;
    const isLast   = curveDragging === pts.length - 1;

    pts[curveDragging][0] = isFirst ? 0 : isLast ? 1 : nx;
    pts[curveDragging][1] = ny;

    if (!isFirst && pts[curveDragging][0] < pts[curveDragging-1][0] + 0.01)
      pts[curveDragging][0] = pts[curveDragging-1][0] + 0.01;
    if (!isLast && pts[curveDragging][0] > pts[curveDragging+1][0] - 0.01)
      pts[curveDragging][0] = pts[curveDragging+1][0] - 0.01;

    scheduleRedraw(); drawHistogram();
    updateCurvePointInfo(pts[curveDragging]);
  } else {
    const prev    = curveHover;
    curveHover    = findClosestPoint(cx, cy);
    curveCanvas.style.cursor = curveHover >= 0 ? 'grab' : 'crosshair';
    if (curveHover !== prev) drawCurveCanvas();
  }
}

function onCurveMouseUp() {
  if (curveDragging !== null) {
    curveDragging = null;
    pushHistory();
    drawCurveCanvas();
  }
}

function onCurveMouseLeave() {
  curveDragging = null;
  curveHover    = null;
  curveCanvas.style.cursor = 'crosshair';
  drawCurveCanvas();
}

function onCurveDoubleClick(e) {
  const [cx, cy] = getCurveCoords(e);
  const idx      = findClosestPoint(cx, cy, 12);
  const pts      = getActivePoints();
  if (idx > 0 && idx < pts.length - 1) {
    pts.splice(idx, 1);
    scheduleRedraw(); drawHistogram(); pushHistory(); drawCurveCanvas();
  }
}

function onCurveRightClick(e) {
  e.preventDefault();
  const [cx, cy] = getCurveCoords(e);
  const idx      = findClosestPoint(cx, cy, 12);
  const pts      = getActivePoints();
  if (idx > 0 && idx < pts.length - 1) {
    pts.splice(idx, 1);
    scheduleRedraw(); drawHistogram(); pushHistory(); drawCurveCanvas();
  }
}

function updateCurvePointInfo(point) {
  const el = document.getElementById('curvePointInfo');
  if (el) el.textContent = `In: ${Math.round(point[0]*255)}  →  Out: ${Math.round(point[1]*255)}`;
}

function drawCurveCanvas() {
  if (!curveCtx) return;
  const cw = curveCanvas.width, ch = curveCanvas.height, pad = 16;

  curveCtx.fillStyle = '#18181c';
  curveCtx.fillRect(0, 0, cw, ch);

  // Grid
  curveCtx.strokeStyle = 'rgba(255,255,255,0.06)'; curveCtx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    const x = pad + (cw - pad*2) * i/4, y = pad + (ch - pad*2) * i/4;
    curveCtx.beginPath(); curveCtx.moveTo(x, pad);   curveCtx.lineTo(x, ch-pad); curveCtx.stroke();
    curveCtx.beginPath(); curveCtx.moveTo(pad, y);   curveCtx.lineTo(cw-pad, y); curveCtx.stroke();
  }

  // Diagonal reference
  curveCtx.strokeStyle = 'rgba(255,255,255,0.08)'; curveCtx.lineWidth = 1;
  curveCtx.setLineDash([4, 4]);
  curveCtx.beginPath(); curveCtx.moveTo(pad, ch-pad); curveCtx.lineTo(cw-pad, pad); curveCtx.stroke();
  curveCtx.setLineDash([]);

  const chColours = { luma: '#ffffff', r: '#ff5555', g: '#55cc55', b: '#5588ff' };

  // Inactive channels faintly
  for (const [ch, pts] of Object.entries(state.params.curve)) {
    if (ch === activeCurveChannel || isCurveDefault(pts)) continue;
    drawCurveLine(pts, chColours[ch], 0.25);
  }

  // Active channel
  const pts   = getActivePoints();
  const color = chColours[activeCurveChannel];
  drawCurveLine(pts, color, 1);

  // Control points
  pts.forEach((pt, i) => {
    const [px, py]   = curveToCanvas(pt[0], pt[1]);
    const isHovered  = i === curveHover;
    const isDragging = i === curveDragging;
    curveCtx.beginPath();
    curveCtx.arc(px, py, isDragging ? 6 : isHovered ? 5 : 4, 0, Math.PI * 2);
    curveCtx.fillStyle   = isDragging || isHovered ? '#ffffff' : color;
    curveCtx.strokeStyle = isDragging ? color : 'rgba(0,0,0,0.6)';
    curveCtx.lineWidth   = 1.5;
    curveCtx.fill(); curveCtx.stroke();
  });
}

function drawCurveLine(pts, color, alpha) {
  if (pts.length < 2) return;
  curveCtx.save();
  curveCtx.globalAlpha = alpha;
  curveCtx.strokeStyle = color;
  curveCtx.lineWidth   = 1.5;
  curveCtx.shadowColor = color;
  curveCtx.shadowBlur  = alpha > 0.5 ? 4 : 0;
  curveCtx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const x       = i / 100;
    const y       = cubicSplineInterpolate(pts, x);
    const [cx, cy] = curveToCanvas(x, y);
    i === 0 ? curveCtx.moveTo(cx, cy) : curveCtx.lineTo(cx, cy);
  }
  curveCtx.stroke();
  curveCtx.restore();
}

function bindCurveChannels() {
  const btns = document.querySelectorAll('.curve-ch');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCurveChannel = btn.dataset.ch;
      const el = document.getElementById('curvePointInfo');
      if (el) el.textContent = 'Click curve to add point';
      drawCurveCanvas();
    });
  });

  const btnReset = document.getElementById('btnResetCurve');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      state.params.curve[activeCurveChannel] = [[0,0],[0.25,0.25],[0.75,0.75],[1,1]];
      scheduleRedraw(); drawHistogram(); pushHistory(); drawCurveCanvas();
      showHint(`${activeCurveChannel.toUpperCase()} curve reset`);
    });
  }
}

// ═══════════════════════════════════════════
//  CONVOLUTION ENGINE
// ═══════════════════════════════════════════
function convolve(srcData, kernel, size) {
  const width = srcData.width, height = srcData.height;
  const src   = srcData.data;
  const dst   = new Uint8ClampedArray(src.length);
  const half  = Math.floor(size / 2);
  let kSum    = 0;
  for (let k = 0; k < kernel.length; k++) kSum += kernel[k];
  if (kSum === 0) kSum = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, ki = 0;
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const px  = Math.max(0, Math.min(width  - 1, x + kx));
          const py  = Math.max(0, Math.min(height - 1, y + ky));
          const idx = (py * width + px) * 4;
          const w   = kernel[ki++];
          r += src[idx] * w; g += src[idx+1] * w; b += src[idx+2] * w;
        }
      }
      const out = (y * width + x) * 4;
      dst[out]   = Math.max(0, Math.min(255, r / kSum));
      dst[out+1] = Math.max(0, Math.min(255, g / kSum));
      dst[out+2] = Math.max(0, Math.min(255, b / kSum));
      dst[out+3] = src[out+3];
    }
  }
  return new ImageData(dst, width, height);
}

function buildGaussianKernel(size, sigma) {
  const kernel = [], half = Math.floor(size / 2);
  let total = 0;
  for (let y = -half; y <= half; y++)
    for (let x = -half; x <= half; x++) {
      const val = Math.exp(-(x*x + y*y) / (2 * sigma * sigma));
      kernel.push(val); total += val;
    }
  return kernel.map(v => v / total);
}

function applySharpen(imageData, amount, radius, detailThreshold) {
  if (amount === 0) return imageData;
  const kSize   = radius <= 1 ? 3 : radius <= 2 ? 5 : 7;
  const kernel  = buildGaussianKernel(kSize, radius * 0.8);
  const blurred = convolve(imageData, kernel, kSize);
  const src = imageData.data, blr = blurred.data;
  const dst = new Uint8ClampedArray(src.length);
  const str = amount / 100, threshold = detailThreshold / 100 * 30;

  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const orig = src[i+c], diff = orig - blr[i+c];
      const edge = Math.abs(diff) > threshold ? diff : 0;
      dst[i+c] = Math.max(0, Math.min(255, orig + str * edge * 2.5));
    }
    dst[i+3] = src[i+3];
  }
  return new ImageData(dst, imageData.width, imageData.height);
}

function applyNoiseReduction(imageData, amount, detail, contrastBoost) {
  if (amount === 0) return imageData;
  const str     = amount / 100;
  const kSize   = amount < 30 ? 3 : amount < 60 ? 5 : 7;
  const kernel  = buildGaussianKernel(kSize, 1 + amount / 40);
  const blurred = convolve(imageData, kernel, kSize);
  const src = imageData.data, blr = blurred.data;
  const dst = new Uint8ClampedArray(src.length);
  const detailStr = detail / 100;

  for (let i = 0; i < src.length; i += 4) {
    const rO = src[i], gO = src[i+1], bO = src[i+2];
    const rB = blr[i], gB = blr[i+1], bB = blr[i+2];
    const lc    = Math.abs(rO-rB) + Math.abs(gO-gB) + Math.abs(bO-bB);
    const blend = str * (1 - Math.min(1, lc / 60 * detailStr));

    let r = rO + (rB-rO)*blend, g = gO + (gB-gO)*blend, b = bO + (bB-bO)*blend;

    if (contrastBoost > 0) {
      const boost = contrastBoost / 100 * 0.3;
      const luma  = 0.299*r + 0.587*g + 0.114*b;
      r = luma + (r-luma)*(1+boost); g = luma + (g-luma)*(1+boost); b = luma + (b-luma)*(1+boost);
    }

    dst[i]   = Math.max(0, Math.min(255, r));
    dst[i+1] = Math.max(0, Math.min(255, g));
    dst[i+2] = Math.max(0, Math.min(255, b));
    dst[i+3] = src[i+3];
  }
  return new ImageData(dst, imageData.width, imageData.height);
}

// ═══════════════════════════════════════════
//  VIGNETTE ENGINE
//  Radial gradient darkening/lightening
//  around the edges of the image
// ═══════════════════════════════════════════
function applyVignette(imageData, amount, size, feather, roundness) {
  if (amount === 0) return imageData;

  const width  = imageData.width;
  const height = imageData.height;
  const data   = new Uint8ClampedArray(imageData.data);

  // Normalise params
  const strength  = amount / 100;           // −1 … +1
  const radius    = (size / 100) * 0.85;    // 0 … 0.85 (fraction of half-diagonal)
  const softness  = (feather / 100) * 0.6;  // falloff width
  const roundness_val = roundness / 100;     // 0=oval, 1=circle

  const cx = width  / 2;
  const cy = height / 2;

  // Half-diagonal for normalisation
  const diag = Math.sqrt(cx*cx + cy*cy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Normalised distance from center
      // roundness blends between elliptical (0) and circular (1)
      const dx     = (x - cx) / cx;
      const dy     = (y - cy) / cy;
      const ellDist = Math.sqrt(dx*dx + dy*dy);
      const cirDist = Math.sqrt(
        ((x-cx)*(x-cx) + (y-cy)*(y-cy))
      ) / diag;
      const dist   = ellDist * (1 - roundness_val) + cirDist * roundness_val * 2;

      // Smooth falloff using smoothstep
      const inner  = radius;
      const outer  = radius + softness + 0.1;
      const t      = Math.max(0, Math.min(1, (dist - inner) / (outer - inner)));
      const smooth = t * t * (3 - 2 * t); // smoothstep

      // Vignette factor:
      // positive amount = darken edges (negative = lighten, like Lightroom)
      const factor = smooth * strength;

      const idx    = (y * width + x) * 4;

      if (factor > 0) {
        // Darken
        data[idx]     = Math.max(0, data[idx]     * (1 - factor));
        data[idx + 1] = Math.max(0, data[idx + 1] * (1 - factor));
        data[idx + 2] = Math.max(0, data[idx + 2] * (1 - factor));
      } else if (factor < 0) {
        // Lighten (negative vignette)
        const lift    = -factor;
        data[idx]     = Math.min(255, data[idx]     + (255 - data[idx])     * lift);
        data[idx + 1] = Math.min(255, data[idx + 1] + (255 - data[idx + 1]) * lift);
        data[idx + 2] = Math.min(255, data[idx + 2] + (255 - data[idx + 2]) * lift);
      }
    }
  }

  return new ImageData(data, width, height);
}

// ═══════════════════════════════════════════
//  FILM GRAIN ENGINE
//  Authentic film grain with:
//  - Luminance-dependent grain (shadows get more)
//  - Size control via averaging
//  - Roughness controls grain distribution
// ═══════════════════════════════════════════

// Cache grain layer so it doesn't regenerate on every slider move
// Only regenerates when grain params change or image size changes
let _grainCache    = null;
let _grainCacheKey = '';

function applyGrain(imageData, amount, grainSize, roughness) {
  if (amount === 0) return imageData;

  const width    = imageData.width;
  const height   = imageData.height;
  const data     = new Uint8ClampedArray(imageData.data);
  const strength = amount / 100;

  // Cache key — regenerate grain when params or size changes
  const cacheKey = `${width}x${height}_${grainSize}_${roughness}`;
  if (_grainCacheKey !== cacheKey || !_grainCache) {
    _grainCache    = generateGrainLayer(width, height, grainSize, roughness);
    _grainCacheKey = cacheKey;
  }

  const grain = _grainCache;

  for (let i = 0; i < data.length; i += 4) {
    const r     = data[i];
    const g     = data[i + 1];
    const b     = data[i + 2];
    const luma  = 0.299*r + 0.587*g + 0.114*b;

    // Film grain is strongest in midtones, less in deep shadows/highlights
    // This matches real film behaviour
    const lumaFactor = 1 - Math.pow(Math.abs(luma/128 - 1), 2) * 0.5;
    const pixelIdx   = i / 4;
    const g_val      = grain[pixelIdx] * strength * lumaFactor;

    data[i]     = Math.max(0, Math.min(255, r + g_val));
    data[i + 1] = Math.max(0, Math.min(255, g + g_val));
    data[i + 2] = Math.max(0, Math.min(255, b + g_val));
  }

  return new ImageData(data, width, height);
}

function generateGrainLayer(width, height, grainSize, roughness) {
  const total  = width * height;
  const grain  = new Float32Array(total);
  const rough  = roughness / 100;

  // Generate base noise at reduced resolution for "size" effect
  // then scale back up
  const scale = Math.max(1, Math.round(grainSize / 25));

  // Use a simple LCG pseudo-random number generator for speed
  // (Math.random() is too slow for megapixel images)
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };

  if (scale === 1) {
    // Fine grain — one value per pixel
    for (let i = 0; i < total; i++) {
      // Box-Muller transform for Gaussian distribution
      // This gives more natural grain than uniform noise
      const u1 = Math.max(1e-10, rand());
      const u2  = rand();
      const mag = rough * 60;
      grain[i]  = mag * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
  } else {
    // Coarser grain — generate at reduced size then scale up
    const sw = Math.ceil(width  / scale);
    const sh = Math.ceil(height / scale);
    const small = new Float32Array(sw * sh);

    for (let i = 0; i < small.length; i++) {
      const u1  = Math.max(1e-10, rand());
      const u2  = rand();
      const mag = rough * 60;
      small[i]  = mag * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    // Nearest-neighbour scale-up
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = Math.min(Math.floor(x / scale), sw - 1);
        const sy = Math.min(Math.floor(y / scale), sh - 1);
        grain[y * width + x] = small[sy * sw + sx];
      }
    }
  }

  return grain;
}

// ═══════════════════════════════════════════
//  CROP STATE
// ═══════════════════════════════════════════
const crop = {
  active: false, dragging: false, dragHandle: null,
  startX: 0, startY: 0,
  rect: { x: 0, y: 0, w: 0, h: 0 },
  aspectRatio: null,
};

function screenToImage(sx, sy) {
  return { x: (sx - state.offsetX) / state.zoom, y: (sy - state.offsetY) / state.zoom };
}
function imageToScreen(ix, iy) {
  return { x: ix * state.zoom + state.offsetX, y: iy * state.zoom + state.offsetY };
}
function clampCropRect(r) {
  const iw = offscreen.width, ih = offscreen.height;
  r.x = Math.max(0, Math.min(r.x, iw-2)); r.y = Math.max(0, Math.min(r.y, ih-2));
  r.w = Math.max(2, Math.min(r.w, iw-r.x)); r.h = Math.max(2, Math.min(r.h, ih-r.y));
  return r;
}
function enforceAspectRatio(r, anchor) {
  if (!crop.aspectRatio) return r;
  const newH = r.w / crop.aspectRatio;
  if (anchor === 'tl' || anchor === 'tr') r.h = newH;
  else { r.y = r.y + r.h - newH; r.h = newH; }
  return r;
}
function getCropHandles() {
  const { x, y, w, h } = crop.rect;
  const s = imageToScreen(x, y), e = imageToScreen(x+w, y+h);
  const mx = (s.x+e.x)/2, my = (s.y+e.y)/2, hs = 8;
  const H = (cx, cy, id) => ({ id, x: cx-hs/2, y: cy-hs/2, w: hs, h: hs });
  return [
    H(s.x,s.y,'tl'), H(mx,s.y,'tc'), H(e.x,s.y,'tr'),
    H(s.x,my,'ml'),                   H(e.x,my,'mr'),
    H(s.x,e.y,'bl'), H(mx,e.y,'bc'), H(e.x,e.y,'br'),
  ];
}
function hitHandle(sx, sy) {
  for (const h of getCropHandles())
    if (sx >= h.x && sx <= h.x+h.w && sy >= h.y && sy <= h.y+h.h) return h.id;
  return null;
}
function insideCropRect(sx, sy) {
  const { x, y, w, h } = crop.rect;
  const s = imageToScreen(x, y), e = imageToScreen(x+w, y+h);
  return sx > s.x && sx < e.x && sy > s.y && sy < e.y;
}

function drawCropOverlay() {
  if (!crop.active || crop.rect.w < 2) return;
  const { x, y, w, h } = crop.rect;
  const s = imageToScreen(x, y), e = imageToScreen(x+w, y+h);
  const sw = e.x-s.x, sh = e.y-s.y;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, canvas.width, s.y);
  ctx.fillRect(0, e.y, canvas.width, canvas.height-e.y);
  ctx.fillRect(0, s.y, s.x, sh);
  ctx.fillRect(e.x, s.y, canvas.width-e.x, sh);

  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(s.x, s.y, sw, sh);

  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.5;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(s.x+sw*i/3, s.y); ctx.lineTo(s.x+sw*i/3, e.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x, s.y+sh*i/3); ctx.lineTo(e.x, s.y+sh*i/3); ctx.stroke();
  }

  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
  const ca = 14;
  [[s.x,s.y,1,1],[e.x,s.y,-1,1],[s.x,e.y,1,-1],[e.x,e.y,-1,-1]].forEach(([cx,cy,dx,dy]) => {
    ctx.beginPath(); ctx.moveTo(cx+dx*ca,cy); ctx.lineTo(cx,cy); ctx.lineTo(cx,cy+dy*ca); ctx.stroke();
  });

  ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
  getCropHandles().forEach(h => { ctx.fillRect(h.x,h.y,h.w,h.h); ctx.strokeRect(h.x,h.y,h.w,h.h); });

  const label = `${Math.round(w)} × ${Math.round(h)}`;
  ctx.font = '12px system-ui,sans-serif';
  const lw = ctx.measureText(label).width + 12;
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(s.x, s.y-22, lw, 18);
  ctx.fillStyle = '#fff'; ctx.fillText(label, s.x+6, s.y-8);
  ctx.restore();
}

const HANDLE_CURSORS = {
  tl:'nw-resize', tc:'n-resize',  tr:'ne-resize',
  ml:'w-resize',                   mr:'e-resize',
  bl:'sw-resize', bc:'s-resize',  br:'se-resize',
};

function applyCrop() {
  if (!crop.active || crop.rect.w < 2 || crop.rect.h < 2) return;
  const { x, y, w, h } = crop.rect;
  const nv = document.createElement('canvas');
  nv.width = Math.round(w); nv.height = Math.round(h);
  const nc = nv.getContext('2d', { willReadFrequently: true });
  nc.drawImage(offscreen, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, Math.round(w), Math.round(h));
  offscreen = nv; offscreenCtx = nc;
  state.params.crop = { x, y, w, h };
  deactivateCrop(); fitToScreen(); redraw(); pushHistory();
  showHint(`Cropped to ${Math.round(w)} × ${Math.round(h)}px`);
}

function deactivateCrop() {
  crop.active = false; crop.dragging = false; crop.rect = { x:0, y:0, w:0, h:0 };
  canvas.style.cursor = 'crosshair';
  const cc = document.getElementById('cropControls');
  if (cc) cc.style.display = 'none';
  const sel = document.querySelector('[data-tool="select"]');
  if (sel) sel.click();
  const cw = document.getElementById('cropW'), ch = document.getElementById('cropH');
  if (cw) cw.value = ''; if (ch) ch.value = '';
}

// ═══════════════════════════════════════════
//  ROTATE ENGINE
// ═══════════════════════════════════════════
function rotateCanvas90(degrees) {
  const cw = offscreen.width, ch = offscreen.height;
  const nw = (degrees === 90 || degrees === 270) ? ch : cw;
  const nh = (degrees === 90 || degrees === 270) ? cw : ch;
  const tmp = document.createElement('canvas');
  tmp.width = nw; tmp.height = nh;
  const tc = tmp.getContext('2d', { willReadFrequently: true });
  tc.translate(nw/2, nh/2); tc.rotate(degrees * Math.PI / 180);
  tc.drawImage(offscreen, -cw/2, -ch/2);
  offscreen = tmp; offscreenCtx = tc;
  fitToScreen(); redraw(); pushHistory();
  showHint(`Rotated ${degrees}°`);
}

function applyFineRotation(degrees) { state.params.rotation = degrees; scheduleRedraw(); }

function flipCanvas(horizontal) {
  const tmp = document.createElement('canvas');
  tmp.width = offscreen.width; tmp.height = offscreen.height;
  const tc  = tmp.getContext('2d', { willReadFrequently: true });
  tc.translate(horizontal ? offscreen.width : 0, horizontal ? 0 : offscreen.height);
  tc.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
  tc.drawImage(offscreen, 0, 0);
  offscreen = tmp; offscreenCtx = tc;
  fitToScreen(); redraw(); pushHistory();
  showHint(horizontal ? 'Flipped horizontal' : 'Flipped vertical');
}

// ═══════════════════════════════════════════
//  PIXEL PROCESSING — CORE ENGINE
// ═══════════════════════════════════════════
function processPixels(srcData) {
  const p    = state.params;
  const data = new Uint8ClampedArray(srcData.data);
  const len  = data.length;

  const brightness = p.brightness * 0.8;
  const exposure   = p.exposure   * 1.0;
  const saturation = p.saturation / 100;
  const highlights = p.highlights * 0.6;
  const shadows    = p.shadows    * 0.6;
  const cVal       = p.contrast;
  const cFactor    = cVal !== 0 ? (259*(cVal+255))/(255*(259-cVal)) : 1;

  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = i + exposure + brightness;
    if (cVal !== 0) v = cFactor * (v - 128) + 128;
    lut[i] = Math.max(0, Math.min(255, v));
  }

  const hslParams   = p.hsl;
  const hasHslEdits = Object.values(hslParams).some(
    band => band.hue !== 0 || band.sat !== 0 || band.lum !== 0
  );

  for (let i = 0; i < len; i += 4) {
    let r = lut[data[i]], g = lut[data[i+1]], b = lut[data[i+2]];
    const luma = 0.299*r + 0.587*g + 0.114*b;

    if (highlights !== 0) {
      const w = Math.max(0, (luma-128)/127);
      r += highlights*w; g += highlights*w; b += highlights*w;
    }
    if (shadows !== 0) {
      const w = Math.max(0, (128-luma)/128);
      r += shadows*w; g += shadows*w; b += shadows*w;
    }
    if (state._wbMatrix && (p.temperature !== 0 || p.tint !== 0)) {
      const wb = applyWbMatrix(r, g, b, state._wbMatrix);
      r = wb.r; g = wb.g; b = wb.b;
    }
    if (saturation !== 0) {
      const grey = 0.299*r + 0.587*g + 0.114*b;
      r = grey+(r-grey)*(1+saturation);
      g = grey+(g-grey)*(1+saturation);
      b = grey+(b-grey)*(1+saturation);
    }
    if (hasHslEdits) {
      const res = applyHslToPixel(r, g, b, hslParams);
      r = res.r; g = res.g; b = res.b;
    }
    if (p.vibrance !== 0) {
      const res = applyVibrance(r, g, b, p.vibrance);
      r = res.r; g = res.g; b = res.b;
    }

    data[i]   = Math.max(0, Math.min(255, r));
    data[i+1] = Math.max(0, Math.min(255, g));
    data[i+2] = Math.max(0, Math.min(255, b));
  }

  let result = new ImageData(data, srcData.width, srcData.height);

  // Tone curves
  result = applyCurves(result);

  // Noise reduction
  if (p.noise_reduction > 0)
    result = applyNoiseReduction(result, p.noise_reduction, p.noise_detail ?? 50, p.noise_contrast ?? 0);

  // Sharpening
  if (p.sharpness > 0)
    result = applySharpen(result, p.sharpness, p.sharpen_radius ?? 1, p.sharpen_detail ?? 25);

  // ── Vignette (applied after sharpening) ──
  if (p.vignette !== 0)
    result = applyVignette(
      result,
      p.vignette,
      p.vignette_size     ?? 50,
      p.vignette_feather  ?? 50,
      p.vignette_roundness ?? 50
    );

  // ── Film grain (applied last) ──
  if (p.grain > 0)
    result = applyGrain(
      result,
      p.grain,
      p.grain_size      ?? 25,
      p.grain_roughness ?? 50
    );

  return result;
}

// ═══════════════════════════════════════════
//  REDRAW
// ═══════════════════════════════════════════
function redraw() {
  if (!state.imageLoaded) return;

  state._wbMatrix = buildWbMatrix(state.params.temperature, state.params.tint);
  updateWbMatrixDisplay(state._wbMatrix);

  const area    = canvasArea.getBoundingClientRect();
  canvas.width  = area.width;
  canvas.height = area.height;

  drawCheckerboard();
  ctx.save();

  const rotation = state.params.rotation || 0;
  if (rotation !== 0) {
    const cx = state.offsetX + (offscreen.width  * state.zoom) / 2;
    const cy = state.offsetY + (offscreen.height * state.zoom) / 2;
    ctx.translate(cx, cy); ctx.rotate(rotation * Math.PI / 180); ctx.translate(-cx, -cy);
  }

  ctx.translate(state.offsetX, state.offsetY);
  ctx.scale(state.zoom, state.zoom);

  const srcData   = offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  const processed = processPixels(srcData);

  // Reuse temp canvas — only recreate when size changes (fixes the bug in your version)
  if (!state._tmpCanvas ||
      state._tmpCanvas.width !== offscreen.width ||
      state._tmpCanvas.height !== offscreen.height) {
    state._tmpCanvas = document.createElement('canvas');
    state._tmpCanvas.width  = offscreen.width;
    state._tmpCanvas.height = offscreen.height;
    state._tmpCtx = state._tmpCanvas.getContext('2d', { willReadFrequently: true });
  }
  state._tmpCtx.putImageData(processed, 0, 0);
  ctx.drawImage(state._tmpCanvas, 0, 0);

  ctx.restore();
  if (crop.active) drawCropOverlay();
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(redraw, 8);
}

function drawCheckerboard() {
  const size = 14;
  for (let y = 0; y < canvas.height; y += size)
    for (let x = 0; x < canvas.width; x += size) {
      ctx.fillStyle = ((x/size + y/size) % 2 === 0) ? '#1a1a1e' : '#141418';
      ctx.fillRect(x, y, size, size);
    }
}

// ═══════════════════════════════════════════
//  FIT TO SCREEN / ZOOM
// ═══════════════════════════════════════════
function fitToScreen() {
  if (!state.imageLoaded) return;
  const area    = canvasArea.getBoundingClientRect(), pad = 80;
  state.zoom    = Math.min((area.width-pad)/offscreen.width, (area.height-pad)/offscreen.height, 1);
  state.offsetX = (area.width  - offscreen.width  * state.zoom) / 2;
  state.offsetY = (area.height - offscreen.height * state.zoom) / 2;
  updateZoomLabel(); redraw();
}

function zoomTo(newZoom, originX, originY) {
  newZoom       = Math.max(state.minZoom, Math.min(state.maxZoom, newZoom));
  const ratio   = newZoom / state.zoom;
  state.offsetX = originX - ratio * (originX - state.offsetX);
  state.offsetY = originY - ratio * (originY - state.offsetY);
  state.zoom    = newZoom; updateZoomLabel(); redraw();
}

function updateZoomLabel() { zoomLabel.textContent = Math.round(state.zoom * 100) + '%'; }

// ═══════════════════════════════════════════
//  HISTOGRAM
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
//  HISTOGRAM — Day 18 enhanced
// ═══════════════════════════════════════════

// Which channels are visible — toggled by buttons
const histChannels = { luma: true, r: true, g: true, b: true };

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

  // ── Sample processed pixels ──
  const srcData   = offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  const processed = processPixels(srcData);
  const data      = processed.data;
  const total     = data.length / 4;

  const rBins = new Uint32Array(256);
  const gBins = new Uint32Array(256);
  const bBins = new Uint32Array(256);
  const lBins = new Uint32Array(256);

  // Sample every 4th pixel for speed
  let lumaSum = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const l = Math.round(0.299*r + 0.587*g + 0.114*b);
    rBins[r]++;
    gBins[g]++;
    bBins[b]++;
    lBins[l]++;
    lumaSum += l;
  }

  const sampledPixels = total / 4;

  // ── Stats ──
  const mean = Math.round(lumaSum / sampledPixels);

  // Median from luma bins
  let cumulative = 0;
  let median     = 0;
  const half     = sampledPixels / 2;
  for (let i = 0; i < 256; i++) {
    cumulative += lBins[i];
    if (cumulative >= half) { median = i; break; }
  }

  // Clipping — pixels within 5 stops of pure black/white
  const threshold   = sampledPixels * 0.001; // 0.1%
  const blacksCount = lBins[0] + lBins[1] + lBins[2] + lBins[3] + lBins[4];
  const whitesCount = lBins[251] + lBins[252] + lBins[253] + lBins[254] + lBins[255];
  const hasBlacks   = blacksCount > threshold;
  const hasWhites   = whitesCount > threshold;

  // Update clipping indicators
  const clipShadow    = document.getElementById('histClipShadow');
  const clipHighlight = document.getElementById('histClipHighlight');
  if (clipShadow)    clipShadow.classList.toggle('hist-clip--active', hasBlacks);
  if (clipHighlight) clipHighlight.classList.toggle('hist-clip--active', hasWhites);

  // Update stats
  const meanEl    = document.getElementById('histMean');
  const medianEl  = document.getElementById('histMedian');
  const blacksEl  = document.getElementById('histBlacks');
  const whitesEl  = document.getElementById('histWhites');
  if (meanEl)   meanEl.textContent   = mean;
  if (medianEl) medianEl.textContent = median;
  if (blacksEl) blacksEl.textContent = hasBlacks ? '⚠' : '✓';
  if (whitesEl) whitesEl.textContent = hasWhites ? '⚠' : '✓';
  if (blacksEl) blacksEl.style.color = hasBlacks ? 'var(--danger)' : 'var(--success, #4caf7d)';
  if (whitesEl) whitesEl.style.color = hasWhites ? 'var(--danger)' : 'var(--success, #4caf7d)';

  // ── Find max for scaling ──
  const activeBins = [];
  if (histChannels.luma) activeBins.push(...Array.from(lBins));
  if (histChannels.r)    activeBins.push(...Array.from(rBins));
  if (histChannels.g)    activeBins.push(...Array.from(gBins));
  if (histChannels.b)    activeBins.push(...Array.from(bBins));

  if (activeBins.length === 0) return;

  // Use 95th percentile as max to prevent a single spike dominating
  const sorted = [...activeBins].sort((a, b) => a - b);
  const p95    = sorted[Math.floor(sorted.length * 0.95)];
  const max    = Math.max(p95, 1);

  // ── Draw ──
  hCtx.clearRect(0, 0, w, h);

  // Background
  hCtx.fillStyle = '#18181c';
  hCtx.fillRect(0, 0, w, h);

  // Grid lines
  hCtx.strokeStyle = 'rgba(255,255,255,0.05)';
  hCtx.lineWidth   = 0.5;
  [64, 128, 192].forEach(x => {
    const px = (x / 255) * w;
    hCtx.beginPath(); hCtx.moveTo(px, 0); hCtx.lineTo(px, h); hCtx.stroke();
  });
  [0.25, 0.5, 0.75].forEach(y => {
    hCtx.beginPath(); hCtx.moveTo(0, h*y); hCtx.lineTo(w, h*y); hCtx.stroke();
  });

  // Draw channels
  const channels = [
    { bins: lBins, color: 'rgba(255,255,255,0.15)', active: histChannels.luma },
    { bins: rBins, color: 'rgba(255,75,75,0.55)',   active: histChannels.r    },
    { bins: gBins, color: 'rgba(75,200,75,0.55)',   active: histChannels.g    },
    { bins: bBins, color: 'rgba(75,130,255,0.55)',  active: histChannels.b    },
  ];

  channels.forEach(({ bins, color, active }) => {
    if (!active) return;
    hCtx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - Math.min((bins[i] / max) * h, h);
      i === 0 ? hCtx.moveTo(x, y) : hCtx.lineTo(x, y);
    }
    hCtx.lineTo(w, h); hCtx.lineTo(0, h);
    hCtx.closePath();
    hCtx.fillStyle = color;
    hCtx.fill();
  });

  // Shadow / Highlight clipping overlay zones
  if (hasBlacks) {
    const grad = hCtx.createLinearGradient(0, 0, 12, 0);
    grad.addColorStop(0, 'rgba(80,80,255,0.3)');
    grad.addColorStop(1, 'transparent');
    hCtx.fillStyle = grad;
    hCtx.fillRect(0, 0, 12, h);
  }
  if (hasWhites) {
    const grad = hCtx.createLinearGradient(w-12, 0, w, 0);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, 'rgba(255,80,80,0.3)');
    hCtx.fillStyle = grad;
    hCtx.fillRect(w-12, 0, 12, h);
  }

  // Store bins for hover readout
  hCanvas._bins  = { r: rBins, g: gBins, b: bBins, l: lBins };
  hCanvas._max   = max;
  hCanvas._total = sampledPixels;
}

// ── Channel toggle buttons ──
function bindHistogramControls() {
  document.querySelectorAll('.hist-ch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ch = btn.dataset.ch;
      histChannels[ch] = !histChannels[ch];
      btn.classList.toggle('hist-ch-btn--off', !histChannels[ch]);
      drawHistogram();
    });
  });

  // ── Hover readout ──
  const hCanvas = document.getElementById('histogramCanvas');
  const readout = document.getElementById('histReadout');
  if (!hCanvas || !readout) return;

  hCanvas.addEventListener('mousemove', e => {
    if (!hCanvas._bins) return;
    const rect  = hCanvas.getBoundingClientRect();
    const x     = e.clientX - rect.left;
    const value = Math.round((x / rect.width) * 255);
    const bins  = hCanvas._bins;

    readout.style.display = 'block';
    readout.style.left    = `${Math.min(x, hCanvas.offsetWidth - 80)}px`;
    readout.innerHTML     = `
      <div class="hist-readout__val">${value}</div>
      <div style="color:#ff5555;">R: ${bins.r[value] || 0}</div>
      <div style="color:#55cc55;">G: ${bins.g[value] || 0}</div>
      <div style="color:#5588ff;">B: ${bins.b[value] || 0}</div>
    `;
  });

  hCanvas.addEventListener('mouseleave', () => {
    readout.style.display = 'none';
  });
}

// ═══════════════════════════════════════════
//  SLIDER BINDING
// ═══════════════════════════════════════════
function bindSliders() {
  document.querySelectorAll('.adj-slider:not(.hsl-slider)').forEach(slider => {
    const valEl = slider.nextElementSibling;
    const row   = slider.closest('.slider-row');

    // Guard — skip sliders not inside a .slider-row
    if (!row || !valEl) return;

    slider.addEventListener('input', () => {
      const param = slider.dataset.param; if (!param) return;
      const value = parseInt(slider.value); state.params[param] = value;
      valEl.textContent = value > 0 ? `+${value}` : `${value}`;
      valEl.style.color = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
      row.classList.toggle('slider-row--active', value !== 0);
      updateSliderTrack(slider); scheduleRedraw(); drawHistogram();
    });

    slider.addEventListener('change', pushHistory);

    const label = row.querySelector('label');
    if (label) {
      label.style.cursor = 'pointer'; label.title = 'Double-click to reset';
      label.addEventListener('dblclick', () => {
        slider.value = 0; state.params[slider.dataset.param] = 0;
        valEl.textContent = '0'; valEl.style.color = 'var(--text-muted)';
        row.classList.remove('slider-row--active'); updateSliderTrack(slider);
        scheduleRedraw(); drawHistogram(); pushHistory();
      });
    }
  });
}

function updateSliderTrack(slider) {
  const min = parseInt(slider.min), max = parseInt(slider.max), val = parseInt(slider.value);
  if (min < 0) {
    const center = (0-min)/(max-min)*100, pos = (val-min)/(max-min)*100;
    const left = Math.min(center, pos), width = Math.abs(pos-center);
    slider.style.background = `linear-gradient(to right,var(--bg-3) 0%,var(--bg-3) ${left}%,var(--accent) ${left}%,var(--accent) ${left+width}%,var(--bg-3) ${left+width}%,var(--bg-3) 100%)`;
  } else {
    const pct = max > 0 ? (val/max)*100 : 0;
    slider.style.background = `linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--bg-3) ${pct}%,var(--bg-3) 100%)`;
  }
}

function initSliderTracks() { document.querySelectorAll('.adj-slider').forEach(updateSliderTrack); }

// ═══════════════════════════════════════════
//  HSL TABS
// ═══════════════════════════════════════════
function bindHslTabs() {
  const tabs = document.querySelectorAll('.hsl-tab'), sliders = document.querySelectorAll('.hsl-slider');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active')); tab.classList.add('active');
      activeHueBand = tab.dataset.hue;

      if (activeHueBand === 'all') {
        sliders.forEach(s => {
          s.value = 0; s.nextElementSibling.textContent = '0';
          s.nextElementSibling.style.color = 'var(--text-muted)'; updateSliderTrack(s);
        });
      } else {
        const band = state.params.hsl[activeHueBand];
        sliders.forEach(s => {
          const key = s.dataset.hsl, value = band[key]; s.value = value;
          s.nextElementSibling.textContent = value > 0 ? `+${value}` : `${value}`;
          s.nextElementSibling.style.color = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
          updateSliderTrack(s);
        });
      }
    });
  });

  sliders.forEach(slider => {
    const valEl = slider.nextElementSibling;
    slider.addEventListener('input', () => {
      const key = slider.dataset.hsl, value = parseInt(slider.value);
      if (activeHueBand === 'all') Object.keys(state.params.hsl).forEach(b => { state.params.hsl[b][key] = value; });
      else state.params.hsl[activeHueBand][key] = value;
      valEl.textContent = value > 0 ? `+${value}` : `${value}`;
      valEl.style.color = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
      updateSliderTrack(slider); updateHslDots(); scheduleRedraw(); drawHistogram();
    });
    slider.addEventListener('change', pushHistory);

    const label = slider.closest('.slider-row')?.querySelector('label');
    if (label) {
      label.style.cursor = 'pointer'; label.title = 'Double-click to reset';
      label.addEventListener('dblclick', () => {
        const key = slider.dataset.hsl; slider.value = 0;
        valEl.textContent = '0'; valEl.style.color = 'var(--text-muted)';
        if (activeHueBand === 'all') Object.keys(state.params.hsl).forEach(b => { state.params.hsl[b][key] = 0; });
        else state.params.hsl[activeHueBand][key] = 0;
        updateSliderTrack(slider); updateHslDots(); scheduleRedraw(); drawHistogram(); pushHistory();
      });
    }
  });
}

function updateHslDots() {
  document.querySelectorAll('.hsl-dot').forEach(dot => {
    const p = state.params.hsl[dot.dataset.hue];
    dot.classList.toggle('hsl-dot--active', p.hue !== 0 || p.sat !== 0 || p.lum !== 0);
  });
}

// ═══════════════════════════════════════════
//  HISTORY — UNDO / REDO
// ═══════════════════════════════════════════
function pushHistory() {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push({
    ...state.params,
    hsl:   JSON.parse(JSON.stringify(state.params.hsl)),
    curve: JSON.parse(JSON.stringify(state.params.curve)),
  });
  if (state.history.length > state.maxHistory) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateHistoryBtns(); updateHistoryPanel(); autoSave();
}

function undo() { if (state.historyIndex <= 0) return; state.historyIndex--; restoreHistory(state.history[state.historyIndex]); }
function redo() { if (state.historyIndex >= state.history.length-1) return; state.historyIndex++; restoreHistory(state.history[state.historyIndex]); }

function restoreHistory(params) {
  state.params = {
    ...params,
    hsl:   JSON.parse(JSON.stringify(params.hsl)),
    curve: JSON.parse(JSON.stringify(params.curve || state.params.curve)),
  };
  syncSliders(); updateHslDots();
  if (curveCanvas) drawCurveCanvas();
  redraw(); drawHistogram(); updateHistoryBtns(); updateHistoryPanel();
}

function syncSliders() {
  document.querySelectorAll('.adj-slider:not(.hsl-slider)').forEach(slider => {
    const param = slider.dataset.param;
    if (!param || state.params[param] === undefined) return;
    const value = state.params[param]; slider.value = value;
    const valEl = slider.nextElementSibling;
    valEl.textContent = value > 0 ? `+${value}` : `${value}`;
    valEl.style.color = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
    slider.closest('.slider-row').classList.toggle('slider-row--active', value !== 0);
    updateSliderTrack(slider);
  });

  if (rotSlider) {
    rotSlider.value = state.params.rotation || 0;
    if (rotVal) rotVal.textContent = `${state.params.rotation || 0}°`;
    updateSliderTrack(rotSlider);
  }

  if (activeHueBand !== 'all') {
    const band = state.params.hsl[activeHueBand];
    document.querySelectorAll('.hsl-slider').forEach(s => {
      const key = s.dataset.hsl, value = band[key]; s.value = value;
      s.nextElementSibling.textContent = value > 0 ? `+${value}` : `${value}`;
      s.nextElementSibling.style.color = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
      updateSliderTrack(s);
    });
  }
}

function updateHistoryBtns() {
  const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
  if (u) u.disabled = state.historyIndex <= 0;
  if (r) r.disabled = state.historyIndex >= state.history.length - 1;
}

// ═══════════════════════════════════════════
//  HISTORY PANEL
// ═══════════════════════════════════════════
const PARAM_LABELS = {
  brightness:'Brightness', contrast:'Contrast', exposure:'Exposure',
  highlights:'Highlights', shadows:'Shadows', saturation:'Saturation',
  vibrance:'Vibrance', temperature:'Temperature', tint:'Tint',
  sharpness:'Sharpening', sharpen_radius:'Sharpen Radius', sharpen_detail:'Sharpen Detail',
  noise_reduction:'Noise Reduction', noise_detail:'NR Detail', noise_contrast:'NR Contrast',
  vignette:'Vignette', grain:'Grain', rotation:'Rotation',
};

// ═══════════════════════════════════════════
//  BUILT-IN PRESET LIBRARY
// ═══════════════════════════════════════════
const BUILTIN_PRESETS = [
  {
    name: 'Vivid',
    category: 'builtin',
    params: { brightness:5, contrast:20, saturation:30, vibrance:25, highlights:-10, shadows:10, exposure:5 },
  },
  {
    name: 'Matte',
    category: 'builtin',
    params: { brightness:10, contrast:-20, saturation:-15, highlights:-30, shadows:25, exposure:0 },
  },
  {
    name: 'Cinematic',
    category: 'builtin',
    params: { brightness:-5, contrast:30, saturation:-10, highlights:-20, shadows:-15, temperature:-15, tint:5, exposure:-10 },
  },
  {
    name: 'Golden Hour',
    category: 'builtin',
    params: { brightness:8, contrast:10, saturation:20, temperature:40, tint:-5, highlights:-15, shadows:15, exposure:5 },
  },
  {
    name: 'Cool Tone',
    category: 'builtin',
    params: { brightness:0, contrast:15, saturation:5, temperature:-35, tint:10, highlights:-10, shadows:5 },
  },
  {
    name: 'B&W Classic',
    category: 'builtin',
    params: { saturation:-100, contrast:20, brightness:5, highlights:-15, shadows:10 },
  },
  {
    name: 'B&W Dramatic',
    category: 'builtin',
    params: { saturation:-100, contrast:50, brightness:-10, highlights:-30, shadows:-20, exposure:-10 },
  },
  {
    name: 'Faded Film',
    category: 'builtin',
    params: { brightness:15, contrast:-25, saturation:-20, highlights:-20, shadows:30, exposure:5 },
    curve: {
      luma: [[0,0.08],[0.25,0.3],[0.75,0.72],[1,0.92]],
      r:[[0,0],[0.25,0.25],[0.75,0.75],[1,1]],
      g:[[0,0],[0.25,0.25],[0.75,0.75],[1,1]],
      b:[[0,0],[0.25,0.25],[0.75,0.75],[1,1]],
    },
  },
  {
    name: 'Warm Vintage',
    category: 'builtin',
    params: { brightness:5, contrast:-10, saturation:10, temperature:30, tint:10, highlights:-20, shadows:20 },
    curve: {
      luma: [[0,0.05],[0.25,0.28],[0.75,0.73],[1,0.95]],
      r:[[0,0.05],[0.25,0.28],[0.75,0.78],[1,1]],
      g:[[0,0],[0.25,0.25],[0.75,0.75],[1,1]],
      b:[[0,0],[0.25,0.22],[0.75,0.68],[1,0.92]],
    },
  },
  {
    name: 'Velvia',
    category: 'builtin',
    params: { brightness:0, contrast:25, saturation:40, vibrance:30, highlights:-10, shadows:0, exposure:0 },
  },
  {
    name: 'Soft Glow',
    category: 'builtin',
    params: { brightness:15, contrast:-15, saturation:5, highlights:20, shadows:10, exposure:5 },
  },
  {
    name: 'Moody Dark',
    category: 'builtin',
    params: { brightness:-15, contrast:35, saturation:-5, highlights:-40, shadows:-20, exposure:-15, temperature:-10 },
  },
];

// ═══════════════════════════════════════════
//  PRESET ENGINE
// ═══════════════════════════════════════════

// Load custom presets from localStorage
function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY);
    customPresets = raw ? JSON.parse(raw) : [];
  } catch (e) {
    customPresets = [];
  }
}

// Save custom presets to localStorage
function saveCustomPresets() {
  try {
    localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(customPresets));
  } catch (e) { /* quota exceeded */ }
}

// Build a preset from current state
function buildPreset(name) {
  return {
    name,
    category: 'custom',
    timestamp: Date.now(),
    params: {
      brightness:      state.params.brightness,
      contrast:        state.params.contrast,
      exposure:        state.params.exposure,
      highlights:      state.params.highlights,
      shadows:         state.params.shadows,
      saturation:      state.params.saturation,
      vibrance:        state.params.vibrance,
      temperature:     state.params.temperature,
      tint:            state.params.tint,
      sharpness:       state.params.sharpness,
      sharpen_radius:  state.params.sharpen_radius,
      sharpen_detail:  state.params.sharpen_detail,
      noise_reduction: state.params.noise_reduction,
      noise_detail:    state.params.noise_detail,
      noise_contrast:  state.params.noise_contrast,
      vignette:        state.params.vignette,
      grain:           state.params.grain,
    },
    hsl:   JSON.parse(JSON.stringify(state.params.hsl)),
    curve: JSON.parse(JSON.stringify(state.params.curve)),
  };
}

// Apply a preset to current state
function applyPreset(preset) {
  // Apply flat params
  const safeParams = [
    'brightness','contrast','exposure','highlights','shadows',
    'saturation','vibrance','temperature','tint',
    'sharpness','sharpen_radius','sharpen_detail',
    'noise_reduction','noise_detail','noise_contrast',
    'vignette','grain',
  ];
  safeParams.forEach(key => {
    if (preset.params?.[key] !== undefined) {
      state.params[key] = preset.params[key];
    } else {
      state.params[key] = 0; // reset to 0 if not in preset
    }
  });

  // Apply HSL if present, otherwise reset
  if (preset.hsl) {
    state.params.hsl = JSON.parse(JSON.stringify(preset.hsl));
  } else {
    Object.keys(state.params.hsl).forEach(band => {
      state.params.hsl[band] = { hue: 0, sat: 0, lum: 0 };
    });
  }

  // Apply curve if present, otherwise reset
  if (preset.curve) {
    state.params.curve = JSON.parse(JSON.stringify(preset.curve));
  } else {
    Object.keys(state.params.curve).forEach(ch => {
      state.params.curve[ch] = [[0,0],[0.25,0.25],[0.75,0.75],[1,1]];
    });
  }

  syncSliders();
  updateHslDots();
  if (curveCanvas) drawCurveCanvas();
  redraw();
  drawHistogram();
  pushHistory();
  showHint(`Preset applied: ${preset.name}`);
}

// Generate a tiny thumbnail of current image with preset applied
function generateThumbnail(preset, size = 60) {
  if (!state.imageLoaded) return null;

  // Save current params
  const savedParams = JSON.parse(JSON.stringify(state.params));

  // Temporarily apply preset params
  const safeParams = [
    'brightness','contrast','exposure','highlights','shadows',
    'saturation','vibrance','temperature','tint',
    'sharpness','sharpen_radius','sharpen_detail',
    'noise_reduction','noise_detail','noise_contrast',
    'vignette','grain',
  ];
  safeParams.forEach(key => {
    state.params[key] = preset.params?.[key] ?? 0;
  });
  if (preset.hsl) state.params.hsl = JSON.parse(JSON.stringify(preset.hsl));
  if (preset.curve) state.params.curve = JSON.parse(JSON.stringify(preset.curve));

  // Process pixels at thumbnail resolution
  const scale     = Math.min(size / offscreen.width, size / offscreen.height);
  const tw        = Math.round(offscreen.width  * scale);
  const th        = Math.round(offscreen.height * scale);

  const tmp       = document.createElement('canvas');
  tmp.width       = tw; tmp.height = th;
  const tmpCtx    = tmp.getContext('2d');
  tmpCtx.drawImage(offscreen, 0, 0, tw, th);

  const srcData   = tmpCtx.getImageData(0, 0, tw, th);
  const processed = processPixels(srcData);
  tmpCtx.putImageData(processed, 0, 0);

  const dataUrl = tmp.toDataURL('image/jpeg', 0.7);

  // Restore params
  state.params.brightness      = savedParams.brightness;
  state.params.contrast        = savedParams.contrast;
  state.params.exposure        = savedParams.exposure;
  state.params.highlights      = savedParams.highlights;
  state.params.shadows         = savedParams.shadows;
  state.params.saturation      = savedParams.saturation;
  state.params.vibrance        = savedParams.vibrance;
  state.params.temperature     = savedParams.temperature;
  state.params.tint            = savedParams.tint;
  state.params.sharpness       = savedParams.sharpness;
  state.params.sharpen_radius  = savedParams.sharpen_radius;
  state.params.sharpen_detail  = savedParams.sharpen_detail;
  state.params.noise_reduction = savedParams.noise_reduction;
  state.params.noise_detail    = savedParams.noise_detail;
  state.params.noise_contrast  = savedParams.noise_contrast;
  state.params.vignette        = savedParams.vignette;
  state.params.grain           = savedParams.grain;
  state.params.hsl   = JSON.parse(JSON.stringify(savedParams.hsl));
  state.params.curve = JSON.parse(JSON.stringify(savedParams.curve));

  return dataUrl;
}

// Render the preset grid
function renderPresetGrid() {
  const grid = document.getElementById('presetGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const allPresets = [
    ...BUILTIN_PRESETS,
    ...customPresets,
  ];

  const filtered = activePresetCategory === 'all'    ? allPresets
                 : activePresetCategory === 'builtin' ? BUILTIN_PRESETS
                 : customPresets;

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="preset-empty">No presets yet — save your current edits above</div>';
    return;
  }

  filtered.forEach((preset, index) => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.title     = preset.name;

    // Generate thumbnail
    const thumb = generateThumbnail(preset, 80);

    card.innerHTML = `
      <div class="preset-thumb">
        ${thumb
          ? `<img src="${thumb}" alt="${preset.name}" loading="lazy">`
          : `<div class="preset-thumb-placeholder">◈</div>`
        }
        ${preset.category === 'custom'
          ? `<button class="preset-delete" data-index="${index}" title="Delete preset">✕</button>`
          : ''
        }
      </div>
      <div class="preset-name">${preset.name}</div>
    `;

    // Apply on click
    card.addEventListener('click', e => {
      if (e.target.classList.contains('preset-delete')) return;
      document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('preset-card--active'));
      card.classList.add('preset-card--active');
      applyPreset(preset);
    });

    // Delete custom preset
    const delBtn = card.querySelector('.preset-delete');
    if (delBtn) {
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        const customIndex = customPresets.findIndex(p => p.name === preset.name && p.timestamp === preset.timestamp);
        if (customIndex >= 0) {
          customPresets.splice(customIndex, 1);
          saveCustomPresets();
          renderPresetGrid();
          showHint(`Deleted preset: ${preset.name}`);
        }
      });
    }

    grid.appendChild(card);
  });
}

// Bind preset UI
function bindPresets() {
  loadCustomPresets();

  // Category tabs
  document.querySelectorAll('.preset-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.preset-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activePresetCategory = tab.dataset.cat;
      renderPresetGrid();
    });
  });

  // Save preset button
  const btnSave  = document.getElementById('btnSavePreset');
  const nameInput = document.getElementById('presetNameInput');

  if (btnSave && nameInput) {
    btnSave.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { showHint('Enter a preset name first'); nameInput.focus(); return; }

      // Check for duplicate names
      if (customPresets.some(p => p.name === name)) {
        if (!confirm(`Replace existing preset "${name}"?`)) return;
        customPresets = customPresets.filter(p => p.name !== name);
      }

      const preset = buildPreset(name);
      customPresets.unshift(preset); // newest first
      saveCustomPresets();
      nameInput.value = '';

      // Switch to custom tab to show it
      document.querySelectorAll('.preset-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.preset-tab[data-cat="custom"]')?.classList.add('active');
      activePresetCategory = 'custom';

      renderPresetGrid();
      showHint(`Preset saved: ${name}`);
    });

    // Save on Enter key
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') btnSave.click();
    });
  }

  // Initial render
  renderPresetGrid();
}

function describeChange(prev, curr) {
  if (!prev) return 'Original';
  for (const [key, label] of Object.entries(PARAM_LABELS))
    if (prev[key] !== curr[key]) return label;
  for (const band of Object.keys(curr.hsl || {})) {
    const pb = prev.hsl?.[band] || { hue:0, sat:0, lum:0 };
    const cb = curr.hsl?.[band] || { hue:0, sat:0, lum:0 };
    if (pb.hue !== cb.hue || pb.sat !== cb.sat || pb.lum !== cb.lum)
      return `HSL ${band.charAt(0).toUpperCase() + band.slice(1)}`;
  }
  // Check curve changes
  for (const ch of ['luma','r','g','b']) {
    const pc = JSON.stringify(prev.curve?.[ch]);
    const cc = JSON.stringify(curr.curve?.[ch]);
    if (pc !== cc) return `Curve ${ch === 'luma' ? 'RGB' : ch.toUpperCase()}`;
  }
  if (prev.crop !== curr.crop) return 'Crop';
  if (prev.flipH !== curr.flipH) return 'Flip H';
  if (prev.flipV !== curr.flipV) return 'Flip V';
  return 'Edit';
}

function updateHistoryPanel() {
  const list = document.getElementById('historyList'); if (!list) return;
  list.innerHTML = '';

  state.history.forEach((entry, index) => {
    const label    = describeChange(state.history[index-1] || null, entry);
    const isActive = index === state.historyIndex;
    const icon     = index === 0 ? '◉'
      : label.includes('Crop')   ? '⊡'
      : label.includes('Rotate') ? '↻'
      : label.includes('Flip')   ? '⇔'
      : label.includes('HSL')    ? '◉'
      : label.includes('Curve')  ? '〜'
      : label.includes('Sharp')  ? '◈'
      : label.includes('Noise')  ? '≋'
      : label.includes('Temp') || label.includes('Tint') ? '⬡'
      : '●';

    const item = document.createElement('div');
    item.className = `history-item${isActive ? ' history-item--active' : ''}`;
    item.innerHTML = `
      <span class="history-icon">${icon}</span>
      <span class="history-label">${label}</span>
      <span class="history-step">${index}</span>
    `;
    item.addEventListener('click', () => { state.historyIndex = index; restoreHistory(state.history[index]); });
    list.appendChild(item);
  });

  const active = list.querySelector('.history-item--active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

// ═══════════════════════════════════════════
//  JSON STATE — SAVE & LOAD
// ═══════════════════════════════════════════
function buildStateSnapshot() {
  return {
    version:   '1.0',
    timestamp: new Date().toISOString(),
    imageName: typeof IMAGE_NAME !== 'undefined' ? IMAGE_NAME : 'unknown',
    params: {
      ...state.params,
      hsl:   JSON.parse(JSON.stringify(state.params.hsl)),
      curve: JSON.parse(JSON.stringify(state.params.curve)),
    },
  };
}

function saveStateToFile() {
  const snapshot = buildStateSnapshot();
  const blob     = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  const name     = typeof IMAGE_NAME !== 'undefined' ? IMAGE_NAME : 'pixloft';
  a.href = url; a.download = name.replace(/\.[^.]+$/, '') + '.pixloft.json';
  a.click(); URL.revokeObjectURL(url);
  showHint(`State saved → ${a.download}`);
}

function loadStateFromFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const snapshot = JSON.parse(e.target.result);
      if (!snapshot.params) { showHint('⚠ Invalid state file'); return; }
      state.params = {
        ...state.params,
        ...snapshot.params,
        hsl:   JSON.parse(JSON.stringify(snapshot.params.hsl   || state.params.hsl)),
        curve: JSON.parse(JSON.stringify(snapshot.params.curve || state.params.curve)),
      };
      syncSliders(); updateHslDots();
      if (curveCanvas) drawCurveCanvas();
      redraw(); drawHistogram(); pushHistory(); updateHistoryPanel();
      showHint(`State loaded from ${file.name}`);
    } catch (err) {
      showHint('⚠ Could not parse state file');
      console.error('State load error:', err);
    }
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════
//  AUTO-SAVE TO LOCALSTORAGE
// ═══════════════════════════════════════════
function autoSave() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(buildStateSnapshot())); }
  catch (e) { /* quota exceeded */ }
}

function autoLoad() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (!snapshot?.params) return false;
    state.params = {
      ...state.params,
      ...snapshot.params,
      hsl:   JSON.parse(JSON.stringify(snapshot.params.hsl   || state.params.hsl)),
      curve: JSON.parse(JSON.stringify(snapshot.params.curve || state.params.curve)),
    };
    return true;
  } catch (e) { return false; }
}

// ═══════════════════════════════════════════
//  RESET TO ORIGINAL IMAGE
// ═══════════════════════════════════════════
function resetToOriginal() {
  if (!state.originalImage) return;

  offscreen        = document.createElement('canvas');
  offscreen.width  = state.originalImage.naturalWidth;
  offscreen.height = state.originalImage.naturalHeight;
  offscreenCtx     = offscreen.getContext('2d', { willReadFrequently: true });
  offscreenCtx.drawImage(state.originalImage, 0, 0);

  // Default values for params that aren't 0
  const PARAM_DEFAULTS = {
    sharpen_radius:    1,
    sharpen_detail:    25,
    noise_detail:      50,
    vignette_size:     50,
    vignette_feather:  50,
    vignette_roundness:50,
    grain_size:        25,
    grain_roughness:   50,
  };

  Object.keys(state.params).forEach(k => {
    if (k === 'hsl' || k === 'curve') return;
    if (k === 'flipH' || k === 'flipV') { state.params[k] = false; return; }
    if (k === 'crop') { state.params[k] = null; return; }
    state.params[k] = PARAM_DEFAULTS[k] ?? 0;
  });
  Object.keys(state.params.hsl).forEach(band => { state.params.hsl[band] = { hue:0, sat:0, lum:0 }; });
  Object.keys(state.params.curve).forEach(ch => { state.params.curve[ch] = [[0,0],[0.25,0.25],[0.75,0.75],[1,1]]; });

  if (rotSlider) { rotSlider.value = 0; updateSliderTrack(rotSlider); }
  if (rotVal)    rotVal.textContent = '0°';

  document.querySelectorAll('.hsl-slider').forEach(s => {
    s.value = 0; s.nextElementSibling.textContent = '0';
    s.nextElementSibling.style.color = 'var(--text-muted)'; updateSliderTrack(s);
  });

  if (curveCanvas) drawCurveCanvas();
  try { localStorage.removeItem(LS_KEY); } catch (e) {}

  // Clear grain cache so it regenerates for new image
  _grainCache    = null;
  _grainCacheKey = '';

  syncSliders(); updateHslDots(); fitToScreen(); redraw(); drawHistogram();
  state.history = []; state.historyIndex = -1;
  pushHistory(); updateHistoryPanel(); updateHistoryBtns();
  showHint('Reset to original image ◉');
}

// ═══════════════════════════════════════════
//  CANVAS EVENTS — ZOOM, PAN, CROP
// ═══════════════════════════════════════════
function bindCanvasEvents() {
  new ResizeObserver(() => { if (state.imageLoaded) redraw(); }).observe(canvasArea);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomTo(state.zoom * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX-rect.left, e.clientY-rect.top);
  }, { passive: false });

  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX-rect.left, sy = e.clientY-rect.top;

    if (crop.active) {
      const handle = hitHandle(sx, sy);
      if (handle) { crop.dragging=true; crop.dragHandle=handle; crop.startX=sx; crop.startY=sy; crop._origRect={...crop.rect}; return; }
      if (insideCropRect(sx, sy)) { crop.dragging=true; crop.dragHandle='move'; crop.startX=sx; crop.startY=sy; crop._origRect={...crop.rect}; canvas.style.cursor='move'; return; }
      const imgPt = screenToImage(sx, sy); crop.dragging=true; crop.dragHandle='new';
      crop.startX=sx; crop.startY=sy; crop._startImgPt=imgPt; crop.rect={x:imgPt.x,y:imgPt.y,w:0,h:0}; return;
    }

    if (e.button === 1 || state.spaceHeld) {
      e.preventDefault(); state.isPanning=true;
      state.panStartX=e.clientX; state.panStartY=e.clientY;
      state.panOriginX=state.offsetX; state.panOriginY=state.offsetY;
      canvas.style.cursor='grabbing';
    }
  });

  window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX-rect.left, sy = e.clientY-rect.top;

    if (crop.active && crop.dragging) {
      const dx=sx-crop.startX, dy=sy-crop.startY;
      const dxI=dx/state.zoom, dyI=dy/state.zoom;
      const h=crop.dragHandle; let r={...crop._origRect};

      if (h==='new') {
        const ip=screenToImage(sx,sy); r.x=Math.min(crop._startImgPt.x,ip.x); r.y=Math.min(crop._startImgPt.y,ip.y);
        r.w=Math.abs(ip.x-crop._startImgPt.x); r.h=Math.abs(ip.y-crop._startImgPt.y);
        if (crop.aspectRatio) enforceAspectRatio(r,'tl');
      } else if (h==='move') {
        r.x+=dxI; r.y+=dyI;
      } else {
        if (h.includes('r')) r.w=Math.max(10,r.w+dxI);
        if (h.includes('l')) { r.x+=dxI; r.w=Math.max(10,r.w-dxI); }
        if (h.includes('b')) r.h=Math.max(10,r.h+dyI);
        if (h.includes('t')) { r.y+=dyI; r.h=Math.max(10,r.h-dyI); }
        if (crop.aspectRatio) enforceAspectRatio(r, h.length===2?h:'tl');
      }

      crop.rect=clampCropRect(r);
      const cw=document.getElementById('cropW'), ch=document.getElementById('cropH');
      if (cw) cw.value=Math.round(crop.rect.w); if (ch) ch.value=Math.round(crop.rect.h);
      redraw(); return;
    }

    if (crop.active && !crop.dragging) {
      const handle=hitHandle(sx,sy);
      canvas.style.cursor=handle?(HANDLE_CURSORS[handle]||'pointer'):insideCropRect(sx,sy)?'move':'crosshair';
    }

    if (state.isPanning) {
      state.offsetX=state.panOriginX+(e.clientX-state.panStartX);
      state.offsetY=state.panOriginY+(e.clientY-state.panStartY); redraw();
    }
  });

  window.addEventListener('mouseup', () => {
    if (crop.active && crop.dragging) {
      crop.dragging=false; crop.dragHandle=null;
      if (crop.rect.w<0) { crop.rect.x+=crop.rect.w; crop.rect.w=-crop.rect.w; }
      if (crop.rect.h<0) { crop.rect.y+=crop.rect.h; crop.rect.h=-crop.rect.h; }
      crop.rect=clampCropRect(crop.rect); redraw(); return;
    }
    if (state.isPanning) { state.isPanning=false; canvas.style.cursor=state.spaceHeld?'grab':'crosshair'; }
  });

  let lastPinch=null;
  canvas.addEventListener('touchstart', e => { if (e.touches.length===2) lastPinch=pinchDist(e); }, {passive:true});
  canvas.addEventListener('touchmove', e => {
    if (e.touches.length!==2) return; e.preventDefault();
    const d=pinchDist(e), rect=canvas.getBoundingClientRect();
    const cx=(e.touches[0].clientX+e.touches[1].clientX)/2-rect.left;
    const cy=(e.touches[0].clientY+e.touches[1].clientY)/2-rect.top;
    zoomTo(state.zoom*d/lastPinch,cx,cy); lastPinch=d;
  }, {passive:false});

  canvas.addEventListener('dblclick', e => {
    if (crop.active) return;
    const rect=canvas.getBoundingClientRect();
    zoomTo(state.zoom<1.5?2:1, e.clientX-rect.left, e.clientY-rect.top);
  });
}

function pinchDist(e) {
  const dx=e.touches[0].clientX-e.touches[1].clientX;
  const dy=e.touches[0].clientY-e.touches[1].clientY;
  return Math.sqrt(dx*dx+dy*dy);
}

window.addEventListener('keydown', e => {
  if (e.code==='Space' && e.target.tagName!=='INPUT') { e.preventDefault(); state.spaceHeld=true; canvas.style.cursor='grab'; }
});
window.addEventListener('keyup', e => {
  if (e.code==='Space') { state.spaceHeld=false; canvas.style.cursor='crosshair'; }
});

// ═══════════════════════════════════════════
//  TOOLS
// ═══════════════════════════════════════════
function bindTools() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); state.activeTool=btn.dataset.tool;
      const cc=document.getElementById('cropControls'), rc=document.getElementById('rotateControls');
      if (cc) cc.style.display='none'; if (rc) rc.style.display='none';

      if (state.activeTool==='crop') { if (cc) cc.style.display='block'; crop.active=true; canvas.style.cursor='crosshair'; showHint('Draw crop area · Drag handles to resize'); }
      else if (state.activeTool==='rotate') { if (rc) rc.style.display='block'; if (crop.active) deactivateCrop(); showHint('Rotate or flip the image'); }
      else { if (crop.active) deactivateCrop(); canvas.style.cursor='crosshair'; }
    });
  });

  document.querySelectorAll('.crop-ratio').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.crop-ratio').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      const ratio=btn.dataset.ratio;
      crop.aspectRatio=ratio==='free'?null:(()=>{ const p=ratio.split(':'); return parseInt(p[0])/parseInt(p[1]); })();
      if (crop.rect.w>0) { crop.rect=clampCropRect(enforceAspectRatio({...crop.rect},'tl')); const cw=document.getElementById('cropW'),ch=document.getElementById('cropH'); if (cw) cw.value=Math.round(crop.rect.w); if (ch) ch.value=Math.round(crop.rect.h); redraw(); }
    });
  });

  const cwEl=document.getElementById('cropW'), chEl=document.getElementById('cropH');
  if (cwEl) cwEl.addEventListener('change', e => { const w=parseInt(e.target.value); if (!w||w<1) return; crop.rect.w=Math.min(w,offscreen.width-crop.rect.x); if (crop.aspectRatio) crop.rect.h=crop.rect.w/crop.aspectRatio; if (chEl) chEl.value=Math.round(crop.rect.h); crop.rect=clampCropRect(crop.rect); redraw(); });
  if (chEl) chEl.addEventListener('change', e => { const h=parseInt(e.target.value); if (!h||h<1) return; crop.rect.h=Math.min(h,offscreen.height-crop.rect.y); if (crop.aspectRatio) crop.rect.w=crop.rect.h*crop.aspectRatio; if (cwEl) cwEl.value=Math.round(crop.rect.w); crop.rect=clampCropRect(crop.rect); redraw(); });

  const btnAC=document.getElementById('btnApplyCrop'), btnCC=document.getElementById('btnCancelCrop');
  if (btnAC) btnAC.addEventListener('click', applyCrop);
  if (btnCC) btnCC.addEventListener('click', deactivateCrop);

  const bCCW=document.getElementById('btnRotateCCW'), bCW=document.getElementById('btnRotateCW');
  const bFH=document.getElementById('btnFlipH'), bFV=document.getElementById('btnFlipV');
  if (bCCW) bCCW.addEventListener('click', ()=>rotateCanvas90(270));
  if (bCW)  bCW.addEventListener('click',  ()=>rotateCanvas90(90));
  if (bFH)  bFH.addEventListener('click',  ()=>flipCanvas(true));
  if (bFV)  bFV.addEventListener('click',  ()=>flipCanvas(false));

  rotSlider=document.getElementById('rotateSlider'); rotVal=document.getElementById('rotateVal');
  if (rotSlider) {
    rotSlider.addEventListener('input', () => { const deg=parseFloat(rotSlider.value); if (rotVal) rotVal.textContent=`${deg}°`; updateSliderTrack(rotSlider); applyFineRotation(deg); });
    rotSlider.addEventListener('change', pushHistory);
  }

  const btnRT=document.getElementById('btnResetTransform');
  if (btnRT) btnRT.addEventListener('click', () => { state.params.rotation=0; if (rotSlider){rotSlider.value=0;updateSliderTrack(rotSlider);} if (rotVal) rotVal.textContent='0°'; redraw(); pushHistory(); showHint('Transform reset'); });
}

// ═══════════════════════════════════════════
//  ACCORDION
// ═══════════════════════════════════════════
function bindAccordion() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const section=header.parentElement, body=section.querySelector('.accordion-body'), isOpen=section.classList.contains('open');
      section.classList.toggle('open',!isOpen); body.style.display=isOpen?'none':'block';
    });
  });
}

// ═══════════════════════════════════════════
//  TOPBAR
// ═══════════════════════════════════════════
function bindTopbar() {
  const cx=()=>canvas.width/2, cy=()=>canvas.height/2;
  document.getElementById('btnZoomIn') .addEventListener('click',()=>zoomTo(state.zoom*1.25,cx(),cy()));
  document.getElementById('btnZoomOut').addEventListener('click',()=>zoomTo(state.zoom*0.80,cx(),cy()));
  document.getElementById('btnFit')    .addEventListener('click',fitToScreen);
  document.getElementById('btnUndo')   .addEventListener('click',undo);
  document.getElementById('btnRedo')   .addEventListener('click',redo);

  document.getElementById('btnReset').addEventListener('click',()=>{
    if (confirm('Reset to original image? This will clear all edits and crop/rotate.')) resetToOriginal();
  });

  let showingBefore=false;
  document.getElementById('btnBefore').addEventListener('click',()=>{
    showingBefore=!showingBefore;
    const btn=document.getElementById('btnBefore');
    if (showingBefore) {
      const area=canvasArea.getBoundingClientRect(); canvas.width=area.width; canvas.height=area.height;
      drawCheckerboard(); ctx.save(); ctx.translate(state.offsetX,state.offsetY); ctx.scale(state.zoom,state.zoom);
      ctx.drawImage(state.originalImage,0,0); ctx.restore();
      btn.classList.add('active'); btn.textContent='◨ After';
    } else { redraw(); btn.classList.remove('active'); btn.textContent='◧ Before'; }
  });

  document.getElementById('btnExport').addEventListener('click', openExportModal);

  const btnSave=document.getElementById('btnSaveState');
  if (btnSave) btnSave.addEventListener('click',saveStateToFile);

  const btnLoad=document.getElementById('btnLoadState'), stateInput=document.getElementById('stateFileInput');
  if (btnLoad && stateInput) {
    btnLoad.addEventListener('click',()=>stateInput.click());
    stateInput.addEventListener('change',e=>{ const file=e.target.files[0]; if (file){loadStateFromFile(file);stateInput.value='';} });
  }
}

// ═══════════════════════════════════════════
//  EXPORT MODAL
// ═══════════════════════════════════════════
let exportFormat  = 'jpeg';
let exportQuality = 95;

function openExportModal() {
  if (!state.imageLoaded) return;

  const overlay = document.getElementById('exportOverlay');
  if (!overlay) return;

  // Update size info
  const sizeEl = document.getElementById('exportSizeInfo');
  if (sizeEl) {
    sizeEl.textContent = `${offscreen.width} × ${offscreen.height}px`;
  }

  overlay.style.display = 'flex';
}

function closeExportModal() {
  const overlay = document.getElementById('exportOverlay');
  if (overlay) overlay.style.display = 'none';

  // Reset progress
  const prog  = document.getElementById('exportProgress');
  const bar   = document.getElementById('exportProgressBar');
  const label = document.getElementById('exportProgressLabel');
  if (prog)  prog.style.display  = 'none';
  if (bar)   bar.style.width     = '0%';
  if (label) label.textContent   = 'Processing on server...';
}

function bindExportModal() {
  // Format buttons
  document.querySelectorAll('.export-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.export-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      exportFormat = btn.dataset.fmt;

      // Hide quality slider for PNG (lossless)
      const qualRow = document.getElementById('qualityRow');
      if (qualRow) qualRow.style.display = exportFormat === 'png' ? 'none' : 'flex';
    });
  });

  // Quality slider
  const qualSlider = document.getElementById('exportQuality');
  const qualVal    = document.getElementById('exportQualityVal');
  if (qualSlider && qualVal) {
    qualSlider.addEventListener('input', () => {
      exportQuality      = parseInt(qualSlider.value);
      qualVal.textContent = `${exportQuality}%`;
    });
  }

  // Cancel
  const btnCancel = document.getElementById('btnExportCancel');
  if (btnCancel) btnCancel.addEventListener('click', closeExportModal);

  // Close on overlay click
  const overlay = document.getElementById('exportOverlay');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeExportModal();
    });
  }

  // Confirm download
  const btnConfirm = document.getElementById('btnExportConfirm');
  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      const prog  = document.getElementById('exportProgress');
      const bar   = document.getElementById('exportProgressBar');
      const label = document.getElementById('exportProgressLabel');

      // Show progress
      if (prog) prog.style.display = 'block';
      btnConfirm.disabled          = true;

      // Animate progress bar
      let pct = 0;
      const interval = setInterval(() => {
        pct = Math.min(pct + 5, 85);
        if (bar) bar.style.width = `${pct}%`;
      }, 150);

      try {
        // Build export payload — send current params + curve + hsl
        const payload = {
          format:  exportFormat,
          quality: exportQuality,
          params: {
            ...state.params,
            hsl:   JSON.parse(JSON.stringify(state.params.hsl)),
            curve: JSON.parse(JSON.stringify(state.params.curve)),
          },
        };

        const res = await fetch(`/editor/api/export/${IMAGE_ID}/`, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken':  getCsrfToken(),
          },
          body: JSON.stringify(payload),
        });

        clearInterval(interval);

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Export failed' }));
          showHint(`⚠ ${err.error || 'Export failed'}`);
          if (label) label.textContent = '⚠ Export failed';
          btnConfirm.disabled          = false;
          return;
        }

        // Complete bar
        if (bar) bar.style.width = '100%';
        if (label) label.textContent = 'Done! Downloading...';

        // Trigger download
        const blob     = await res.blob();
        const url      = URL.createObjectURL(blob);
        const a        = document.createElement('a');
        const filename = res.headers.get('Content-Disposition')
          ?.match(/filename="(.+)"/)?.[1]
          || `export.${exportFormat === 'jpeg' ? 'jpg' : exportFormat}`;

        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        setTimeout(() => {
          closeExportModal();
          btnConfirm.disabled = false;
          showHint(`Downloaded: ${filename}`);
        }, 800);

      } catch (err) {
        clearInterval(interval);
        console.error('Export error:', err);
        showHint('⚠ Network error during export');
        if (label) label.textContent = '⚠ Network error';
        btnConfirm.disabled          = false;
      }
    });
  }
}

// Helper — get CSRF token from cookie
function getCsrfToken() {
  return document.cookie.split('; ')
    .find(r => r.startsWith('csrftoken='))
    ?.split('=')[1] ?? '';
}

function bindHistoryPanel() {
  const btnClear=document.getElementById('btnClearHistory');
  if (btnClear) {
    btnClear.addEventListener('click',()=>{
      const current=state.history[state.historyIndex]; state.history=[current]; state.historyIndex=0;
      updateHistoryBtns(); updateHistoryPanel(); showHint('History cleared');
    });
  }
}

// ═══════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════
function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName==='INPUT') return;
    const cx=canvas.width/2, cy=canvas.height/2;
    if ((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey||e.metaKey)&&e.key==='y')               { e.preventDefault(); redo(); }
    if ((e.ctrlKey||e.metaKey)&&e.key==='z'&&e.shiftKey)   { e.preventDefault(); redo(); }
    switch(e.key) {
      case '0': fitToScreen(); break;
      case '1': zoomTo(1,cx,cy); break;
      case '2': zoomTo(2,cx,cy); break;
      case '+': case '=': zoomTo(state.zoom*1.25,cx,cy); break;
      case '-': zoomTo(state.zoom*0.80,cx,cy); break;
      case 'b': case 'B': document.getElementById('btnBefore').click(); break;
      case 'r': case 'R': document.getElementById('btnReset').click(); break;
      case 'c': case 'C': document.querySelector('[data-tool="crop"]')?.click(); break;
      case 'Escape': if (crop.active) deactivateCrop(); break;
      case 'Enter':  if (crop.active) applyCrop(); break;
    }
  });
}

// ═══════════════════════════════════════════
//  WHITE BALANCE PRESETS
// ═══════════════════════════════════════════
function bindWhiteBalance() {
  document.querySelectorAll('.wb-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const temp=parseInt(btn.dataset.temp), tint=parseInt(btn.dataset.tint);
      state.params.temperature=temp; state.params.tint=tint;

      const ts=document.querySelector('.adj-slider[data-param="temperature"]');
      const ti=document.querySelector('.adj-slider[data-param="tint"]');
      if (ts) { ts.value=temp; const v=ts.nextElementSibling; v.textContent=temp>0?`+${temp}`:`${temp}`; v.style.color=temp!==0?'var(--accent)':'var(--text-muted)'; ts.closest('.slider-row').classList.toggle('slider-row--active',temp!==0); updateSliderTrack(ts); }
      if (ti) { ti.value=tint; const v=ti.nextElementSibling; v.textContent=tint>0?`+${tint}`:`${tint}`; v.style.color=tint!==0?'var(--accent)':'var(--text-muted)'; ti.closest('.slider-row').classList.toggle('slider-row--active',tint!==0); updateSliderTrack(ti); }

      document.querySelectorAll('.wb-preset').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      scheduleRedraw(); drawHistogram(); pushHistory(); showHint(`White balance: ${btn.textContent}`);
    });
  });

  const ts=document.querySelector('.adj-slider[data-param="temperature"]');
  if (ts) ts.addEventListener('input',()=>{ showHint(`${Math.round(sliderToKelvin(parseInt(ts.value))).toLocaleString()}K`); document.querySelectorAll('.wb-preset').forEach(b=>b.classList.remove('active')); });
}

// ═══════════════════════════════════════════
//  HINT
// ═══════════════════════════════════════════
function showHint(msg) {
  canvasHint.textContent=msg; canvasHint.style.opacity='1';
  clearTimeout(hintTimer); hintTimer=setTimeout(()=>{ canvasHint.style.opacity='0'; },2500);
}
canvasHint.style.transition='opacity 0.4s';

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
init();
initSliderTracks();