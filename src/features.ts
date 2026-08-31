// Numeric analysis behind `find_features`. The point of this file is that the
// agent gets real coordinates to reason about instead of guessing from the
// shape of the algebra.

import { getState, scope, byId } from './store';
import type { Expression, NumericScope, Result } from './types';

type Sample = (value: number) => number;
type FeatureType =
  | 'root' | 'asymptote' | 'minimum' | 'maximum' | 'y_intercept'
  | 'intersection' | 'saddle';
interface Feature {
  type: FeatureType;
  x: number;
  y: number | null;
  z?: number;
  with?: string;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function sampler(expr: Expression, varName: string, extra: NumericScope = {}): Sample {
  const base: NumericScope = { ...scope(), ...extra };
  const fn = expr.fn;
  if (!fn) return () => NaN;
  return (v: number) => {
    try {
      base[varName] = v;
      const out = fn.evaluate(base);
      return typeof out === 'number' ? out : Number(out);
    } catch { return NaN; }
  };
}

function bisect(f: Sample, a: number, b: number, iters = 80): number {
  let fa = f(a);
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (!finite(fm)) return m;
    if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else { b = m; }
  }
  return (a + b) / 2;
}

// A sign change across a pole looks like a root but isn't. Reject crossings
// where the function is large on both sides of a tiny bracket.
function isPole(f: Sample, x: number, h: number): boolean {
  const l = Math.abs(f(x - h)), r = Math.abs(f(x + h));
  return !finite(l) || !finite(r) || (l > 1e4 && r > 1e4);
}

function dedupe(points: Feature[], tol: number): Feature[] {
  const out: Feature[] = [];
  for (const p of points.sort((a, b) => a.x - b.x)) {
    if (!out.some((q) => Math.abs(q.x - p.x) < tol && q.type === p.type)) out.push(p);
  }
  return out;
}

function features1D(expr: Expression, varName = 'x'): Feature[] {
  const { xmin, xmax } = getState().viewport;
  const f = sampler(expr, varName);
  const N = 2000;
  const dx = (xmax - xmin) / N;
  const h = (xmax - xmin) / 1e5;
  const df = (x: number) => {
    const a = f(x - h), b = f(x + h);
    return finite(a) && finite(b) ? (b - a) / (2 * h) : NaN;
  };

  const roots: Feature[] = [];
  const extrema: Feature[] = [];
  const poles: Feature[] = [];

  // A bracketed sign change is either a root or a pole. Rather than guessing
  // from magnitude, bisect and look at what we landed on: a real root drives
  // |f| to ~0, a pole does not.
  const classifyCrossing = (a: number, b: number) => {
    const r = bisect(f, a, b);
    if (Math.abs(f(r)) < 1e-6) roots.push({ type: 'root', x: +r.toFixed(6), y: 0 });
    else poles.push({ type: 'asymptote', x: +r.toFixed(6), y: null });
  };

  // Only accept a turning point that actually turns: strictly higher (or
  // lower) than both neighbours. This rejects the spurious extremum the
  // numeric derivative invents on either side of a pole.
  const pushExtremum = (e: number) => {
    const ey = f(e), left = f(e - dx), right = f(e + dx);
    if (![ey, left, right].every(finite)) return;
    const type: FeatureType | null = left > ey && right > ey ? 'minimum'
      : left < ey && right < ey ? 'maximum'
      : null;
    if (!type) return;
    extrema.push({ type, x: +e.toFixed(6), y: +ey.toFixed(6) });
  };

  // Distinguish a vertical asymptote from the edge of a domain (sqrt(x) at 0)
  // by walking geometrically closer and watching whether |f| runs away.
  const blowsUp = (x: number, dir: number) => {
    const first = Math.abs(f(x + dir * dx / 2));
    let last = first;
    for (let k = 2; k <= 8; k++) {
      const v = Math.abs(f(x + dir * dx / Math.pow(2, k)));
      if (!finite(v)) break;
      last = v;
    }
    return finite(first) && finite(last) && last > first * 100;
  };

  let prevX = xmin, prevY = f(xmin), prevD = df(xmin);
  for (let i = 1; i <= N; i++) {
    const x = xmin + i * dx;
    const y = f(x);
    const d = df(x);

    // A root landing exactly on a sample point produces no sign CHANGE, so it
    // has to be caught directly or it is stepped straight over.
    if (finite(y) && y === 0) roots.push({ type: 'root', x: +x.toFixed(6), y: 0 });
    else if (finite(prevY) && finite(y) && prevY !== 0 && (prevY < 0) !== (y < 0)) classifyCrossing(prevX, x);
    else if (!finite(y) && finite(prevY) && blowsUp(x, -1)) {
      // The sample landed on the singularity itself, so there is no sign
      // change to bracket -- 1/x sampled straight through 0 hits this.
      poles.push({ type: 'asymptote', x: +x.toFixed(6), y: null });
    }

    if (finite(d) && d === 0) pushExtremum(x);
    else if (finite(prevD) && finite(d) && prevD !== 0 && (prevD < 0) !== (d < 0)) pushExtremum(bisect(df, prevX, x, 60));

    prevX = x; prevY = y; prevD = d;
  }

  const realPoles = dedupe(poles, dx * 2);
  const trueExtrema = dedupe(extrema, dx * 2)
    .filter((e) => !realPoles.some((p) => Math.abs(p.x - e.x) < dx * 3));

  const out = [...dedupe(roots, dx * 2), ...trueExtrema, ...realPoles];

  if (xmin <= 0 && xmax >= 0) {
    const y0 = f(0);
    if (finite(y0)) out.push({ type: 'y_intercept', x: 0, y: +y0.toFixed(6) });
  }
  return out;
}

function intersections(expr: Expression, others: Expression[]): Feature[] {
  const { xmin, xmax } = getState().viewport;
  const f = sampler(expr, 'x');
  const found: Feature[] = [];
  const N = 1500;
  const dx = (xmax - xmin) / N;

  for (const other of others) {
    const g = sampler(other, 'x');
    const diff = (x: number) => f(x) - g(x);
    let prevX = xmin, prevD = diff(xmin);
    for (let i = 1; i <= N; i++) {
      const x = xmin + i * dx;
      const d = diff(x);
      if (finite(d) && d === 0) {
        const y = f(x);
        if (finite(y)) found.push({ type: 'intersection', with: other.id, x: +x.toFixed(6), y: +y.toFixed(6) });
      } else if (finite(prevD) && finite(d) && prevD !== 0 && (prevD < 0) !== (d < 0)) {
        if (!isPole(diff, (prevX + x) / 2, dx)) {
          const r = bisect(diff, prevX, x);
          const y = f(r);
          if (finite(y) && Math.abs(diff(r)) < 1e-5) {
            found.push({ type: 'intersection', with: other.id, x: +r.toFixed(6), y: +y.toFixed(6) });
          }
        }
      }
      prevX = x; prevD = d;
    }
  }
  return found;
}

// Critical points of z = f(x,y): where the gradient vanishes. Classified by the
// Hessian determinant so the agent can say "saddle" and mean it.
function features2D(expr: Expression): Feature[] {
  const { xmin, xmax, ymin, ymax } = getState().viewport;
  const base = { ...scope() };
  const fn = expr.fn;
  if (!fn) return [];
  const f = (x: number, y: number) => {
    try {
      base.x = x; base.y = y;
      const out = fn.evaluate(base);
      return typeof out === 'number' ? out : Number(out);
    } catch { return NaN; }
  };
  const h = Math.min(xmax - xmin, ymax - ymin) / 1e4;
  const fx = (x: number, y: number) => (f(x + h, y) - f(x - h, y)) / (2 * h);
  const fy = (x: number, y: number) => (f(x, y + h) - f(x, y - h)) / (2 * h);
  const fxx = (x: number, y: number) => (f(x + h, y) - 2 * f(x, y) + f(x - h, y)) / (h * h);
  const fyy = (x: number, y: number) => (f(x, y + h) - 2 * f(x, y) + f(x, y - h)) / (h * h);
  const fxy = (x: number, y: number) => (f(x + h, y + h) - f(x + h, y - h) - f(x - h, y + h) + f(x - h, y - h)) / (4 * h * h);

  const found: Feature[] = [];
  const G = 40;
  const stepX = (xmax - xmin) / G, stepY = (ymax - ymin) / G;

  for (let i = 0; i <= G; i++) {
    for (let j = 0; j <= G; j++) {
      let x = xmin + i * stepX, y = ymin + j * stepY;
      // A few Newton-ish steps on the gradient to snap onto a critical point.
      let converged = false;
      for (let k = 0; k < 40; k++) {
        const gx = fx(x, y), gy = fy(x, y);
        if (!finite(gx) || !finite(gy)) break;
        if (Math.abs(gx) < 1e-9 && Math.abs(gy) < 1e-9) { converged = true; break; }
        const a = fxx(x, y), b = fxy(x, y), d = fyy(x, y);
        const det = a * d - b * b;
        if (!finite(det) || Math.abs(det) < 1e-12) {
          x -= 0.01 * gx; y -= 0.01 * gy;
        } else {
          x -= (d * gx - b * gy) / det;
          y -= (a * gy - b * gx) / det;
        }
        if (x < xmin || x > xmax || y < ymin || y > ymax) break;
      }
      if (!converged) continue;
      if (x < xmin || x > xmax || y < ymin || y > ymax) continue;
      if (found.some((p) => p.y !== null && Math.hypot(p.x - x, p.y - y) < Math.max(stepX, stepY) / 2)) continue;

      const a = fxx(x, y), b = fxy(x, y), d = fyy(x, y);
      const det = a * d - b * b;
      const z = f(x, y);
      if (!finite(z)) continue;
      found.push({
        type: det < 0 ? 'saddle' : a > 0 ? 'minimum' : 'maximum',
        x: +x.toFixed(5), y: +y.toFixed(5), z: +z.toFixed(5),
      });
    }
  }
  return found;
}

export function findFeatures(id: string): Result<{
  id: string;
  kind: string;
  searched_region: Record<string, number>;
  features: Feature[];
  note: string;
}> {
  const expr = byId(id);
  if (!expr) {
    return { ok: false, error: `No expression with id "${id}". Call list_expressions first.` };
  }
  if (expr.error) return { ok: false, error: `Expression "${id}" has a parse error: ${expr.error}` };

  const state = getState();
  const viewport = state.viewport;

  if (expr.kind === 'explicit_z') {
    return {
      ok: true, id, kind: expr.kind,
      searched_region: { xmin: viewport.xmin, xmax: viewport.xmax, ymin: viewport.ymin, ymax: viewport.ymax },
      features: features2D(expr),
      note: 'Critical points of the surface within the current viewport. det(H)<0 is reported as a saddle.',
    };
  }

  if (expr.kind === 'explicit_y' || expr.kind === 'explicit_x') {
    const varName = expr.kind === 'explicit_y' ? 'x' : 'y';
    const others = state.expressions.filter(
      (e) => e.id !== id && e.visible && !e.error && e.kind === expr.kind
    );
    const feats = [...features1D(expr, varName)];
    if (expr.kind === 'explicit_y') feats.push(...intersections(expr, others));
    return {
      ok: true, id, kind: expr.kind,
      searched_region: { xmin: viewport.xmin, xmax: viewport.xmax },
      features: feats,
      note: 'Only features inside the current viewport are found. Call set_viewport to widen the search.',
    };
  }

  return {
    ok: false,
    error: `find_features supports y=f(x), x=g(y) and z=f(x,y). Expression "${id}" is kind "${expr.kind}".`,
  };
}
