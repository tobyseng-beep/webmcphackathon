// The single mutation layer. Sliders, buttons and agent tools all call these
// functions -- there is no second code path. If you are adding a feature and
// find yourself mutating `state` from outside this file, stop.

import { normalize, splitEquation } from './normalize.js';

const math = window.math;

const PALETTE = ['#2d70b3', '#c74440', '#388c46', '#6042a6', '#fa7e19', '#000000'];
const RESERVED = new Set(['x', 'y', 'z', 't', 'theta', 'r', 'e', 'pi', 'i', 'Infinity', 'NaN']);

const state = {
  mode: '2d',
  expressions: [],
  sliders: [],
  annotations: [],
  viewport: { xmin: -10, xmax: 10, ymin: -6.5, ymax: 6.5, zmin: -5, zmax: 5 },
  camera: { theta: 45, phi: 60, distance: 34 },
};

const listeners = new Set();
let idCounter = 0;
const animations = new Map();

function notify(reason) {
  for (const fn of listeners) fn(reason, state);
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getState() { return state; }

function nextId() { return 'e' + (++idCounter); }

function nextColor() {
  return PALETTE[state.expressions.length % PALETTE.length];
}

function freeVars(node) {
  const names = new Set();
  node.traverse((n, path, parent) => {
    if (!n.isSymbolNode) return;
    if (parent && parent.isFunctionNode && path === 'fn') return;
    if (typeof math[n.name] === 'function') return;
    names.add(n.name);
  });
  return names;
}

const POINT_RE = /^\(\s*([^,()]+)\s*,\s*([^,()]+)\s*\)$/;

// Decide what kind of object an input describes, and produce the expression(s)
// that need compiling. Returns { kind, source, extra } or throws.
function classify(src) {
  const point = src.match(POINT_RE);
  if (point) return { kind: 'point', source: `[${point[1]}, ${point[2]}]` };

  const eq = splitEquation(src);
  if (!eq) {
    return { kind: state.mode === '3d' ? 'explicit_z' : 'explicit_y', source: src };
  }
  const { lhs, rhs } = eq;
  const bare = (v) => lhs === v;

  if (bare('y') && !/\by\b/.test(rhs)) return { kind: 'explicit_y', source: rhs };
  if (bare('z')) return { kind: 'explicit_z', source: rhs };
  if (bare('x') && !/\bx\b/.test(rhs)) return { kind: 'explicit_x', source: rhs };
  if (bare('r')) return { kind: 'polar', source: rhs };
  return { kind: 'implicit', source: `(${lhs}) - (${rhs})` };
}

function compile(src) {
  const node = math.parse(src);
  const fn = node.compile();
  // Smoke-test the compile so bad calls surface as a parse error, not a
  // render-loop exception the agent never sees.
  return { node, fn };
}

/**
 * Create or replace an expression. This is the function `add_expression` and
 * `update_expression` both call, and the same one the UI text boxes call.
 * Never throws -- returns { ok:false, error } so the agent can self-correct.
 */
export function upsert(id, patch = {}) {
  const existing = state.expressions.find((e) => e.id === id);
  const latex = patch.latex ?? existing?.latex ?? '';
  const targetId = id ?? nextId();

  const record = {
    id: targetId,
    latex,
    color: patch.color ?? existing?.color ?? nextColor(),
    visible: patch.visible ?? existing?.visible ?? true,
    kind: null, fn: null, node: null, error: null, vars: [],
  };

  if (!String(latex).trim()) {
    record.kind = 'empty';
  } else {
    try {
      const normalized = normalize(latex);
      const { kind, source } = classify(normalized);
      const { node, fn } = compile(source);
      record.kind = kind;
      record.node = node;
      record.fn = fn;
      record.source = source;
      record.vars = [...freeVars(node)];
    } catch (err) {
      record.error = err.message;
      record.kind = 'error';
    }
  }

  const idx = state.expressions.findIndex((e) => e.id === targetId);
  if (idx === -1) state.expressions.push(record); else state.expressions[idx] = record;

  const newSliders = [];
  for (const name of record.vars) {
    if (RESERVED.has(name)) continue;
    if (state.sliders.some((s) => s.name === name)) continue;
    defineSlider(name, {}, true);
    newSliders.push(name);
  }

  notify('expressions');

  if (record.error) {
    return { ok: false, id: targetId, error: `Could not parse "${latex}": ${record.error}` };
  }
  return { ok: true, id: targetId, kind: record.kind, latex, new_sliders: newSliders };
}

export function remove(id) {
  const idx = state.expressions.findIndex((e) => e.id === id);
  if (idx === -1) return { ok: false, error: `No expression with id "${id}". Call list_expressions to see current ids.` };
  const [gone] = state.expressions.splice(idx, 1);
  notify('expressions');
  return { ok: true, removed: { id: gone.id, latex: gone.latex } };
}

export function clearAll() {
  state.expressions = [];
  state.sliders = [];
  state.annotations = [];
  notify('expressions');
  return { ok: true };
}

export function list() {
  return state.expressions.map((e) => ({
    id: e.id, latex: e.latex, kind: e.kind, color: e.color,
    visible: e.visible, error: e.error ?? undefined,
  }));
}

export function defineSlider(name, spec = {}, quiet = false) {
  if (RESERVED.has(name)) {
    return { ok: false, error: `"${name}" is a reserved variable (x, y, z, t, r, theta, e, pi) and cannot be a slider.` };
  }
  const existing = state.sliders.find((s) => s.name === name);
  const slider = {
    name,
    min: spec.min ?? existing?.min ?? -10,
    max: spec.max ?? existing?.max ?? 10,
    step: spec.step ?? existing?.step ?? 0.01,
    value: spec.value ?? existing?.value ?? 1,
  };
  if (slider.min >= slider.max) return { ok: false, error: 'min must be less than max.' };
  slider.value = Math.min(slider.max, Math.max(slider.min, slider.value));

  if (existing) Object.assign(existing, slider);
  else state.sliders.push(slider);

  if (!quiet) notify('sliders');
  return { ok: true, slider: { ...slider } };
}

export function setSlider(name, value) {
  const slider = state.sliders.find((s) => s.name === name);
  if (!slider) {
    return { ok: false, error: `No slider named "${name}". Existing sliders: ${state.sliders.map((s) => s.name).join(', ') || '(none)'}. Use define_slider to create it.` };
  }
  const clamped = Math.min(slider.max, Math.max(slider.min, Number(value)));
  slider.value = clamped;
  notify('sliders');
  return { ok: true, name, value: clamped, clamped: clamped !== Number(value) };
}

export function scope() {
  const s = {};
  for (const slider of state.sliders) s[slider.name] = slider.value;
  return s;
}

/** Animate a slider from -> to, driving the real on-screen control. */
export function animateSlider(name, from, to, duration = 1500) {
  const slider = state.sliders.find((s) => s.name === name);
  if (!slider) {
    return Promise.resolve({ ok: false, error: `No slider named "${name}". Use define_slider first.` });
  }
  const prior = animations.get(name);
  if (prior) prior.finish('Superseded by a newer animate_slider call on the same slider.');

  const start = from ?? slider.value;
  const end = to;
  // Widen the slider range if the agent asked to animate beyond it, rather
  // than silently clamping to a stop.
  if (start < slider.min || end < slider.min) slider.min = Math.min(start, end) - 1;
  if (start > slider.max || end > slider.max) slider.max = Math.max(start, end) + 1;

  const ms = Math.min(10000, Math.max(200, Number(duration) || 1500));
  const t0 = performance.now();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (note) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      const running = animations.get(name);
      if (running) { cancelAnimationFrame(running.handle); animations.delete(name); }
      slider.value = end;
      notify('sliders');
      resolve({ ok: true, name, from: start, to: end, duration_ms: ms, ...(note ? { note } : {}) });
    };

    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      slider.value = start + (end - start) * eased;
      notify('sliders');
      if (p < 1) animations.set(name, { handle: requestAnimationFrame(tick), finish });
      else finish();
    };

    // requestAnimationFrame is throttled to a standstill in a background tab.
    // Without this the promise would never settle and the agent would hang
    // waiting on a sweep the user cannot even see.
    const watchdog = setTimeout(
      () => finish('Tab was not visible, so the sweep jumped to its final value instead of animating.'),
      ms + 750
    );

    animations.set(name, { handle: requestAnimationFrame(tick), finish });
  });
}

export function setViewport(patch) {
  const v = { ...state.viewport, ...patch };
  if (v.xmin >= v.xmax || v.ymin >= v.ymax) {
    return { ok: false, error: 'Viewport requires xmin < xmax and ymin < ymax.' };
  }
  state.viewport = v;
  notify('viewport');
  return { ok: true, viewport: { ...v } };
}

export function setCamera(patch) {
  const c = { ...state.camera, ...patch };
  c.phi = Math.min(179, Math.max(1, c.phi));
  c.distance = Math.min(200, Math.max(2, c.distance));
  state.camera = c;
  notify('camera');
  return { ok: true, camera: { ...c } };
}

export function setMode(mode) {
  if (mode !== '2d' && mode !== '3d') return { ok: false, error: 'mode must be "2d" or "3d".' };
  state.mode = mode;
  notify('mode');
  return { ok: true, mode };
}

export function annotate({ x, y, z, text }) {
  const note = { id: 'a' + (++idCounter), x: Number(x), y: Number(y), z: z == null ? null : Number(z), text: String(text) };
  state.annotations.push(note);
  notify('annotations');
  return { ok: true, annotation: note };
}

export function clearAnnotations() {
  state.annotations = [];
  notify('annotations');
  return { ok: true };
}

export function evaluateAt(latex, at = {}) {
  try {
    const src = normalize(latex);
    const eq = splitEquation(src);
    const body = eq ? eq.rhs : src;
    const { fn } = compile(body);
    const value = fn.evaluate({ ...scope(), ...at });
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return { ok: true, value: null, note: 'undefined or non-finite at that point' };
    return { ok: true, value: num };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function byId(id) { return state.expressions.find((e) => e.id === id); }
export { RESERVED, PALETTE };
