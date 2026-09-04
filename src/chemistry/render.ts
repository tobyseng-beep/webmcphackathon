// Canvas renderer + interaction for the atomic-structure board. Read-only with
// respect to state: draws whatever the store holds, routes gestures back
// through the store. Atoms are Bohr diagrams (packed nucleus + electron shells);
// bonds are lines (covalent) or dashed links (ionic).

import type { Atom, Bond, BondKind } from './types';
import * as chem from './store';
import { atomInfo, shells } from './atom';
import { analyzeStructure, type AtomBondingAnalysis } from './analysis';
import { elementByZ, CATEGORY_COLOR } from './elements';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let dpr = 1;

const COLORS = {
  bg: '#fbfcfe',
  gridDot: '#e2e8f0',
  proton: '#ef4444',
  neutron: '#94a3b8',
  electron: '#2d70b3',
  bondElectron: '#7c3aed',
  ring: '#cbd5e1',
  bond: '#334155',
  ionic: '#b45309',
  select: '#2d70b3',
  ink: '#16202e',
  muted: '#64748b',
  labelBg: 'rgba(255,255,255,0.92)',
};

interface Vec2 { x: number; y: number; }

// Lighten (amt>0, toward white) or darken (amt<0, toward black) a hex colour.
function adjust(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const f = (c: number) => (amt >= 0 ? Math.round(c + (255 - c) * amt) : Math.round(c * (1 + amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// Draw a particle as a shaded sphere: a radial gradient lit from the upper-left
// with a small specular highlight, so protons/neutrons/electrons read as 3D.
function drawSphere(cx: number, cy: number, r: number, base: string, specular = true): void {
  if (r < 2.4) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = base; ctx.fill(); return; }
  const g = ctx.createRadialGradient(cx - r * 0.33, cy - r * 0.38, r * 0.08, cx, cy, r * 1.06);
  g.addColorStop(0, adjust(base, 0.55));
  g.addColorStop(0.5, base);
  g.addColorStop(1, adjust(base, -0.42));
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  if (specular) {
    ctx.beginPath();
    ctx.arc(cx - r * 0.33, cy - r * 0.4, r * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
  }
}

let clock = 0;

export function initChemRender(canvasEl: HTMLCanvasElement): void {
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
  const { scale } = chem.getState().view;
  chem.setView({ originX: -(w / scale) / 2, originY: -(h / scale) / 2 });
}
function dims(): { W: number; H: number } { return { W: canvas.width / dpr, H: canvas.height / dpr }; }

function toScreen(x: number, y: number): Vec2 {
  const { originX, originY, scale } = chem.getState().view;
  return { x: (x - originX) * scale, y: (y - originY) * scale };
}
function toWorld(px: number, py: number): Vec2 {
  const { originX, originY, scale } = chem.getState().view;
  return { x: originX + px / scale, y: originY + py / scale };
}

// ---- geometry ----

const NUCLEUS_DOT = 0.13; // world units, nucleon dot radius
const SHELL_GAP = 0.42; // spacing between shells (world units)
const ELECTRON_DOT = 0.1;

function nucleusRadius(atom: Atom): number {
  const n = Math.max(1, atom.protons + atom.neutrons);
  return NUCLEUS_DOT * (1.6 + 1.25 * Math.sqrt(n));
}
function atomRadius(atom: Atom): number {
  const nShells = shells(atom.electrons).length;
  return nucleusRadius(atom) + 0.35 + Math.max(0, nShells) * SHELL_GAP;
}

// ---- grid ----

function drawGrid(): void {
  const { W, H } = dims();
  const { originX, originY, scale } = chem.getState().view;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(1, '#eef2f9');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COLORS.gridDot;
  const x0 = Math.floor(originX), x1 = Math.ceil(originX + W / scale);
  const y0 = Math.floor(originY), y1 = Math.ceil(originY + H / scale);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const s = toScreen(x, y);
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.1, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ---- atom ----

function drawNucleus(atom: Atom, center: Vec2, scale: number): void {
  const total = atom.protons + atom.neutrons;
  const spacing = NUCLEUS_DOT * 2.05 * scale;
  const dot = Math.max(1.5, NUCLEUS_DOT * scale);
  const nr = nucleusRadius(atom) * scale;
  const golden = 2.399963;

  // soft drop shadow to lift the nucleus off the board
  const sy = center.y + nr * 0.18;
  const shadow = ctx.createRadialGradient(center.x, sy, nr * 0.2, center.x, sy, nr * 1.45);
  shadow.addColorStop(0, 'rgba(15,23,42,0.20)');
  shadow.addColorStop(1, 'rgba(15,23,42,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath(); ctx.arc(center.x, sy, nr * 1.45, 0, Math.PI * 2); ctx.fill();

  // nucleons as little spheres; render far-from-centre first so nearer ones sit on top
  const order: number[] = [];
  for (let i = 0; i < total; i++) order.push(i);
  order.sort((a, b) => b - a);
  let protonRun = 0;
  const protonAt: boolean[] = [];
  for (let i = 0; i < total; i++) { protonRun += atom.protons; protonAt[i] = protonRun >= total ? (protonRun -= total, true) : false; }
  for (const i of order) {
    const r = spacing * 0.42 * Math.sqrt(i);
    const ang = i * golden;
    const px = center.x + Math.cos(ang) * r;
    const py = center.y + Math.sin(ang) * r;
    drawSphere(px, py, dot, protonAt[i] ? COLORS.proton : COLORS.neutron, dot > 4);
  }
}

function drawAtom(atom: Atom, selected: boolean, bonding: AtomBondingAnalysis | undefined): void {
  const { scale } = chem.getState().view;
  const center = toScreen(atom.x, atom.y);
  const nR = nucleusRadius(atom) * scale;
  const shellCounts = shells(atom.electrons);

  // Bond electrons are drawn separately between atoms. Every electron that
  // remains nonbonding stays on its atom's outer ring and continues orbiting.
  const nShells = shellCounts.length;
  shellCounts.forEach((count, i) => {
    const ringR = (nucleusRadius(atom) + 0.35 + (i + 1) * SHELL_GAP) * scale;
    ctx.strokeStyle = COLORS.ring;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, center.y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    const isBondedOuterShell = i === nShells - 1 && (bonding?.bondOrder ?? 0) > 0;
    const visibleCount = isBondedOuterShell ? bonding!.nonbondingElectrons : count;
    const start = (i * 0.6) + Math.PI / 2;
    const spin = clock * (0.32 / (i + 1)) * (i % 2 === 0 ? 1 : -1);
    const eR = Math.max(2.5, ELECTRON_DOT * scale);
    for (let j = 0; j < visibleCount; j++) {
      const ang = start + spin + (j / visibleCount) * Math.PI * 2;
      const ex = center.x + Math.cos(ang) * ringR;
      const ey = center.y + Math.sin(ang) * ringR;
      drawSphere(ex, ey, eR, COLORS.electron, eR > 3);
    }
  });
  void nShells;

  // hover feedback (not while selected)
  if (!selected && hoverAtom === atom.id) {
    ctx.strokeStyle = 'rgba(45,112,179,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(center.x, center.y, atomRadius(atom) * scale + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // nucleus
  drawNucleus(atom, center, scale);

  // selection halo: soft glow + dashed ring
  if (selected) {
    const haloR = atomRadius(atom) * scale + 6;
    const glow = ctx.createRadialGradient(center.x, center.y, haloR * 0.8, center.x, center.y, haloR + 12);
    glow.addColorStop(0, 'rgba(45,112,179,0)');
    glow.addColorStop(1, 'rgba(45,112,179,0.18)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(center.x, center.y, haloR + 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(center.x, center.y, haloR, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  void nR;
  drawAtomLabel(atom, center, scale);
}

function drawAtomLabel(atom: Atom, center: Vec2, scale: number): void {
  const info = atomInfo(atom);
  const y = center.y + atomRadius(atom) * scale + 14;
  const symbol = info.symbol;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // symbol + charge
  ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif';
  const symW = ctx.measureText(symbol).width;
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
  const chW = info.chargeLabel ? ctx.measureText(info.chargeLabel).width + 2 : 0;
  const line2 = `${atom.protons}p · ${atom.neutrons}n · ${atom.electrons}e`;
  ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace';
  const l2W = ctx.measureText(line2).width;

  const boxW = Math.max(symW + chW, l2W) + 16;
  const boxH = 34;
  ctx.save();
  ctx.shadowColor = 'rgba(16,24,40,0.14)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = COLORS.labelBg;
  roundRect(center.x - boxW / 2, y - 10, boxW, boxH, 7); ctx.fill();
  ctx.restore();

  ctx.fillStyle = info.charge === 0 ? COLORS.ink : info.charge > 0 ? COLORS.proton : COLORS.electron;
  ctx.textAlign = 'left';
  ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif';
  const sx = center.x - (symW + chW) / 2;
  ctx.fillText(symbol, sx, y - 1);
  if (info.chargeLabel) {
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(info.chargeLabel, sx + symW + 2, y - 6);
  }
  ctx.textAlign = 'center';
  ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(line2, center.x, y + 13);
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

// ---- bonds ----

interface BondGeometry {
  ux: number;
  uy: number;
  lanes: { start: Vec2; end: Vec2 }[];
}

function bondGeometry(bond: Bond, a: Atom, b: Atom): BondGeometry {
  const { scale } = chem.getState().view;
  const ca = toScreen(a.x, a.y), cb = toScreen(b.x, b.y);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const perp = { x: -uy, y: ux };
  const ra = atomRadius(a) * scale, rb = atomRadius(b) * scale;
  const count = bond.kind === 'covalent' ? bond.order : 1;
  const electronR = Math.max(2.5, ELECTRON_DOT * scale);
  const laneGap = Math.max(8, electronR * 2.25);
  const lanes = Array.from({ length: count }, (_, i) => {
    const offset = (i - (count - 1) / 2) * laneGap;
    // Intersect each bond lane with both outer-shell circles. This keeps double
    // bond lanes attached to the rings instead of floating beside them.
    const reachA = Math.sqrt(Math.max(0, ra * ra - offset * offset));
    const reachB = Math.sqrt(Math.max(0, rb * rb - offset * offset));
    return {
      start: { x: ca.x + ux * reachA + perp.x * offset, y: ca.y + uy * reachA + perp.y * offset },
      end: { x: cb.x - ux * reachB + perp.x * offset, y: cb.y - uy * reachB + perp.y * offset },
    };
  });
  return { ux, uy, lanes };
}

function drawBond(bond: Bond, selected: boolean): void {
  const a = chem.atomById(bond.a), b = chem.atomById(bond.b);
  if (!a || !b) return;
  const geometry = bondGeometry(bond, a, b);
  const { ux, uy } = geometry;

  ctx.lineCap = 'round';
  // soft shadow under the bond for a little lift
  ctx.save();
  ctx.strokeStyle = 'rgba(16,24,40,0.10)';
  ctx.lineWidth = bond.kind === 'ionic' ? 3.5 : (2.4 + (bond.order - 1) * 4);
  for (const lane of geometry.lanes) {
    ctx.beginPath(); ctx.moveTo(lane.start.x, lane.start.y + 1.5); ctx.lineTo(lane.end.x, lane.end.y + 1.5); ctx.stroke();
  }
  ctx.restore();

  if (bond.kind === 'ionic') {
    const { start, end } = geometry.lanes[0];
    ctx.strokeStyle = selected ? COLORS.select : COLORS.ionic;
    ctx.lineWidth = selected ? 3 : 2.2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.setLineDash([]);
    // little + / - near each end
    ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = COLORS.ionic;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+', start.x + ux * 12, start.y + uy * 12);
    ctx.fillText('−', end.x - ux * 12, end.y - uy * 12);
  } else {
    ctx.strokeStyle = selected ? COLORS.select : COLORS.bond;
    ctx.lineWidth = selected ? 3 : 2.4;
    for (const { start, end } of geometry.lanes) {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }
}

function drawBondElectrons(bond: Bond): void {
  if (bond.kind !== 'covalent') return;
  const a = chem.atomById(bond.a), b = chem.atomById(bond.b);
  if (!a || !b) return;
  const { scale } = chem.getState().view;
  const electronR = Math.max(2.5, ELECTRON_DOT * scale);
  const geometry = bondGeometry(bond, a, b);
  for (const { start, end } of geometry.lanes) {
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const halfGap = Math.min(electronR * 1.2, Math.max(electronR, Math.hypot(end.x - start.x, end.y - start.y) / 4));
    drawSphere(mid.x - geometry.ux * halfGap, mid.y - geometry.uy * halfGap, electronR, COLORS.bondElectron, electronR > 3);
    drawSphere(mid.x + geometry.ux * halfGap, mid.y + geometry.uy * halfGap, electronR, COLORS.bondElectron, electronR > 3);
  }
}

// ---- interaction state ----

let bondMode = false;
let bondFrom: string | null = null;
let hoverAtom: string | null = null;
let pointer: Vec2 = { x: 0, y: 0 };

export function setBondMode(on: boolean): void {
  bondMode = on;
  bondFrom = null;
  chem.setMessage(on ? 'Bond mode: click one atom, then another to bond them.' : null);
  canvas.style.cursor = on ? 'crosshair' : 'default';
}
export function isBondMode(): boolean { return bondMode; }

/** Metal + non-metal defaults to ionic, otherwise covalent. */
export function suggestBondKind(aId: string, bId: string): BondKind {
  const a = chem.atomById(aId), b = chem.atomById(bId);
  const catA = a ? elementByZ(a.protons)?.category : undefined;
  const catB = b ? elementByZ(b.protons)?.category : undefined;
  const metal = (c?: string) =>
    c === 'alkali' || c === 'alkaline' || c === 'transition' || c === 'post-transition' ||
    c === 'lanthanide' || c === 'actinide';
  const nonmetal = (c?: string) => c === 'nonmetal' || c === 'halogen';
  if ((metal(catA) && nonmetal(catB)) || (metal(catB) && nonmetal(catA))) return 'ionic';
  return 'covalent';
}

// ---- draw loop ----

function draw(): void {
  if (!ctx) return;
  const { W, H } = dims();
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  drawGrid();

  const state = chem.getState();
  const analysis = analyzeStructure(state);
  for (const bond of state.bonds) drawBond(bond, bond.id === state.selectedBondId);
  for (const atom of state.atoms) drawAtom(atom, atom.id === state.selectedId, analysis.atoms.get(atom.id));
  for (const bond of state.bonds) drawBondElectrons(bond);

  // bond rubber-band
  if (bondMode && bondFrom) {
    const from = chem.atomById(bondFrom);
    if (from) {
      const c = toScreen(from.x, from.y);
      ctx.strokeStyle = COLORS.select; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(pointer.x, pointer.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  clock += dt;
  draw();
  requestAnimationFrame(frame);
}

// ---- hit testing ----

function atomAt(px: number, py: number): string | null {
  const state = chem.getState();
  const { scale } = state.view;
  for (let i = state.atoms.length - 1; i >= 0; i--) {
    const a = state.atoms[i];
    const c = toScreen(a.x, a.y);
    if (Math.hypot(c.x - px, c.y - py) <= atomRadius(a) * scale + 4) return a.id;
  }
  return null;
}
function bondAt(px: number, py: number): string | null {
  const state = chem.getState();
  let best: string | null = null; let bestD = 7;
  for (const bond of state.bonds) {
    const a = chem.atomById(bond.a), b = chem.atomById(bond.b);
    if (!a || !b) continue;
    const ca = toScreen(a.x, a.y), cb = toScreen(b.x, b.y);
    const d = distToSegment({ x: px, y: py }, ca, cb);
    if (d < bestD) { bestD = d; best = bond.id; }
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

// ---- pointer interaction ----

interface Drag { kind: 'pan' | 'move' | 'none'; atomId?: string; startWorld?: Vec2; atomStart?: Vec2; downClient?: Vec2; moved?: boolean; }
let drag: Drag = { kind: 'none' };

function attachInteraction(): void {
  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.offsetX, y: e.offsetY };
    if (drag.kind === 'pan') {
      const w = toWorld(e.offsetX, e.offsetY);
      chem.setView({
        originX: chem.getState().view.originX - (w.x - drag.startWorld!.x),
        originY: chem.getState().view.originY - (w.y - drag.startWorld!.y),
      });
      return;
    }
    if (drag.kind === 'move' && drag.atomId) {
      const dist = Math.hypot(e.offsetX - drag.downClient!.x, e.offsetY - drag.downClient!.y);
      if (!drag.moved && dist < 4) return;
      const w = toWorld(e.offsetX, e.offsetY);
      drag.moved = true;
      chem.moveAtom(drag.atomId, drag.atomStart!.x + (w.x - drag.startWorld!.x), drag.atomStart!.y + (w.y - drag.startWorld!.y), false);
      return;
    }
    if (!bondMode) hoverAtom = atomAt(e.offsetX, e.offsetY);
    canvas.style.cursor = bondMode ? 'crosshair' : hoverAtom ? 'grab' : bondAt(e.offsetX, e.offsetY) ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointer = { x: e.offsetX, y: e.offsetY };
    const atom = atomAt(e.offsetX, e.offsetY);

    if (bondMode) {
      if (atom) {
        if (!bondFrom) { bondFrom = atom; chem.setSelected(atom); }
        else if (bondFrom !== atom) {
          const kind = suggestBondKind(bondFrom, atom);
          chem.addBond(bondFrom, atom, kind, kind === 'covalent' ? 1 : 1);
          bondFrom = null;
        } else { bondFrom = null; }
      } else { bondFrom = null; }
      return;
    }

    if (atom) {
      const a = chem.atomById(atom)!;
      chem.setSelected(atom);
      drag = { kind: 'move', atomId: atom, startWorld: toWorld(e.offsetX, e.offsetY), atomStart: { x: a.x, y: a.y }, downClient: { x: e.offsetX, y: e.offsetY }, moved: false };
      canvas.style.cursor = 'grabbing';
      return;
    }
    const bond = bondAt(e.offsetX, e.offsetY);
    if (bond) { chem.setSelectedBond(bond); return; }

    chem.setSelected(null); chem.setSelectedBond(null);
    drag = { kind: 'pan', startWorld: toWorld(e.offsetX, e.offsetY) };
    canvas.style.cursor = 'grabbing';
  });

  const end = (): void => {
    if (drag.kind === 'move' && drag.atomId && drag.moved) {
      const a = chem.atomById(drag.atomId);
      if (a) chem.moveAtom(drag.atomId, Math.round(a.x), Math.round(a.y), true);
      chem.commitHistory();
    }
    drag = { kind: 'none' };
    canvas.style.cursor = 'default';
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = toWorld(e.offsetX, e.offsetY);
    const scale = Math.max(24, Math.min(160, chem.getState().view.scale * Math.exp(-e.deltaY * 0.0015)));
    chem.setView({ scale });
    const after = toWorld(e.offsetX, e.offsetY);
    chem.setView({ originX: chem.getState().view.originX + (before.x - after.x), originY: chem.getState().view.originY + (before.y - after.y) });
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === 'Escape') { if (bondMode) setBondMode(false); chem.setSelected(null); chem.setSelectedBond(null); return; }
    const st = chem.getState();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (st.selectedBondId) { chem.removeBond(st.selectedBondId); e.preventDefault(); }
      else if (st.selectedId) { chem.removeAtom(st.selectedId); e.preventDefault(); }
    }
  });
}

/** Frame all atoms in the viewport with a little padding. */
export function fitView(): void {
  const atoms = chem.getState().atoms;
  if (atoms.length === 0 || !canvas) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of atoms) {
    const r = atomRadius(a) + 0.6;
    minX = Math.min(minX, a.x - r); maxX = Math.max(maxX, a.x + r);
    minY = Math.min(minY, a.y - r); maxY = Math.max(maxY, a.y + r + 0.9); // label sits below
  }
  const { W, H } = dims();
  const worldW = Math.max(1, maxX - minX), worldH = Math.max(1, maxY - minY);
  const scale = Math.max(24, Math.min(90, Math.min(W / worldW, H / worldH) * 0.92));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  chem.setView({ scale, originX: cx - (W / scale) / 2, originY: cy - (H / scale) / 2 });
}

/** Place an atom of element Z at a viewport-client point (for palette drops). */
export function clientToGrid(clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  const w = toWorld(clientX - rect.left, clientY - rect.top);
  return { x: Math.round(w.x), y: Math.round(w.y) };
}
