// Canvas drawing and pointer handling for the physics box. World coordinates
// are metres with +y up and the origin at the bottom-left inside corner of the
// box, which is exactly what the WebMCP tools report -- so a position an agent
// states matches the position a student can point at.

import * as physics from './store';
import { worldVerts } from './engine';
import type { Body, Vec2 } from './types';

/** Drag distance to force/velocity conversion, chosen so a full-box drag is big
 *  but not absurd: 1 metre of drag = 6 N, or 3 m/s. */
const FORCE_PER_METRE = 6;
const SPEED_PER_METRE = 3;

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let scale = 40; // pixels per metre
let originX = 0; // canvas px of world x=0
let originY = 0; // canvas px of world y=0 (the floor)

/* ---------------- coordinate transforms ---------------- */

function toScreenX(x: number): number { return originX + x * scale; }
function toScreenY(y: number): number { return originY - y * scale; }

export function clientToWorld(clientX: number, clientY: number): Vec2 {
  const rect = canvas.getBoundingClientRect();
  const ratio = dpr();
  // Canvas backing-store pixels, which is the space originX/originY live in.
  const px = (clientX - rect.left) * ratio;
  const py = (clientY - rect.top) * ratio;
  return { x: (px - originX) / scale, y: (originY - py) / scale };
}

function dpr(): number { return window.devicePixelRatio || 1; }

function layout(): void {
  const ratio = dpr();
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * ratio));
  const h = Math.max(1, Math.round(rect.height * ratio));
  // Assigning width/height clears the canvas, so only do it on a real resize.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const { width, height } = physics.WORLD_BOX;
  const pad = 18 * ratio;
  // A collapsed or not-yet-laid-out stage gives a 1px canvas, which would make
  // the scale negative and blow up every gradient and arc we draw.
  scale = Math.max(
    0.01,
    Math.min((canvas.width - pad * 2) / width, (canvas.height - pad * 2) / height),
  );
  originX = (canvas.width - width * scale) / 2;
  originY = (canvas.height - height * scale) / 2 + height * scale;
}

/** False while the stage is too small to draw anything meaningful into. */
function drawable(): boolean {
  return canvas.width > 40 && canvas.height > 40;
}

/* ---------------- hit testing ---------------- */

/** `pad` grows the shape outward in metres, for a more forgiving pick. */
function pointInBody(body: Body, p: Vec2, pad = 0): boolean {
  for (const shape of body.shapes) {
    if (shape.kind === 'circle') {
      if (Math.hypot(p.x - body.x, p.y - body.y) <= shape.r + 0.06 + pad) return true;
      continue;
    }
    const vs = worldVerts(body, shape);
    let insideShape = true;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross < -(0.02 + pad)) { insideShape = false; break; }
    }
    if (insideShape) return true;
  }
  return false;
}

export function bodyAt(p: Vec2, pad = 0): Body | null {
  const bodies = physics.getState().bodies;
  // Later bodies are drawn on top, so pick from the top down.
  for (let i = bodies.length - 1; i >= 0; i--) {
    const body = bodies[i];
    if (body.wall) continue;
    if (pointInBody(body, p, pad)) return body;
  }
  return null;
}

/**
 * The movable object under the pointer, re-tested every frame so an object
 * moving under a stationary cursor picks itself up. The pick is padded because
 * hovering a small ball crossing the box at 8 m/s is otherwise fiddly.
 */
const HOVER_PAD = 0.22; // metres

function hoveredBody(): Body | null {
  if (!hoverPoint) return null;
  const body = bodyAt(hoverPoint, HOVER_PAD);
  return body && body.kind === 'dynamic' ? body : null;
}

/* ---------------- interaction state ---------------- */

type Drag =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'stroke'; points: Vec2[] }
  | { kind: 'vector'; id: string; tool: 'force' | 'velocity'; from: Vec2; to: Vec2 }
  | null;

let drag: Drag = null;
let hoverPoint: Vec2 | null = null;
/** Last object the pointer was over, so a hover change can force a repaint. */
let lastHoveredId: string | null = null;

/* ---------------- drawing ---------------- */

function drawBox(): void {
  const { width, height } = physics.WORLD_BOX;
  const ratio = dpr();

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(toScreenX(0), toScreenY(height), width * scale, height * scale);

  // One-metre grid, with a heavier line every 5 m.
  ctx.lineWidth = 1 * ratio;
  for (let x = 0; x <= width + 1e-6; x += 1) {
    ctx.strokeStyle = Math.round(x) % 5 === 0 ? 'rgba(100,116,139,.28)' : 'rgba(100,116,139,.12)';
    ctx.beginPath();
    ctx.moveTo(toScreenX(x), toScreenY(0));
    ctx.lineTo(toScreenX(x), toScreenY(height));
    ctx.stroke();
  }
  for (let y = 0; y <= height + 1e-6; y += 1) {
    ctx.strokeStyle = Math.round(y) % 5 === 0 ? 'rgba(100,116,139,.28)' : 'rgba(100,116,139,.12)';
    ctx.beginPath();
    ctx.moveTo(toScreenX(0), toScreenY(y));
    ctx.lineTo(toScreenX(width), toScreenY(y));
    ctx.stroke();
  }

  // Floor and side walls: solid supports, drawn as a heavy edge.
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 4 * ratio;
  ctx.beginPath();
  ctx.moveTo(toScreenX(0), toScreenY(height));
  ctx.lineTo(toScreenX(0), toScreenY(0));
  ctx.lineTo(toScreenX(width), toScreenY(0));
  ctx.lineTo(toScreenX(width), toScreenY(height));
  ctx.stroke();

  // The open top, drawn dashed so it reads as "things may fly out and come back".
  ctx.strokeStyle = 'rgba(51,65,85,.35)';
  ctx.lineWidth = 1.5 * ratio;
  ctx.setLineDash([6 * ratio, 6 * ratio]);
  ctx.beginPath();
  ctx.moveTo(toScreenX(0), toScreenY(height));
  ctx.lineTo(toScreenX(width), toScreenY(height));
  ctx.stroke();
  ctx.setLineDash([]);
}

function tracePolygon(verts: Vec2[]): void {
  ctx.beginPath();
  ctx.moveTo(toScreenX(verts[0].x), toScreenY(verts[0].y));
  for (let i = 1; i < verts.length; i++) ctx.lineTo(toScreenX(verts[i].x), toScreenY(verts[i].y));
  ctx.closePath();
}

function drawBody(body: Body, selected: boolean): void {
  const ratio = dpr();
  const floating = physics.getState().stage === 'design' && body.kind === 'dynamic';

  for (const shape of body.shapes) {
    if (shape.kind === 'circle') {
      const cx = toScreenX(body.x);
      const cy = toScreenY(body.y);
      const r = shape.r * scale;
      const gradient = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
      gradient.addColorStop(0, lighten(body.color, 0.45));
      gradient.addColorStop(1, body.color);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = darken(body.color, 0.25);
      ctx.lineWidth = 1.6 * ratio;
      ctx.stroke();
      // A spin mark, so rotation is visible on a plain circle.
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 2 * ratio;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(-body.angle) * r * 0.8, cy + Math.sin(-body.angle) * r * 0.8);
      ctx.stroke();
      continue;
    }
    const verts = worldVerts(body, shape);
    tracePolygon(verts);
    ctx.fillStyle = body.kind === 'static' ? withAlpha(body.color, 0.5) : withAlpha(body.color, 0.82);
    ctx.fill();
    ctx.strokeStyle = darken(body.color, 0.3);
    ctx.lineWidth = 1.4 * ratio;
    ctx.stroke();
  }

  // Carts get wheels so they read as roller-coaster cars rather than boxes.
  if (body.type === 'cart') {
    const half = body.width / 2 - body.height * 0.35;
    for (const side of [-half, half]) {
      const c = Math.cos(body.angle);
      const s = Math.sin(body.angle);
      const wx = body.x + side * c - (-body.height / 2) * s;
      const wy = body.y + side * s + (-body.height / 2) * c;
      ctx.fillStyle = '#1f2937';
      ctx.beginPath();
      ctx.arc(toScreenX(wx), toScreenY(wy), body.height * 0.22 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (floating) {
    // Pre-simulation objects float: a soft dashed halo says "nothing acts here yet".
    ctx.strokeStyle = 'rgba(45,112,179,.4)';
    ctx.lineWidth = 1.2 * ratio;
    ctx.setLineDash([4 * ratio, 4 * ratio]);
    const box = bodyScreenBox(body);
    ctx.strokeRect(box.x - 5 * ratio, box.y - 5 * ratio, box.w + 10 * ratio, box.h + 10 * ratio);
    ctx.setLineDash([]);
  }

  if (selected) {
    const box = bodyScreenBox(body);
    ctx.strokeStyle = '#2d70b3';
    ctx.lineWidth = 2 * ratio;
    ctx.setLineDash([6 * ratio, 4 * ratio]);
    ctx.strokeRect(box.x - 4 * ratio, box.y - 4 * ratio, box.w + 8 * ratio, box.h + 8 * ratio);
    ctx.setLineDash([]);
  }
}

function bodyScreenBox(body: Body): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of body.shapes) {
    if (shape.kind === 'circle') {
      minX = Math.min(minX, body.x - shape.r);
      maxX = Math.max(maxX, body.x + shape.r);
      minY = Math.min(minY, body.y - shape.r);
      maxY = Math.max(maxY, body.y + shape.r);
      continue;
    }
    for (const v of worldVerts(body, shape)) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  }
  return {
    x: toScreenX(minX),
    y: toScreenY(maxY),
    w: (maxX - minX) * scale,
    h: (maxY - minY) * scale,
  };
}

function drawArrow(from: Vec2, to: Vec2, color: string, dashed: boolean, label: string): void {
  const ratio = dpr();
  const x1 = toScreenX(from.x);
  const y1 = toScreenY(from.y);
  const x2 = toScreenX(to.x);
  const y2 = toScreenY(to.y);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 10 * ratio;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4 * ratio;
  if (dashed) ctx.setLineDash([7 * ratio, 5 * ratio]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - 0.4), y2 - head * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - head * Math.cos(angle + 0.4), y2 - head * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();

  if (label) {
    ctx.font = `${11 * ratio}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tx = x2 + 8 * ratio * Math.cos(angle);
    const ty = y2 + 8 * ratio * Math.sin(angle);
    const w = ctx.measureText(label).width + 8 * ratio;
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.fillRect(tx - 2 * ratio, ty - 8 * ratio, w, 16 * ratio);
    ctx.fillStyle = color;
    ctx.fillText(label, tx + 2 * ratio, ty);
  }
}

/** Pre-run annotations: the forces and velocities that will be applied. */
function drawPlannedVectors(body: Body): void {
  if (body.kind !== 'dynamic') return;
  const origin = { x: body.x, y: body.y };
  for (const f of body.forces) {
    const mag = Math.hypot(f.fx, f.fy);
    if (mag < 1e-6) continue;
    const len = mag / FORCE_PER_METRE;
    const to = { x: origin.x + (f.fx / mag) * len, y: origin.y + (f.fy / mag) * len };
    const label = f.mode === 'start' ? `${mag.toFixed(1)} N·s` : `${mag.toFixed(1)} N · ${f.duration}s`;
    drawArrow(origin, to, '#b91c1c', false, label);
  }
  const v = body.velocity;
  if (v) {
    const mag = Math.hypot(v.vx, v.vy);
    if (mag > 1e-6) {
      const len = mag / SPEED_PER_METRE;
      const to = { x: origin.x + (v.vx / mag) * len, y: origin.y + (v.vy / mag) * len };
      const label = v.mode === 'start' ? `${mag.toFixed(1)} m/s` : `${mag.toFixed(1)} m/s · ${v.duration}s`;
      drawArrow(origin, to, '#15803d', true, label);
    }
  }
}

/** A boxed text label pinned near a world point. */
function drawLabel(at: Vec2, text: string, color: string): void {
  const ratio = dpr();
  ctx.font = `${11 * ratio}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const x = toScreenX(at.x) + 10 * ratio;
  const y = toScreenY(at.y) - 14 * ratio;
  const w = ctx.measureText(text).width + 8 * ratio;
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  ctx.fillRect(x - 2 * ratio, y - 8 * ratio, w, 16 * ratio);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 2 * ratio, y);
}

/** Live annotation for the hovered object: its velocity vector and speed. */
function drawLiveVectors(body: Body): void {
  if (body.kind !== 'dynamic') return;
  const speed = Math.hypot(body.vx, body.vy);
  // Too slow to draw a meaningful arrow, but the reading is still the answer
  // to "what is it doing right now", so say it in words.
  if (speed < 0.15) {
    drawLabel({ x: body.x, y: body.y }, `${speed.toFixed(2)} m/s — at rest`, 'rgba(100,116,139,.95)');
    return;
  }
  const len = Math.min(speed / SPEED_PER_METRE, 3);
  const to = { x: body.x + (body.vx / speed) * len, y: body.y + (body.vy / speed) * len };
  drawArrow({ x: body.x, y: body.y }, to, 'rgba(21,128,61,.85)', true, `${speed.toFixed(1)} m/s`);
}

function drawTrail(body: Body): void {
  const samples = physics.getTelemetry(body.id);
  if (samples.length < 2) return;
  ctx.strokeStyle = withAlpha(body.color, 0.35);
  ctx.lineWidth = 1.8 * dpr();
  ctx.beginPath();
  ctx.moveTo(toScreenX(samples[0].x), toScreenY(samples[0].y));
  for (const s of samples) ctx.lineTo(toScreenX(s.x), toScreenY(s.y));
  ctx.stroke();
}

function drawStroke(points: Vec2[]): void {
  if (points.length < 2) return;
  ctx.strokeStyle = 'rgba(51,65,85,.8)';
  ctx.lineWidth = 0.16 * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(toScreenX(points[0].x), toScreenY(points[0].y));
  for (const p of points) ctx.lineTo(toScreenX(p.x), toScreenY(p.y));
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawHud(hovering: boolean): void {
  const ratio = dpr();
  const state = physics.getState();
  const { height } = physics.WORLD_BOX;

  ctx.font = `600 ${12 * ratio}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const stageText = physics.stageLabel(state.stage);
  const friction = state.friction ? ' · friction on' : '';
  const timeText = state.stage === 'design'
    ? `${physics.userBodies().length}/${state.objectCap} objects · g = ${state.gravity} m/s²${friction}`
    : `t = ${state.time.toFixed(2)} s / ${physics.MAX_RUN_SECONDS} s${friction}`;
  // The velocity readout is hover-only now, so say so until they find it.
  const hint = state.stage !== 'design' && !hovering ? ' · hover an object for its velocity' : '';
  const text = `${stageText} — ${timeText}${hint}`;

  const x = toScreenX(0) + 10 * ratio;
  const y = toScreenY(height) + 10 * ratio;
  const w = ctx.measureText(text).width + 16 * ratio;
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.strokeStyle = 'rgba(226,232,240,1)';
  ctx.lineWidth = 1 * ratio;
  roundRect(x, y, w, 22 * ratio, 6 * ratio);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = state.stage === 'running' ? '#15803d' : state.stage === 'ended' ? '#b45309' : '#64748b';
  ctx.fillText(text, x + 8 * ratio, y + 5 * ratio);

  // The five-second rest countdown, so the auto-end is not a surprise.
  if (state.stage === 'running') {
    const rest = physics.restProgress();
    if (rest > 0.4) {
      const remaining = Math.max(0, physics.REST_SECONDS - rest);
      const note = `all objects at rest — ending in ${remaining.toFixed(1)} s`;
      const nw = ctx.measureText(note).width + 16 * ratio;
      const nx = toScreenX(physics.WORLD_BOX.width) - nw - 10 * ratio;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      roundRect(nx, y, nw, 22 * ratio, 6 * ratio);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b45309';
      ctx.fillText(note, nx + 8 * ratio, y + 5 * ratio);
    }
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function draw(): void {
  if (!ctx) return;
  layout();
  if (!drawable()) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBox();

  const state = physics.getState();

  if (state.stage !== 'design') {
    for (const body of state.bodies) if (body.kind === 'dynamic') drawTrail(body);
  }

  for (const body of state.bodies) {
    if (body.wall) continue;
    drawBody(body, body.id === state.selectedId);
  }

  // Live velocity would be a thicket of arrows across every moving object, so
  // outside the design stage it belongs to whatever the pointer is over. The
  // planned forces and velocities of the design stage are the student's own
  // setup and stay on screen -- you need to see what you configured.
  let hovered: Body | null = null;
  if (state.stage === 'design') {
    for (const body of state.bodies) {
      if (!body.wall) drawPlannedVectors(body);
    }
  } else {
    hovered = hoveredBody();
    if (hovered) drawLiveVectors(hovered);
  }
  // Inline style wins over the per-tool cursor in physics.css; clear it when
  // there is nothing to hover so the tool cursor comes back.
  canvas.style.cursor = hovered ? 'pointer' : '';

  if (drag?.kind === 'stroke') drawStroke(drag.points);
  if (drag?.kind === 'vector') {
    const dx = drag.to.x - drag.from.x;
    const dy = drag.to.y - drag.from.y;
    const mag = Math.hypot(dx, dy);
    const label = drag.tool === 'force'
      ? `${(mag * FORCE_PER_METRE).toFixed(1)} N`
      : `${(mag * SPEED_PER_METRE).toFixed(1)} m/s`;
    drawArrow(drag.from, drag.to, drag.tool === 'force' ? '#b91c1c' : '#15803d', drag.tool === 'velocity', label);
  }

  drawHud(hovered !== null);
}

/* ---------------- colour helpers ---------------- */

function parse(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function lighten(hex: string, amount: number): string {
  const [r, g, b] = parse(hex);
  const mix = (c: number): number => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
function darken(hex: string, amount: number): string {
  const [r, g, b] = parse(hex);
  const mix = (c: number): number => Math.round(c * (1 - amount));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------------- pointer handling ---------------- */

function onPointerDown(e: PointerEvent): void {
  const state = physics.getState();
  const p = clientToWorld(e.clientX, e.clientY);
  canvas.setPointerCapture(e.pointerId);

  if (state.stage !== 'design') {
    // Outside the design stage the canvas is read-only except for selection.
    const hit = bodyAt(p);
    physics.select(hit ? hit.id : null);
    return;
  }

  if (state.tool === 'draw') {
    drag = { kind: 'stroke', points: [p] };
    return;
  }
  const hit = bodyAt(p);
  if (state.tool === 'erase') {
    if (hit) physics.removeObject(hit.id);
    return;
  }
  if (!hit) {
    physics.select(null);
    return;
  }
  physics.select(hit.id);
  if (state.tool === 'select') {
    drag = { kind: 'move', id: hit.id, dx: hit.x - p.x, dy: hit.y - p.y };
  } else if (state.tool === 'force' || state.tool === 'velocity') {
    drag = { kind: 'vector', id: hit.id, tool: state.tool, from: { x: hit.x, y: hit.y }, to: p };
  }
}

function onPointerMove(e: PointerEvent): void {
  const p = clientToWorld(e.clientX, e.clientY);
  hoverPoint = p;
  if (!drag) {
    // The hover readout must not wait for the next simulation tick: repaint as
    // soon as the pointer lands on a different object (or leaves one).
    const id = hoveredBody()?.id ?? null;
    if (id !== lastHoveredId) {
      lastHoveredId = id;
      draw();
    }
    return;
  }
  if (drag.kind === 'move') {
    physics.moveObject(drag.id, p.x + drag.dx, p.y + drag.dy);
  } else if (drag.kind === 'stroke') {
    const last = drag.points[drag.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.05) drag.points.push(p);
  } else if (drag.kind === 'vector') {
    drag.to = p;
  }
}

function onPointerUp(): void {
  if (!drag) return;
  const finished = drag;
  drag = null;

  if (finished.kind === 'stroke') {
    physics.drawLine(finished.points);
  } else if (finished.kind === 'vector') {
    const dx = finished.to.x - finished.from.x;
    const dy = finished.to.y - finished.from.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 0.15) return; // a click, not a drag
    if (finished.tool === 'force') {
      physics.addForce(finished.id, +(dx * FORCE_PER_METRE).toFixed(2), +(dy * FORCE_PER_METRE).toFixed(2), 'start', 0);
    } else {
      physics.setStartVelocity(finished.id, +(dx * SPEED_PER_METRE).toFixed(2), +(dy * SPEED_PER_METRE).toFixed(2), 'start', 0);
    }
  }
}

export function initPhysicsRender(target: HTMLCanvasElement): void {
  canvas = target;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  ctx = context;

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    hoverPoint = null;
    lastHoveredId = null;
    draw();
  });
  window.addEventListener('resize', draw);

  physics.subscribe(() => draw());
  draw();
}

/** Where the pointer is, in world metres — used by the status line. */
export function pointer(): Vec2 | null {
  return hoverPoint;
}

/** World point under a client coordinate, or null when it is off the canvas. */
export function canvasHit(clientX: number, clientY: number): Vec2 | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  const p = clientToWorld(clientX, clientY);
  const { width, height } = physics.WORLD_BOX;
  if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) return null;
  return p;
}

export { FORCE_PER_METRE, SPEED_PER_METRE };
