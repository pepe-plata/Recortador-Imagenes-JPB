/* =========================================================
   Image Cropper PWA - sin backend
   ========================================================= */

// ---------- Configuración de relaciones de aspecto ----------
const ASPECTS = [
  { label: 'Libre', value: null, free: true },
  { label: '1:1 (Cuadrada)', value: 1 },
  { group: 'Video' },
  { label: '3:4', value: 3/4 },
  { label: '4:3', value: 4/3 },
  { label: '9:16', value: 9/16 },
  { label: '16:9', value: 16/9 },
  { group: 'Fotografía' },
  { label: '4:6', value: 4/6 },
  { label: '5:7', value: 5/7 },
  { label: '8:10', value: 8/10 },
  { label: '8.5:11', value: 8.5/11 },
  { group: 'Hoja' },
  { label: '8.5:11 (Carta Vertical)', value: 8.5/11 },
  { label: '11:8.5 (Carta Horizontal)', value: 11/8.5 },
  { label: '8.5:14 (Oficio Vertical)', value: 8.5/14 },
  { label: '8.5:5.5 (Media Carta Vertical)', value: 8.5/5.5 },
  { label: '8.27:11.69 (A4 Vertical)', value: 8.27/11.69 },
  { label: '11.69:8.27 (A4 Horizontal)', value: 11.69/8.27 },
  { group: 'Instagram' },
  { label: 'Instagram Feed 4:5', value: 4/5 },
  { label: 'Instagram Stories/Reels 9:16', value: 9/16 },
  { group: 'Facebook' },
  { label: 'Facebook Post 1.91:1', value: 1.91 },
  { label: 'Facebook Stories 9:16', value: 9/16 },
  { label: 'Facebook Portada 16:9', value: 16/9 },
  { group: 'WhatsApp' },
  { label: 'WhatsApp Estado 9:16', value: 9/16 },
  { label: 'WhatsApp Perfil 1:1', value: 1 }
];

// ---------- Elementos del DOM ----------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvasWrap');
const placeholder = document.getElementById('placeholder');
const infoBadge = document.getElementById('infoBadge');
const fileInput = document.getElementById('fileInput');
const aspectSelect = document.getElementById('aspectSelect');
const formatSelect = document.getElementById('formatSelect');
const qualityRange = document.getElementById('qualityRange');
const qualityValue = document.getElementById('qualityValue');
const keepExif = document.getElementById('keepExif');
const btnOpen = document.getElementById('btnOpen');
const btnReset = document.getElementById('btnReset');
const btnSave = document.getElementById('btnSave');

// ---------- Estado global ----------
const state = {
  img: null,
  fileBuffer: null,
  fileName: 'imagen',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  minScale: 0.1,
  maxScale: 8,
  crop: { x: 0, y: 0, w: 100, h: 100 },
  aspect: null,             // null = libre (default)
  dragMode: null,
  dragStart: null,
  pointers: new Map(),
  lastPinchDist: 0,
  lastPinchMid: null,
};

let DPR = window.devicePixelRatio || 1;

// ---------- Inicialización ----------
function init() {
  populateAspects();
  setupCanvasSize();
  bindEvents();
  updateQualityVisibility();
  draw();
  registerSW();
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW error', err));
  }
}

function populateAspects() {
  ASPECTS.forEach(item => {
    if (item.group) {
      const og = document.createElement('optgroup');
      og.label = item.group;
      aspectSelect.appendChild(og);
      aspectSelect._lastGroup = og;
    } else {
      const opt = document.createElement('option');
      opt.value = item.free ? 'free' : String(item.value);
      opt.textContent = item.label;
      opt.dataset.label = item.label;
      opt.dataset.value = item.value;
      (aspectSelect._lastGroup || aspectSelect).appendChild(opt);
    }
  });
  // "Libre" al inicio y por defecto
  aspectSelect.value = 'free';
}

function setupCanvasSize() {
  const rect = canvasWrap.getBoundingClientRect();
  DPR = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * DPR);
  canvas.height = Math.floor(rect.height * DPR);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const viewW = rect.width;
  const viewH = rect.height;
  const size = Math.min(viewW, viewH) * 0.7;
  state.crop = { x: (viewW - size) / 2, y: (viewH - size) / 2, w: size, h: size };
  applyAspectToCrop(true);
}

window.addEventListener('resize', () => {
  setupCanvasSize();
  if (state.img) clampCropToImage();
  draw();
});

// ---------- Eventos ----------
function bindEvents() {
  btnOpen.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', onFileSelected);

  aspectSelect.addEventListener('change', () => {
    const opt = aspectSelect.selectedOptions[0];
    const raw = opt?.dataset?.value;
    state.aspect = (raw === '' || raw === 'null' || raw === 'undefined' || opt.value === 'free')
      ? null
      : parseFloat(raw);
    if (Number.isNaN(state.aspect)) state.aspect = null;
    applyAspectToCrop(true);
    clampCropToImage();
    draw();
  });

  formatSelect.addEventListener('change', updateQualityVisibility);
  qualityRange.addEventListener('input', () => {
    qualityValue.textContent = qualityRange.value + '%';
  });

  btnReset.addEventListener('click', () => {
    if (!state.img) return;
    resetView();
    draw();
  });

  btnSave.addEventListener('click', onSave);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', (e) => { if (e.buttons === 0) return; });

  canvas.addEventListener('wheel', onWheel, { passive: false });

  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function updateQualityVisibility() {
  const fmt = formatSelect.value;
  const show = fmt === 'image/jpeg' || fmt === 'image/webp' || fmt === 'image/avif';
  qualityRange.disabled = !show;
  qualityValue.style.opacity = show ? '1' : '0.4';
  qualityRange.style.opacity = show ? '1' : '0.4';
}

// ---------- Carga de imagen ----------
async function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  state.fileName = file.name.replace(/\.[^.]+$/, '') || 'imagen';

  try {
    state.fileBuffer = await file.arrayBuffer();
  } catch { state.fileBuffer = null; }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.img = img;
    URL.revokeObjectURL(url);
    placeholder.classList.add('hidden');
    resetView();
    draw();
    btnSave.disabled = false;
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('No se pudo cargar la imagen.');
  };
  img.src = url;
}

function resetView() {
  if (!state.img) return;
  const rect = canvasWrap.getBoundingClientRect();
  const viewW = rect.width;
  const viewH = rect.height;

  const scaleToFit = Math.min(viewW / state.img.width, viewH / state.img.height);
  state.scale = scaleToFit;
  state.minScale = scaleToFit * 0.2;
  state.maxScale = scaleToFit * 10;

  state.offsetX = (viewW - state.img.width * state.scale) / 2;
  state.offsetY = (viewH - state.img.height * state.scale) / 2;

  // Frame por defecto = 70% del área menor, centrado en la imagen
  const size = Math.min(viewW, viewH) * 0.7;
  state.crop = { x: (viewW - size) / 2, y: (viewH - size) / 2, w: size, h: size };
  applyAspectToCrop(false);
  clampCropToImage();
}

// ---------- Aspecto del frame ----------
function applyAspectToCrop(keepCenter = true) {
  if (state.aspect == null) return;
  const cx = state.crop.x + state.crop.w / 2;
  const cy = state.crop.y + state.crop.h / 2;
  const viewW = canvasWrap.clientWidth;
  const viewH = canvasWrap.clientHeight;

  let w = state.crop.w;
  let h = w / state.aspect;
  if (h > viewH * 0.9) { h = viewH * 0.9; w = h * state.aspect; }
  if (w > viewW * 0.9) { w = viewW * 0.9; h = w / state.aspect; }

  const nx = keepCenter ? cx - w / 2 : (viewW - w) / 2;
  const ny = keepCenter ? cy - h / 2 : (viewH - h) / 2;

  state.crop = { x: nx, y: ny, w, h };
}

/* =========================================================
   Límites de la IMAGEN (no del viewport)
   ========================================================= */
function getImageBounds() {
  if (!state.img) {
    const viewW = canvasWrap.clientWidth;
    const viewH = canvasWrap.clientHeight;
    return { minX: 0, maxX: viewW, minY: 0, maxY: viewH };
  }
  const viewW = canvasWrap.clientWidth;
  const viewH = canvasWrap.clientHeight;
  return {
    minX: Math.max(0, state.offsetX),
    maxX: Math.min(viewW, state.offsetX + state.img.width * state.scale),
    minY: Math.max(0, state.offsetY),
    maxY: Math.min(viewH, state.offsetY + state.img.height * state.scale)
  };
}

function clampCropToImage() {
  if (!state.img) return;

  const c = state.crop;
  const minSize = 40;
  const B = getImageBounds();

  const availW = B.maxX - B.minX;
  const availH = B.maxY - B.minY;

  if (availW <= 0 || availH <= 0) {
    c.w = 1;
    c.h = 1;
    c.x = B.minX;
    c.y = B.minY;
    return;
  }

  c.w = Math.min(c.w, availW);
  c.h = Math.min(c.h, availH);

  if (state.aspect != null) {
    let w = c.w, h = c.h;
    if (w / h > state.aspect) w = h * state.aspect;
    else h = w / state.aspect;
    if (w > availW) { w = availW; h = w / state.aspect; }
    if (h > availH) { h = availH; w = h * state.aspect; }
    c.w = w;
    c.h = h;
  }

  if (c.w < minSize) c.w = Math.min(minSize, availW);
  if (c.h < minSize) c.h = Math.min(minSize, availH);

  c.x = Math.max(B.minX, Math.min(c.x, B.maxX - c.w));
  c.y = Math.max(B.minY, Math.min(c.y, B.maxY - c.h));
}

// ---------- Dibujo ----------
function draw() {
  const viewW = canvasWrap.clientWidth;
  const viewH = canvasWrap.clientHeight;

  ctx.clearRect(0, 0, viewW, viewH);

  if (!state.img) {
    infoBadge.classList.add('hidden');
    return;
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    state.img,
    state.offsetX,
    state.offsetY,
    state.img.width * state.scale,
    state.img.height * state.scale
  );
  ctx.restore();

  const c = state.crop;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, viewW, c.y);
  ctx.fillRect(0, c.y + c.h, viewW, viewH - (c.y + c.h));
  ctx.fillRect(0, c.y, c.x, c.h);
  ctx.fillRect(c.x + c.w, c.y, viewW - (c.x + c.w), c.h);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    const x = c.x + (c.w * i) / 3;
    const y = c.y + (c.h * i) / 3;
    ctx.beginPath(); ctx.moveTo(x, c.y); ctx.lineTo(x, c.y + c.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.x, y); ctx.lineTo(c.x + c.w, y); ctx.stroke();
  }
  ctx.restore();

  drawHandles();
  updateInfoBadge();
}

function drawHandles() {
  const c = state.crop;
  const r = 7;
  const positions = [
    [c.x, c.y],
    [c.x + c.w / 2, c.y],
    [c.x + c.w, c.y],
    [c.x + c.w, c.y + c.h / 2],
    [c.x + c.w, c.y + c.h],
    [c.x + c.w / 2, c.y + c.h],
    [c.x, c.y + c.h],
    [c.x, c.y + c.h / 2],
  ];
  ctx.save();
  positions.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#2563eb';
    ctx.stroke();
  });
  ctx.restore();
}

function updateInfoBadge() {
  if (!state.img) { infoBadge.classList.add('hidden'); return; }
  const c = state.crop;
  const imgX = (c.x - state.offsetX) / state.scale;
  const imgY = (c.y - state.offsetY) / state.scale;
  const imgW = c.w / state.scale;
  const imgH = c.h / state.scale;

  const srcX = Math.max(0, imgX);
  const srcY = Math.max(0, imgY);
  const srcW = Math.min(state.img.width - srcX, imgW);
  const srcH = Math.min(state.img.height - srcY, imgH);

  const outW = Math.max(1, Math.round(srcW));
  const outH = Math.max(1, Math.round(srcH));

  infoBadge.textContent = `${outW} × ${outH} px`;
  infoBadge.classList.remove('hidden');
}

// ---------- Pointer events ----------
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function hitHandle(pos) {
  const c = state.crop;
  const hitR = 16;
  const handles = [
    { name: 'nw', x: c.x, y: c.y },
    { name: 'n',  x: c.x + c.w / 2, y: c.y },
    { name: 'ne', x: c.x + c.w, y: c.y },
    { name: 'e',  x: c.x + c.w, y: c.y + c.h / 2 },
    { name: 'se', x: c.x + c.w, y: c.y + c.h },
    { name: 's',  x: c.x + c.w / 2, y: c.y + c.h },
    { name: 'sw', x: c.x, y: c.y + c.h },
    { name: 'w',  x: c.x, y: c.y + c.h / 2 },
  ];
  for (const h of handles) {
    const dx = pos.x - h.x, dy = pos.y - h.y;
    if (dx * dx + dy * dy <= hitR * hitR) return h.name;
  }
  return null;
}

function isInsideCrop(pos) {
  const c = state.crop;
  return pos.x >= c.x && pos.x <= c.x + c.w && pos.y >= c.y && pos.y <= c.y + c.h;
}

function setCursor(mode) {
  const map = {
    nw: 'nwse-resize', se: 'nwse-resize',
    ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize',
    e: 'ew-resize', w: 'ew-resize',
    pan: 'grab'
  };
  canvas.style.cursor = map[mode] || 'default';
}

function onPointerDown(e) {
  if (!state.img) return;
  canvas.setPointerCapture(e.pointerId);
  state.pointers.set(e.pointerId, getCanvasPos(e));

  if (state.pointers.size === 2) {
    state.dragMode = null;
    const pts = [...state.pointers.values()];
    state.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    state.lastPinchMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    return;
  }

  const pos = getCanvasPos(e);
  const handle = hitHandle(pos);
  const c = state.crop;

  if (handle) {
    state.dragMode = handle;
    state.dragStart = { x: pos.x, y: pos.y, crop: { ...c } };
    setCursor(handle);
    return;
  }

  if (isInsideCrop(pos)) {
    state.dragMode = 'moveCrop';
    state.dragStart = { x: pos.x, y: pos.y, crop: { ...c } };
    canvas.style.cursor = 'move';
    return;
  }

  state.dragMode = 'pan';
  state.dragStart = { x: pos.x, y: pos.y, offsetX: state.offsetX, offsetY: state.offsetY };
  canvas.style.cursor = 'grabbing';
}

function onPointerMove(e) {
  if (!state.img) return;

  if (state.pointers.has(e.pointerId)) {
    state.pointers.set(e.pointerId, getCanvasPos(e));
  }

  if (state.pointers.size === 2) {
    const pts = [...state.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    if (state.lastPinchDist > 0) {
      const factor = dist / state.lastPinchDist;
      zoomAt(mid.x, mid.y, factor);
      if (state.lastPinchMid) {
        state.offsetX += mid.x - state.lastPinchMid.x;
        state.offsetY += mid.y - state.lastPinchMid.y;
      }
      clampCropToImage();
    }
    state.lastPinchDist = dist;
    state.lastPinchMid = mid;
    draw();
    return;
  }

  if (!state.dragMode) {
    const pos = getCanvasPos(e);
    const h = hitHandle(pos);
    if (h) setCursor(h);
    else if (isInsideCrop(pos)) canvas.style.cursor = 'move';
    else canvas.style.cursor = 'grab';
    return;
  }

  const pos = getCanvasPos(e);
  const dx = pos.x - state.dragStart.x;
  const dy = pos.y - state.dragStart.y;

  if (state.dragMode === 'pan') {
    state.offsetX = state.dragStart.offsetX + dx;
    state.offsetY = state.dragStart.offsetY + dy;
    clampCropToImage();
  } else if (state.dragMode === 'moveCrop') {
    state.crop.x = state.dragStart.crop.x + dx;
    state.crop.y = state.dragStart.crop.y + dy;
    clampCropToImage();
  } else {
    // Resize: resizeCrop ya respeta los límites de la imagen y
    // mantiene el lado opuesto fijo. NO llamamos clampCropToImage aquí.
    resizeCrop(state.dragMode, dx, dy);
  }
  draw();
}

function onPointerUp(e) {
  state.pointers.delete(e.pointerId);
  if (state.pointers.size < 2) {
    state.lastPinchDist = 0;
    state.lastPinchMid = null;
  }
  if (state.pointers.size === 0) {
    state.dragMode = null;
    state.dragStart = null;
  }
}

// ---------- Resize del crop ----------
/* =========================================================
   Resize del crop
   Los 8 handles funcionan. El lado opuesto al handle
   permanece fijo y el lado arrastrado se limita al área
   de la imagen.

   Partimos SIEMPRE del rectángulo original guardado en
   dragStart.crop para evitar encogimientos acumulativos.
   ========================================================= */
function resizeCrop(mode, dx, dy) {
  const start = state.dragStart.crop;
  const minSize = 40;
  const asp = state.aspect;
  const B = getImageBounds();

  // Esquinas y centros originales
  const origLeft   = start.x;
  const origTop    = start.y;
  const origRight  = start.x + start.w;
  const origBottom = start.y + start.h;
  const origCX     = origLeft + start.w / 2;
  const origCY     = origTop  + start.h / 2;

  // Posiciones tentativas partiendo del original
  let left   = origLeft;
  let right  = origRight;
  let top    = origTop;
  let bottom = origBottom;

  // Aplicar SOLO el desplazamiento correspondiente al handle
  switch (mode) {
    case 'nw': left  = origLeft  + dx; top    = origTop    + dy; break;
    case 'n':  top   = origTop   + dy; break;
    case 'ne': right = origRight + dx; top    = origTop    + dy; break;
    case 'e':  right = origRight + dx; break;
    case 'se': right = origRight + dx; bottom = origBottom + dy; break;
    case 's':  bottom = origBottom + dy; break;
    case 'sw': left  = origLeft  + dx; bottom = origBottom + dy; break;
    case 'w':  left  = origLeft  + dx; break;
  }

  // Normalizar orden
  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];

  // ---------- Restricción de aspecto ----------
  if (asp != null) {
    const isCorner = mode.length === 2;

    if (mode === 'n' || mode === 's') {
      // Alto manda; ancho derivado, centrado horizontalmente
      const h = Math.max(1, bottom - top);
      const w = h * asp;
      left  = origCX - w / 2;
      right = origCX + w / 2;
    } else if (mode === 'e' || mode === 'w') {
      // Ancho manda; alto derivado, centrado verticalmente
      const w = Math.max(1, right - left);
      const h = w / asp;
      top    = origCY - h / 2;
      bottom = origCY + h / 2;
    } else if (isCorner) {
      // Esquinas: partir del ancho/alto actual y ajustar al aspecto
      let w = right - left;
      let h = bottom - top;
      if (w / h > asp) h = w / asp;
      else w = h * asp;

      // Reanclar la esquina opuesta
      switch (mode) {
        case 'nw':
          right = origRight; bottom = origBottom;
          left = right - w;  top    = bottom - h;
          break;
        case 'ne':
          left  = origLeft;  bottom = origBottom;
          right = left + w;  top    = bottom - h;
          break;
        case 'sw':
          right = origRight; top    = origTop;
          left  = right - w; bottom = top + h;
          break;
        case 'se':
          left  = origLeft;  top    = origTop;
          right = left + w;  bottom = top + h;
          break;
      }
    }
  }

  // ---------- Clamp contra los límites de la imagen ----------
  if (mode.includes('w')) {
    if (left < B.minX) left = B.minX;
    if (right - left < minSize) left = right - minSize;
    if (left < B.minX) left = B.minX;
  }
  if (mode.includes('e')) {
    if (right > B.maxX) right = B.maxX;
    if (right - left < minSize) right = left + minSize;
    if (right > B.maxX) right = B.maxX;
  }
  if (mode.includes('n')) {
    if (top < B.minY) top = B.minY;
    if (bottom - top < minSize) top = bottom - minSize;
    if (top < B.minY) top = B.minY;
  }
  if (mode.includes('s')) {
    if (bottom > B.maxY) bottom = B.maxY;
    if (bottom - top < minSize) bottom = top + minSize;
    if (bottom > B.maxY) bottom = B.maxY;
  }

  // Ajuste final del complementario si el clamp desvió el aspecto
  if (asp != null) {
    if (mode === 'n' || mode === 's') {
      const h = bottom - top;
      const w = h * asp;
      left  = origCX - w / 2;
      right = origCX + w / 2;
    } else if (mode === 'e' || mode === 'w') {
      const w = right - left;
      const h = w / asp;
      top    = origCY - h / 2;
      bottom = origCY + h / 2;
    }
  }

  state.crop = { x: left, y: top, w: right - left, h: bottom - top };
}

// ---------- Zoom ----------
function onWheel(e) {
  if (!state.img) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomAt(pos.x, pos.y, factor);
  clampCropToImage();
  draw();
}

function zoomAt(cx, cy, factor) {
  const oldScale = state.scale;
  let newScale = oldScale * factor;
  newScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));
  if (newScale === oldScale) return;

  state.offsetX = cx - (cx - state.offsetX) * (newScale / oldScale);
  state.offsetY = cy - (cy - state.offsetY) * (newScale / oldScale);
  state.scale = newScale;
}

// ---------- Guardar imagen ----------
async function onSave() {
  if (!state.img) return;

  const fmt = formatSelect.value;
  const quality = parseInt(qualityRange.value, 10) / 100;

  const c = state.crop;
  let srcX = (c.x - state.offsetX) / state.scale;
  let srcY = (c.y - state.offsetY) / state.scale;
  let srcW = c.w / state.scale;
  let srcH = c.h / state.scale;

  const clampedX = Math.max(0, srcX);
  const clampedY = Math.max(0, srcY);
  const clampedW = Math.min(state.img.width - clampedX, srcW);
  const clampedH = Math.min(state.img.height - clampedY, srcH);

  if (clampedW <= 0 || clampedH <= 0) {
    alert('El área de recorte está fuera de la imagen.');
    return;
  }

  const outW = Math.round(clampedW);
  const outH = Math.round(clampedH);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const octx = outCanvas.getContext('2d');

  if (fmt === 'image/jpeg' || fmt === 'image/bmp') {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, outW, outH);
  }

  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(state.img, clampedX, clampedY, clampedW, clampedH, 0, 0, outW, outH);

  const type = await getSupportedMime(fmt);
  const useQuality = (type === 'image/jpeg' || type === 'image/webp' || type === 'image/avif');
  const q = useQuality ? quality : undefined;

  let blob = await new Promise(res => outCanvas.toBlob(res, type, q));

  if (!blob) {
    alert(`El formato ${fmt} no es soportado por este navegador. Se guardará como PNG.`);
    blob = await new Promise(res => outCanvas.toBlob(res, 'image/png'));
  }

  const actualType = blob.type || type;

  if (keepExif.checked && state.fileBuffer && (actualType === 'image/jpeg' || type === 'image/jpeg')) {
    try {
      const buffer = await blob.arrayBuffer();
      const newBuffer = copyExif(state.fileBuffer, buffer);
      blob = new Blob([newBuffer], { type: 'image/jpeg' });
    } catch (err) {
      console.warn('No se pudo copiar EXIF:', err);
    }
  }

  const extMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/bmp': 'bmp',
    'image/webp': 'webp',
    'image/avif': 'avif'
  };
  const ext = extMap[actualType] || extMap[type] || 'png';
  const suggestedName = `${state.fileName}_crop.${ext}`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: 'Imagen',
          accept: { [actualType]: ['.' + ext] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('Save picker falló, usando descarga:', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function getSupportedMime(mime) {
  const test = document.createElement('canvas');
  test.width = 1; test.height = 1;
  const t = await new Promise(res => test.toBlob(res, mime));
  return t && t.type === mime ? mime : 'image/png';
}

/* =========================================================
   EXIF copy
   ========================================================= */
function copyExif(srcBuffer, dstBuffer) {
  const src = new Uint8Array(srcBuffer);
  const dst = new Uint8Array(dstBuffer);

  if (src[0] !== 0xFF || src[1] !== 0xD8) return dstBuffer;
  if (dst[0] !== 0xFF || dst[1] !== 0xD8) return dstBuffer;

  let i = 2;
  let exifStart = -1, exifEnd = -1;
  while (i < src.length - 1) {
    if (src[i] !== 0xFF) { i++; continue; }
    const marker = src[i + 1];
    if (marker === 0xD8 || marker === 0xD9) { i += 2; continue; }
    if (marker >= 0xD0 && marker <= 0xD7) { i += 2; continue; }
    if (marker === 0xDA) break;
    const size = (src[i + 2] << 8) | src[i + 3];
    if (marker === 0xE1) {
      if (src[i + 4] === 0x45 && src[i + 5] === 0x78 &&
          src[i + 6] === 0x69 && src[i + 7] === 0x66 &&
          src[i + 8] === 0x00 && src[i + 9] === 0x00) {
        exifStart = i;
        exifEnd = i + 2 + size;
        break;
      }
    }
    i += 2 + size;
  }

  if (exifStart < 0) return dstBuffer;

  const cleaned = stripExif(dst);
  const exifSegment = src.slice(exifStart, exifEnd);

  const result = new Uint8Array(2 + exifSegment.length + (cleaned.length - 2));
  result[0] = 0xFF; result[1] = 0xD8;
  result.set(exifSegment, 2);
  result.set(cleaned.slice(2), 2 + exifSegment.length);
  return result.buffer;
}

function stripExif(dst) {
  const result = new Uint8Array(dst.length);
  result[0] = dst[0]; result[1] = dst[1];
  let outIdx = 2;
  let i = 2;
  while (i < dst.length - 1) {
    if (dst[i] !== 0xFF) { result[outIdx++] = dst[i++]; continue; }
    const marker = dst[i + 1];
    if (marker === 0xDA) {
      for (let k = i; k < dst.length; k++) result[outIdx++] = dst[k];
      break;
    }
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      result[outIdx++] = dst[i++];
      result[outIdx++] = dst[i++];
      continue;
    }
    const size = (dst[i + 2] << 8) | dst[i + 3];
    const isExif = marker === 0xE1 &&
      dst[i + 4] === 0x45 && dst[i + 5] === 0x78 &&
      dst[i + 6] === 0x69 && dst[i + 7] === 0x66;
    if (!isExif) {
      for (let k = i; k < i + 2 + size; k++) result[outIdx++] = dst[k];
    }
    i += 2 + size;
  }
  return result.slice(0, outIdx);
}

// ---------- Arranque ----------
init();