// Oscilloscope canvas. Read-only: it plots whatever trace samples the store has
// accumulated during the transient run. Auto-scales the vertical axis to the
// data and scrolls a fixed-width time window horizontally.

import * as circuit from './store';
import type { ScopeTrace } from './types';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let dpr = 1;

const COLORS = {
  bg: '#0f172a',
  grid: 'rgba(255,255,255,0.08)',
  axis: 'rgba(255,255,255,0.35)',
  text: 'rgba(226,232,240,0.85)',
  muted: 'rgba(148,163,184,0.9)',
};

export function initScope(canvasEl: HTMLCanvasElement): void {
  canvas = canvasEl;
  ctx = canvas.getContext('2d')!;
  resizeScope();
  window.addEventListener('resize', resizeScope);
  requestAnimationFrame(frame);
}

export function resizeScope(): void {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function dims(): { W: number; H: number } {
  return { W: canvas.width / dpr, H: canvas.height / dpr };
}

interface Bounds { tMin: number; tMax: number; vMin: number; vMax: number; }

function bounds(traces: ScopeTrace[], windowSeconds: number): Bounds {
  let tMax = 0;
  let vMin = Infinity, vMax = -Infinity;
  for (const tr of traces) {
    for (const s of tr.samples) {
      if (s.t > tMax) tMax = s.t;
      if (s.v < vMin) vMin = s.v;
      if (s.v > vMax) vMax = s.v;
    }
  }
  if (!Number.isFinite(vMin)) { vMin = -1; vMax = 1; }
  if (vMax - vMin < 1e-6) { vMax += 1; vMin -= 1; }
  const pad = (vMax - vMin) * 0.12;
  vMin -= pad; vMax += pad;
  // Always show zero if the data straddles it or sits close.
  if (vMin > 0 && vMin < (vMax - vMin) * 0.5) vMin = 0;
  if (vMax < 0 && vMax > -(vMax - vMin) * 0.5) vMax = 0;
  const tMin = Math.max(0, tMax - windowSeconds);
  return { tMin, tMax: Math.max(tMax, tMin + windowSeconds), vMin, vMax };
}

const PAD_L = 46, PAD_R = 10, PAD_T = 10, PAD_B = 22;

function draw(): void {
  if (!ctx) return;
  const { W, H } = dims();
  const scope = circuit.getState().scope;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  if (scope.traces.length === 0) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Select a part and add a V or I probe to plot it over time.', W / 2, H / 2);
    ctx.restore();
    return;
  }

  const b = bounds(scope.traces, scope.windowSeconds);
  const toX = (t: number): number => PAD_L + ((t - b.tMin) / (b.tMax - b.tMin || 1)) * plotW;
  const toY = (v: number): number => PAD_T + (1 - (v - b.vMin) / (b.vMax - b.vMin || 1)) * plotH;

  // grid + y labels
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.text;
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const v = b.vMin + (i / yTicks) * (b.vMax - b.vMin);
    const y = Math.round(toY(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
    ctx.fillText(v.toFixed(Math.abs(v) < 10 ? 1 : 0), PAD_L - 5, y);
  }
  // zero line brighter
  if (b.vMin < 0 && b.vMax > 0) {
    ctx.strokeStyle = COLORS.axis;
    const y0 = Math.round(toY(0)) + 0.5;
    ctx.beginPath(); ctx.moveTo(PAD_L, y0); ctx.lineTo(W - PAD_R, y0); ctx.stroke();
  }

  // x axis (time) labels
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const xTicks = 5;
  for (let i = 0; i <= xTicks; i++) {
    const t = b.tMin + (i / xTicks) * (b.tMax - b.tMin);
    ctx.fillText(`${t.toFixed(1)}s`, toX(t), H - PAD_B + 5);
  }

  // clip to plot area
  ctx.save();
  ctx.beginPath(); ctx.rect(PAD_L, PAD_T, plotW, plotH); ctx.clip();
  for (const tr of scope.traces) {
    if (tr.samples.length < 2) continue;
    ctx.strokeStyle = tr.color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (const s of tr.samples) {
      const x = toX(s.t), y = toY(s.v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // marker at the newest sample
    const last = tr.samples[tr.samples.length - 1];
    ctx.fillStyle = tr.color;
    ctx.beginPath(); ctx.arc(toX(last.t), toY(last.v), 2.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function frame(): void {
  const scope = circuit.getState().scope;
  if (scope.visible) draw();
  requestAnimationFrame(frame);
}
