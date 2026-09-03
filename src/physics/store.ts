// The single mutation layer for the physics sandbox. The palette, the canvas
// and the WebMCP tools all call these functions -- there is no second path --
// so what a student sees and what an agent reads back are the same numbers
// from the same solve.
//
// Three stages, exactly as the sandbox is specified:
//   design   objects float where you put them, nothing acts on them
//   running  gravity, normal forces and any forces you added are applied
//   ended    everything freezes; retry restores the pre-run layout, reset clears

import {
  DT,
  REST_OMEGA,
  REST_SPEED,
  applyStartConditions,
  polyMassData,
  stepWorld,
} from './engine';
import { CATALOG, LINE_COLOR, TRACK_THICKNESS, rectShape, thickenPolyline } from './catalog';
import { MATERIALS, frictionCoefficient } from './materials';
import type {
  AppliedForce,
  ApplyMode,
  Body,
  ChangeReason,
  Material,
  PhysicsEvent,
  PhysicsState,
  Shape,
  Stage,
  TelemetrySample,
  ToolId,
  Vec2,
  VelocitySpec,
} from './types';

/** Wall-clock limits that end a run, straight from the spec. */
export const MAX_RUN_SECONDS = 30;
export const REST_SECONDS = 5;
export const OBJECT_CAP = 15;
export const MAX_FORCE_SECONDS = 10;

const WORLD = { width: 16, height: 10 };
const WALL_THICKNESS = 0.6;

export type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };

const state: PhysicsState = {
  stage: 'design',
  time: 0,
  tool: 'select',
  gravity: 9.81,
  friction: false,
  world: WORLD,
  bodies: [],
  selectedId: null,
  events: [],
  endReason: null,
  canRetry: false,
  message: null,
  objectCap: OBJECT_CAP,
};

/** Motion history, sampled while running, keyed by body id. */
const telemetry = new Map<string, TelemetrySample[]>();
const TELEMETRY_INTERVAL = 0.05;
const TELEMETRY_CAP = 800;
let telemetryClock = 0;

/** The layout as it was the instant Start was pressed, for retry. */
let preRunSnapshot: Body[] | null = null;

type Listener = (reason: ChangeReason, state: PhysicsState) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(reason: ChangeReason): void {
  // A listener that throws (a renderer hitting a degenerate canvas, say) must
  // not abort the mutation that is part-way through calling us.
  for (const fn of listeners) {
    try { fn(reason, state); }
    catch (err) { console.error('[physics] listener failed:', err); }
  }
}

export function getState(): PhysicsState {
  return state;
}

export function bodyById(id: string): Body | undefined {
  return state.bodies.find((b) => b.id === id);
}

/** Everything the student placed: the box walls do not count against the cap. */
export function userBodies(): Body[] {
  return state.bodies.filter((b) => !b.wall);
}

/* ---------------- ids ---------------- */

const counters = new Map<string, number>();
function nextId(prefix: string): string {
  const n = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, n);
  return `${prefix}${n}`;
}

/* ---------------- body construction ---------------- */

interface BodyInit {
  type: string;
  kind: 'static' | 'dynamic';
  x: number;
  y: number;
  angle?: number;
  width: number;
  height: number;
  radius: number;
  mass: number;
  restitution: number;
  material: Material;
  color: string;
  shapes: Shape[];
  label: string;
  wall?: boolean;
  id?: string;
}

function makeBody(init: BodyInit): Body {
  const body: Body = {
    id: init.id ?? nextId(init.type === 'line' ? 'line' : init.type),
    type: init.type,
    kind: init.kind,
    label: init.label,
    x: init.x,
    y: init.y,
    angle: init.angle ?? 0,
    vx: 0,
    vy: 0,
    omega: 0,
    mass: init.kind === 'dynamic' ? init.mass : 0,
    invMass: 0,
    inertia: 0,
    invInertia: 0,
    restitution: init.restitution,
    material: init.material,
    shapes: init.shapes,
    width: init.width,
    height: init.height,
    radius: init.radius,
    color: init.color,
    forces: [],
    velocity: null,
    wall: init.wall ?? false,
    restFor: 0,
    maxSpeed: 0,
    maxHeight: init.y,
    pathLength: 0,
  };
  computeMass(body);
  return body;
}

/** Derive mass and rotational inertia from the body's shape and mass. */
function computeMass(body: Body): void {
  if (body.kind === 'static') {
    body.invMass = 0;
    body.inertia = 0;
    body.invInertia = 0;
    return;
  }
  const shape = body.shapes[0];
  body.invMass = body.mass > 0 ? 1 / body.mass : 0;
  if (!shape) {
    body.inertia = 0;
    body.invInertia = 0;
    return;
  }
  if (shape.kind === 'circle') {
    body.inertia = 0.5 * body.mass * shape.r * shape.r;
  } else {
    body.inertia = body.mass * polyMassData(shape.verts).inertiaPerMass;
  }
  body.invInertia = body.inertia > 0 ? 1 / body.inertia : 0;
}

/* ---------------- the box ---------------- */

// Floor and side walls are solid supports; the top is deliberately open so a
// launched object follows a real projectile arc instead of hitting a lid.
function buildWalls(): void {
  const { width, height } = WORLD;
  const t = WALL_THICKNESS;
  state.bodies.push(makeBody({
    id: 'floor', type: 'floor', kind: 'static', label: 'Floor',
    x: width / 2, y: -t / 2, width: width + 2 * t, height: t, radius: 0,
    mass: 0, restitution: 0.2, material: 'concrete', color: '#334155', wall: true,
    shapes: [rectShape(width + 2 * t, t)],
  }));
  state.bodies.push(makeBody({
    id: 'wall_left', type: 'wall_left', kind: 'static', label: 'Left wall',
    x: -t / 2, y: height / 2, width: t, height: height * 3, radius: 0,
    mass: 0, restitution: 0.2, material: 'concrete', color: '#334155', wall: true,
    shapes: [rectShape(t, height * 3)],
  }));
  state.bodies.push(makeBody({
    id: 'wall_right', type: 'wall_right', kind: 'static', label: 'Right wall',
    x: width + t / 2, y: height / 2, width: t, height: height * 3, radius: 0,
    mass: 0, restitution: 0.2, material: 'concrete', color: '#334155', wall: true,
    shapes: [rectShape(t, height * 3)],
  }));
}

buildWalls();

/* ---------------- guards ---------------- */

function requireDesign(): string | null {
  if (state.stage === 'design') return null;
  if (state.stage === 'ended') {
    return 'The run has finished. Call retry_simulation to go back to the layout you started from, or reset_simulation to clear the box.';
  }
  return 'The simulation is running. Call end_simulation first — objects can only be edited before a run.';
}

function inside(x: number, y: number): boolean {
  return x >= 0 && x <= WORLD.width && y >= 0 && y <= WORLD.height * 1.5;
}

/* ---------------- placing objects ---------------- */

export function addObject(type: string, opts: {
  x?: number;
  y?: number;
  angle?: number;
  width?: number;
  height?: number;
  radius?: number;
  mass?: number;
  restitution?: number;
  material?: Material;
} = {}): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };

  const entry = CATALOG[type];
  if (!entry) {
    return { ok: false, error: `Unknown type "${type}". Call list_library to see what can be placed.` };
  }
  if (userBodies().length >= OBJECT_CAP) {
    return { ok: false, error: `The box already holds the maximum of ${OBJECT_CAP} objects. Remove something first.` };
  }

  const width = clamp(opts.width ?? entry.width, 0.1, WORLD.width);
  const height = clamp(opts.height ?? entry.height, 0.1, WORLD.height);
  const radius = clamp(opts.radius ?? entry.radius, 0.05, 2);
  const x = opts.x ?? WORLD.width / 2;
  const y = opts.y ?? WORLD.height * 0.65;
  if (!inside(x, y)) {
    return { ok: false, error: `(${x}, ${y}) is outside the box, which spans x 0…${WORLD.width} and y 0…${WORLD.height} metres.` };
  }

  const body = makeBody({
    type,
    kind: entry.kind,
    x, y,
    angle: ((opts.angle ?? 0) * Math.PI) / 180,
    width, height, radius,
    mass: clamp(opts.mass ?? entry.mass, 0.01, 1000),
    restitution: clamp(opts.restitution ?? entry.restitution, 0, 0.98),
    material: opts.material && MATERIALS.includes(opts.material) ? opts.material : entry.material,
    color: entry.color,
    label: entry.title,
    shapes: entry.build(width, height, radius),
  });
  state.bodies.push(body);
  state.selectedId = body.id;
  notify('bodies');
  return { ok: true, id: body.id, placed: type, position: { x: body.x, y: body.y }, objects_used: userBodies().length, object_cap: OBJECT_CAP };
}

/** Turn a polyline of world points into one fixed line object. */
export function drawLine(points: Vec2[]): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  if (points.length < 2) return { ok: false, error: 'A line needs at least two points.' };
  if (userBodies().length >= OBJECT_CAP) {
    return { ok: false, error: `The box already holds the maximum of ${OBJECT_CAP} objects. Remove something first.` };
  }

  // Drop points that are too close together, so a freehand drag does not
  // become a hundred collision shapes.
  const simplified: Vec2[] = [points[0]];
  for (const p of points.slice(1)) {
    const last = simplified[simplified.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.18) simplified.push(p);
  }
  const last = points[points.length - 1];
  const tail = simplified[simplified.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1e-6) simplified.push(last);
  if (simplified.length < 2) return { ok: false, error: 'That line is too short to draw.' };

  const cx = simplified.reduce((s, p) => s + p.x, 0) / simplified.length;
  const cy = simplified.reduce((s, p) => s + p.y, 0) / simplified.length;
  const local = simplified.map((p) => ({ x: p.x - cx, y: p.y - cy }));

  let length = 0;
  for (let i = 0; i + 1 < simplified.length; i++) {
    length += Math.hypot(simplified[i + 1].x - simplified[i].x, simplified[i + 1].y - simplified[i].y);
  }

  const body = makeBody({
    type: 'line',
    kind: 'static',
    x: cx, y: cy,
    width: length, height: TRACK_THICKNESS, radius: 0,
    mass: 0, restitution: 0.15, material: 'concrete',
    color: LINE_COLOR,
    label: 'Line',
    shapes: thickenPolyline(local, TRACK_THICKNESS),
  });
  // Keep the drawn path for rendering and for describing the line to an agent.
  linePaths.set(body.id, local);
  state.bodies.push(body);
  state.selectedId = body.id;
  notify('bodies');
  return { ok: true, id: body.id, points: simplified.length, length_m: +length.toFixed(2), objects_used: userBodies().length, object_cap: OBJECT_CAP };
}

/** Local-frame polylines for drawn lines, used only for drawing them back. */
export const linePaths = new Map<string, Vec2[]>();

export function removeObject(id: string): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  if (body.wall) return { ok: false, error: 'The floor and the side walls are part of the box and cannot be removed.' };
  state.bodies = state.bodies.filter((b) => b.id !== id);
  linePaths.delete(id);
  telemetry.delete(id);
  if (state.selectedId === id) state.selectedId = null;
  notify('bodies');
  return { ok: true, removed: id, objects_used: userBodies().length };
}

export function clearAll(): Result {
  state.bodies = state.bodies.filter((b) => b.wall);
  linePaths.clear();
  telemetry.clear();
  state.selectedId = null;
  state.stage = 'design';
  state.time = 0;
  state.events = [];
  state.endReason = null;
  state.canRetry = false;
  preRunSnapshot = null;
  notify('bodies');
  notify('stage');
  return { ok: true, cleared: true };
}

/* ---------------- editing ---------------- */

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function moveObject(id: string, x: number, y: number, opts: { silent?: boolean } = {}): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  if (body.wall) return { ok: false, error: 'The box walls are fixed.' };
  if (!inside(x, y)) {
    return { ok: false, error: `(${x}, ${y}) is outside the box, which spans x 0…${WORLD.width} and y 0…${WORLD.height} metres.` };
  }
  body.x = x;
  body.y = y;
  body.maxHeight = y;
  if (!opts.silent) notify('bodies');
  return { ok: true, id, position: { x, y } };
}

export function setAngle(id: string, degrees: number): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  if (body.wall) return { ok: false, error: 'The box walls are fixed.' };
  body.angle = (degrees * Math.PI) / 180;
  notify('bodies');
  return { ok: true, id, angle_deg: degrees };
}

export function setProperty(id: string, props: {
  mass?: number;
  restitution?: number;
  width?: number;
  height?: number;
  radius?: number;
  material?: Material;
}): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  if (body.wall) return { ok: false, error: 'The box walls are fixed.' };

  if (props.material !== undefined) {
    if (!MATERIALS.includes(props.material)) {
      return { ok: false, error: `"${props.material}" is not a material. Choose one of: ${MATERIALS.join(', ')}.` };
    }
    body.material = props.material;
  }
  if (props.mass !== undefined) {
    if (body.kind !== 'dynamic') return { ok: false, error: `${body.label} is fixed scenery — it has no mass to set.` };
    body.mass = clamp(props.mass, 0.01, 1000);
  }
  if (props.restitution !== undefined) body.restitution = clamp(props.restitution, 0, 0.98);

  const resized = props.width !== undefined || props.height !== undefined || props.radius !== undefined;
  if (resized) {
    if (body.type === 'line') return { ok: false, error: 'A drawn line cannot be resized — erase it and draw a new one.' };
    body.width = clamp(props.width ?? body.width, 0.1, WORLD.width);
    body.height = clamp(props.height ?? body.height, 0.1, WORLD.height);
    body.radius = clamp(props.radius ?? body.radius, 0.05, 2);
    const entry = CATALOG[body.type];
    if (entry) body.shapes = entry.build(body.width, body.height, body.radius);
  }
  computeMass(body);
  notify('bodies');
  return {
    ok: true,
    id,
    mass_kg: body.mass,
    restitution: body.restitution,
    material: body.material,
    width_m: body.width,
    height_m: body.height,
    radius_m: body.radius,
  };
}

/**
 * Turn Coulomb friction on or off for the whole sandbox. Design-stage only, so
 * that a run is reproducible from its starting conditions and retry replays it.
 */
export function setFriction(on: boolean): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  state.friction = on;
  notify('bodies');
  return { ok: true, friction: state.friction };
}

/** The coefficient that would apply between two objects if they touched. */
export function frictionBetween(a: Body, b: Body): number {
  return state.friction ? frictionCoefficient(a.material, b.material) : 0;
}

/* ---------------- forces and velocity ---------------- */

export function addForce(id: string, fx: number, fy: number, mode: ApplyMode, duration: number): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  if (body.kind !== 'dynamic') {
    return { ok: false, error: `${body.label} (${id}) is fixed scenery. Forces only do anything to movable objects — see list_library.` };
  }
  const force: AppliedForce = {
    id: nextId('f'),
    fx,
    fy,
    mode,
    duration: mode === 'continuous' ? clamp(duration, 0.05, MAX_FORCE_SECONDS) : 0,
  };
  body.forces.push(force);
  notify('bodies');
  return {
    ok: true,
    force_id: force.id,
    on: id,
    mode,
    fx, fy,
    unit: mode === 'start' ? 'N·s (a single impulse at t=0)' : 'N (held from t=0)',
    duration_s: force.duration,
  };
}

export function clearForces(id: string): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  const removed = body.forces.length;
  body.forces = [];
  notify('bodies');
  return { ok: true, id, removed_forces: removed };
}

export function removeForce(id: string, forceId: string): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  const before = body.forces.length;
  body.forces = body.forces.filter((f) => f.id !== forceId);
  if (body.forces.length === before) return { ok: false, error: `${id} has no force "${forceId}".` };
  notify('bodies');
  return { ok: true, id, removed: forceId };
}

export function setStartVelocity(id: string, vx: number, vy: number, mode: ApplyMode, duration: number): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  if (body.kind !== 'dynamic') {
    return { ok: false, error: `${body.label} (${id}) is fixed scenery and cannot move.` };
  }
  const spec: VelocitySpec = {
    vx,
    vy,
    mode,
    duration: mode === 'continuous' ? clamp(duration, 0.05, MAX_FORCE_SECONDS) : 0,
  };
  body.velocity = spec;
  notify('bodies');
  return { ok: true, id, mode, vx, vy, duration_s: spec.duration, speed_m_s: +Math.hypot(vx, vy).toFixed(3) };
}

export function clearVelocity(id: string): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  const body = bodyById(id);
  if (!body) return { ok: false, error: `No object with id "${id}".` };
  body.velocity = null;
  notify('bodies');
  return { ok: true, id, cleared: 'velocity' };
}

export function setGravity(g: number): Result {
  const guard = requireDesign();
  if (guard) return { ok: false, error: guard };
  state.gravity = clamp(g, 0, 50);
  notify('bodies');
  return { ok: true, gravity_m_s2: state.gravity };
}

/* ---------------- selection and tool ---------------- */

export function select(id: string | null): Result {
  if (id !== null && !bodyById(id)) return { ok: false, error: `No object with id "${id}".` };
  state.selectedId = id;
  notify('selection');
  return { ok: true, selected: id };
}

export function setTool(tool: ToolId): Result {
  state.tool = tool;
  notify('tool');
  return { ok: true, tool };
}

/* ---------------- events and telemetry ---------------- */

function pushEvent(event: PhysicsEvent): void {
  state.events.push(event);
  if (state.events.length > 300) state.events.shift();
}

export function getTelemetry(id: string): TelemetrySample[] {
  return telemetry.get(id) ?? [];
}

function sampleTelemetry(): void {
  for (const body of state.bodies) {
    if (body.kind !== 'dynamic') continue;
    let series = telemetry.get(body.id);
    if (!series) {
      series = [];
      telemetry.set(body.id, series);
    }
    series.push({
      t: +state.time.toFixed(3),
      x: +body.x.toFixed(4),
      y: +body.y.toFixed(4),
      vx: +body.vx.toFixed(4),
      vy: +body.vy.toFixed(4),
    });
    if (series.length > TELEMETRY_CAP) series.shift();
  }
}

/* ---------------- the stage machine ---------------- */

function snapshotBodies(): Body[] {
  return state.bodies.map((b) => ({
    ...b,
    shapes: b.shapes.map((s) => (s.kind === 'circle' ? { ...s } : { kind: 'poly' as const, verts: s.verts.map((v) => ({ ...v })) })),
    forces: b.forces.map((f) => ({ ...f })),
    velocity: b.velocity ? { ...b.velocity } : null,
  }));
}

export function startSimulation(): Result {
  if (state.stage === 'running') return { ok: false, error: 'The simulation is already running.' };
  if (state.stage === 'paused') return resumeSimulation();
  if (state.stage === 'ended') {
    return { ok: false, error: 'The last run has finished. Call retry_simulation to run the same layout again, or reset_simulation to start over.' };
  }
  const movable = state.bodies.filter((b) => b.kind === 'dynamic');
  if (movable.length === 0) {
    return { ok: false, error: 'Nothing would move: add at least one object from the "Objects" section of the library first.' };
  }

  preRunSnapshot = snapshotBodies();
  state.canRetry = true;
  state.time = 0;
  telemetryClock = 0;
  telemetry.clear();
  state.events = [];
  state.endReason = null;
  for (const body of state.bodies) {
    body.vx = 0;
    body.vy = 0;
    body.omega = 0;
    body.restFor = 0;
    body.maxSpeed = 0;
    body.maxHeight = body.y;
    body.pathLength = 0;
  }
  applyStartConditions(state.bodies);
  pushEvent({ t: 0, kind: 'start', text: `Run started with ${movable.length} movable object${movable.length === 1 ? '' : 's'} and gravity ${state.gravity} m/s².` });
  sampleTelemetry();
  state.stage = 'running';
  lastFrame = performance.now();
  notify('stage');
  return { ok: true, stage: state.stage, movable_objects: movable.length, gravity_m_s2: state.gravity };
}

export function pauseSimulation(): Result {
  if (state.stage !== 'running') return { ok: false, error: `Nothing to pause — the sandbox is in the "${state.stage}" stage.` };
  state.stage = 'paused';
  notify('stage');
  return { ok: true, stage: state.stage, time_s: +state.time.toFixed(3) };
}

export function resumeSimulation(): Result {
  if (state.stage !== 'paused') return { ok: false, error: `Nothing to resume — the sandbox is in the "${state.stage}" stage.` };
  state.stage = 'running';
  lastFrame = performance.now();
  notify('stage');
  return { ok: true, stage: state.stage, time_s: +state.time.toFixed(3) };
}

export function endSimulation(reason = 'You ended the run.'): Result {
  if (state.stage !== 'running' && state.stage !== 'paused') {
    return { ok: false, error: `Nothing to end — the sandbox is in the "${state.stage}" stage.` };
  }
  state.stage = 'ended';
  state.endReason = reason;
  pushEvent({ t: state.time, kind: 'end', text: reason });
  notify('stage');
  return { ok: true, stage: state.stage, reason, time_s: +state.time.toFixed(3) };
}

export function retrySimulation(): Result {
  if (!preRunSnapshot) return { ok: false, error: 'There is no earlier run to go back to — nothing has been simulated yet.' };
  state.bodies = preRunSnapshot.map((b) => ({
    ...b,
    shapes: b.shapes.map((s) => (s.kind === 'circle' ? { ...s } : { kind: 'poly' as const, verts: s.verts.map((v) => ({ ...v })) })),
    forces: b.forces.map((f) => ({ ...f })),
    velocity: b.velocity ? { ...b.velocity } : null,
  }));
  state.stage = 'design';
  state.time = 0;
  state.endReason = null;
  state.events = [];
  telemetry.clear();
  notify('bodies');
  notify('stage');
  return { ok: true, stage: state.stage, restored_objects: userBodies().length };
}

export function resetSimulation(): Result {
  clearAll();
  return { ok: true, stage: state.stage, cleared: true };
}

/* ---------------- the clock ---------------- */

let lastFrame = performance.now();
let accumulator = 0;

/**
 * Advance a running simulation by `seconds` of wall-clock time, in fixed steps.
 * Kept separate from the frame loop so the clock source is swappable — the page
 * drives it from requestAnimationFrame, tests drive it directly.
 */
export function advance(seconds: number): void {
  if (state.stage !== 'running') return;
  accumulator += seconds;
  let steps = 0;
  while (accumulator >= DT && steps < 400) {
    const result = stepWorld(state.bodies, DT, state.gravity, state.time, state.friction);
    state.time += DT;
    accumulator -= DT;
    steps++;
    recordImpacts(result.impacts);
    telemetryClock += DT;
    if (telemetryClock >= TELEMETRY_INTERVAL) {
      telemetryClock = 0;
      sampleTelemetry();
    }
    if (checkEndConditions()) break;
  }
}

function frame(now: number): void {
  const wall = Math.min((now - lastFrame) / 1000, 0.1); // ignore huge tab-switch gaps
  lastFrame = now;
  advance(wall);
  notify('tick');
  requestAnimationFrame(frame);
}

/** Collapse repeated contacts into one reported impact per pair per moment. */
const lastImpactAt = new Map<string, number>();

function recordImpacts(impacts: { a: Body; b: Body; speed: number }[]): void {
  for (const impact of impacts) {
    const key = impact.a.id < impact.b.id ? `${impact.a.id}|${impact.b.id}` : `${impact.b.id}|${impact.a.id}`;
    const previous = lastImpactAt.get(key) ?? -Infinity;
    if (state.time - previous < 0.12) continue;
    lastImpactAt.set(key, state.time);
    const moving = impact.a.kind === 'dynamic' ? impact.a : impact.b;
    const other = moving === impact.a ? impact.b : impact.a;
    pushEvent({
      t: +state.time.toFixed(3),
      kind: 'collision',
      a: moving.id,
      b: other.id,
      speed: +impact.speed.toFixed(3),
      text: `${moving.label} (${moving.id}) hit ${other.label} (${other.id}) at ${impact.speed.toFixed(2)} m/s.`,
    });
  }
}

function checkEndConditions(): boolean {
  if (state.time >= MAX_RUN_SECONDS) {
    endSimulation(`The run reached the ${MAX_RUN_SECONDS} second limit.`);
    return true;
  }
  const movable = state.bodies.filter((b) => b.kind === 'dynamic');
  if (movable.length > 0 && movable.every((b) => b.restFor >= REST_SECONDS)) {
    pushEvent({
      t: +state.time.toFixed(3),
      kind: 'rest',
      text: `Every object had been at rest for ${REST_SECONDS} seconds.`,
    });
    endSimulation(`Every object came to rest and stayed there for ${REST_SECONDS} seconds.`);
    return true;
  }
  return false;
}

requestAnimationFrame(frame);

/* ---------------- derived readings ---------------- */

export function kineticEnergy(body: Body): number {
  if (body.kind !== 'dynamic') return 0;
  const v2 = body.vx * body.vx + body.vy * body.vy;
  return 0.5 * body.mass * v2 + 0.5 * body.inertia * body.omega * body.omega;
}

export function potentialEnergy(body: Body): number {
  if (body.kind !== 'dynamic') return 0;
  return body.mass * state.gravity * body.y;
}

/** Forces acting on a body right now, in newtons, with gravity always listed. */
export function activeForces(body: Body): { label: string; fx: number; fy: number }[] {
  const out: { label: string; fx: number; fy: number }[] = [];
  if (body.kind !== 'dynamic') return out;
  out.push({ label: 'gravity', fx: 0, fy: -state.gravity * body.mass });
  for (const f of body.forces) {
    if (f.mode === 'continuous' && state.stage !== 'design' && state.time < f.duration) {
      out.push({ label: `applied ${f.id}`, fx: f.fx, fy: f.fy });
    }
    if (f.mode === 'start' && state.stage === 'design') {
      out.push({ label: `impulse ${f.id} (at t=0)`, fx: f.fx, fy: f.fy });
    }
  }
  return out;
}

/** True when the body is resting on something (used for the normal-force note). */
export function isSupported(body: Body): boolean {
  return body.kind === 'dynamic' && body.restFor > 0.05;
}

export function restProgress(): number {
  const movable = state.bodies.filter((b) => b.kind === 'dynamic');
  if (movable.length === 0) return 0;
  return Math.min(...movable.map((b) => b.restFor));
}

export { REST_SPEED, REST_OMEGA };
export const WORLD_BOX = WORLD;

/** Used by presets so a whole scene loads without cap or stage complaints. */
export function replaceAll(build: () => void): void {
  clearAll();
  build();
  notify('bodies');
}

export function stageLabel(stage: Stage): string {
  return stage === 'design' ? 'Pre-simulation'
    : stage === 'running' ? 'Simulating'
    : stage === 'paused' ? 'Paused'
    : 'Post-simulation';
}
