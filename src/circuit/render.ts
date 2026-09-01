// Canvas renderer + pointer interaction for the circuit board. Read-only with
// respect to electrical state: it draws whatever the store holds and routes
// every gesture (pan, drag, wire, toggle) back through the store, so the agent
// and the student are always acting on the same circuit.

import type { Component, Vec2 } from './types';
import * as circuit from './store';
import {
  CATALOG,
  LED_SPEC,
  pinPosition,
  pinNames,
} from './components';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let dpr = 1;

const COLORS = {
  bg: '#fbfcfe',
  gridMinor: '#eef2f8',
  gridMajor: '#dfe6f0',
  lead: '#334155',
  body: '#1e293b',
  pin: '#64748b',
  pinLive: '#2d70b3',
  select: '#2d70b3',
  current: '#e0a500',
  wire: '#475569',
  wireSelected: '#dc2626',
  wireHover: '#ef4444',
  labelBg: 'rgba(255,255,255,0.92)',
  labelInk: '#16202e',
  muted: '#94a3b8',
};

export function initCircuitRender(canvasEl: HTMLCanvasElement): void {
  canvas = canvasEl;
  ctx = canvas.getContext('2d')!;
  attachInteraction();
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
}

export function resize(): void {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  centerIfFresh(rect.width, rect.height);
}

let didCenter = false;
function centerIfFresh(w: number, h: number): void {
  if (didCenter) return;
  didCenter = true;
  const { scale } = circuit.getState().view;
  circuit.setView({ originX: -(w / scale) / 2, originY: -(h / scale) / 2 });
}

function dims(): { W: number; H: number } {
  return { W: canvas.width / dpr, H: canvas.height / dpr };
}

function toScreen(x: number, y: number): Vec2 {
  const { originX, originY, scale } = circuit.getState().view;
  return { x: (x - originX) * scale, y: (y - originY) * scale };
}
function toWorld(px: number, py: number): Vec2 {
  const { originX, originY, scale } = circuit.getState().view;
  return { x: originX + px / scale, y: originY + py / scale };
}

// ---- grid ----

function drawGrid(): void {
  const { W, H } = dims();
  const { originX, originY, scale } = circuit.getState().view;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const x0 = Math.floor(originX);
  const x1 = Math.ceil(originX + W / scale);
  const y0 = Math.floor(originY);
  const y1 = Math.ceil(originY + H / scale);

  ctx.strokeStyle = COLORS.gridMinor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) {
    const sx = Math.round((x - originX) * scale) + 0.5;
    ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
  }
  for (let y = y0; y <= y1; y++) {
    const sy = Math.round((y - originY) * scale) + 0.5;
    ctx.moveTo(0, sy); ctx.lineTo(W, sy);
  }
  ctx.stroke();

  // dots at integer grid points make snap targets legible
  ctx.fillStyle = COLORS.gridMajor;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const s = toScreen(x, y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---- geometry helpers for symbols ----

interface Axis {
  p0: Vec2; p1: Vec2; mid: Vec2;
  dir: Vec2; perp: Vec2; len: number;
}

function axisOf(component: Component): Axis {
  const names = pinNames(component.type);
  const w0 = pinPosition(component, names[0]);
  const w1 = names.length > 1 ? pinPosition(component, names[1]) : { x: component.x, y: component.y };
  const p0 = toScreen(w0.x, w0.y);
  const p1 = toScreen(w1.x, w1.y);
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / len, y: dy / len };
  const perp = { x: -dir.y, y: dir.x };
  return { p0, p1, mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, dir, perp, len };
}

function pt(base: Vec2, ax: Axis, along: number, across: number): Vec2 {
  return {
    x: base.x + ax.dir.x * along + ax.perp.x * across,
    y: base.y + ax.dir.y * along + ax.perp.y * across,
  };
}

function line(a: Vec2, b: Vec2): void {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

// ---- symbols ----

function drawLeads(ax: Axis, bodyHalf: number): void {
  ctx.strokeStyle = COLORS.lead;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  line(ax.p0, pt(ax.mid, ax, -bodyHalf, 0));
  line(pt(ax.mid, ax, bodyHalf, 0), ax.p1);
}

function drawResistor(ax: Axis): void {
  const bodyHalf = Math.min(ax.len * 0.3, 26);
  drawLeads(ax, bodyHalf);
  ctx.strokeStyle = COLORS.body;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  const zig = 6;
  const start = pt(ax.mid, ax, -bodyHalf, 0);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i <= zig; i++) {
    const along = -bodyHalf + (2 * bodyHalf * i) / zig;
    const across = i === 0 || i === zig ? 0 : (i % 2 === 0 ? 7 : -7);
    const p = pt(ax.mid, ax, along, across);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawLamp(ax: Axis, lit: boolean, brightness: number): void {
  const r = Math.min(ax.len * 0.22, 18);
  drawLeads(ax, r);
  if (lit) {
    const glow = ctx.createRadialGradient(ax.mid.x, ax.mid.y, 0, ax.mid.x, ax.mid.y, r * 3.2);
    glow.addColorStop(0, `rgba(253,224,71,${0.5 * brightness + 0.1})`);
    glow.addColorStop(1, 'rgba(253,224,71,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(ax.mid.x, ax.mid.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = COLORS.body;
  ctx.lineWidth = 2.2;
  ctx.fillStyle = lit ? `rgba(253,224,71,${0.35 + 0.5 * brightness})` : '#fff';
  ctx.beginPath(); ctx.arc(ax.mid.x, ax.mid.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // X inside
  const d = r * 0.7;
  line(pt(ax.mid, ax, -d, -d), pt(ax.mid, ax, d, d));
  line(pt(ax.mid, ax, -d, d), pt(ax.mid, ax, d, -d));
}

function drawBattery(ax: Axis): void {
  const bodyHalf = 9;
  drawLeads(ax, bodyHalf);
  ctx.strokeStyle = COLORS.body;
  ctx.lineWidth = 2.4;
  // long plate (+) near pin0 (pos), short thick plate (−) near pin1 (neg)
  const longHalf = 13, shortHalf = 7;
  const plateA = pt(ax.mid, ax, -4, 0);
  const plateB = pt(ax.mid, ax, 4, 0);
  line(pt(plateA, ax, 0, -longHalf), pt(plateA, ax, 0, longHalf));
  ctx.lineWidth = 5;
  line(pt(plateB, ax, 0, -shortHalf), pt(plateB, ax, 0, shortHalf));
  // + sign near the long plate
  ctx.lineWidth = 1.8;
  const plus = pt(ax.mid, ax, -14, -16);
  line(pt(plus, ax, -3, 0), pt(plus, ax, 3, 0));
  line(pt(plus, ax, 0, -3), pt(plus, ax, 0, 3));
}

function drawLed(ax: Axis, color: string, lit: boolean, brightness: number): void {
  const bodyHalf = Math.min(ax.len * 0.28, 20);
  drawLeads(ax, bodyHalf);
  if (lit) {
    const glow = ctx.createRadialGradient(ax.mid.x, ax.mid.y, 0, ax.mid.x, ax.mid.y, bodyHalf * 3.4);
    glow.addColorStop(0, hexAlpha(color, 0.15 + 0.6 * brightness));
    glow.addColorStop(1, hexAlpha(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(ax.mid.x, ax.mid.y, bodyHalf * 3.4, 0, Math.PI * 2); ctx.fill();
  }
  // triangle anode(p0) -> cathode(p1)
  const t = bodyHalf * 0.9;
  const apex = pt(ax.mid, ax, t, 0);
  const baseA = pt(ax.mid, ax, -t, -t);
  const baseB = pt(ax.mid, ax, -t, t);
  ctx.beginPath();
  ctx.moveTo(baseA.x, baseA.y); ctx.lineTo(baseB.x, baseB.y); ctx.lineTo(apex.x, apex.y); ctx.closePath();
  ctx.fillStyle = lit ? hexAlpha(color, 0.35 + 0.5 * brightness) : '#fff';
  ctx.strokeStyle = COLORS.body; ctx.lineWidth = 2.2;
  ctx.fill(); ctx.stroke();
  // cathode bar
  line(pt(ax.mid, ax, t, -t), pt(ax.mid, ax, t, t));
  // two little emission arrows
  ctx.strokeStyle = lit ? color : COLORS.muted;
  ctx.lineWidth = 1.6;
  for (const off of [-4, 4]) {
    const a = pt(ax.mid, ax, off, -t - 3);
    const b = pt(ax.mid, ax, off + 6, -t - 11);
    line(a, b);
    line(b, pt(b, ax, -3, 1));
    line(b, pt(b, ax, 0.5, 3.5));
  }
}

function drawSwitch(ax: Axis, closed: boolean): void {
  const bodyHalf = Math.min(ax.len * 0.3, 24);
  ctx.strokeStyle = COLORS.lead; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  line(ax.p0, pt(ax.mid, ax, -bodyHalf, 0));
  line(pt(ax.mid, ax, bodyHalf, 0), ax.p1);
  const hingeL = pt(ax.mid, ax, -bodyHalf, 0);
  const hingeR = pt(ax.mid, ax, bodyHalf, 0);
  ctx.fillStyle = COLORS.body;
  for (const h of [hingeL, hingeR]) { ctx.beginPath(); ctx.arc(h.x, h.y, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = closed ? COLORS.body : '#b45309';
  ctx.lineWidth = 2.6;
  if (closed) line(hingeL, hingeR);
  else line(hingeL, pt(ax.mid, ax, bodyHalf * 0.6, -bodyHalf * 0.7));
}

function drawCapacitor(ax: Axis): void {
  const bodyHalf = 5;
  drawLeads(ax, bodyHalf);
  ctx.strokeStyle = COLORS.body;
  ctx.lineWidth = 2.6;
  const plateHalf = 14;
  const a = pt(ax.mid, ax, -3, 0);
  const b = pt(ax.mid, ax, 3, 0);
  line(pt(a, ax, 0, -plateHalf), pt(a, ax, 0, plateHalf));
  line(pt(b, ax, 0, -plateHalf), pt(b, ax, 0, plateHalf));
}

function drawDiode(ax: Axis): void {
  const bodyHalf = Math.min(ax.len * 0.28, 18);
  drawLeads(ax, bodyHalf);
  const t = bodyHalf * 0.9;
  const apex = pt(ax.mid, ax, t, 0);
  const baseA = pt(ax.mid, ax, -t, -t);
  const baseB = pt(ax.mid, ax, -t, t);
  ctx.beginPath();
  ctx.moveTo(baseA.x, baseA.y); ctx.lineTo(baseB.x, baseB.y); ctx.lineTo(apex.x, apex.y); ctx.closePath();
  ctx.fillStyle = '#475569'; ctx.strokeStyle = COLORS.body; ctx.lineWidth = 2.2;
  ctx.fill(); ctx.stroke();
  line(pt(ax.mid, ax, t, -t), pt(ax.mid, ax, t, t)); // cathode bar
}

function drawGround(component: Component): void {
  const w = pinPosition(component, 'gnd');
  const pin = toScreen(w.x, w.y);
  const anchor = toScreen(component.x, component.y);
  ctx.strokeStyle = COLORS.lead; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  line(pin, anchor);
  ctx.strokeStyle = COLORS.body;
  const widths = [12, 8, 4];
  widths.forEach((hw, i) => {
    const y = anchor.y + 4 + i * 5;
    ctx.beginPath(); ctx.moveTo(anchor.x - hw, y); ctx.lineTo(anchor.x + hw, y); ctx.stroke();
  });
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ---- current flow animation ----

// Signed flow from pin0 to pin1 for a component, in amps.
function flowP0toP1(component: Component): number {
  const res = circuit.getState().solution?.results[component.id];
  if (!res) return 0;
  if (component.type === 'battery') return -res.current; // current exits + externally
  return res.current;
}

let clock = 0;

function drawCurrentDots(component: Component, ax: Axis): void {
  const flow = flowP0toP1(component);
  const mag = Math.abs(flow);
  if (mag < 1e-6 || !circuit.getState().running) return;
  const dir = Math.sign(flow);
  const spacing = 16;
  const speed = Math.min(90, 12 + mag * 2600); // px/sec, gently saturating
  const phase = (clock * speed * dir) % spacing;
  ctx.fillStyle = COLORS.current;
  const count = Math.ceil(ax.len / spacing) + 1;
  for (let i = -1; i < count; i++) {
    const along = i * spacing + (phase < 0 ? phase + spacing : phase);
    if (along < 4 || along > ax.len - 4) continue;
    const p = pt(ax.p0, ax, along, 0);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- wires, pins, labels ----

function pinScreen(pinRef: string): Vec2 | null {
  const dot = pinRef.lastIndexOf('.');
  const id = pinRef.slice(0, dot);
  const pin = pinRef.slice(dot + 1);
  const c = circuit.componentById(id);
  if (!c) return null;
  const w = pinPosition(c, pin);
  return toScreen(w.x, w.y);
}

function drawWires(): void {
  const { wires, selectedWireId } = circuit.getState();
  ctx.lineCap = 'round';
  for (const w of wires) {
    const a = pinScreen(w.from);
    const b = pinScreen(w.to);
    if (!a || !b) continue;
    const isSel = w.id === selectedWireId;
    const isHover = w.id === hoverWire;
    ctx.strokeStyle = isSel ? COLORS.wireSelected : isHover ? COLORS.wireHover : COLORS.wire;
    ctx.lineWidth = isSel || isHover ? 4 : 3;
    line(a, b);
  }
}

function drawPins(): void {
  const state = circuit.getState();
  for (const c of state.components) {
    for (const name of pinNames(c.type)) {
      const wp = pinPosition(c, name);
      const s = toScreen(wp.x, wp.y);
      const isHover = hoverPin === `${c.id}.${name}` || wireStart === `${c.id}.${name}`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, isHover ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isHover ? COLORS.pinLive : COLORS.pin;
      ctx.fill();
      if (isHover) {
        ctx.strokeStyle = COLORS.pinLive; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
}

function drawNodeVoltages(): void {
  const state = circuit.getState();
  const sol = state.solution;
  if (!sol || !sol.ok || !state.running) return;

  // Average screen position of each electrical node, from its pins.
  const acc = new Map<number, { x: number; y: number; n: number }>();
  for (const c of state.components) {
    for (const name of pinNames(c.type)) {
      const node = sol.pinNode[`${c.id}.${name}`];
      if (node === undefined) continue;
      const wp = pinPosition(c, name);
      const ps = toScreen(wp.x, wp.y);
      const e = acc.get(node) ?? { x: 0, y: 0, n: 0 };
      e.x += ps.x; e.y += ps.y; e.n += 1;
      acc.set(node, e);
    }
  }

  ctx.font = '600 11px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [node, e] of acc) {
    const v = sol.nodeVoltage[node] ?? 0;
    const label = `${v.toFixed(2)} V`;
    const x = e.x / e.n, y = e.y / e.n - 16;
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = COLORS.labelBg;
    roundRect(x - w / 2, y - 8, w, 16, 4); ctx.fill();
    ctx.fillStyle = COLORS.labelInk;
    ctx.fillText(label, x, y);
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

function round2(v: number): number { return Math.round(v * 100) / 100; }
function formatOhms(v: number): string {
  if (v >= 1e6) return `${round2(v / 1e6)} MΩ`;
  if (v >= 1e3) return `${round2(v / 1e3)} kΩ`;
  return `${round2(v)} Ω`;
}
function formatValue(c: Component): string | null {
  switch (c.type) {
    case 'battery': return `${round2(c.value)} V`;
    case 'resistor':
    case 'lamp': return formatOhms(c.value);
    case 'capacitor': return `${round2(c.value)} µF`;
    default: return null;
  }
}
function drawValueLabel(c: Component, ax: Axis): void {
  const text = formatValue(c);
  if (!text) return;
  const x = ax.mid.x;
  const y = ax.mid.y + 21;
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 6;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  roundRect(x - w / 2, y - 7, w, 14, 3); ctx.fill();
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(text, x, y);
}

function drawComponent(c: Component): void {
  if (c.type === 'ground') { drawGround(c); return; }
  const ax = axisOf(c);
  const res = circuit.getState().solution?.results[c.id];
  switch (c.type) {
    case 'resistor': drawResistor(ax); break;
    case 'lamp': drawLamp(ax, !!res?.lit, res?.brightness ?? 0); break;
    case 'battery': drawBattery(ax); break;
    case 'led': drawLed(ax, LED_SPEC[c.color].hex, !!res?.lit, res?.brightness ?? 0); break;
    case 'switch': drawSwitch(ax, c.closed); break;
    case 'capacitor': drawCapacitor(ax); break;
    case 'diode': drawDiode(ax); break;
    default: break;
  }
  drawValueLabel(c, ax);
  drawCurrentDots(c, ax);
}

function drawSelection(): void {
  const state = circuit.getState();
  if (!state.selectedId) return;
  const c = circuit.componentById(state.selectedId);
  if (!c) return;
  const names = pinNames(c.type);
  const pts = names.map((n) => { const w = pinPosition(c, n); return toScreen(w.x, w.y); });
  pts.push(toScreen(c.x, c.y));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const pad = 16;
  ctx.strokeStyle = COLORS.select;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  roundRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2, 8);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWiringRubberBand(): void {
  if (!wireStart) return;
  const a = pinScreen(wireStart);
  if (!a) return;
  ctx.strokeStyle = COLORS.pinLive;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  line(a, pointer);
  ctx.setLineDash([]);
}

function draw(): void {
  if (!ctx) return;
  const { W, H } = dims();
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  drawGrid();
  drawWires();
  for (const c of circuit.getState().components) drawComponent(c);
  drawPins();
  drawSelection();
  drawWiringRubberBand();
  drawNodeVoltages();
  ctx.restore();
}

let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  if (circuit.getState().running) { clock += dt; circuit.advance(dt); }
  draw();
  requestAnimationFrame(frame);
}

// ---- interaction ----

let hoverPin: string | null = null;
let hoverWire: string | null = null;
let wireStart: string | null = null;
let pointer: Vec2 = { x: 0, y: 0 };

interface DragState {
  kind: 'pan' | 'move' | 'none';
  compId?: string;
  startWorld?: Vec2;
  compStart?: Vec2;
  moved?: boolean;
}
let drag: DragState = { kind: 'none' };

function pinHitTest(px: number, py: number): string | null {
  const state = circuit.getState();
  let best: string | null = null;
  let bestD = 12; // px
  for (const c of state.components) {
    for (const name of pinNames(c.type)) {
      const wp = pinPosition(c, name);
      const s = toScreen(wp.x, wp.y);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) { bestD = d; best = `${c.id}.${name}`; }
    }
  }
  return best;
}

function componentHitTest(px: number, py: number): string | null {
  const state = circuit.getState();
  for (let i = state.components.length - 1; i >= 0; i--) {
    const c = state.components[i];
    if (c.type === 'ground') {
      const a = toScreen(c.x, c.y);
      if (Math.hypot(a.x - px, a.y - py) < 22) return c.id;
      continue;
    }
    const ax = axisOf(c);
    const d = distToSegment({ x: px, y: py }, ax.p0, ax.p1);
    if (d < 16) return c.id;
  }
  return null;
}

function wireHitTest(px: number, py: number): string | null {
  const { wires } = circuit.getState();
  let best: string | null = null;
  let bestD = 8;
  for (const w of wires) {
    const a = pinScreen(w.from);
    const b = pinScreen(w.to);
    if (!a || !b) continue;
    const d = distToSegment({ x: px, y: py }, a, b);
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function attachInteraction(): void {
  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.offsetX, y: e.offsetY };
    if (drag.kind === 'pan') {
      const w = toWorld(e.offsetX, e.offsetY);
      circuit.setView({
        originX: circuit.getState().view.originX - (w.x - drag.startWorld!.x),
        originY: circuit.getState().view.originY - (w.y - drag.startWorld!.y),
      });
      return;
    }
    if (drag.kind === 'move' && drag.compId) {
      const w = toWorld(e.offsetX, e.offsetY);
      const nx = drag.compStart!.x + (w.x - drag.startWorld!.x);
      const ny = drag.compStart!.y + (w.y - drag.startWorld!.y);
      drag.moved = true;
      circuit.moveComponent(drag.compId, nx, ny, false); // smooth; snapped on release
      return;
    }
    hoverPin = pinHitTest(e.offsetX, e.offsetY);
    hoverWire = hoverPin ? null : wireHitTest(e.offsetX, e.offsetY);
    canvas.style.cursor = hoverPin ? 'crosshair'
      : componentHitTest(e.offsetX, e.offsetY) ? 'grab'
      : hoverWire ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointer = { x: e.offsetX, y: e.offsetY };
    const pin = pinHitTest(e.offsetX, e.offsetY);

    if (pin) {
      // Wiring: first pin starts, second pin completes.
      if (!wireStart) { wireStart = pin; }
      else if (wireStart === pin) { wireStart = null; }
      else { circuit.connect(wireStart, pin); wireStart = null; }
      return;
    }

    const compId = componentHitTest(e.offsetX, e.offsetY);
    if (compId) {
      const c = circuit.componentById(compId)!;
      circuit.setSelected(compId);
      if (c.type === 'switch') { circuit.toggleSwitch(compId); return; }
      drag = {
        kind: 'move', compId,
        startWorld: toWorld(e.offsetX, e.offsetY),
        compStart: { x: c.x, y: c.y },
        moved: false,
      };
      canvas.style.cursor = 'grabbing';
      return;
    }

    // A wire? select it (Delete or double-click removes it).
    const wireId = wireHitTest(e.offsetX, e.offsetY);
    if (wireId) { if (wireStart) wireStart = null; circuit.setSelectedWire(wireId); return; }

    // Empty space: cancel wiring / deselect, then pan.
    if (wireStart) { wireStart = null; return; }
    circuit.setSelected(null);
    circuit.setSelectedWire(null);
    drag = { kind: 'pan', startWorld: toWorld(e.offsetX, e.offsetY) };
    canvas.style.cursor = 'grabbing';
  });

  const endDrag = (): void => {
    if (drag.kind === 'move' && drag.compId) {
      const c = circuit.componentById(drag.compId);
      if (c) circuit.moveComponent(drag.compId, Math.round(c.x), Math.round(c.y), true);
    }
    drag = { kind: 'none' };
    canvas.style.cursor = 'default';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('dblclick', (e) => {
    const wireId = wireHitTest(e.offsetX, e.offsetY);
    if (wireId) circuit.removeWire(wireId);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = toWorld(e.offsetX, e.offsetY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.max(18, Math.min(140, circuit.getState().view.scale * factor));
    circuit.setView({ scale });
    const after = toWorld(e.offsetX, e.offsetY);
    circuit.setView({
      originX: circuit.getState().view.originX + (before.x - after.x),
      originY: circuit.getState().view.originY + (before.y - after.y),
    });
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const state = circuit.getState();
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === 'Escape') { wireStart = null; circuit.setSelected(null); circuit.setSelectedWire(null); return; }
    if (state.selectedWireId && (e.key === 'Delete' || e.key === 'Backspace')) {
      circuit.removeWire(state.selectedWireId); e.preventDefault(); return;
    }
    if (!state.selectedId) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { circuit.removeComponent(state.selectedId); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') { circuit.rotateComponent(state.selectedId); }
  });
}

export { draw };
