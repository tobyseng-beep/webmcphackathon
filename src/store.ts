// The single mutation layer. Sliders, buttons and agent tools all call these
// functions -- there is no second code path. If you are adding a feature and
// find yourself mutating `state` from outside this file, stop.

import * as math from 'mathjs';
import type { MathNode, SymbolNode } from 'mathjs';
import { normalize, splitEquation } from './normalize';
import type {
  Annotation,
  BoardMode,
  BoardState,
  CameraState,
  Expression,
  ExpressionKind,
  ExpressionPatch,
  MutationReason,
  NumericScope,
  Result,
  Slider,
  SliderSpec,
  Viewport,
} from './types';

const PALETTE = ['#2d70b3', '#c74440', '#388c46', '#6042a6', '#fa7e19', '#000000'];
const RESERVED = new Set(['x', 'y', 'z', 'e', 'pi', 'i', 'Infinity', 'NaN']);

const state: BoardState = {
  mode: '2d',
  expressions: [],
  sliders: [],
  annotations: [],
  viewport: { xmin: -10, xmax: 10, ymin: -6.5, ymax: 6.5, zmin: -5, zmax: 5 },
  camera: { theta: 45, phi: 60, distance: 34 },
  snapping: true,
  snapToCurve: true,
  canUndo: false,
  canRedo: false,
};

type Listener = (reason: MutationReason, state: BoardState) => void;
const listeners = new Set<Listener>();
let idCounter = 0;
interface RunningAnimation {
  handle: number;
  finish: (note?: string) => void;
}
const animations = new Map<string, RunningAnimation>();

function notify(reason: MutationReason): void {
  for (const fn of listeners) fn(reason, state);
}

// ---- undo / redo ----
// Snapshots capture the editable board: expressions (compiled fn/node kept by
// reference, since they are immutable for a given latex), sliders and
// annotations. View settings (viewport, camera, mode, snap) are not history.
interface HistorySnapshot {
  expressions: Expression[];
  sliders: Slider[];
  annotations: Annotation[];
}
const undoStack: HistorySnapshot[] = [];
const redoStack: HistorySnapshot[] = [];
const MAX_HISTORY = 100;
let coalesceKey: string | null = null;
let coalesceAt = 0;
let batching = false;

function historySnapshot(): HistorySnapshot {
  return {
    expressions: state.expressions.map((e) => ({ ...e })),
    sliders: state.sliders.map((s) => ({ ...s })),
    annotations: state.annotations.map((a) => ({ ...a })),
  };
}

function refreshHistoryFlags(): void {
  state.canUndo = undoStack.length > 0;
  state.canRedo = redoStack.length > 0;
}

// Call at the START of a recordable mutation, before state changes. A non-null
// key coalesces a burst of same-key edits (typing, a slider sweep) into one step.
function pushHistory(key: string | null): void {
  if (batching) return;
  const now = performance.now();
  if (key !== null && key === coalesceKey && now - coalesceAt < 700) {
    coalesceAt = now;
    return;
  }
  undoStack.push(historySnapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  coalesceKey = key;
  coalesceAt = now;
  refreshHistoryFlags();
  notify('history');
}

export function commitHistory(): void { coalesceKey = null; }

function restoreHistory(snap: HistorySnapshot): void {
  state.expressions = snap.expressions.map((e) => ({ ...e }));
  state.sliders = snap.sliders.map((s) => ({ ...s }));
  state.annotations = snap.annotations.map((a) => ({ ...a }));
  coalesceKey = null;
  notify('expressions');
  notify('sliders');
  notify('annotations');
}

export function undo(): Result {
  if (undoStack.length === 0) return { ok: false, error: 'Nothing to undo.' };
  redoStack.push(historySnapshot());
  restoreHistory(undoStack.pop()!);
  refreshHistoryFlags();
  notify('history');
  return { ok: true };
}

export function redo(): Result {
  if (redoStack.length === 0) return { ok: false, error: 'Nothing to redo.' };
  undoStack.push(historySnapshot());
  restoreHistory(redoStack.pop()!);
  refreshHistoryFlags();
  notify('history');
  return { ok: true };
}

export function beginBatch(): void {
  if (!batching) { undoStack.push(historySnapshot()); if (undoStack.length > MAX_HISTORY) undoStack.shift(); redoStack.length = 0; }
  batching = true;
  coalesceKey = null;
}
export function endBatch(): void {
  batching = false;
  coalesceKey = null;
  refreshHistoryFlags();
  notify('history');
}

// Dedicated colour / visibility mutations (kept out of upsert so they do not
// recompile the expression, and so each is a clean undo step).
export function setColor(id: string, color: string): Result<{ id: string; color: string }> {
  const expr = state.expressions.find((e) => e.id === id);
  if (!expr) return { ok: false, error: `No expression with id "${id}".` };
  pushHistory(`color:${id}`);
  expr.color = color;
  notify('expressions');
  return { ok: true, id, color };
}

export function setVisible(id: string, visible: boolean): Result<{ id: string; visible: boolean }> {
  const expr = state.expressions.find((e) => e.id === id);
  if (!expr) return { ok: false, error: `No expression with id "${id}".` };
  pushHistory(null);
  expr.visible = visible;
  notify('expressions');
  return { ok: true, id, visible };
}

export function subscribe(fn: Listener): () => boolean { listeners.add(fn); return () => listeners.delete(fn); }
export function getState(): BoardState { return state; }

function nextId() { return 'e' + (++idCounter); }

function nextColor() {
  return PALETTE[state.expressions.length % PALETTE.length];
}

function freeVars(node: MathNode): Set<string> {
  const names = new Set<string>();
  node.traverse((n, path, parent) => {
    if (n.type !== 'SymbolNode') return;
    const symbol = n as SymbolNode;
    if (parent?.type === 'FunctionNode' && path === 'fn') return;
    if (typeof (math as unknown as Record<string, unknown>)[symbol.name] === 'function') return;
    names.add(symbol.name);
  });
  return names;
}

function parameterNames(): string[] {
  const names = new Set<string>();
  for (const expression of state.expressions) {
    for (const name of expression.vars) {
      if (!RESERVED.has(name)) names.add(name);
    }
  }
  return [...names];
}

function defaultSlider(name: string): import('./types').Slider {
  return { name, min: -10, max: 10, step: 0.01, value: 1 };
}

function syncSlidersToExpressions(): string[] {
  const names = parameterNames();
  const existing = new Map(state.sliders.map((slider) => [slider.name, slider]));
  const newSliders = names.filter((name) => !existing.has(name));
  const retained = new Set(names);

  for (const [name, animation] of animations) {
    if (!retained.has(name)) {
      animation.finish('The parameter was removed from every expression.');
    }
  }

  state.sliders = names.map((name) => existing.get(name) ?? defaultSlider(name));
  return newSliders;
}

function pointSource(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;

  const inner = trimmed.slice(1, -1);
  let depth = 0;
  let comma = -1;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      if (comma !== -1) return null;
      comma = i;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0 || comma === -1) return null;

  const x = inner.slice(0, comma).trim();
  const y = inner.slice(comma + 1).trim();
  return x && y ? `[${x}, ${y}]` : null;
}

// Decide what kind of object an input describes, and produce the expression(s)
// that need compiling. Returns { kind, source, extra } or throws.
function classify(src: string): { kind: ExpressionKind; source: string } {
  const point = pointSource(src);
  if (point) return { kind: 'point', source: point };

  const eq = splitEquation(src);
  if (!eq) {
    return { kind: state.mode === '3d' ? 'explicit_z' : 'explicit_y', source: src };
  }
  const { lhs, rhs } = eq;
  const bare = (v: string) => lhs === v;

  if (bare('y') && !/\by\b/.test(rhs)) return { kind: 'explicit_y', source: rhs };
  if (bare('z')) return { kind: 'explicit_z', source: rhs };
  if (bare('x') && !/\bx\b/.test(rhs)) return { kind: 'explicit_x', source: rhs };
  if (bare('r')) return { kind: 'polar', source: rhs };
  return { kind: 'implicit', source: `(${lhs}) - (${rhs})` };
}

function compile(src: string) {
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
export function upsert(id: string | null, patch: ExpressionPatch = {}): Result<{ id: string; kind: ExpressionKind; latex: string; new_sliders: string[] }> | { ok: false; id: string; error: string } {
  const existing = state.expressions.find((e) => e.id === id);
  const latex = patch.latex ?? existing?.latex ?? '';
  const targetId = id ?? nextId();

  const record: Expression = {
    id: targetId,
    latex,
    color: patch.color ?? existing?.color ?? nextColor(),
    visible: patch.visible ?? existing?.visible ?? true,
    kind: 'empty', fn: null, node: null, error: null, vars: [],
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
      record.vars = [...freeVars(node)].filter((name) => kind !== 'polar' || name !== 'theta');
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
      record.kind = 'error';
    }
  }

  const idx = state.expressions.findIndex((e) => e.id === targetId);
  pushHistory(existing ? `edit:${targetId}` : null);
  if (idx === -1) state.expressions.push(record); else state.expressions[idx] = record;

  const newSliders = syncSlidersToExpressions();

  notify('expressions');

  if (record.error) {
    return { ok: false, id: targetId, error: `Could not parse "${latex}": ${record.error}` };
  }
  return { ok: true, id: targetId, kind: record.kind, latex, new_sliders: newSliders };
}

export function remove(id: string): Result<{ removed: { id: string; latex: string } }> {
  const idx = state.expressions.findIndex((e) => e.id === id);
  if (idx === -1) return { ok: false, error: `No expression with id "${id}". Call list_expressions to see current ids.` };
  pushHistory(null);
  const [gone] = state.expressions.splice(idx, 1);
  syncSlidersToExpressions();
  notify('expressions');
  return { ok: true, removed: { id: gone.id, latex: gone.latex } };
}

export function clearAll(): Result {
  if (state.expressions.length > 0 || state.annotations.length > 0) pushHistory(null);
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
    ...(e.kind === 'point' ? { point: pointCoordinates(e) ?? undefined } : {}),
  }));
}

export function pointCoordinates(expression: Expression): { x: number; y: number } | null {
  if (expression.kind !== 'point' || !expression.fn) return null;
  try {
    const value = expression.fn.evaluate(scope());
    const pair = value && typeof value.toArray === 'function' ? value.toArray() : value;
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch {
    return null;
  }
}

export function defineSlider(name: string, spec: SliderSpec = {}, quiet = false): Result<{ slider: import('./types').Slider }> {
  if (RESERVED.has(name)) {
    return { ok: false, error: `"${name}" is a coordinate or reserved value and cannot be a slider.` };
  }
  if (!parameterNames().includes(name)) {
    return { ok: false, error: `No expression currently uses parameter "${name}". Add it to an expression first.` };
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

  if (!quiet) pushHistory(`slider-def:${name}`);
  if (existing) Object.assign(existing, slider);
  else state.sliders.push(slider);

  if (!quiet) notify('sliders');
  return { ok: true, slider: { ...slider } };
}

export function setSlider(name: string, value: number): Result<{ name: string; value: number; clamped: boolean }> {
  const slider = state.sliders.find((s) => s.name === name);
  if (!slider) {
    return { ok: false, error: `No slider named "${name}". Existing sliders: ${state.sliders.map((s) => s.name).join(', ') || '(none)'}. Use define_slider to create it.` };
  }
  const clamped = Math.min(slider.max, Math.max(slider.min, Number(value)));
  pushHistory(`slider:${name}`);
  slider.value = clamped;
  notify('sliders');
  return { ok: true, name, value: clamped, clamped: clamped !== Number(value) };
}

export function scope(): NumericScope {
  const s: NumericScope = {};
  for (const slider of state.sliders) s[slider.name] = slider.value;
  return s;
}

/** Animate a slider from -> to, driving the real on-screen control. */
export function animateSlider(name: string, from: number | undefined, to: number, duration = 1500): Promise<Result<{ name: string; from: number; to: number; duration_ms: number; note?: string }>> {
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
    const finish = (note?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      const running = animations.get(name);
      if (running) { cancelAnimationFrame(running.handle); animations.delete(name); }
      slider.value = end;
      notify('sliders');
      resolve({ ok: true, name, from: start, to: end, duration_ms: ms, ...(note ? { note } : {}) });
    };

    const tick = (now: number) => {
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

export function setViewport(patch: Partial<Viewport>): Result<{ viewport: Viewport }> {
  const v = { ...state.viewport, ...patch };
  if (v.xmin >= v.xmax || v.ymin >= v.ymax) {
    return { ok: false, error: 'Viewport requires xmin < xmax and ymin < ymax.' };
  }
  state.viewport = v;
  notify('viewport');
  return { ok: true, viewport: { ...v } };
}

export function setCamera(patch: Partial<CameraState>): Result<{ camera: CameraState }> {
  const c = { ...state.camera, ...patch };
  c.phi = Math.min(179, Math.max(1, c.phi));
  c.distance = Math.min(200, Math.max(2, c.distance));
  state.camera = c;
  notify('camera');
  return { ok: true, camera: { ...c } };
}

export function setSnapToCurve(enabled: boolean): Result<{ snapToCurve: boolean }> {
  state.snapToCurve = Boolean(enabled);
  notify('settings');
  return { ok: true, snapToCurve: state.snapToCurve };
}

export function setSnapping(enabled: boolean): Result<{ snapping: boolean }> {
  state.snapping = Boolean(enabled);
  notify('settings');
  return { ok: true, snapping: state.snapping };
}

export function setMode(mode: BoardMode): Result<{ mode: BoardMode }> {
  if (mode !== '2d' && mode !== '3d') return { ok: false, error: 'mode must be "2d" or "3d".' };
  if (mode === '3d' && state.mode !== '3d') {
    const extent = Math.max(
      Math.abs(state.viewport.xmin),
      Math.abs(state.viewport.xmax),
      Math.abs(state.viewport.ymin),
      Math.abs(state.viewport.ymax),
      Math.abs(state.viewport.zmin),
      Math.abs(state.viewport.zmax),
      1,
    );
    state.viewport = {
      xmin: -extent,
      xmax: extent,
      ymin: -extent,
      ymax: extent,
      zmin: -extent,
      zmax: extent,
    };
  }
  state.mode = mode;
  notify('mode');
  return { ok: true, mode };
}

export function annotate({ x, y, z, text }: { x: number; y: number; z?: number; text: string }): Result<{ annotation: Annotation }> {
  const note: Annotation = { id: 'a' + (++idCounter), x: Number(x), y: Number(y), z: z == null ? null : Number(z), text: String(text) };
  pushHistory(null);
  state.annotations.push(note);
  notify('annotations');
  return { ok: true, annotation: note };
}

export function clearAnnotations() {
  if (state.annotations.length > 0) pushHistory(null);
  state.annotations = [];
  notify('annotations');
  return { ok: true };
}

export function evaluateAt(latex: string, at: NumericScope = {}): Result<{ value: number | null; note?: string }> {
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
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function byId(id: string): Expression | undefined { return state.expressions.find((e) => e.id === id); }
export { RESERVED, PALETTE };
