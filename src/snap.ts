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

import { getState, pointCoordinates, scope } from './store';
import type { Expression, Viewport } from './types';

/** A point in graph space. */
interface Vec2 { x: number; y: number }

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
const POINT_CAPTURE_PX = 12;
const POINT_RELEASE_PX = 18;

/** Inside this radius an intersection's marker gives way to the cursor's own. */
export const MARKER_HIDE_RADIUS_PX = 36;

/** Above this many crossings the board is too busy to mark them all. */
export const MAX_MARKED_INTERSECTIONS = 3;

export type SnapKind = 'point' | 'curve' | 'curve-grid' | 'curve-curve';

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

/** Evaluate a two-variable expression, used for implicit F(x, y). */
function evaluator2(expr: Expression): (x: number, y: number) => number {
  const base = scope();
  const fn = expr.fn;
  if (!fn) return () => NaN;
  return (x, y) => {
    try {
      base.x = x;
      base.y = y;
      const out = fn.evaluate(base);
      return typeof out === 'number' ? out : Number(out);
    } catch { return NaN; }
  };
}

/**
 * What a curve can offer the snapper, whatever kind it is.
 *
 * `field` is a signed quantity that is zero exactly on the curve, so another
 * curve can be walked against it to find crossings. `param` is a natural
 * parameterisation, so this curve can be the one doing the walking. Between
 * them every pair of curves can be handled: explicit and implicit curves have
 * both, polar curves have only a parameterisation.
 */
interface CurveModel {
  expr: Expression;
  field: ((x: number, y: number) => number) | null;
  /**
   * The implicit F before gradient-normalising. It has the same zero set and
   * the same sign, so it is what to use for detecting a crossing; only judging
   * *how near* zero something is needs the normalised `field`, which costs five
   * evaluations instead of one.
   */
  raw: ((x: number, y: number) => number) | null;
  param: { lo: number; hi: number; at: (t: number) => Vec2 } | null;
  /** Sampled points, for nearest-point search on curves without a closed form. */
  samples: Vec2[] | null;
}

/**
 * Two full turns, matching what the renderer draws for a polar curve. The
 * sample count only has to be fine enough to pick the right neighbourhood --
 * a ternary search refines from there against the real parameterisation -- and
 * each sample costs an expression evaluation, so it is kept modest.
 */
const POLAR_TURNS = 2;
const POLAR_SAMPLES = 600;

function buildCurve(expr: Expression, view: Viewport): CurveModel | null {
  if (!expr.visible || expr.error || !expr.fn) return null;

  if (expr.kind === 'explicit_y') {
    const f = evaluator(expr, 'x');
    return {
      expr,
      field: (x, y) => y - f(x),
      raw: null,
      param: { lo: view.xmin, hi: view.xmax, at: (x) => ({ x, y: f(x) }) },
      samples: null,
    };
  }
  if (expr.kind === 'explicit_x') {
    const g = evaluator(expr, 'y');
    return {
      expr,
      field: (x, y) => x - g(y),
      raw: null,
      param: { lo: view.ymin, hi: view.ymax, at: (y) => ({ x: g(y), y }) },
      samples: null,
    };
  }
  if (expr.kind === 'polar') {
    const f = evaluator(expr, 'theta');
    const at = (t: number): Vec2 => {
      const r = f(t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    };
    const samples: Vec2[] = [];
    for (let i = 0; i <= POLAR_SAMPLES; i++) {
      samples.push(at((i / POLAR_SAMPLES) * POLAR_TURNS * Math.PI * 2));
    }
    // No scalar field: "distance from the curve" is not a single-valued
    // function of (x, y) once the spiral overlaps itself.
    return { expr, field: null, raw: null, param: { lo: 0, hi: POLAR_TURNS * Math.PI * 2, at }, samples };
  }
  if (expr.kind === 'implicit') {
    const F = evaluator2(expr);
    const hx = (view.xmax - view.xmin) * 1e-5;
    const hy = (view.ymax - view.ymin) * 1e-5;
    // F itself has arbitrary magnitude (x²+y²−25 is ~10 a unit off the circle),
    // so divide by the gradient: that turns it into an approximate signed
    // distance and lets one tolerance serve every implicit curve.
    const field = (x: number, y: number): number => {
      const v = F(x, y);
      if (!Number.isFinite(v)) return NaN;
      const gx = (F(x + hx, y) - F(x - hx, y)) / (2 * hx);
      const gy = (F(x, y + hy) - F(x, y - hy)) / (2 * hy);
      const mag = Math.hypot(gx, gy);
      if (!Number.isFinite(mag) || mag < 1e-12) return v > 0 ? Infinity : -Infinity;
      return v / mag;
    };
    return { expr, field, raw: F, param: null, samples: null };
  }
  return null;
}

let curveCacheKey = '';
let curveCache: CurveModel[] = [];

function curveModels(): CurveModel[] {
  const view = getState().viewport;
  const visible = getState().expressions.filter((e) => e.visible && !e.error && e.fn);
  const key = modelKey(visible, view);
  if (key === curveCacheKey) return curveCache;
  curveCacheKey = key;
  curveCache = visible
    .map((e) => buildCurve(e, view))
    .filter((c): c is CurveModel => c !== null);
  return curveCache;
}

function modelKey(curves: Expression[], view: Viewport): string {
  const vars = JSON.stringify(scope());
  const src = curves.map((e) => `${e.id}:${e.kind}:${e.source ?? e.latex}`).join('|');
  const box = [view.xmin, view.xmax, view.ymin, view.ymax].map((v) => v.toFixed(6)).join(',');
  return `${src}#${vars}#${box}`;
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
function roots(
  h: (v: number) => number,
  lo: number,
  hi: number,
  scale: number,
  /** Distance-like magnitude at a parameter, for the tolerance tests. Defaults
   *  to |h|, which is right whenever h is already measured in graph units. */
  measure: (v: number) => number = (v) => Math.abs(h(v)),
): number[] {
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
    if (Number.isFinite(at[i]) && at[i] === 0) nearZero++;
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
      if (measure(r) < poleTolerance) out.push(r);
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
      if (measure(r) < touchTolerance) out.push(r);
    }

    if (out.length > MAX_ROOTS_PER_PAIR) return out.slice(0, MAX_ROOTS_PER_PAIR);
  }
  return out;
}

/**
 * Where two sampled polylines cross, for the pair that has nothing better.
 * Comparing every segment against every other is quadratic, so both are thinned
 * first: at this density the chord strays from the curve by far less than a
 * pixel, and the loop drops from millions of pairs to tens of thousands.
 */
const POLYLINE_CROSS_SAMPLES = 250;

function thin(points: Vec2[]): Vec2[] {
  const stride = Math.max(1, Math.ceil(points.length / POLYLINE_CROSS_SAMPLES));
  if (stride === 1) return points;
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

function polylineCrossings(rawA: Vec2[], rawB: Vec2[]): Vec2[] {
  const a = thin(rawA);
  const b = thin(rawB);
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < a.length; i++) {
    const p1 = a[i], p2 = a[i + 1];
    if (!Number.isFinite(p1.x) || !Number.isFinite(p2.x)) continue;
    for (let j = 0; j + 1 < b.length; j++) {
      const q1 = b[j], q2 = b[j + 1];
      if (!Number.isFinite(q1.x) || !Number.isFinite(q2.x)) continue;
      const rx = p2.x - p1.x, ry = p2.y - p1.y;
      const sx = q2.x - q1.x, sy = q2.y - q1.y;
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) < 1e-15) continue;
      const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / denom;
      const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / denom;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      out.push({ x: p1.x + rx * t, y: p1.y + ry * t });
      if (out.length > MAX_ROOTS_PER_PAIR) return out;
    }
  }
  return out;
}

/**
 * Crossings of two implicit curves. Neither can walk the other, so scan a grid
 * for cells where both fields change sign and refine each hit with a 2D Newton
 * step on the pair.
 */
function implicitPairCrossings(
  fa: (x: number, y: number) => number,
  fb: (x: number, y: number) => number,
  view: Viewport,
): Vec2[] {
  const N = 72;
  const dx = (view.xmax - view.xmin) / N;
  const dy = (view.ymax - view.ymin) / N;
  const out: Vec2[] = [];

  // Sample each field once per grid *vertex*, not once per cell corner: every
  // interior vertex is shared by four cells, so this is a quarter of the work.
  const stride = N + 1;
  const ga = new Float64Array(stride * stride);
  const gb = new Float64Array(stride * stride);
  for (let j = 0; j <= N; j++) {
    const y = view.ymin + j * dy;
    for (let i = 0; i <= N; i++) {
      const x = view.xmin + i * dx;
      ga[j * stride + i] = fa(x, y);
      gb[j * stride + i] = fb(x, y);
    }
  }

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x0 = view.xmin + i * dx, y0 = view.ymin + j * dy;
      const idx = [j * stride + i, j * stride + i + 1, (j + 1) * stride + i + 1, (j + 1) * stride + i];
      const av = idx.map((k) => ga[k]);
      const bv = idx.map((k) => gb[k]);
      if (av.some((v) => !Number.isFinite(v)) || bv.some((v) => !Number.isFinite(v))) continue;
      // Both curves must pass through this cell for them to meet inside it.
      if (Math.min(...av) > 0 || Math.max(...av) < 0) continue;
      if (Math.min(...bv) > 0 || Math.max(...bv) < 0) continue;

      let p = { x: x0 + dx / 2, y: y0 + dy / 2 };
      const h = Math.min(dx, dy) * 1e-3;
      // Converged when the step stops moving, which is scale-free: an absolute
      // threshold on F would depend on how the student happened to write it.
      const settled = Math.min(dx, dy) * 1e-9;
      let ok = false;
      for (let k = 0; k < 24; k++) {
        const A = fa(p.x, p.y), B = fb(p.x, p.y);
        if (!Number.isFinite(A) || !Number.isFinite(B)) break;
        const ax = (fa(p.x + h, p.y) - fa(p.x - h, p.y)) / (2 * h);
        const ay = (fa(p.x, p.y + h) - fa(p.x, p.y - h)) / (2 * h);
        const bx = (fb(p.x + h, p.y) - fb(p.x - h, p.y)) / (2 * h);
        const by = (fb(p.x, p.y + h) - fb(p.x, p.y - h)) / (2 * h);
        const det = ax * by - ay * bx;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
        const stepX = (by * A - ay * B) / det;
        const stepY = (-bx * A + ax * B) / det;
        if (!Number.isFinite(stepX) || !Number.isFinite(stepY)) break;
        p = { x: p.x - stepX, y: p.y - stepY };
        if (Math.hypot(stepX, stepY) < settled) { ok = true; break; }
      }
      // Newton can walk off to a different branch; keep it only if it stayed
      // near the cell that suggested it.
      if (ok && Math.abs(p.x - (x0 + dx / 2)) < dx * 2 && Math.abs(p.y - (y0 + dy / 2)) < dy * 2) {
        out.push(p);
      }
      if (out.length > MAX_ROOTS_PER_PAIR) return out;
    }
  }
  return out;
}

/**
 * Crossings of any two curves. Whichever curve has a parameterisation walks,
 * and the other's field is root-found along the way -- which turns almost every
 * pairing into the same one-dimensional search, tangency handling included.
 * Only two implicits (no parameterisation) and two polars (no field) need
 * their own treatment.
 */
function crossingsOf(A: CurveModel, B: CurveModel, view: Viewport): Intersection[] {
  const out: Intersection[] = [];
  const { xmin, xmax, ymin, ymax } = view;
  const inView = (p: Vec2): boolean =>
    Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= xmin && p.x <= xmax && p.y >= ymin && p.y <= ymax;
  const push = (p: Vec2): void => { if (inView(p)) out.push({ x: p.x, y: p.y, a: A.expr.id, b: B.expr.id }); };

  // Prefer walking the curve whose parameter is the tidier one: an explicit or
  // polar curve traces itself exactly, so it makes the better ruler.
  let walker = A, target = B;
  if (!walker.param || !target.field) {
    if (B.param && A.field) { walker = B; target = A; }
  }

  if (walker.param && target.field) {
    const at = walker.param.at;
    const cheap = target.raw ?? target.field;
    const exact = target.field;
    // The normalised field is a distance in graph units, so the viewport span
    // is the right scale for judging "near zero".
    const scale = Math.max(Math.abs(xmax - xmin), Math.abs(ymax - ymin));
    const sample = (v: number): number => { const p = at(v); return cheap(p.x, p.y); };
    const measure = (v: number): number => { const p = at(v); return Math.abs(exact(p.x, p.y)); };
    for (const t of roots(sample, walker.param.lo, walker.param.hi, scale, measure)) {
      push(at(t));
    }
    return out;
  }

  if (A.field && B.field) {
    // Detect and refine on the raw implicit F where there is one: it has the
    // same zero set for a fifth of the evaluations.
    for (const p of implicitPairCrossings(A.raw ?? A.field, B.raw ?? B.field, view)) push(p);
    return out;
  }

  if (A.samples && B.samples) {
    for (const p of polylineCrossings(A.samples, B.samples)) push(p);
    return out;
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
  const models = curveModels();
  const key = intersectionKey(models.map((m) => m.expr), view);
  if (key === cacheKey) return cached;

  const found: Intersection[] = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      found.push(...crossingsOf(models[i], models[j], view));
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

/**
 * Walk an implicit curve's field downhill to land on the curve itself. The
 * field is already gradient-normalised, so each step is close to "move by the
 * distance you are away, in the direction that shrinks it".
 */
function projectOntoImplicit(
  field: (x: number, y: number) => number,
  rawX: number,
  rawY: number,
  ctx: SnapContext,
): Vec2 | null {
  const hx = 1 / ctx.pxPerX * 0.05;
  const hy = 1 / ctx.pxPerY * 0.05;
  let x = rawX, y = rawY;
  for (let i = 0; i < 8; i++) {
    const v = field(x, y);
    if (!Number.isFinite(v)) return null;
    if (Math.abs(v) < Math.min(hx, hy) * 1e-3) break;
    const gx = (field(x + hx, y) - field(x - hx, y)) / (2 * hx);
    const gy = (field(x, y + hy) - field(x, y - hy)) / (2 * hy);
    const mag2 = gx * gx + gy * gy;
    if (!Number.isFinite(mag2) || mag2 < 1e-18) return null;
    x -= (v * gx) / mag2;
    y -= (v * gy) / mag2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  }
  return Math.abs(field(x, y)) < Math.max(hx, hy) ? { x, y } : null;
}

/** Nearest sampled point on a polyline, refined against its own parameter. */
function nearestOnSamples(
  model: CurveModel,
  rawX: number,
  rawY: number,
  ctx: SnapContext,
): Vec2 | null {
  const samples = model.samples;
  if (!samples || samples.length === 0) return null;
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const d = pxDist(rawX, rawY, p.x, p.y, ctx);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestI < 0) return null;
  const param = model.param;
  if (!param) return samples[bestI];

  // Refine between the neighbouring samples, so the point sits on the curve
  // rather than on the coarse polyline that stands in for it.
  const span = (param.hi - param.lo) / (samples.length - 1);
  const t0 = param.lo + Math.max(0, bestI - 1) * span;
  const t1 = param.lo + Math.min(samples.length - 1, bestI + 1) * span;
  let lo = t0, hi = t1;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const p1 = param.at(m1), p2 = param.at(m2);
    const d1 = pxDist(rawX, rawY, p1.x, p1.y, ctx);
    const d2 = pxDist(rawX, rawY, p2.x, p2.y, ctx);
    if (!Number.isFinite(d1) || !Number.isFinite(d2)) break;
    if (d1 <= d2) hi = m2; else lo = m1;
  }
  const refined = param.at((lo + hi) / 2);
  return Number.isFinite(refined.x) && Number.isFinite(refined.y) ? refined : samples[bestI];
}

/** The point on the nearest curve under the cursor, if one is close enough. */
function nearestCurvePoint(
  rawX: number,
  rawY: number,
  ctx: SnapContext,
  holding: string | null,
): { x: number; y: number; id: string; px: number } | null {
  let best: { x: number; y: number; id: string; px: number } | null = null;

  for (const model of curveModels()) {
    const expr = model.expr;
    // A curve the cursor is already riding keeps hold of it for longer, so the
    // pointer does not fall off the moment it wavers -- but a firm pull frees it.
    const limit = expr.id === holding ? CURVE_RELEASE_PX : CURVE_CAPTURE_PX;

    let hit: Vec2 | null = null;
    if (expr.kind === 'explicit_y') {
      const y = evaluator(expr, 'x')(rawX);
      if (Number.isFinite(y)) hit = { x: rawX, y };
    } else if (expr.kind === 'explicit_x') {
      const x = evaluator(expr, 'y')(rawY);
      if (Number.isFinite(x)) hit = { x, y: rawY };
    } else if (expr.kind === 'implicit' && model.field) {
      hit = projectOntoImplicit(model.field, rawX, rawY, ctx);
    } else if (model.samples) {
      hit = nearestOnSamples(model, rawX, rawY, ctx);
    }
    if (!hit) continue;

    const px = pxDist(rawX, rawY, hit.x, hit.y, ctx);
    if (px <= limit && (!best || px < best.px)) best = { x: hit.x, y: hit.y, id: expr.id, px };
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
  if (expr.kind === 'explicit_x') {
    const gy = Math.round(rawY / ctx.minorY) * ctx.minorY;
    const gx = evaluator(expr, 'y')(gy);
    if (!Number.isFinite(gx)) return null;
    if (pxDist(rawX, rawY, gx, gy, ctx) > limit) return null;
    return { x: gx, y: gy };
  }
  // A circle or a rose has no single value to pin to a grid line -- solving for
  // "where does this cross x = 2.4" is the crossing search, not a cheap lookup.
  // Those curves simply skip this tier and slide freely instead.
  return null;
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

  // An explicitly plotted point is an exact coordinate, so it outranks the
  // sampled curve tiers when the cursor is close to its marker.
  const heldPointId = previous?.kind === 'point' ? previous.curves[0] : null;
  let bestPoint: { x: number; y: number; id: string; px: number } | null = null;
  for (const expression of getState().expressions) {
    if (!expression.visible || expression.error || expression.kind !== 'point') continue;
    const point = pointCoordinates(expression);
    if (!point) continue;
    const limit = expression.id === heldPointId ? POINT_RELEASE_PX : POINT_CAPTURE_PX;
    const px = pxDist(rawX, rawY, point.x, point.y, ctx);
    if (px <= limit && (!bestPoint || px < bestPoint.px)) {
      bestPoint = { ...point, id: expression.id, px };
    }
  }
  if (bestPoint) {
    return { x: bestPoint.x, y: bestPoint.y, kind: 'point', curves: [bestPoint.id] };
  }

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

  const expr = curveModels().find((m) => m.expr.id === onCurve.id)?.expr;
  if (expr) {
    const limit = previous?.kind === 'curve-grid' ? GRID_CROSS_RELEASE_PX : GRID_CROSS_CAPTURE_PX;
    const node = gridCrossing(expr, rawX, rawY, ctx, limit);
    if (node) return { x: node.x, y: node.y, kind: 'curve-grid', curves: [onCurve.id] };
  }

  return { x: onCurve.x, y: onCurve.y, kind: 'curve', curves: [onCurve.id] };
}
