// Cursor snapping for the 2D board, and the curve-crossing search behind it.
//
// Three tiers of magnetism, weakest to strongest:
//   'curve'        anywhere along a plotted curve -- the cursor slides freely
//   'curve-grid'   where a curve crosses one of the graph's own grid lines
//   'curve-curve'  where two plotted curves cross each other
//
// The tiers differ only in how large a radius pulls the cursor in. A crossing
// of two of the student's own curves is the most meaningful point on the board,
// so it grabs from furthest away; a grid crossing is a weaker convenience.
//
// Radii are in screen pixels, not graph units, so the feel does not change as
// the viewport zooms.

import { getState, scope } from './store';
import type { Expression, Viewport } from './types';

// Every radius below is deliberately tight. Snapping should feel like the
// cursor settling onto a line it was already near, not like a force the student
// has to fight; a grabby snap is something to work around rather than use.

/** How far a curve reaches out to catch the cursor, perpendicular to itself. */
const CURVE_CAPTURE_PX = 17;
/** How far the cursor must be dragged to break free of a curve it is riding. */
const CURVE_RELEASE_PX = 25;

/** Radial pull of a curve/grid-line crossing. */
const GRID_CROSS_CAPTURE_PX = 6;
const GRID_CROSS_RELEASE_PX = 9;

/**
 * Radial pull of a curve/curve crossing -- the strongest tier, near twice the
 * grid-crossing reach. Deliberately smaller than the curve's own perpendicular
 * capture: it has to leave a band where the cursor is visibly near a crossing
 * without being on it, which is when that crossing's marker stands down.
 */
const CURVE_CROSS_CAPTURE_PX = 10;
const CURVE_CROSS_RELEASE_PX = 15;

/** Inside this radius an intersection's marker gives way to the cursor's own. */
export const MARKER_HIDE_RADIUS_PX = 36;

/** Above this many crossings the board is too busy to mark them all. */
export const MAX_MARKED_INTERSECTIONS = 3;

export type SnapKind = 'curve' | 'curve-grid' | 'curve-curve';

export interface SnapHit {
  x: number;
  y: number;
  kind: SnapKind;
  /** Expression ids involved: one for a curve, two for a curve/curve crossing. */
  curves: string[];
}

export interface Intersection {
  x: number;
  y: number;
  a: string; // expression id
  b: string;
}

/** Everything the resolver needs to convert graph units to screen pixels. */
export interface SnapContext {
  pxPerX: number;
  pxPerY: number;
  minorX: number; // spacing of the finest vertical grid line
  minorY: number;
}

/* ---------------- evaluation ---------------- */

function evaluator(expr: Expression, varName: string): (v: number) => number {
  const base = scope();
  const fn = expr.fn;
  if (!fn) return () => NaN;
  return (v) => {
    try {
      base[varName] = v;
      const out = fn.evaluate(base);
      return typeof out === 'number' ? out : Number(out);
    } catch { return NaN; }
  };
}

function plottableCurves(): Expression[] {
  return getState().expressions.filter(
    (e) => e.visible && !e.error && e.fn
      && (e.kind === 'explicit_y' || e.kind === 'explicit_x'),
  );
}

/* ---------------- curve/curve intersections ---------------- */

const SAMPLES = 900;

function bisect(h: (v: number) => number, lo: number, hi: number): number {
  let a = lo, b = hi;
  let fa = h(a);
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const fm = h(m);
    if (!Number.isFinite(fm)) return m;
    if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else { b = m; }
  }
  return (a + b) / 2;
}

/** Location of the smallest |h| on [a, b], by ternary search. */
function minimiseAbs(h: (v: number) => number, a: number, b: number): number {
  let lo = a, hi = b;
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const g1 = Math.abs(h(m1));
    const g2 = Math.abs(h(m2));
    if (!Number.isFinite(g1) || !Number.isFinite(g2)) break;
    if (g1 <= g2) hi = m2; else lo = m1;
  }
  return (lo + hi) / 2;
}

/** Beyond this a pair is coincident or too dense to have useful crossings. */
const MAX_ROOTS_PER_PAIR = 64;

/**
 * Roots of `h` over [lo, hi]. `scale` is the magnitude of h's own output (the
 * viewport span in whichever axis h measures), used to judge how near zero
 * counts as a root.
 *
 * Two things have to be caught beyond a plain sign change. A root landing
 * exactly on a sample never changes sign, and neither does a *tangency* -- two
 * curves that touch without crossing, like y = x² meeting y = 0 at the origin,
 * where the difference dips to zero and comes straight back up. Tangencies are
 * found by refining each local minimum of |h| and asking whether it reaches
 * zero.
 */
function roots(h: (v: number) => number, lo: number, hi: number, scale: number): number[] {
  const out: number[] = [];
  const step = (hi - lo) / SAMPLES;

  // A crossing bisects to |h| ~ 0; a sign flip across a pole leaves it huge.
  const poleTolerance = scale * 1e-3;
  // A refined touch reaches zero; a curve that merely comes close does not.
  const touchTolerance = scale * 1e-6;
  // Only bother refining dips that are already plausibly near zero.
  const dipGate = scale * 1e-2;

  const at: number[] = new Array(SAMPLES + 1);
  let nearZero = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    at[i] = h(lo + i * step);
    if (Number.isFinite(at[i]) && Math.abs(at[i]) < touchTolerance) nearZero++;
  }
  // Curves that lie on top of each other have no isolated crossing to mark.
  if (nearZero > SAMPLES * 0.25) return [];

  for (let i = 0; i <= SAMPLES; i++) {
    const v = lo + i * step;
    const val = at[i];
    if (!Number.isFinite(val)) continue;

    if (val === 0) {
      // Exactly on a sample: no sign change happens, so catch it here. This is
      // the common case for the tidy numbers a lesson is built from.
      out.push(v);
      continue;
    }

    const prevVal = i > 0 ? at[i - 1] : NaN;
    if (
      Number.isFinite(prevVal) && prevVal !== 0
      && (prevVal < 0) !== (val < 0)
    ) {
      const r = bisect(h, lo + (i - 1) * step, v);
      if (Number.isFinite(h(r)) && Math.abs(h(r)) < poleTolerance) out.push(r);
      continue;
    }

    // A tangency shows up as a dip in |h| with no sign change either side.
    const nextVal = i < SAMPLES ? at[i + 1] : NaN;
    if (
      i > 0 && i < SAMPLES
      && Number.isFinite(prevVal) && Number.isFinite(nextVal)
      && Math.abs(val) < dipGate
      && Math.abs(val) <= Math.abs(prevVal) && Math.abs(val) <= Math.abs(nextVal)
    ) {
      const r = minimiseAbs(h, lo + (i - 1) * step, lo + (i + 1) * step);
      if (Number.isFinite(h(r)) && Math.abs(h(r)) < touchTolerance) out.push(r);
    }

    if (out.length > MAX_ROOTS_PER_PAIR) return out.slice(0, MAX_ROOTS_PER_PAIR);
  }
  return out;
}

function crossingsOf(a: Expression, b: Expression, view: Viewport): Intersection[] {
  const out: Intersection[] = [];
  const { xmin, xmax, ymin, ymax } = view;

  // `roots` needs the scale of h's *output*, which is the span of whichever
  // axis the difference is measured in -- not the axis being searched over.
  const xSpan = Math.abs(xmax - xmin);
  const ySpan = Math.abs(ymax - ymin);

  if (a.kind === 'explicit_y' && b.kind === 'explicit_y') {
    const f = evaluator(a, 'x'), g = evaluator(b, 'x');
    for (const x of roots((v) => f(v) - g(v), xmin, xmax, ySpan)) {
      const y = f(x);
      if (Number.isFinite(y) && y >= ymin && y <= ymax) out.push({ x, y, a: a.id, b: b.id });
    }
  } else if (a.kind === 'explicit_x' && b.kind === 'explicit_x') {
    const f = evaluator(a, 'y'), g = evaluator(b, 'y');
    for (const y of roots((v) => f(v) - g(v), ymin, ymax, xSpan)) {
      const x = f(y);
      if (Number.isFinite(x) && x >= xmin && x <= xmax) out.push({ x, y, a: a.id, b: b.id });
    }
  } else {
    // One of each: y = f(x) and x = g(y) meet where g(f(x)) = x.
    const yOfX = a.kind === 'explicit_y' ? a : b;
    const xOfY = a.kind === 'explicit_y' ? b : a;
    const f = evaluator(yOfX, 'x'), g = evaluator(xOfY, 'y');
    for (const x of roots((v) => g(f(v)) - v, xmin, xmax, xSpan)) {
      const y = f(x);
      if (Number.isFinite(y) && y >= ymin && y <= ymax) out.push({ x, y, a: yOfX.id, b: xOfY.id });
    }
  }
  return out;
}

/** Drop crossings that land on top of each other (tangency, repeated roots). */
function dedupe(list: Intersection[], view: Viewport): Intersection[] {
  const tolX = (view.xmax - view.xmin) * 1e-3;
  const tolY = (view.ymax - view.ymin) * 1e-3;
  const out: Intersection[] = [];
  for (const p of list) {
    if (out.some((q) => Math.abs(q.x - p.x) < tolX && Math.abs(q.y - p.y) < tolY)) continue;
    out.push(p);
  }
  return out;
}

// The search is far too slow to redo on every pointermove, so it is memoised on
// everything that could change the answer: the curves, the sliders they use and
// the visible window.
let cacheKey = '';
let cached: Intersection[] = [];

function intersectionKey(curves: Expression[], view: Viewport): string {
  const vars = JSON.stringify(scope());
  const src = curves.map((e) => `${e.id}:${e.kind}:${e.source ?? e.latex}`).join('|');
  const box = [view.xmin, view.xmax, view.ymin, view.ymax].map((v) => v.toFixed(6)).join(',');
  return `${src}#${vars}#${box}`;
}

/** Every crossing of two visible curves inside the current viewport. */
export function curveIntersections(): Intersection[] {
  const view = getState().viewport;
  const curves = plottableCurves();
  const key = intersectionKey(curves, view);
  if (key === cacheKey) return cached;

  const found: Intersection[] = [];
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      found.push(...crossingsOf(curves[i], curves[j], view));
    }
  }
  cacheKey = key;
  cached = dedupe(found, view);
  return cached;
}

/* ---------------- snap resolution ---------------- */

function pxDist(ax: number, ay: number, bx: number, by: number, ctx: SnapContext): number {
  return Math.hypot((ax - bx) * ctx.pxPerX, (ay - by) * ctx.pxPerY);
}

/** The point on the nearest curve under the cursor, if one is close enough. */
function nearestCurvePoint(
  rawX: number,
  rawY: number,
  ctx: SnapContext,
  holding: string | null,
): { x: number; y: number; id: string; px: number } | null {
  let best: { x: number; y: number; id: string; px: number } | null = null;
  for (const expr of plottableCurves()) {
    // A curve the cursor is already riding keeps hold of it for longer, so the
    // pointer does not fall off the moment it wavers -- but a firm pull frees it.
    const limit = expr.id === holding ? CURVE_RELEASE_PX : CURVE_CAPTURE_PX;
    if (expr.kind === 'explicit_y') {
      const y = evaluator(expr, 'x')(rawX);
      if (!Number.isFinite(y)) continue;
      const px = Math.abs(rawY - y) * ctx.pxPerY;
      if (px <= limit && (!best || px < best.px)) best = { x: rawX, y, id: expr.id, px };
    } else {
      const x = evaluator(expr, 'y')(rawY);
      if (!Number.isFinite(x)) continue;
      const px = Math.abs(rawX - x) * ctx.pxPerX;
      if (px <= limit && (!best || px < best.px)) best = { x, y: rawY, id: expr.id, px };
    }
  }
  return best;
}

/** Where the given curve crosses the nearest grid line, if that is close by. */
function gridCrossing(
  expr: Expression,
  rawX: number,
  rawY: number,
  ctx: SnapContext,
  limit: number,
): { x: number; y: number } | null {
  if (expr.kind === 'explicit_y') {
    const gx = Math.round(rawX / ctx.minorX) * ctx.minorX;
    const gy = evaluator(expr, 'x')(gx);
    if (!Number.isFinite(gy)) return null;
    if (pxDist(rawX, rawY, gx, gy, ctx) > limit) return null;
    return { x: gx, y: gy };
  }
  const gy = Math.round(rawY / ctx.minorY) * ctx.minorY;
  const gx = evaluator(expr, 'y')(gy);
  if (!Number.isFinite(gx)) return null;
  if (pxDist(rawX, rawY, gx, gy, ctx) > limit) return null;
  return { x: gx, y: gy };
}

/**
 * Decide where the cursor should sit. `previous` is the last hit, used so a
 * snap the cursor is already holding is harder to leave than it was to enter.
 */
export function resolveSnap(
  rawX: number,
  rawY: number,
  ctx: SnapContext,
  previous: SnapHit | null,
): SnapHit | null {
  // A collapsed stage gives a zero-width canvas and hence a zero pixel scale,
  // which would make every point read as zero pixels away and snap to the first
  // curve it found. Better to offer no snapping at all than a wrong one.
  if (!(ctx.pxPerX > 0) || !(ctx.pxPerY > 0)) return null;
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;

  // Strongest tier first: a crossing of two curves outranks everything nearby.
  const heldCrossing = previous?.kind === 'curve-curve' ? previous : null;
  let bestCross: { hit: Intersection; px: number } | null = null;
  for (const p of curveIntersections()) {
    const holding = heldCrossing
      && Math.abs(heldCrossing.x - p.x) < 1e-9 && Math.abs(heldCrossing.y - p.y) < 1e-9;
    const limit = holding ? CURVE_CROSS_RELEASE_PX : CURVE_CROSS_CAPTURE_PX;
    const px = pxDist(rawX, rawY, p.x, p.y, ctx);
    if (px <= limit && (!bestCross || px < bestCross.px)) bestCross = { hit: p, px };
  }
  if (bestCross) {
    return { x: bestCross.hit.x, y: bestCross.hit.y, kind: 'curve-curve', curves: [bestCross.hit.a, bestCross.hit.b] };
  }

  const holdingCurve = previous ? previous.curves[0] ?? null : null;
  const onCurve = nearestCurvePoint(rawX, rawY, ctx, holdingCurve);
  if (!onCurve) return null;

  const expr = plottableCurves().find((e) => e.id === onCurve.id);
  if (expr) {
    const limit = previous?.kind === 'curve-grid' ? GRID_CROSS_RELEASE_PX : GRID_CROSS_CAPTURE_PX;
    const node = gridCrossing(expr, rawX, rawY, ctx, limit);
    if (node) return { x: node.x, y: node.y, kind: 'curve-grid', curves: [onCurve.id] };
  }

  return { x: onCurve.x, y: onCurve.y, kind: 'curve', curves: [onCurve.id] };
}
