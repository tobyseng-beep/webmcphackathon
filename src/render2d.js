// Canvas renderer for the 2D grapher. Read-only with respect to state: it
// renders whatever the store holds, and routes pan/zoom back through
// store.setViewport so the agent sees the same viewport the student does.

import { getState, scope, setViewport } from './store.js';

let canvas, ctx, dpr = 1;

export function initRender2D(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  attachInteraction();
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  draw();
}

function dims() {
  return { W: canvas.width / dpr, H: canvas.height / dpr };
}

function transforms() {
  const { xmin, xmax, ymin, ymax } = getState().viewport;
  const { W, H } = dims();
  return {
    toPx: (x) => ((x - xmin) / (xmax - xmin)) * W,
    toPy: (y) => H - ((y - ymin) / (ymax - ymin)) * H,
    toX: (px) => xmin + (px / W) * (xmax - xmin),
    toY: (py) => ymin + ((H - py) / H) * (ymax - ymin),
    W, H, xmin, xmax, ymin, ymax,
  };
}

function niceStep(span, target) {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return mult * mag;
}

function fmt(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (step < 1 ? 0 : 0));
  return Math.abs(v) < step / 1000 ? '0' : v.toFixed(Math.min(6, decimals));
}

function drawGrid(t) {
  const { W, H, xmin, xmax, ymin, ymax, toPx, toPy } = t;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const stepX = niceStep(xmax - xmin, Math.max(4, W / 90));
  const stepY = niceStep(ymax - ymin, Math.max(4, H / 70));

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#eef1f5';
  ctx.beginPath();
  for (let x = Math.ceil(xmin / (stepX / 5)) * (stepX / 5); x <= xmax; x += stepX / 5) {
    const px = Math.round(toPx(x)) + 0.5;
    ctx.moveTo(px, 0); ctx.lineTo(px, H);
  }
  for (let y = Math.ceil(ymin / (stepY / 5)) * (stepY / 5); y <= ymax; y += stepY / 5) {
    const py = Math.round(toPy(y)) + 0.5;
    ctx.moveTo(0, py); ctx.lineTo(W, py);
  }
  ctx.stroke();

  ctx.strokeStyle = '#dbe1ea';
  ctx.beginPath();
  for (let x = Math.ceil(xmin / stepX) * stepX; x <= xmax; x += stepX) {
    const px = Math.round(toPx(x)) + 0.5;
    ctx.moveTo(px, 0); ctx.lineTo(px, H);
  }
  for (let y = Math.ceil(ymin / stepY) * stepY; y <= ymax; y += stepY) {
    const py = Math.round(toPy(y)) + 0.5;
    ctx.moveTo(0, py); ctx.lineTo(W, py);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = '#8b96a5';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const y0 = Math.round(toPy(0)) + 0.5, x0 = Math.round(toPx(0)) + 0.5;
  if (0 >= ymin && 0 <= ymax) { ctx.moveTo(0, y0); ctx.lineTo(W, y0); }
  if (0 >= xmin && 0 <= xmax) { ctx.moveTo(x0, 0); ctx.lineTo(x0, H); }
  ctx.stroke();

  // Tick labels
  ctx.fillStyle = '#5b6673';
  ctx.font = `${11}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const labelY = Math.min(H - 14, Math.max(2, toPy(0) + 4));
  for (let x = Math.ceil(xmin / stepX) * stepX; x <= xmax; x += stepX) {
    if (Math.abs(x) < stepX / 1000) continue;
    ctx.fillText(fmt(x, stepX), toPx(x), labelY);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const labelX = Math.min(W - 4, Math.max(24, toPx(0) - 6));
  for (let y = Math.ceil(ymin / stepY) * stepY; y <= ymax; y += stepY) {
    if (Math.abs(y) < stepY / 1000) continue;
    ctx.fillText(fmt(y, stepY), labelX, toPy(y));
  }
}

function evaluator(expr, varName) {
  const base = scope();
  return (v) => {
    try {
      base[varName] = v;
      const out = expr.fn.evaluate(base);
      return typeof out === 'number' ? out : Number(out);
    } catch { return NaN; }
  };
}

function strokePolyline(pts, t) {
  const { H } = t;
  ctx.beginPath();
  let drawing = false;
  let prev = null;
  for (const p of pts) {
    if (!p) { drawing = false; prev = null; continue; }
    const [px, py] = p;
    if (!Number.isFinite(py)) { drawing = false; prev = null; continue; }
    // Break the path across a pole instead of drawing a vertical wall.
    if (prev && Math.abs(py - prev[1]) > H * 1.5) { drawing = false; prev = null; }
    if (!drawing) { ctx.moveTo(px, py); drawing = true; } else { ctx.lineTo(px, py); }
    prev = [px, py];
  }
  ctx.stroke();
}

function drawExplicitY(expr, t) {
  const f = evaluator(expr, 'x');
  const pts = [];
  const steps = Math.round(t.W * 2);
  for (let i = 0; i <= steps; i++) {
    const x = t.xmin + (i / steps) * (t.xmax - t.xmin);
    const y = f(x);
    pts.push(Number.isFinite(y) ? [t.toPx(x), t.toPy(y)] : null);
  }
  strokePolyline(pts, t);
}

function drawExplicitX(expr, t) {
  const f = evaluator(expr, 'y');
  const pts = [];
  const steps = Math.round(t.H * 2);
  for (let i = 0; i <= steps; i++) {
    const y = t.ymin + (i / steps) * (t.ymax - t.ymin);
    const x = f(y);
    pts.push(Number.isFinite(x) ? [t.toPx(x), t.toPy(y)] : null);
  }
  ctx.beginPath();
  let drawing = false, prev = null;
  for (const p of pts) {
    if (!p) { drawing = false; prev = null; continue; }
    if (prev && Math.abs(p[0] - prev[0]) > t.W * 1.5) { drawing = false; prev = null; }
    if (!drawing) { ctx.moveTo(p[0], p[1]); drawing = true; } else { ctx.lineTo(p[0], p[1]); }
    prev = p;
  }
  ctx.stroke();
}

function drawPolar(expr, t) {
  const f = evaluator(expr, 'theta');
  const steps = 2000;
  const turns = 2;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * turns * Math.PI * 2;
    const r = f(th);
    if (!Number.isFinite(r)) { pts.push(null); continue; }
    pts.push([t.toPx(r * Math.cos(th)), t.toPy(r * Math.sin(th))]);
  }
  ctx.beginPath();
  let drawing = false;
  for (const p of pts) {
    if (!p) { drawing = false; continue; }
    if (!drawing) { ctx.moveTo(p[0], p[1]); drawing = true; } else { ctx.lineTo(p[0], p[1]); }
  }
  ctx.stroke();
}

// Marching squares over F(x,y)=0.
function drawImplicit(expr, t, quality) {
  const base = scope();
  const N = quality;
  const grid = new Float64Array((N + 1) * (N + 1));
  const gx = (i) => t.xmin + (i / N) * (t.xmax - t.xmin);
  const gy = (j) => t.ymin + (j / N) * (t.ymax - t.ymin);

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      base.x = gx(i); base.y = gy(j);
      let v;
      try { v = expr.fn.evaluate(base); } catch { v = NaN; }
      grid[j * (N + 1) + i] = typeof v === 'number' ? v : NaN;
    }
  }

  const at = (i, j) => grid[j * (N + 1) + i];
  const lerp = (a, b, va, vb) => a + ((0 - va) / (vb - va)) * (b - a);

  ctx.beginPath();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (v.some((n) => !Number.isFinite(n))) continue;
      const x0 = gx(i), x1 = gx(i + 1), y0 = gy(j), y1 = gy(j + 1);
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const a = e, b = (e + 1) % 4;
        if ((v[a] < 0) === (v[b] < 0)) continue;
        const [ax, ay] = corners[a], [bx, by] = corners[b];
        pts.push([lerp(ax, bx, v[a], v[b]), lerp(ay, by, v[a], v[b])]);
      }
      for (let k = 0; k + 1 < pts.length; k += 2) {
        ctx.moveTo(t.toPx(pts[k][0]), t.toPy(pts[k][1]));
        ctx.lineTo(t.toPx(pts[k + 1][0]), t.toPy(pts[k + 1][1]));
      }
    }
  }
  ctx.stroke();
}

function drawPoint(expr, t) {
  try {
    const val = expr.fn.evaluate(scope());
    const arr = val && val.toArray ? val.toArray() : val;
    const [x, y] = arr;
    ctx.beginPath();
    ctx.arc(t.toPx(Number(x)), t.toPy(Number(y)), 5, 0, Math.PI * 2);
    ctx.fill();
  } catch { /* not a plottable point */ }
}

function drawAnnotations(t) {
  const { annotations } = getState();
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const note of annotations) {
    const px = t.toPx(note.x), py = t.toPy(note.y);
    if (px < -50 || px > t.W + 50 || py < -50 || py > t.H + 50) continue;

    const padding = 6;
    const w = ctx.measureText(note.text).width + padding * 2;
    const h = 22;
    let bx = px + 12, by = py - 30;
    if (bx + w > t.W - 4) bx = px - 12 - w;
    if (by < 4) by = py + 14;

    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(bx + (bx > px ? 0 : w), by + h / 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(17,24,39,0.92)';
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(note.text, bx + padding, by + h / 2 + 0.5);

    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

let interacting = false;

export function draw() {
  if (!ctx) return;
  const state = getState();
  if (state.mode !== '2d') return;

  ctx.save();
  ctx.scale(dpr, dpr);
  const t = transforms();
  drawGrid(t);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const expr of state.expressions) {
    if (!expr.visible || expr.error || !expr.fn) continue;
    ctx.strokeStyle = expr.color;
    ctx.fillStyle = expr.color;
    ctx.lineWidth = 2.5;
    switch (expr.kind) {
      case 'explicit_y': drawExplicitY(expr, t); break;
      case 'explicit_x': drawExplicitX(expr, t); break;
      case 'polar': drawPolar(expr, t); break;
      case 'implicit': drawImplicit(expr, t, interacting ? 90 : 190); break;
      case 'point': drawPoint(expr, t); break;
      case 'explicit_z': break; // 3D only
      default: break;
    }
  }
  drawAnnotations(t);
  ctx.restore();
}

function attachInteraction() {
  let dragging = false, last = null;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; interacting = true; last = [e.offsetX, e.offsetY];
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const t = transforms();
    const dx = (e.offsetX - last[0]) / t.W * (t.xmax - t.xmin);
    const dy = (e.offsetY - last[1]) / t.H * (t.ymax - t.ymin);
    last = [e.offsetX, e.offsetY];
    setViewport({
      xmin: t.xmin - dx, xmax: t.xmax - dx,
      ymin: t.ymin + dy, ymax: t.ymax + dy,
    });
  });
  const end = () => { dragging = false; interacting = false; draw(); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const t = transforms();
    const factor = Math.exp(e.deltaY * 0.0015);
    const cx = t.toX(e.offsetX), cy = t.toY(e.offsetY);
    interacting = true;
    setViewport({
      xmin: cx + (t.xmin - cx) * factor,
      xmax: cx + (t.xmax - cx) * factor,
      ymin: cy + (t.ymin - cy) * factor,
      ymax: cy + (t.ymax - cy) * factor,
    });
    clearTimeout(attachInteraction._t);
    attachInteraction._t = setTimeout(() => { interacting = false; draw(); }, 160);
  }, { passive: false });
}

export { resize as resize2D };
