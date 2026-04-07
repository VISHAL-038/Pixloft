// ===== Pixloft Canvas Engine — editor.js =====

const canvas        = document.getElementById('mainCanvas');
const ctx           = canvas.getContext('2d');
const canvasArea    = document.getElementById('canvasArea');
const canvasHint    = document.getElementById('canvasHint');
const zoomLabel     = document.getElementById('zoomLabel');

// ===== State =====
const state = {
  // Image
  originalImage: null,
  imageLoaded: false,

  // Canvas transform
  zoom: 1,
  minZoom: 0.05,
  maxZoom: 10,
  offsetX: 0,
  offsetY: 0,

  // Pan
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  panOriginX: 0,
  panOriginY: 0,

  // Active tool
  activeTool: 'select',

  // Edit parameters
  params: {
    exposure: 0, brightness: 0, contrast: 0,
    highlights: 0, shadows: 0, saturation: 0,
    vibrance: 0, temperature: 0, tint: 0,
    sharpness: 0, noise_reduction: 0,
    vignette: 0, grain: 0,
  },

  // Undo history
  history: [],
  historyIndex: -1,
  maxHistory: 30,
};

// ===== Offscreen canvas for original pixel data =====
let offscreen    = null;
let offscreenCtx = null;

// ===== Init =====
function init() {
  loadImage(IMAGE_URL);
  bindEvents();
  bindSliders();
  bindTools();
  bindAccordion();
  bindTopbar();
  bindKeyboard();
}

// ===== Load Image =====
function loadImage(src) {
  canvasHint.textContent = 'Loading image...';
  canvasHint.style.opacity = '1';

  const img = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    state.originalImage = img;
    state.imageLoaded   = true;

    // Set canvas to image natural size
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Offscreen canvas stores original pixels
    offscreen        = document.createElement('canvas');
    offscreen.width  = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    offscreenCtx     = offscreen.getContext('2d');
    offscreenCtx.drawImage(img, 0, 0);

    // Draw and fit
    redraw();
    fitToScreen();
    pushHistory();

    canvasHint.textContent = 'Scroll to zoom · Drag to pan · Sliders to edit';
    setTimeout(() => {
      canvasHint.style.opacity = '0';
    }, 3000);

    drawHistogram();
  };

  img.onerror = () => {
    canvasHint.textContent = '⚠ Failed to load image';
  };

  img.src = src;
}

// ===== Redraw =====
// Clears the canvas and redraws with current transform + edits
function redraw() {
  if (!state.imageLoaded) return;

  // Resize canvas display to fill area
  const area = canvasArea.getBoundingClientRect();
  canvas.width  = area.width;
  canvas.height = area.height;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Checkerboard background (shows transparency)
  drawCheckerboard();

  // Apply pan + zoom transform
  ctx.translate(state.offsetX, state.offsetY);
  ctx.scale(state.zoom, state.zoom);

  // Draw edited image from offscreen
    //   const edited = getEditedImageData();
    //   ctx.putImageData(edited, 0, 0);
    const edited = getEditedImageData();
    const temp = document.createElement('canvas');
    temp.width = edited.width;
    temp.height = edited.height;
    temp.getContext('2d').putImageData(edited, 0, 0);

    ctx.drawImage(temp, 0, 0);

  ctx.restore();
}

// ===== Checkerboard (transparency indicator) =====
function drawCheckerboard() {
  const size = 12;
  for (let y = 0; y < canvas.height; y += size) {
    for (let x = 0; x < canvas.width; x += size) {
      ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#1a1a1e' : '#141418';
      ctx.fillRect(x, y, size, size);
    }
  }
}

// ===== Apply Edits to Pixel Data =====
function getEditedImageData() {
  // Start from original pixel data
  const src = offscreenCtx.getImageData(
    0, 0, offscreen.width, offscreen.height
  );
  const data = new Uint8ClampedArray(src.data);
  const p    = state.params;

  const brightness  = p.brightness  / 100 * 80;
  const exposure    = p.exposure    / 100 * 100;
  const contrast    = p.contrast    / 100;
  const saturation  = p.saturation  / 100;
  const temperature = p.temperature / 100 * 30;
  const tint        = p.tint        / 100 * 20;
  const highlights  = p.highlights  / 100 * 60;
  const shadows     = p.shadows     / 100 * 60;
  const vibrance    = p.vibrance    / 100;

  const contrastFactor = contrast !== 0
    ? (259 * (contrast * 100 + 255)) / (255 * (259 - contrast * 100))
    : 1;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Exposure
    r += exposure; g += exposure; b += exposure;

    // Brightness
    r += brightness; g += brightness; b += brightness;

    // Contrast
    if (contrast !== 0) {
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;
    }

    // Highlights (affect bright pixels)
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (highlights !== 0) {
      const hFactor = luma / 255;
      r += highlights * hFactor;
      g += highlights * hFactor;
      b += highlights * hFactor;
    }

    // Shadows (affect dark pixels)
    if (shadows !== 0) {
      const sFactor = 1 - luma / 255;
      r += shadows * sFactor;
      g += shadows * sFactor;
      b += shadows * sFactor;
    }

    // Temperature
    r += temperature;
    b -= temperature;

    // Tint
    g += tint;

    // Saturation
    if (saturation !== 0) {
      const avg = 0.299 * r + 0.587 * g + 0.114 * b;
      r = avg + (r - avg) * (1 + saturation);
      g = avg + (g - avg) * (1 + saturation);
      b = avg + (b - avg) * (1 + saturation);
    }

    // Vibrance (boosts less-saturated colours more)
    if (vibrance !== 0) {
      const max  = Math.max(r, g, b);
      const avg2 = (r + g + b) / 3;
      const vAmt = (max - avg2) / 255 * vibrance;
      r += (r - avg2) * vAmt;
      g += (g - avg2) * vAmt;
      b += (b - avg2) * vAmt;
    }

    // Clamp
    data[i]     = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  return new ImageData(data, offscreen.width, offscreen.height);
}

// ===== Fit to Screen =====
function fitToScreen() {
  if (!state.imageLoaded) return;

  const area    = canvasArea.getBoundingClientRect();
  const padding = 80;
  const scaleX  = (area.width  - padding) / offscreen.width;
  const scaleY  = (area.height - padding) / offscreen.height;
  state.zoom    = Math.min(scaleX, scaleY, 1);

  // Center the image
  state.offsetX = (area.width  - offscreen.width  * state.zoom) / 2;
  state.offsetY = (area.height - offscreen.height * state.zoom) / 2;

  updateZoomLabel();
  redraw();
}

// ===== Zoom to point =====
function zoomTo(newZoom, originX, originY) {
  newZoom = Math.max(state.minZoom, Math.min(state.maxZoom, newZoom));

  // Zoom toward mouse/origin point
  const ratio    = newZoom / state.zoom;
  state.offsetX  = originX - ratio * (originX - state.offsetX);
  state.offsetY  = originY - ratio * (originY - state.offsetY);
  state.zoom     = newZoom;

  updateZoomLabel();
  redraw();
}

function updateZoomLabel() {
  zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
}

// ===== Canvas coordinate helpers =====
function screenToCanvas(sx, sy) {
  return {
    x: (sx - state.offsetX) / state.zoom,
    y: (sy - state.offsetY) / state.zoom,
  };
}

// ===== History (undo/redo) =====
function pushHistory() {
  // Trim forward history
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push({ ...state.params });
  if (state.history.length > state.maxHistory) {
    state.history.shift();
  }
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  applyHistoryState(state.history[state.historyIndex]);
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  applyHistoryState(state.history[state.historyIndex]);
}

function applyHistoryState(params) {
  state.params = { ...params };
  syncSlidersToState();
  redraw();
  drawHistogram();
}

function updateHistoryButtons() {
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  if (btnUndo) btnUndo.disabled = state.historyIndex <= 0;
  if (btnRedo) btnRedo.disabled = state.historyIndex >= state.history.length - 1;
}

function syncSlidersToState() {
  document.querySelectorAll('.adj-slider').forEach(slider => {
    const param = slider.dataset.param;
    if (state.params[param] !== undefined) {
      slider.value = state.params[param];
      const valEl = slider.nextElementSibling;
      valEl.textContent = state.params[param];
      valEl.style.color = state.params[param] !== 0
        ? 'var(--accent)'
        : 'var(--text-muted)';
    }
  });
}

// ===== Bind Events =====
function bindEvents() {
  // Resize observer — redraw when canvas area resizes
  const ro = new ResizeObserver(() => {
    if (state.imageLoaded) redraw();
  });
  ro.observe(canvasArea);

  // ── Mouse wheel zoom ──
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect   = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta  = e.deltaY > 0 ? 0.9 : 1.1;
    zoomTo(state.zoom * delta, mouseX, mouseY);
  }, { passive: false });

  // ── Pan (middle mouse or space+drag) ──
  canvas.addEventListener('mousedown', e => {
    const isMiddle = e.button === 1;
    const isSpace  = state.spaceHeld;
    if (isMiddle || isSpace) {
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
      state.isPanning = false;
      canvas.style.cursor = state.spaceHeld ? 'grab' : 'crosshair';
    }
  });

  // ── Touch zoom (pinch) ──
  let lastPinchDist = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 2) lastPinchDist = getPinchDist(e);
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist  = getPinchDist(e);
      const ratio = dist / lastPinchDist;
      const rect  = canvas.getBoundingClientRect();
      const cx    = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy    = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      zoomTo(state.zoom * ratio, cx, cy);
      lastPinchDist = dist;
    }
  }, { passive: false });

  // ── Double click to zoom in ──
  canvas.addEventListener('dblclick', e => {
    const rect   = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const target = state.zoom < 1.5 ? 2 : 1;
    zoomTo(target, mouseX, mouseY);
  });
}

function getPinchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ===== Space to pan =====
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    state.spaceHeld         = true;
    canvas.style.cursor     = 'grab';
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    state.spaceHeld         = false;
    canvas.style.cursor     = 'crosshair';
  }
});

// ===== Bind Sliders =====
function bindSliders() {
  document.querySelectorAll('.adj-slider').forEach(slider => {
    const valEl = slider.nextElementSibling;

    slider.addEventListener('input', () => {
      const param = slider.dataset.param;
      const value = parseInt(slider.value);
      state.params[param] = value;
      valEl.textContent   = value;
      valEl.style.color   = value !== 0 ? 'var(--accent)' : 'var(--text-muted)';
      redraw();
      drawHistogram();
    });

    // Push to history on release
    slider.addEventListener('change', () => {
      pushHistory();
    });
  });
}

// ===== Bind Tools =====
function bindTools() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTool = btn.dataset.tool;

      const hints = {
        select: 'Scroll to zoom · Hold Space + drag to pan',
        crop:   'Crop tool — coming Day 10',
        rotate: 'Rotate tool — coming Day 10',
        flip:   'Flip tool — coming Day 10',
      };
      showHint(hints[state.activeTool] || '');
    });
  });
}

// ===== Bind Accordion =====
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

// ===== Bind Topbar =====
function bindTopbar() {
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;
    zoomTo(state.zoom * 1.25, cx, cy);
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;
    zoomTo(state.zoom * 0.8, cx, cy);
  });

  document.getElementById('btnFit').addEventListener('click', fitToScreen);

  document.getElementById('btnReset').addEventListener('click', () => {
    Object.keys(state.params).forEach(k => state.params[k] = 0);
    syncSlidersToState();
    redraw();
    drawHistogram();
    pushHistory();
    showHint('All edits reset');
  });

  // Before / After
  let showingOriginal = false;
  document.getElementById('btnBefore').addEventListener('click', () => {
    showingOriginal = !showingOriginal;
    const btn = document.getElementById('btnBefore');

    if (showingOriginal) {
      // Draw original without edits
      const area = canvasArea.getBoundingClientRect();
      canvas.width  = area.width;
      canvas.height = area.height;
      ctx.save();
      drawCheckerboard();
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

  // Undo/Redo buttons (if present)
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnRedo) btnRedo.addEventListener('click', redo);
}

// ===== Keyboard shortcuts =====
function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;

    // Undo: Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault(); undo();
    }
    // Redo: Ctrl+Shift+Z or Ctrl+Y
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault(); redo();
    }
    // Fit: 0
    if (e.key === '0') fitToScreen();
    // Zoom in/out: + -
    if (e.key === '+' || e.key === '=') {
      zoomTo(state.zoom * 1.25, canvas.width / 2, canvas.height / 2);
    }
    if (e.key === '-') {
      zoomTo(state.zoom * 0.8, canvas.width / 2, canvas.height / 2);
    }
    // Before/After: B
    if (e.key === 'b' || e.key === 'B') {
      document.getElementById('btnBefore').click();
    }
    // Reset: R
    if (e.key === 'r' || e.key === 'R') {
      document.getElementById('btnReset').click();
    }
    // Zoom to 100%: 1
    if (e.key === '1') {
      zoomTo(1, canvas.width / 2, canvas.height / 2);
    }
    // Zoom to 200%: 2
    if (e.key === '2') {
      zoomTo(2, canvas.width / 2, canvas.height / 2);
    }
  });
}

// ===== Histogram =====
function drawHistogram() {
  if (!state.imageLoaded) return;

  const hCanvas = document.getElementById('histogramCanvas');
  const hCtx    = hCanvas.getContext('2d');
  const edited  = getEditedImageData();
  const data    = edited.data;

  const rBins = new Array(256).fill(0);
  const gBins = new Array(256).fill(0);
  const bBins = new Array(256).fill(0);

  for (let i = 0; i < data.length; i += 4) {
    rBins[data[i]]++;
    gBins[data[i + 1]]++;
    bBins[data[i + 2]]++;
  }

  const max = Math.max(...rBins, ...gBins, ...bBins);
  const w   = hCanvas.width;
  const h   = hCanvas.height;

  hCtx.clearRect(0, 0, w, h);

  [
    [rBins, 'rgba(255, 80, 80, 0.55)'],
    [gBins, 'rgba(80, 200, 80, 0.55)'],
    [bBins, 'rgba(80, 140, 255, 0.55)'],
  ].forEach(([bins, color]) => {
    hCtx.beginPath();
    hCtx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
      hCtx.lineTo((i / 255) * w, h - (bins[i] / max) * h);
    }
    hCtx.lineTo(w, h);
    hCtx.closePath();
    hCtx.fillStyle = color;
    hCtx.fill();
  });
}

// ===== Show canvas hint =====
function showHint(msg) {
  canvasHint.textContent    = msg;
  canvasHint.style.opacity  = '1';
  clearTimeout(canvasHint._timer);
  canvasHint._timer = setTimeout(() => {
    canvasHint.style.opacity = '0';
  }, 2500);
}

// ===== Cursor style on canvas hint fade =====
canvasHint.style.transition = 'opacity 0.4s';

// ===== Start =====
init();