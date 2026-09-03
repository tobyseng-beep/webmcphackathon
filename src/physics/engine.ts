// The rigid-body solver. Convex polygons and circles, sequential impulses,
// gravity and normal forces, plus Coulomb friction when the sandbox has it
// switched on. There is never any air resistance: the sandbox exists to teach
// the problems a first mechanics course actually sets, and those start
// frictionless and add friction as the next lesson.
//
// Everything here is pure with respect to the store: stepWorld mutates the
// bodies it is handed and returns the contacts it resolved, and the store
// decides what those contacts mean.

import { frictionCoefficient } from './materials';
import type { Body, Shape, Vec2 } from './types';

/** Fixed integration step. The render loop substeps to reach wall-clock time. */
export const DT = 1 / 240;

/** Below these a body counts as "at rest" for the end-of-run check. */
export const REST_SPEED = 0.06; // m/s
export const REST_OMEGA = 0.12; // rad/s

const SOLVER_ITERATIONS = 10;
const PENETRATION_SLOP = 0.002; // metres of overlap we tolerate before pushing
const CORRECTION_RATE = 0.6; // fraction of the excess overlap removed per step
const RESTITUTION_CUTOFF = 0.7; // m/s: slower impacts do not bounce, they settle

/* ---------------- geometry helpers ---------------- */

export function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** A shape's vertices in world space. */
export function worldVerts(body: Body, shape: Shape): Vec2[] {
  if (shape.kind !== 'poly') return [];
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  return shape.verts.map((v) => ({
    x: body.x + v.x * c - v.y * s,
    y: body.y + v.x * s + v.y * c,
  }));
}

/** A circle's centre in world space (local centre is always the origin). */
export function worldCentre(body: Body): Vec2 {
  return { x: body.x, y: body.y };
}

interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function shapeAabb(body: Body, shape: Shape): Aabb {
  if (shape.kind === 'circle') {
    return {
      minX: body.x - shape.r,
      minY: body.y - shape.r,
      maxX: body.x + shape.r,
      maxY: body.y + shape.r,
    };
  }
  const vs = worldVerts(body, shape);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vs) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

export function bodyAabb(body: Body): Aabb {
  let box: Aabb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const shape of body.shapes) {
    const b = shapeAabb(body, shape);
    box = {
      minX: Math.min(box.minX, b.minX),
      minY: Math.min(box.minY, b.minY),
      maxX: Math.max(box.maxX, b.maxX),
      maxY: Math.max(box.maxY, b.maxY),
    };
  }
  return box;
}

function overlaps(a: Aabb, b: Aabb, pad = 0.02): boolean {
  return a.minX <= b.maxX + pad && a.maxX >= b.minX - pad
    && a.minY <= b.maxY + pad && a.maxY >= b.minY - pad;
}

/** Area, centroid and second moment of a polygon given as world/local verts. */
export function polyMassData(verts: Vec2[]): { area: number; centroid: Vec2; inertiaPerMass: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    num += cross * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y);
    den += cross;
  }
  area /= 2;
  const scale = 1 / (6 * area);
  return {
    area: Math.abs(area),
    centroid: { x: cx * scale, y: cy * scale },
    inertiaPerMass: den === 0 ? 0 : num / (6 * den),
  };
}

/* ---------------- contact generation ---------------- */

export interface ContactPoint {
  p: Vec2;
  depth: number;
  /** Accumulated normal impulse, kept across solver iterations. */
  jn: number;
  /** Accumulated tangential (friction) impulse, clamped to the friction cone. */
  jt: number;
}

export interface Manifold {
  a: Body;
  b: Body;
  normal: Vec2; // unit vector pointing from a toward b
  points: ContactPoint[];
}

function circleCircle(a: Body, sa: Shape, b: Body, sb: Shape): Manifold | null {
  if (sa.kind !== 'circle' || sb.kind !== 'circle') return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rsum = sa.r + sb.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rsum * rsum) return null;
  const d = Math.sqrt(d2);
  const normal = d > 1e-9 ? { x: dx / d, y: dy / d } : { x: 0, y: 1 };
  const depth = rsum - d;
  const p = { x: a.x + normal.x * sa.r, y: a.y + normal.y * sa.r };
  return { a, b, normal, points: [{ p, depth, jn: 0, jt: 0 }] };
}

/** Closest point to `c` on the polygon `verts`, plus whether c is inside. */
function closestOnPoly(verts: Vec2[], c: Vec2): { point: Vec2; inside: boolean; normal: Vec2; dist: number } {
  let bestDist = Infinity;
  let best: Vec2 = verts[0];
  let bestNormal: Vec2 = { x: 0, y: 1 };
  let inside = true;

  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    // Outward normal for a counter-clockwise polygon.
    const nlen = Math.hypot(ex, ey) || 1;
    const nx = ey / nlen;
    const ny = -ex / nlen;
    if ((c.x - p.x) * nx + (c.y - p.y) * ny > 0) inside = false;

    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? ((c.x - p.x) * ex + (c.y - p.y) * ey) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = p.x + ex * t;
    const py = p.y + ey * t;
    const d = Math.hypot(c.x - px, c.y - py);
    if (d < bestDist) {
      bestDist = d;
      best = { x: px, y: py };
      bestNormal = { x: nx, y: ny };
    }
  }
  return { point: best, inside, normal: bestNormal, dist: bestDist };
}

function circlePoly(circleBody: Body, cs: Shape, polyBody: Body, ps: Shape, flip: boolean): Manifold | null {
  if (cs.kind !== 'circle' || ps.kind !== 'poly') return null;
  const c = worldCentre(circleBody);
  const verts = worldVerts(polyBody, ps);
  const near = closestOnPoly(verts, c);

  let normal: Vec2; // points from the polygon toward the circle
  let depth: number;
  if (near.inside) {
    normal = near.normal;
    depth = cs.r + near.dist;
  } else {
    if (near.dist >= cs.r) return null;
    const dx = c.x - near.point.x;
    const dy = c.y - near.point.y;
    const len = Math.hypot(dx, dy) || 1;
    normal = { x: dx / len, y: dy / len };
    depth = cs.r - near.dist;
  }
  const point = { x: c.x - normal.x * cs.r, y: c.y - normal.y * cs.r };

  // Manifold normals point from a to b.
  return flip
    ? { a: circleBody, b: polyBody, normal: { x: -normal.x, y: -normal.y }, points: [{ p: point, depth, jn: 0, jt: 0 }] }
    : { a: polyBody, b: circleBody, normal, points: [{ p: point, depth, jn: 0, jt: 0 }] };
}

interface AxisQuery {
  index: number;
  separation: number;
  normal: Vec2;
}

/** Deepest separating axis of `av` against `bv`, using av's face normals. */
function leastPenetrationAxis(av: Vec2[], bv: Vec2[]): AxisQuery {
  let best: AxisQuery = { index: -1, separation: -Infinity, normal: { x: 0, y: 1 } };
  for (let i = 0; i < av.length; i++) {
    const p = av[i];
    const q = av[(i + 1) % av.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const len = Math.hypot(ex, ey) || 1;
    const n = { x: ey / len, y: -ex / len }; // outward for CCW winding
    // Support point of b in the -n direction.
    let min = Infinity;
    for (const v of bv) {
      const proj = (v.x - p.x) * n.x + (v.y - p.y) * n.y;
      if (proj < min) min = proj;
    }
    if (min > best.separation) best = { index: i, separation: min, normal: n };
  }
  return best;
}

/** The edge of `verts` whose normal is most opposed to `n`. */
function incidentEdge(verts: Vec2[], n: Vec2): [Vec2, Vec2] {
  let bestDot = Infinity;
  let bestIndex = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const len = Math.hypot(ex, ey) || 1;
    const dot = (ey / len) * n.x + (-ex / len) * n.y;
    if (dot < bestDot) {
      bestDot = dot;
      bestIndex = i;
    }
  }
  return [verts[bestIndex], verts[(bestIndex + 1) % verts.length]];
}

/** Clip a segment to the half-space behind the plane through `o` with normal `n`. */
function clipSegment(seg: [Vec2, Vec2], o: Vec2, n: Vec2): [Vec2, Vec2] | null {
  const d0 = (seg[0].x - o.x) * n.x + (seg[0].y - o.y) * n.y;
  const d1 = (seg[1].x - o.x) * n.x + (seg[1].y - o.y) * n.y;
  const out: Vec2[] = [];
  if (d0 <= 0) out.push(seg[0]);
  if (d1 <= 0) out.push(seg[1]);
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    out.push({ x: seg[0].x + (seg[1].x - seg[0].x) * t, y: seg[0].y + (seg[1].y - seg[0].y) * t });
  }
  if (out.length < 2) return null;
  return [out[0], out[1]];
}

function polyPoly(a: Body, sa: Shape, b: Body, sb: Shape): Manifold | null {
  if (sa.kind !== 'poly' || sb.kind !== 'poly') return null;
  const av = worldVerts(a, sa);
  const bv = worldVerts(b, sb);
  const qa = leastPenetrationAxis(av, bv);
  if (qa.separation > 0) return null;
  const qb = leastPenetrationAxis(bv, av);
  if (qb.separation > 0) return null;

  // Whichever body owns the shallower penetration owns the reference face.
  const aIsReference = qa.separation >= qb.separation;
  const refBody = aIsReference ? a : b;
  const refVerts = aIsReference ? av : bv;
  const incVerts = aIsReference ? bv : av;
  const query = aIsReference ? qa : qb;

  const p = refVerts[query.index];
  const q = refVerts[(query.index + 1) % refVerts.length];
  const n = query.normal; // outward from the reference body
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const len = Math.hypot(ex, ey) || 1;
  const tangent = { x: ex / len, y: ey / len };

  let seg = incidentEdge(incVerts, n);
  const clippedStart = clipSegment(seg, p, { x: -tangent.x, y: -tangent.y });
  if (!clippedStart) return null;
  seg = clippedStart;
  const clippedEnd = clipSegment(seg, q, tangent);
  if (!clippedEnd) return null;
  seg = clippedEnd;

  const points: ContactPoint[] = [];
  for (const pt of seg) {
    const depth = -((pt.x - p.x) * n.x + (pt.y - p.y) * n.y);
    if (depth >= -PENETRATION_SLOP) points.push({ p: pt, depth: Math.max(depth, 0), jn: 0, jt: 0 });
  }
  if (points.length === 0) return null;

  // Normal must run from manifold.a to manifold.b.
  const normal = refBody === a ? n : { x: -n.x, y: -n.y };
  return { a, b, normal, points };
}

function collideShapes(a: Body, sa: Shape, b: Body, sb: Shape): Manifold | null {
  if (sa.kind === 'circle' && sb.kind === 'circle') return circleCircle(a, sa, b, sb);
  if (sa.kind === 'circle' && sb.kind === 'poly') return circlePoly(a, sa, b, sb, true);
  if (sa.kind === 'poly' && sb.kind === 'circle') return circlePoly(b, sb, a, sa, false);
  return polyPoly(a, sa, b, sb);
}

/** Every contact between the given bodies at their current positions. */
export function findContacts(bodies: Body[]): Manifold[] {
  const manifolds: Manifold[] = [];
  const boxes = bodies.map(bodyAabb);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (a.invMass === 0 && b.invMass === 0) continue;
      if (!overlaps(boxes[i], boxes[j])) continue;
      for (const sa of a.shapes) {
        for (const sb of b.shapes) {
          const m = collideShapes(a, sa, b, sb);
          if (m) manifolds.push(m);
        }
      }
    }
  }
  return manifolds;
}

/* ---------------- integration and solving ---------------- */

function cross(rx: number, ry: number, nx: number, ny: number): number {
  return rx * ny - ry * nx;
}

/** Apply an equal-and-opposite impulse at a contact point. */
function applyImpulse(
  a: Body, b: Body,
  rax: number, ray: number, rbx: number, rby: number,
  ix: number, iy: number,
): void {
  a.vx -= ix * a.invMass;
  a.vy -= iy * a.invMass;
  a.omega -= cross(rax, ray, ix, iy) * a.invInertia;
  b.vx += ix * b.invMass;
  b.vy += iy * b.invMass;
  b.omega += cross(rbx, rby, ix, iy) * b.invInertia;
}

/**
 * Resolve one contact. `mu` is the coefficient of friction for this pair of
 * materials, or 0 when friction is switched off. The tangential impulse is
 * clamped to the Coulomb cone (|jt| <= mu * jn), which is what makes a block
 * sit still on a shallow slope and start sliding once it is steep enough.
 */
function solveManifold(m: Manifold, restitution: number, mu: number): void {
  const { a, b, normal } = m;
  const tx = -normal.y;
  const ty = normal.x;

  for (const cp of m.points) {
    const rax = cp.p.x - a.x;
    const ray = cp.p.y - a.y;
    const rbx = cp.p.x - b.x;
    const rby = cp.p.y - b.y;

    // ---- normal impulse ----
    let vax = a.vx - a.omega * ray;
    let vay = a.vy + a.omega * rax;
    let vbx = b.vx - b.omega * rby;
    let vby = b.vy + b.omega * rbx;
    const vn = (vbx - vax) * normal.x + (vby - vay) * normal.y;

    if (vn <= 0) { // skip contacts that are already separating
      const rnA = cross(rax, ray, normal.x, normal.y);
      const rnB = cross(rbx, rby, normal.x, normal.y);
      const invMassSum =
        a.invMass + b.invMass + rnA * rnA * a.invInertia + rnB * rnB * b.invInertia;
      if (invMassSum > 0) {
        // Slow contacts settle instead of chattering; fast ones bounce.
        const e = -vn > RESTITUTION_CUTOFF ? restitution : 0;
        let j = (-(1 + e) * vn) / invMassSum;

        // Clamp the accumulated impulse so a contact can only push, never pull.
        const previous = cp.jn;
        cp.jn = Math.max(previous + j, 0);
        j = cp.jn - previous;
        applyImpulse(a, b, rax, ray, rbx, rby, normal.x * j, normal.y * j);
      }
    }

    // ---- friction impulse, along the contact tangent ----
    // Nothing to rub against until the contact is actually pressing.
    if (mu <= 0 || cp.jn <= 0) continue;

    // Re-read the relative velocity: the normal impulse above just changed it.
    vax = a.vx - a.omega * ray;
    vay = a.vy + a.omega * rax;
    vbx = b.vx - b.omega * rby;
    vby = b.vy + b.omega * rbx;
    const vt = (vbx - vax) * tx + (vby - vay) * ty;

    const rtA = cross(rax, ray, tx, ty);
    const rtB = cross(rbx, rby, tx, ty);
    const invMassSumT =
      a.invMass + b.invMass + rtA * rtA * a.invInertia + rtB * rtB * b.invInertia;
    if (invMassSumT <= 0) continue;

    // The impulse that would stop the sliding outright, then clipped to what
    // the surface can actually hold.
    let jt = -vt / invMassSumT;
    const limit = mu * cp.jn;
    const previousT = cp.jt;
    cp.jt = Math.max(-limit, Math.min(limit, previousT + jt));
    jt = cp.jt - previousT;
    applyImpulse(a, b, rax, ray, rbx, rby, tx * jt, ty * jt);
  }
}

function correctPositions(manifolds: Manifold[]): void {
  for (const m of manifolds) {
    const { a, b, normal } = m;
    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) continue;
    let deepest = 0;
    for (const cp of m.points) deepest = Math.max(deepest, cp.depth);
    const correction = (Math.max(deepest - PENETRATION_SLOP, 0) / invSum) * CORRECTION_RATE;
    if (correction <= 0) continue;
    a.x -= normal.x * correction * a.invMass;
    a.y -= normal.y * correction * a.invMass;
    b.x += normal.x * correction * b.invMass;
    b.y += normal.y * correction * b.invMass;
  }
}

export interface StepResult {
  /** Impacts worth reporting: (a, b, closing speed) at the moment of contact. */
  impacts: { a: Body; b: Body; speed: number }[];
}

/**
 * Advance the world by one fixed step. `time` is the elapsed simulation time
 * used to decide which timed forces and velocity holds are still active.
 */
export function stepWorld(
  bodies: Body[],
  dt: number,
  gravity: number,
  time: number,
  friction = false,
): StepResult {
  const dynamics = bodies.filter((b) => b.invMass > 0);

  // 1. Forces -> velocity.
  for (const body of dynamics) {
    let fx = 0;
    let fy = -gravity * body.mass;
    for (const f of body.forces) {
      if (f.mode === 'continuous' && time < f.duration) {
        fx += f.fx;
        fy += f.fy;
      }
    }
    body.vx += (fx * body.invMass) * dt;
    body.vy += (fy * body.invMass) * dt;
  }

  // 2. A continuous velocity hold overrides integration while it lasts.
  for (const body of dynamics) {
    const v = body.velocity;
    if (v && v.mode === 'continuous' && time < v.duration) {
      body.vx = v.vx;
      body.vy = v.vy;
    }
  }

  // 3. Resolve contacts.
  const manifolds = findContacts(bodies);
  const impacts: { a: Body; b: Body; speed: number }[] = [];
  for (const m of manifolds) {
    const rvx = m.b.vx - m.a.vx;
    const rvy = m.b.vy - m.a.vy;
    const closing = -(rvx * m.normal.x + rvy * m.normal.y);
    if (closing > 0.35) impacts.push({ a: m.a, b: m.b, speed: closing });
  }
  // Friction comes from the pair of materials in contact, not from either body
  // on its own, so it is resolved once per manifold and reused every iteration.
  const mu = manifolds.map((m) => (friction ? frictionCoefficient(m.a.material, m.b.material) : 0));
  for (let i = 0; i < SOLVER_ITERATIONS; i++) {
    for (let k = 0; k < manifolds.length; k++) {
      const m = manifolds[k];
      solveManifold(m, Math.max(m.a.restitution, m.b.restitution), mu[k]);
    }
  }

  // 4. Velocity -> position, re-applying any active hold so the body tracks it.
  for (const body of dynamics) {
    const v = body.velocity;
    if (v && v.mode === 'continuous' && time < v.duration) {
      body.vx = v.vx;
      body.vy = v.vy;
    }
    const dx = body.vx * dt;
    const dy = body.vy * dt;
    body.x += dx;
    body.y += dy;
    body.angle += body.omega * dt;
    body.pathLength += Math.hypot(dx, dy);
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > body.maxSpeed) body.maxSpeed = speed;
    if (body.y > body.maxHeight) body.maxHeight = body.y;
  }

  correctPositions(manifolds);

  // 5. Rest bookkeeping.
  for (const body of dynamics) {
    const speed = Math.hypot(body.vx, body.vy);
    if (speed < REST_SPEED && Math.abs(body.omega) < REST_OMEGA) body.restFor += dt;
    else body.restFor = 0;
  }

  return { impacts };
}

/** Apply the start-of-run kicks: impulses in N·s and instantaneous velocities. */
export function applyStartConditions(bodies: Body[]): void {
  for (const body of bodies) {
    if (body.invMass === 0) continue;
    for (const f of body.forces) {
      if (f.mode !== 'start') continue;
      body.vx += f.fx * body.invMass;
      body.vy += f.fy * body.invMass;
    }
    const v = body.velocity;
    if (v) {
      body.vx = v.vx;
      body.vy = v.vy;
    }
  }
}
