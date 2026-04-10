// ===== Pixloft Editor Engine — Day 10 =====

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
    brightness:      0,
    contrast:        0,
    exposure:        0,
    highlights:      0,
    shadows:         0,
    saturation:      0,
    vibrance:        0,
    temperature:     0,
    tint:            0,
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
    sharpness:       0,
    sharpen_radius:  1,
    sharpen_detail:  25,
    noise_reduction: 0,
    noise_detail:    50,
    noise_contrast:  0,
    vignette:        0,
    grain:           0,
    rotation:        0,
    flipH:           false,
    flipV:           false,
    crop:            null,
  },
};

let offscreen    = null;
let offscreenCtx = null;
let redrawTimer  = null;
let activeHueBand = 'all';
let rotSlider    = null;
let rotVal       = null;

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
  // Warn if image is very large — convolutions are slow on big images
    if (img.naturalWidth * img.naturalHeight > 4000000) {
        console.warn('Pixloft: image > 4MP — sharpening/noise reduction may be slow');
        showHint('Large image — Detail edits may be slow on this device');
  }
  
}

// ═══════════════════════════════════════════
//  HSL COLOUR SPACE
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
    if (t < 1/6) return p + (q-p)*6*t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q-p)*(2/3-t)*6;
    return p;
  };
  const q = l < 0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
  return {
    r: Math.round(hue2rgb(p,q,h+1/3)*255),
    g: Math.round(hue2rgb(p,q,h)*255),
    b: Math.round(hue2rgb(p,q,h-1/3)*255),
  };
}

const HUE_BANDS = {
  red:{ center:0,range:30 }, orange:{ center:30,range:25 },
  yellow:{ center:60,range:25 }, green:{ center:120,range:40 },
  aqua:{ center:180,range:30 }, blue:{ center:220,range:30 },
  purple:{ center:280,range:30 }, magenta:{ center:320,range:30 },
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
//  CONVOLUTION ENGINE
//  Applies a kernel to every pixel using
//  its neighbourhood of pixels
// ═══════════════════════════════════════════

// Apply a convolution kernel to ImageData
// kernel is a flat array, size is kernel width/height (must be odd)
function convolve(srcData, kernel, size) {
    const width  = srcData.width;
    const height = srcData.height;
    const src    = srcData.data;
    const dst    = new Uint8ClampedArray(src.length);
    const half   = Math.floor(size / 2);
    const kLen   = kernel.length;
  
    // Pre-compute kernel sum for normalisation
    let kSum = 0;
    for (let k = 0; k < kLen; k++) kSum += kernel[k];
    if (kSum === 0) kSum = 1; // avoid divide by zero
  
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0;
        let ki = 0;
  
        for (let ky = -half; ky <= half; ky++) {
          for (let kx = -half; kx <= half; kx++) {
            // Clamp to image edges (edge-extend)
            const px = Math.max(0, Math.min(width  - 1, x + kx));
            const py = Math.max(0, Math.min(height - 1, y + ky));
            const idx = (py * width + px) * 4;
            const w   = kernel[ki++];
            r += src[idx]     * w;
            g += src[idx + 1] * w;
            b += src[idx + 2] * w;
          }
        }
  
        const outIdx     = (y * width + x) * 4;
        dst[outIdx]      = Math.max(0, Math.min(255, r / kSum));
        dst[outIdx + 1]  = Math.max(0, Math.min(255, g / kSum));
        dst[outIdx + 2]  = Math.max(0, Math.min(255, b / kSum));
        dst[outIdx + 3]  = src[outIdx + 3]; // preserve alpha
      }
    }
    return new ImageData(dst, width, height);
  }
  
  // ── Build a Gaussian blur kernel ──
  // sigma controls spread — larger = more blur
  function buildGaussianKernel(size, sigma) {
    const kernel = [];
    const half   = Math.floor(size / 2);
    let total    = 0;
  
    for (let y = -half; y <= half; y++) {
      for (let x = -half; x <= half; x++) {
        const val = Math.exp(-(x*x + y*y) / (2 * sigma * sigma));
        kernel.push(val);
        total += val;
      }
    }
    // Normalise so kernel sums to 1
    return kernel.map(v => v / total);
  }
  
  // ── Unsharp mask sharpening ──
  // Sharpening = Original + amount * (Original - Blurred)
  // The "detail" param controls an edge threshold —
  // pixels below this threshold are not sharpened
  // (prevents boosting noise in smooth areas)
  function applySharpen(imageData, amount, radius, detailThreshold) {
    if (amount === 0) return imageData;
  
    const width  = imageData.width;
    const height = imageData.height;
  
    // Choose kernel size based on radius slider
    const kSize  = radius <= 1 ? 3 : radius <= 2 ? 5 : 7;
    const sigma  = radius * 0.8;
    const kernel = buildGaussianKernel(kSize, sigma);
  
    // Get blurred version
    const blurred = convolve(imageData, kernel, kSize);
  
    const src = imageData.data;
    const blr = blurred.data;
    const dst = new Uint8ClampedArray(src.length);
    const str = amount / 100; // 0–1 strength
  
    for (let i = 0; i < src.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const orig = src[i + c];
        const blur = blr[i + c];
        const diff = orig - blur; // edge signal
  
        // Only apply sharpening when edge signal exceeds detail threshold
        // This protects smooth areas from noise amplification
        const threshold = detailThreshold / 100 * 30;
        const edge      = Math.abs(diff) > threshold ? diff : 0;
  
        dst[i + c] = Math.max(0, Math.min(255, orig + str * edge * 2.5));
      }
      dst[i + 3] = src[i + 3];
    }
    return new ImageData(dst, width, height);
  }
  
  // ── Gaussian noise reduction ──
  // Blends original with blurred based on strength
  // The "detail" param controls how much local contrast
  // to preserve (edge-aware blending)
  function applyNoiseReduction(imageData, amount, detail, contrastBoost) {
    if (amount === 0) return imageData;
  
    const width  = imageData.width;
    const height = imageData.height;
    const str    = amount / 100; // 0–1
  
    // Choose blur kernel based on strength
    // More noise reduction = larger kernel
    const kSize  = amount < 30 ? 3 : amount < 60 ? 5 : 7;
    const sigma  = 1 + amount / 40;
    const kernel = buildGaussianKernel(kSize, sigma);
  
    const blurred = convolve(imageData, kernel, kSize);
  
    const src = imageData.data;
    const blr = blurred.data;
    const dst = new Uint8ClampedArray(src.length);
  
    // Detail preservation: areas with high local contrast
    // (edges) get less blurring so detail is preserved
    const detailStr = detail / 100;
  
    for (let i = 0; i < src.length; i += 4) {
      const rO = src[i], gO = src[i+1], bO = src[i+2];
      const rB = blr[i], gB = blr[i+1], bB = blr[i+2];
  
      // Local contrast (how "edgy" this pixel is)
      const localContrast = Math.abs(rO-rB) + Math.abs(gO-gB) + Math.abs(bO-bB);
  
      // Edge pixels blend less (preserve detail)
      const edgeFactor  = Math.min(1, localContrast / 60 * detailStr);
      const blendFactor = str * (1 - edgeFactor);
  
      let r = rO + (rB - rO) * blendFactor;
      let g = gO + (gB - gO) * blendFactor;
      let b = bO + (bB - bO) * blendFactor;
  
      // Optional: slight contrast boost after noise reduction
      // to compensate for the softening effect
      if (contrastBoost > 0) {
        const boost = contrastBoost / 100 * 0.3;
        const luma  = 0.299*r + 0.587*g + 0.114*b;
        r = luma + (r - luma) * (1 + boost);
        g = luma + (g - luma) * (1 + boost);
        b = luma + (b - luma) * (1 + boost);
      }
  
      dst[i]   = Math.max(0, Math.min(255, r));
      dst[i+1] = Math.max(0, Math.min(255, g));
      dst[i+2] = Math.max(0, Math.min(255, b));
      dst[i+3] = src[i+3];
    }
    return new ImageData(dst, width, height);
  }

// ═══════════════════════════════════════════
//  WHITE BALANCE ENGINE
// ═══════════════════════════════════════════
function sliderToKelvin(v) { return v >= 0 ? 6500 + v*55 : 6500 + v*45; }

function kelvinToRgbMultipliers(kelvin) {
  const t = kelvin / 100;
  const r = t <= 66 ? 1.0 : Math.max(0, Math.min(1, 329.698727446*Math.pow(t-60,-0.1332047592)/255));
  const g = t <= 66
    ? Math.max(0, Math.min(1, (99.4708025861*Math.log(t)-161.1195681661)/255))
    : Math.max(0, Math.min(1, 288.1221695283*Math.pow(t-60,-0.0755148492)/255));
  const b = t >= 66 ? 1.0 : t <= 19 ? 0.0
    : Math.max(0, Math.min(1, (138.5177312231*Math.log(t-10)-305.0447927307)/255));
  return { r, g, b };
}

function buildWbMatrix(temperature, tint) {
  if (temperature === 0 && tint === 0)
    return { r:1, g:1, b:1, label:{ r:'1.00', g:'1.00', b:'1.00' } };
  const ref = kelvinToRgbMultipliers(6500);
  const tgt = kelvinToRgbMultipliers(sliderToKelvin(temperature));
  let rM = tgt.r/ref.r, gM = tgt.g/ref.g, bM = tgt.b/ref.b;
  const ts = tint/100*0.25;
  gM += ts; rM -= ts*0.5; bM -= ts*0.5;
  const avg = (rM+gM+bM)/3;
  rM/=avg; gM/=avg; bM/=avg;
  return { r:rM, g:gM, b:bM, label:{ r:rM.toFixed(2), g:gM.toFixed(2), b:bM.toFixed(2) } };
}

function applyWbMatrix(r, g, b, m) {
  return {
    r: Math.max(0, Math.min(255, r*m.r)),
    g: Math.max(0, Math.min(255, g*m.g)),
    b: Math.max(0, Math.min(255, b*m.b)),
  };
}

function updateWbMatrixDisplay(matrix) {
  const grid = document.getElementById('wbMatrixGrid');
  if (!grid) return;
  const rEl = grid.querySelector('.wm-r');
  const gEl = grid.querySelector('.wm-g');
  const bEl = grid.querySelector('.wm-b');
  if (rEl) { rEl.textContent=`R×${matrix.label.r}`; rEl.style.color=matrix.r>1.01?'#ff8080':matrix.r<0.99?'#8080ff':'var(--text-muted)'; }
  if (gEl) { gEl.textContent=`G×${matrix.label.g}`; gEl.style.color=matrix.g>1.01?'#80cc80':matrix.g<0.99?'#cc80cc':'var(--text-muted)'; }
  if (bEl) { bEl.textContent=`B×${matrix.label.b}`; bEl.style.color=matrix.b>1.01?'#80aaff':matrix.b<0.99?'#ffaa80':'var(--text-muted)'; }
}

// ═══════════════════════════════════════════
//  CROP STATE
// ═══════════════════════════════════════════
const crop = {
  active:false, dragging:false, dragHandle:null,
  startX:0, startY:0, rect:{x:0,y:0,w:0,h:0}, aspectRatio:null,
};

function screenToImage(sx, sy) {
  return { x:(sx-state.offsetX)/state.zoom, y:(sy-state.offsetY)/state.zoom };
}
function imageToScreen(ix, iy) {
  return { x:ix*state.zoom+state.offsetX, y:iy*state.zoom+state.offsetY };
}
function clampCropRect(r) {
  const iw=offscreen.width, ih=offscreen.height;
  r.x=Math.max(0,Math.min(r.x,iw-2)); r.y=Math.max(0,Math.min(r.y,ih-2));
  r.w=Math.max(2,Math.min(r.w,iw-r.x)); r.h=Math.max(2,Math.min(r.h,ih-r.y));
  return r;
}
function enforceAspectRatio(r, anchor) {
  if (!crop.aspectRatio) return r;
  const newH = r.w/crop.aspectRatio;
  if (anchor==='tl'||anchor==='tr') r.h=newH;
  else { r.y=r.y+r.h-newH; r.h=newH; }
  return r;
}
function getCropHandles() {
  const {x,y,w,h}=crop.rect, s=imageToScreen(x,y), e=imageToScreen(x+w,y+h);
  const mx=(s.x+e.x)/2, my=(s.y+e.y)/2, hs=8;
  const H=(cx,cy,id)=>({id,x:cx-hs/2,y:cy-hs/2,w:hs,h:hs});
  return [
    H(s.x,s.y,'tl'),H(mx,s.y,'tc'),H(e.x,s.y,'tr'),
    H(s.x,my,'ml'),                 H(e.x,my,'mr'),
    H(s.x,e.y,'bl'),H(mx,e.y,'bc'),H(e.x,e.y,'br'),
  ];
}
function hitHandle(sx, sy) {
  for (const h of getCropHandles())
    if (sx>=h.x&&sx<=h.x+h.w&&sy>=h.y&&sy<=h.y+h.h) return h.id;
  return null;
}
function insideCropRect(sx, sy) {
  const {x,y,w,h}=crop.rect, s=imageToScreen(x,y), e=imageToScreen(x+w,y+h);
  return sx>s.x&&sx<e.x&&sy>s.y&&sy<e.y;
}

function drawCropOverlay() {
  if (!crop.active||crop.rect.w<2) return;
  const {x,y,w,h}=crop.rect, s=imageToScreen(x,y), e=imageToScreen(x+w,y+h);
  const sw=e.x-s.x, sh=e.y-s.y;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.55)';
  ctx.fillRect(0,0,canvas.width,s.y);
  ctx.fillRect(0,e.y,canvas.width,canvas.height-e.y);
  ctx.fillRect(0,s.y,s.x,sh);
  ctx.fillRect(e.x,s.y,canvas.width-e.x,sh);
  ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=1.5;
  ctx.strokeRect(s.x,s.y,sw,sh);
  ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=0.5;
  for (let i=1;i<3;i++) {
    ctx.beginPath(); ctx.moveTo(s.x+sw*i/3,s.y); ctx.lineTo(s.x+sw*i/3,e.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x,s.y+sh*i/3); ctx.lineTo(e.x,s.y+sh*i/3); ctx.stroke();
  }
  ctx.strokeStyle='#fff'; ctx.lineWidth=2.5;
  const ca=14;
  [[s.x,s.y,1,1],[e.x,s.y,-1,1],[s.x,e.y,1,-1],[e.x,e.y,-1,-1]].forEach(([cx,cy,dx,dy])=>{
    ctx.beginPath(); ctx.moveTo(cx+dx*ca,cy); ctx.lineTo(cx,cy); ctx.lineTo(cx,cy+dy*ca); ctx.stroke();
  });
  ctx.fillStyle='#fff'; ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=1;
  getCropHandles().forEach(h=>{ ctx.fillRect(h.x,h.y,h.w,h.h); ctx.strokeRect(h.x,h.y,h.w,h.h); });
  const label=`${Math.round(w)} × ${Math.round(h)}`;
  ctx.font='12px system-ui,sans-serif';
  const lw=ctx.measureText(label).width+12;
  ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(s.x,s.y-22,lw,18);
  ctx.fillStyle='#fff'; ctx.fillText(label,s.x+6,s.y-8);
  ctx.restore();
}

const HANDLE_CURSORS = {
  tl:'nw-resize',tc:'n-resize',tr:'ne-resize',
  ml:'w-resize',mr:'e-resize',
  bl:'sw-resize',bc:'s-resize',br:'se-resize',
};

function applyCrop() {
  if (!crop.active||crop.rect.w<2||crop.rect.h<2) return;
  const {x,y,w,h}=crop.rect;
  const nv=document.createElement('canvas');
  nv.width=Math.round(w); nv.height=Math.round(h);
  const nc=nv.getContext('2d');
  nc.drawImage(offscreen,Math.round(x),Math.round(y),Math.round(w),Math.round(h),0,0,Math.round(w),Math.round(h));
  offscreen=nv; offscreenCtx=nc;
  state.params.crop={x,y,w,h};
  deactivateCrop(); fitToScreen(); redraw(); pushHistory();
  showHint(`Cropped to ${Math.round(w)} × ${Math.round(h)}px`);
}

function deactivateCrop() {
  crop.active=false; crop.dragging=false; crop.rect={x:0,y:0,w:0,h:0};
  canvas.style.cursor='crosshair';
  const cc=document.getElementById('cropControls');
  if (cc) cc.style.display='none';
  const sel=document.querySelector('[data-tool="select"]');
  if (sel) sel.click();
  const cw=document.getElementById('cropW'), ch=document.getElementById('cropH');
  if (cw) cw.value=''; if (ch) ch.value='';
}

// ═══════════════════════════════════════════
//  ROTATE ENGINE
// ═══════════════════════════════════════════
function rotateCanvas90(degrees) {
  const cw=offscreen.width, ch=offscreen.height;
  const nw=(degrees===90||degrees===270)?ch:cw;
  const nh=(degrees===90||degrees===270)?cw:ch;
  const tmp=document.createElement('canvas');
  tmp.width=nw; tmp.height=nh;
  const tc=tmp.getContext('2d');
  tc.translate(nw/2,nh/2); tc.rotate(degrees*Math.PI/180);
  tc.drawImage(offscreen,-cw/2,-ch/2);
  offscreen=tmp; offscreenCtx=tc;
  fitToScreen(); redraw(); pushHistory(); showHint(`Rotated ${degrees}°`);
}

function applyFineRotation(degrees) { state.params.rotation=degrees; scheduleRedraw(); }

function flipCanvas(horizontal) {
  const tmp=document.createElement('canvas');
  tmp.width=offscreen.width; tmp.height=offscreen.height;
  const tc=tmp.getContext('2d');
  tc.translate(horizontal?offscreen.width:0,horizontal?0:offscreen.height);
  tc.scale(horizontal?-1:1,horizontal?1:-1);
  tc.drawImage(offscreen,0,0);
  offscreen=tmp; offscreenCtx=tc;
  fitToScreen(); redraw(); pushHistory();
  showHint(horizontal?'Flipped horizontal':'Flipped vertical');
}

// ═══════════════════════════════════════════
//  PIXEL PROCESSING (COMBINED)
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
  
    const cVal    = p.contrast;
    const cFactor = cVal !== 0
      ? (259 * (cVal + 255)) / (255 * (259 - cVal))
      : 1;
  
    // ── LUT (Brightness + Exposure + Contrast) ──
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
  
    // ── Per-pixel adjustments ──
    for (let i = 0; i < len; i += 4) {
  
      let r = lut[data[i]];
      let g = lut[data[i + 1]];
      let b = lut[data[i + 2]];
  
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  
      // Highlights
      if (highlights !== 0) {
        const w = Math.max(0, (luma - 128) / 127);
        r += highlights * w;
        g += highlights * w;
        b += highlights * w;
      }
  
      // Shadows
      if (shadows !== 0) {
        const w = Math.max(0, (128 - luma) / 128);
        r += shadows * w;
        g += shadows * w;
        b += shadows * w;
      }
  
      // White balance
      if (state._wbMatrix && (p.temperature !== 0 || p.tint !== 0)) {
        const wb = applyWbMatrix(r, g, b, state._wbMatrix);
        r = wb.r;
        g = wb.g;
        b = wb.b;
      }
  
      // Saturation
      if (saturation !== 0) {
        const grey = 0.299 * r + 0.587 * g + 0.114 * b;
        r = grey + (r - grey) * (1 + saturation);
        g = grey + (g - grey) * (1 + saturation);
        b = grey + (b - grey) * (1 + saturation);
      }
  
      // HSL
      if (hasHslEdits) {
        const res = applyHslToPixel(r, g, b, hslParams);
        r = res.r;
        g = res.g;
        b = res.b;
      }
  
      // Vibrance
      if (p.vibrance !== 0) {
        const res = applyVibrance(r, g, b, p.vibrance);
        r = res.r;
        g = res.g;
        b = res.b;
      }
  
      data[i]     = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }
  
    // ── Build intermediate ImageData ──
    let result = new ImageData(data, srcData.width, srcData.height);
  
    // ── Noise Reduction (before sharpening) ──
    if (p.noise_reduction > 0) {
      result = applyNoiseReduction(
        result,
        p.noise_reduction,
        p.noise_detail   ?? 50,
        p.noise_contrast ?? 0
      );
    }
  
    // ── Sharpening (last step) ──
    if (p.sharpness > 0) {
      result = applySharpen(
        result,
        p.sharpness,
        p.sharpen_radius ?? 1,
        p.sharpen_detail ?? 25
      );
    }
  
    return result;
  }

// ═══════════════════════════════════════════
//  REDRAW
// ═══════════════════════════════════════════
function redraw() {
  if (!state.imageLoaded) return;
  state._wbMatrix=buildWbMatrix(state.params.temperature,state.params.tint);
  updateWbMatrixDisplay(state._wbMatrix);
  const area=canvasArea.getBoundingClientRect();
  canvas.width=area.width; canvas.height=area.height;
  drawCheckerboard();
  ctx.save();
  const rotation=state.params.rotation||0;
  if (rotation!==0) {
    const cx=state.offsetX+(offscreen.width*state.zoom)/2;
    const cy=state.offsetY+(offscreen.height*state.zoom)/2;
    ctx.translate(cx,cy); ctx.rotate(rotation*Math.PI/180); ctx.translate(-cx,-cy);
  }
  ctx.translate(state.offsetX,state.offsetY); ctx.scale(state.zoom,state.zoom);
  const srcData=offscreenCtx.getImageData(0,0,offscreen.width,offscreen.height);
  const processed=processPixels(srcData);
  if (!state._tmpCanvas) { state._tmpCanvas=document.createElement('canvas'); state._tmpCtx=state._tmpCanvas.getContext('2d'); }
  state._tmpCanvas.width=offscreen.width; state._tmpCanvas.height=offscreen.height;
  state._tmpCtx.putImageData(processed,0,0);
  ctx.drawImage(state._tmpCanvas,0,0);
  ctx.restore();
  if (crop.active) drawCropOverlay();
}

function scheduleRedraw() { clearTimeout(redrawTimer); redrawTimer=setTimeout(redraw,8); }

function drawCheckerboard() {
  const size=14;
  for (let y=0;y<canvas.height;y+=size)
    for (let x=0;x<canvas.width;x+=size) {
      ctx.fillStyle=((x/size+y/size)%2===0)?'#1a1a1e':'#141418';
      ctx.fillRect(x,y,size,size);
    }
}

// ═══════════════════════════════════════════
//  FIT / ZOOM
// ═══════════════════════════════════════════
function fitToScreen() {
  if (!state.imageLoaded) return;
  const area=canvasArea.getBoundingClientRect(), pad=80;
  state.zoom=Math.min((area.width-pad)/offscreen.width,(area.height-pad)/offscreen.height,1);
  state.offsetX=(area.width-offscreen.width*state.zoom)/2;
  state.offsetY=(area.height-offscreen.height*state.zoom)/2;
  updateZoomLabel(); redraw();
}

function zoomTo(newZoom, originX, originY) {
  newZoom=Math.max(state.minZoom,Math.min(state.maxZoom,newZoom));
  const ratio=newZoom/state.zoom;
  state.offsetX=originX-ratio*(originX-state.offsetX);
  state.offsetY=originY-ratio*(originY-state.offsetY);
  state.zoom=newZoom; updateZoomLabel(); redraw();
}

function updateZoomLabel() { zoomLabel.textContent=Math.round(state.zoom*100)+'%'; }

// ═══════════════════════════════════════════
//  HISTOGRAM
// ═══════════════════════════════════════════
let histTimer=null;
function drawHistogram() { clearTimeout(histTimer); histTimer=setTimeout(_drawHistogram,60); }
function _drawHistogram() {
  if (!state.imageLoaded) return;
  const hCanvas=document.getElementById('histogramCanvas'); if (!hCanvas) return;
  const hCtx=hCanvas.getContext('2d'), w=hCanvas.width, h=hCanvas.height;
  const data=processPixels(offscreenCtx.getImageData(0,0,offscreen.width,offscreen.height)).data;
  const rB=new Uint32Array(256),gB=new Uint32Array(256),bB=new Uint32Array(256),lB=new Uint32Array(256);
  for (let i=0;i<data.length;i+=16) {
    rB[data[i]]++; gB[data[i+1]]++; bB[data[i+2]]++;
    lB[Math.round(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])]++;
  }
  const max=Math.max(...Array.from(rB),...Array.from(gB),...Array.from(bB),...Array.from(lB));
  hCtx.clearRect(0,0,w,h);
  [[lB,'rgba(255,255,255,0.12)'],[rB,'rgba(255,75,75,0.5)'],[gB,'rgba(75,200,75,0.5)'],[bB,'rgba(75,130,255,0.5)']].forEach(([bins,color])=>{
    hCtx.beginPath();
    for (let i=0;i<256;i++) { const x=(i/255)*w, y=h-(bins[i]/max)*(h-2); i===0?hCtx.moveTo(x,y):hCtx.lineTo(x,y); }
    hCtx.lineTo(w,h); hCtx.lineTo(0,h); hCtx.closePath(); hCtx.fillStyle=color; hCtx.fill();
  });
}

// ═══════════════════════════════════════════
//  SLIDER BINDING
// ═══════════════════════════════════════════
function bindSliders() {
  document.querySelectorAll('.adj-slider:not(.hsl-slider)').forEach(slider=>{
    const valEl=slider.nextElementSibling, row=slider.closest('.slider-row');
    slider.addEventListener('input',()=>{
      const param=slider.dataset.param; if (!param) return;
      const value=parseInt(slider.value); state.params[param]=value;
      valEl.textContent=value>0?`+${value}`:`${value}`;
      valEl.style.color=value!==0?'var(--accent)':'var(--text-muted)';
      row.classList.toggle('slider-row--active',value!==0);
      updateSliderTrack(slider); scheduleRedraw(); drawHistogram();
    });
    slider.addEventListener('change',pushHistory);
    const label=row.querySelector('label');
    if (label) {
      label.style.cursor='pointer'; label.title='Double-click to reset';
      label.addEventListener('dblclick',()=>{
        slider.value=0; state.params[slider.dataset.param]=0;
        valEl.textContent='0'; valEl.style.color='var(--text-muted)';
        row.classList.remove('slider-row--active'); updateSliderTrack(slider);
        scheduleRedraw(); drawHistogram(); pushHistory();
      });
    }
  });
}

function updateSliderTrack(slider) {
  const min=parseInt(slider.min), max=parseInt(slider.max), val=parseInt(slider.value);
  if (min<0) {
    const center=(0-min)/(max-min)*100, pos=(val-min)/(max-min)*100;
    const left=Math.min(center,pos), width=Math.abs(pos-center);
    slider.style.background=`linear-gradient(to right,var(--bg-3) 0%,var(--bg-3) ${left}%,var(--accent) ${left}%,var(--accent) ${left+width}%,var(--bg-3) ${left+width}%,var(--bg-3) 100%)`;
  } else {
    const pct=max>0?(val/max)*100:0;
    slider.style.background=`linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--bg-3) ${pct}%,var(--bg-3) 100%)`;
  }
}

function initSliderTracks() { document.querySelectorAll('.adj-slider').forEach(updateSliderTrack); }

// ═══════════════════════════════════════════
//  HSL TABS
// ═══════════════════════════════════════════
function bindHslTabs() {
  const tabs=document.querySelectorAll('.hsl-tab'), sliders=document.querySelectorAll('.hsl-slider');
  tabs.forEach(tab=>{
    tab.addEventListener('click',()=>{
      tabs.forEach(t=>t.classList.remove('active')); tab.classList.add('active');
      activeHueBand=tab.dataset.hue;
      if (activeHueBand==='all') {
        sliders.forEach(s=>{ s.value=0; s.nextElementSibling.textContent='0'; s.nextElementSibling.style.color='var(--text-muted)'; updateSliderTrack(s); });
      } else {
        const band=state.params.hsl[activeHueBand];
        sliders.forEach(s=>{ const key=s.dataset.hsl, value=band[key]; s.value=value; s.nextElementSibling.textContent=value>0?`+${value}`:`${value}`; s.nextElementSibling.style.color=value!==0?'var(--accent)':'var(--text-muted)'; updateSliderTrack(s); });
      }
    });
  });
  sliders.forEach(slider=>{
    const valEl=slider.nextElementSibling;
    slider.addEventListener('input',()=>{
      const key=slider.dataset.hsl, value=parseInt(slider.value);
      if (activeHueBand==='all') Object.keys(state.params.hsl).forEach(b=>{ state.params.hsl[b][key]=value; });
      else state.params.hsl[activeHueBand][key]=value;
      valEl.textContent=value>0?`+${value}`:`${value}`; valEl.style.color=value!==0?'var(--accent)':'var(--text-muted)';
      updateSliderTrack(slider); updateHslDots(); scheduleRedraw(); drawHistogram();
    });
    slider.addEventListener('change',pushHistory);
    const label=slider.closest('.slider-row')?.querySelector('label');
    if (label) {
      label.style.cursor='pointer'; label.title='Double-click to reset';
      label.addEventListener('dblclick',()=>{
        const key=slider.dataset.hsl; slider.value=0; valEl.textContent='0'; valEl.style.color='var(--text-muted)';
        if (activeHueBand==='all') Object.keys(state.params.hsl).forEach(b=>{ state.params.hsl[b][key]=0; });
        else state.params.hsl[activeHueBand][key]=0;
        updateSliderTrack(slider); updateHslDots(); scheduleRedraw(); drawHistogram(); pushHistory();
      });
    }
  });
}

function updateHslDots() {
  document.querySelectorAll('.hsl-dot').forEach(dot=>{
    const p=state.params.hsl[dot.dataset.hue];
    dot.classList.toggle('hsl-dot--active',p.hue!==0||p.sat!==0||p.lum!==0);
  });
}

// ═══════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════
function pushHistory() {
  state.history=state.history.slice(0,state.historyIndex+1);
  state.history.push({...state.params,hsl:JSON.parse(JSON.stringify(state.params.hsl))});
  if (state.history.length>state.maxHistory) state.history.shift();
  state.historyIndex=state.history.length-1; updateHistoryBtns();
}
function undo() { if (state.historyIndex<=0) return; state.historyIndex--; restoreHistory(state.history[state.historyIndex]); }
function redo() { if (state.historyIndex>=state.history.length-1) return; state.historyIndex++; restoreHistory(state.history[state.historyIndex]); }
function restoreHistory(params) {
  state.params={...params,hsl:JSON.parse(JSON.stringify(params.hsl))};
  syncSliders(); updateHslDots(); redraw(); drawHistogram(); updateHistoryBtns();
}
function syncSliders() {
  document.querySelectorAll('.adj-slider:not(.hsl-slider)').forEach(slider=>{
    const param=slider.dataset.param; if (!param||state.params[param]===undefined) return;
    const value=state.params[param]; slider.value=value;
    const valEl=slider.nextElementSibling;
    valEl.textContent=value>0?`+${value}`:`${value}`; valEl.style.color=value!==0?'var(--accent)':'var(--text-muted)';
    slider.closest('.slider-row').classList.toggle('slider-row--active',value!==0); updateSliderTrack(slider);
  });
  if (rotSlider) { rotSlider.value=state.params.rotation||0; if (rotVal) rotVal.textContent=`${state.params.rotation||0}°`; updateSliderTrack(rotSlider); }
  if (activeHueBand!=='all') {
    const band=state.params.hsl[activeHueBand];
    document.querySelectorAll('.hsl-slider').forEach(s=>{
      const key=s.dataset.hsl, value=band[key]; s.value=value;
      s.nextElementSibling.textContent=value>0?`+${value}`:`${value}`;
      s.nextElementSibling.style.color=value!==0?'var(--accent)':'var(--text-muted)'; updateSliderTrack(s);
    });
  }
}
function updateHistoryBtns() {
  const u=document.getElementById('btnUndo'), r=document.getElementById('btnRedo');
  if (u) u.disabled=state.historyIndex<=0;
  if (r) r.disabled=state.historyIndex>=state.history.length-1;
}

// ═══════════════════════════════════════════
//  CANVAS EVENTS
// ═══════════════════════════════════════════
function bindCanvasEvents() {
  new ResizeObserver(()=>{ if (state.imageLoaded) redraw(); }).observe(canvasArea);
  canvas.addEventListener('wheel',e=>{
    e.preventDefault(); const rect=canvas.getBoundingClientRect();
    zoomTo(state.zoom*(e.deltaY>0?0.9:1.1),e.clientX-rect.left,e.clientY-rect.top);
  },{passive:false});

  canvas.addEventListener('mousedown',e=>{
    const rect=canvas.getBoundingClientRect(), sx=e.clientX-rect.left, sy=e.clientY-rect.top;
    if (crop.active) {
      const handle=hitHandle(sx,sy);
      if (handle) { crop.dragging=true; crop.dragHandle=handle; crop.startX=sx; crop.startY=sy; crop._origRect={...crop.rect}; return; }
      if (insideCropRect(sx,sy)) { crop.dragging=true; crop.dragHandle='move'; crop.startX=sx; crop.startY=sy; crop._origRect={...crop.rect}; canvas.style.cursor='move'; return; }
      const imgPt=screenToImage(sx,sy); crop.dragging=true; crop.dragHandle='new'; crop.startX=sx; crop.startY=sy; crop._startImgPt=imgPt; crop.rect={x:imgPt.x,y:imgPt.y,w:0,h:0}; return;
    }
    if (e.button===1||state.spaceHeld) { e.preventDefault(); state.isPanning=true; state.panStartX=e.clientX; state.panStartY=e.clientY; state.panOriginX=state.offsetX; state.panOriginY=state.offsetY; canvas.style.cursor='grabbing'; }
  });

  window.addEventListener('mousemove',e=>{
    const rect=canvas.getBoundingClientRect(), sx=e.clientX-rect.left, sy=e.clientY-rect.top;
    if (crop.active&&crop.dragging) {
      const dx=sx-crop.startX, dy=sy-crop.startY, dxI=dx/state.zoom, dyI=dy/state.zoom;
      const h=crop.dragHandle; let r={...crop._origRect};
      if (h==='new') { const ip=screenToImage(sx,sy); r.x=Math.min(crop._startImgPt.x,ip.x); r.y=Math.min(crop._startImgPt.y,ip.y); r.w=Math.abs(ip.x-crop._startImgPt.x); r.h=Math.abs(ip.y-crop._startImgPt.y); if (crop.aspectRatio) enforceAspectRatio(r,'tl'); }
      else if (h==='move') { r.x+=dxI; r.y+=dyI; }
      else { if (h.includes('r')) r.w=Math.max(10,r.w+dxI); if (h.includes('l')) { r.x+=dxI; r.w=Math.max(10,r.w-dxI); } if (h.includes('b')) r.h=Math.max(10,r.h+dyI); if (h.includes('t')) { r.y+=dyI; r.h=Math.max(10,r.h-dyI); } if (crop.aspectRatio) enforceAspectRatio(r,h.length===2?h:'tl'); }
      crop.rect=clampCropRect(r);
      const cw=document.getElementById('cropW'), ch=document.getElementById('cropH');
      if (cw) cw.value=Math.round(crop.rect.w); if (ch) ch.value=Math.round(crop.rect.h);
      redraw(); return;
    }
    if (crop.active&&!crop.dragging) {
      const handle=hitHandle(sx,sy);
      canvas.style.cursor=handle?(HANDLE_CURSORS[handle]||'pointer'):insideCropRect(sx,sy)?'move':'crosshair';
    }
    if (state.isPanning) { state.offsetX=state.panOriginX+(e.clientX-state.panStartX); state.offsetY=state.panOriginY+(e.clientY-state.panStartY); redraw(); }
  });

  window.addEventListener('mouseup',()=>{
    if (crop.active&&crop.dragging) {
      crop.dragging=false; crop.dragHandle=null;
      if (crop.rect.w<0) { crop.rect.x+=crop.rect.w; crop.rect.w=-crop.rect.w; }
      if (crop.rect.h<0) { crop.rect.y+=crop.rect.h; crop.rect.h=-crop.rect.h; }
      crop.rect=clampCropRect(crop.rect); redraw(); return;
    }
    if (state.isPanning) { state.isPanning=false; canvas.style.cursor=state.spaceHeld?'grab':'crosshair'; }
  });

  let lastPinch=null;
  canvas.addEventListener('touchstart',e=>{ if (e.touches.length===2) lastPinch=pinchDist(e); },{passive:true});
  canvas.addEventListener('touchmove',e=>{
    if (e.touches.length!==2) return; e.preventDefault();
    const d=pinchDist(e), rect=canvas.getBoundingClientRect();
    const cx=(e.touches[0].clientX+e.touches[1].clientX)/2-rect.left;
    const cy=(e.touches[0].clientY+e.touches[1].clientY)/2-rect.top;
    zoomTo(state.zoom*d/lastPinch,cx,cy); lastPinch=d;
  },{passive:false});
  canvas.addEventListener('dblclick',e=>{ if (crop.active) return; const rect=canvas.getBoundingClientRect(); zoomTo(state.zoom<1.5?2:1,e.clientX-rect.left,e.clientY-rect.top); });
}

function pinchDist(e) { const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY; return Math.sqrt(dx*dx+dy*dy); }

window.addEventListener('keydown',e=>{ if (e.code==='Space'&&e.target.tagName!=='INPUT') { e.preventDefault(); state.spaceHeld=true; canvas.style.cursor='grab'; } });
window.addEventListener('keyup',e=>{ if (e.code==='Space') { state.spaceHeld=false; canvas.style.cursor='crosshair'; } });

// ═══════════════════════════════════════════
//  TOOLS
// ═══════════════════════════════════════════
function bindTools() {
  document.querySelectorAll('.tool-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      state.activeTool=btn.dataset.tool;
      const cc=document.getElementById('cropControls'), rc=document.getElementById('rotateControls');
      if (cc) cc.style.display='none'; if (rc) rc.style.display='none';
      if (state.activeTool==='crop') { if (cc) cc.style.display='block'; crop.active=true; canvas.style.cursor='crosshair'; showHint('Draw crop area · Drag handles to resize'); }
      else if (state.activeTool==='rotate') { if (rc) rc.style.display='block'; if (crop.active) deactivateCrop(); showHint('Rotate or flip the image'); }
      else { if (crop.active) deactivateCrop(); canvas.style.cursor='crosshair'; }
    });
  });

  document.querySelectorAll('.crop-ratio').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.crop-ratio').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      const ratio=btn.dataset.ratio; crop.aspectRatio=ratio==='free'?null:(()=>{ const p=ratio.split(':'); return parseInt(p[0])/parseInt(p[1]); })();
      if (crop.rect.w>0) { crop.rect=clampCropRect(enforceAspectRatio({...crop.rect},'tl')); const cw=document.getElementById('cropW'), ch=document.getElementById('cropH'); if (cw) cw.value=Math.round(crop.rect.w); if (ch) ch.value=Math.round(crop.rect.h); redraw(); }
    });
  });

  const cwEl=document.getElementById('cropW'), chEl=document.getElementById('cropH');
  if (cwEl) cwEl.addEventListener('change',e=>{ const w=parseInt(e.target.value); if (!w||w<1) return; crop.rect.w=Math.min(w,offscreen.width-crop.rect.x); if (crop.aspectRatio) crop.rect.h=crop.rect.w/crop.aspectRatio; if (chEl) chEl.value=Math.round(crop.rect.h); crop.rect=clampCropRect(crop.rect); redraw(); });
  if (chEl) chEl.addEventListener('change',e=>{ const h=parseInt(e.target.value); if (!h||h<1) return; crop.rect.h=Math.min(h,offscreen.height-crop.rect.y); if (crop.aspectRatio) crop.rect.w=crop.rect.h*crop.aspectRatio; if (cwEl) cwEl.value=Math.round(crop.rect.w); crop.rect=clampCropRect(crop.rect); redraw(); });

  const btnAC=document.getElementById('btnApplyCrop'), btnCC=document.getElementById('btnCancelCrop');
  if (btnAC) btnAC.addEventListener('click',applyCrop);
  if (btnCC) btnCC.addEventListener('click',deactivateCrop);

  const bCCW=document.getElementById('btnRotateCCW'), bCW=document.getElementById('btnRotateCW');
  const bFH=document.getElementById('btnFlipH'), bFV=document.getElementById('btnFlipV');
  if (bCCW) bCCW.addEventListener('click',()=>rotateCanvas90(270));
  if (bCW)  bCW.addEventListener('click', ()=>rotateCanvas90(90));
  if (bFH)  bFH.addEventListener('click', ()=>flipCanvas(true));
  if (bFV)  bFV.addEventListener('click', ()=>flipCanvas(false));

  // Module-level rotSlider / rotVal assigned here
  rotSlider=document.getElementById('rotateSlider');
  rotVal=document.getElementById('rotateVal');
  if (rotSlider) {
    rotSlider.addEventListener('input',()=>{ const deg=parseFloat(rotSlider.value); if (rotVal) rotVal.textContent=`${deg}°`; updateSliderTrack(rotSlider); applyFineRotation(deg); });
    rotSlider.addEventListener('change',pushHistory);
  }

  const btnRT=document.getElementById('btnResetTransform');
  if (btnRT) btnRT.addEventListener('click',()=>{
    state.params.rotation=0;
    if (rotSlider) { rotSlider.value=0; updateSliderTrack(rotSlider); }
    if (rotVal) rotVal.textContent='0°';
    redraw(); pushHistory(); showHint('Transform reset');
  });
}

// ═══════════════════════════════════════════
//  ACCORDION
// ═══════════════════════════════════════════
function bindAccordion() {
  document.querySelectorAll('.accordion-header').forEach(header=>{
    header.addEventListener('click',()=>{
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
    Object.keys(state.params).forEach(k=>{
      if (k==='hsl') return;
      if (k==='flipH'||k==='flipV') { state.params[k]=false; return; }
      if (k==='crop') { state.params[k]=null; return; }
      state.params[k]=0;
    });
    Object.keys(state.params.hsl).forEach(band=>{ state.params.hsl[band]={hue:0,sat:0,lum:0}; });
    syncSliders(); updateHslDots();
    document.querySelectorAll('.hsl-slider').forEach(s=>{ s.value=0; s.nextElementSibling.textContent='0'; s.nextElementSibling.style.color='var(--text-muted)'; updateSliderTrack(s); });
    if (rotSlider) { rotSlider.value=0; updateSliderTrack(rotSlider); }
    if (rotVal) rotVal.textContent='0°';
    redraw(); drawHistogram(); pushHistory(); showHint('All edits reset ↺');
  });

  let showingBefore=false;
  document.getElementById('btnBefore').addEventListener('click',()=>{
    showingBefore=!showingBefore;
    const btn=document.getElementById('btnBefore');
    if (showingBefore) {
      const area=canvasArea.getBoundingClientRect(); canvas.width=area.width; canvas.height=area.height;
      drawCheckerboard(); ctx.save(); ctx.translate(state.offsetX,state.offsetY); ctx.scale(state.zoom,state.zoom); ctx.drawImage(state.originalImage,0,0); ctx.restore();
      btn.classList.add('active'); btn.textContent='◨ After';
    } else { redraw(); btn.classList.remove('active'); btn.textContent='◧ Before'; }
  });

  document.getElementById('btnExport').addEventListener('click',()=>showHint('Export coming Day 16 ✦'));
}

// ═══════════════════════════════════════════
//  KEYBOARD
// ═══════════════════════════════════════════
function bindKeyboard() {
  document.addEventListener('keydown',e=>{
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
  document.querySelectorAll('.wb-preset').forEach(btn=>{
    btn.addEventListener('click',()=>{
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
let hintTimer=null;
function showHint(msg) { canvasHint.textContent=msg; canvasHint.style.opacity='1'; clearTimeout(hintTimer); hintTimer=setTimeout(()=>{ canvasHint.style.opacity='0'; },2500); }
canvasHint.style.transition='opacity 0.4s';

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
init();
initSliderTracks();