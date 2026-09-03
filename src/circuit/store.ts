// The single mutation layer for the circuit board. The palette, the canvas
// interactions and the WebMCP tools all call these functions -- there is no
// second path. The solver runs after every change so the on-screen readings
// and the numbers an agent reads back are always the same solve.

import type {
  ChangeReason,
  Component,
  ComponentType,
  CircuitState,
  LedColor,
  Rotation,
  Solution,
  View,
  Wire,
} from './types';
import { CATALOG, pinNames } from './components';
import { solve } from './solver';
import { createChangeLog } from '../changelog';

const LED_COLORS: LedColor[] = ['red', 'green', 'blue', 'yellow', 'white'];

const state: CircuitState = {
  components: [],
  wires: [],
  selectedId: null,
  selectedWireId: null,
  running: true,
  view: { originX: -8, originY: -6, scale: 46 },
  solution: null,
  scope: { visible: false, traces: [], windowSeconds: 10 },
  canUndo: false,
  canRedo: false,
  message: null,
};

// Held capacitor voltages, carried between transient steps (kept out of the
// serialisable-ish state object because it is solver bookkeeping).
let capVoltage: Record<string, number> = {};
let indCurrent: Record<string, number> = {};
let simTime = 0;

// ---- undo / redo ----
// Snapshots capture only the circuit itself (components + wires); selection,
// view and transient state are not part of history.
interface Snapshot { components: Component[]; wires: Wire[]; }
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
const MAX_HISTORY = 100;
let coalesceKey: string | null = null;
let coalesceAt = 0;
let batching = false;

function snapshot(): Snapshot {
  return {
    components: state.components.map((c) => ({ ...c })),
    wires: state.wires.map((w) => ({ ...w })),
  };
}

function refreshHistoryFlags(): void {
  state.canUndo = undoStack.length > 0;
  state.canRedo = redoStack.length > 0;
}

// Called at the START of every recordable mutation, before state changes.
// A non-null `key` coalesces a burst of same-key edits (a drag, a slider
// sweep) into a single undo step.
function record(key: string | null): void {
  if (batching) return;
  const now = performance.now();
  if (key !== null && key === coalesceKey && now - coalesceAt < 700) {
    coalesceAt = now;
    return;
  }
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  coalesceKey = key;
  coalesceAt = now;
  refreshHistoryFlags();
  notify('history');
}

// End a coalescing burst (e.g. on pointer-up) so the next same-key edit starts
// a fresh undo step.
export function commitHistory(): void { coalesceKey = null; }

function restoreSnapshot(snap: Snapshot): void {
  state.components = snap.components.map((c) => ({ ...c }));
  state.wires = snap.wires.map((w) => ({ ...w }));
  state.selectedId = null;
  state.selectedWireId = null;
  capVoltage = {};
  indCurrent = {};
  simTime = 0;
  // Drop scope traces whose component no longer exists.
  state.scope.traces = state.scope.traces.filter((tr) => state.components.some((c) => c.id === tr.componentId));
  coalesceKey = null;
  notify('components');
  resolve();
}

export function undo(): { ok: boolean } {
  if (undoStack.length === 0) return { ok: false };
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop()!);
  refreshHistoryFlags();
  changes.record('undid', { summary: 'the last change was undone' });
  notify('history');
  return { ok: true };
}

export function redo(): { ok: boolean } {
  if (redoStack.length === 0) return { ok: false };
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop()!);
  refreshHistoryFlags();
  changes.record('redid', { summary: 'the last undone change was reapplied' });
  notify('history');
  return { ok: true };
}

// Group a composite operation (e.g. loading a preset) into one undo step.
export function beginBatch(): void {
  if (!batching) { undoStack.push(snapshot()); if (undoStack.length > MAX_HISTORY) undoStack.shift(); redoStack.length = 0; }
  batching = true;
  coalesceKey = null;
}
export function endBatch(): void {
  batching = false;
  coalesceKey = null;
  refreshHistoryFlags();
  notify('history');
}

/** What changed on this board, and who changed it. */
export const changes = createChangeLog();

type Listener = (reason: ChangeReason, state: CircuitState) => void;
const listeners = new Set<Listener>();

const counters = new Map<ComponentType, number>();
let wireCounter = 0;

const ID_PREFIX: Record<ComponentType, string> = {
  battery: 'bat', resistor: 'r', led: 'led', lamp: 'lamp', switch: 'sw',
  capacitor: 'cap', inductor: 'ind', diode: 'd', potentiometer: 'pot', currentsource: 'isrc',
  acsource: 'ac', fuse: 'fuse', voltmeter: 'vm', ammeter: 'am', motor: 'mot', buzzer: 'buz', ground: 'gnd',
};

function notify(reason: ChangeReason): void {
  for (const fn of listeners) fn(reason, state);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): CircuitState { return state; }
export function componentById(id: string): Component | undefined {
  return state.components.find((c) => c.id === id);
}

function nextId(type: ComponentType): string {
  const n = (counters.get(type) ?? 0) + 1;
  counters.set(type, n);
  return `${ID_PREFIX[type]}${n}`;
}

export function needsTransient(): boolean {
  return state.components.some(
    (c) => c.type === 'capacitor' || c.type === 'inductor' || c.type === 'acsource',
  );
}

// One solve step. dt === 0 takes an instantaneous snapshot; dt > 0 advances any
// reactive parts one transient step. A blown fuse is detected here: if a fuse
// exceeds its rating it opens and the circuit is re-solved once.
function solveStep(dt: number): Solution {
  let solution = solve(state.components, state.wires, { dt, capVoltage, indCurrent, time: simTime });
  if (solution.ok) {
    let anyBlew = false;
    for (const c of state.components) {
      if (c.type === 'fuse' && !c.blown) {
        const i = solution.results[c.id]?.current ?? 0;
        if (Math.abs(i) > c.value) { c.blown = true; anyBlew = true; }
      }
    }
    if (anyBlew) solution = solve(state.components, state.wires, { dt, capVoltage, indCurrent, time: simTime });
    capVoltage = { ...capVoltage, ...solution.capVoltage };
    indCurrent = { ...indCurrent, ...solution.indCurrent };
    if (dt > 0) sampleScope(solution);
  }
  state.solution = solution;
  return solution;
}

function step(dt: number): Solution {
  const solution = solveStep(dt);
  notify('solution');
  return solution;
}

// ---- oscilloscope ----

const SCOPE_COLORS = ['#2d70b3', '#c74440', '#388c46', '#6042a6', '#e0a500', '#0ea5e9'];

function sampleScope(solution: Solution): void {
  const scope = state.scope;
  if (scope.traces.length === 0) return;
  for (const tr of scope.traces) {
    const res = solution.results[tr.componentId];
    if (!res) continue;
    const v = tr.quantity === 'voltage' ? res.voltage : res.current * 1000; // current in mA
    tr.samples.push({ t: simTime, v });
    const cutoff = simTime - scope.windowSeconds;
    if (tr.samples.length > 4 && tr.samples[0].t < cutoff) {
      // trim points that have scrolled off the left edge
      let i = 0;
      while (i < tr.samples.length - 2 && tr.samples[i + 1].t < cutoff) i++;
      if (i > 0) tr.samples.splice(0, i);
    }
    if (tr.samples.length > 4000) tr.samples.splice(0, tr.samples.length - 4000);
  }
}

export function addProbe(componentId: string, quantity: 'voltage' | 'current'): { ok: boolean; error?: string; traceId?: string } {
  const c = componentById(componentId);
  if (!c) return { ok: false, error: `No component with id "${componentId}".` };
  if (c.type === 'ground') return { ok: false, error: 'Ground carries no signal to probe.' };
  const traceId = `${componentId}:${quantity}`;
  if (state.scope.traces.some((tr) => tr.id === traceId)) {
    return { ok: false, error: `${componentId} ${quantity} is already on the scope.` };
  }
  const color = SCOPE_COLORS[state.scope.traces.length % SCOPE_COLORS.length];
  const unit = quantity === 'voltage' ? 'V' : 'mA';
  state.scope.traces.push({
    id: traceId, componentId, quantity,
    label: `${componentId} ${quantity === 'voltage' ? 'V' : 'I'} (${unit})`,
    color, samples: [],
  });
  state.scope.visible = true;
  notify('scope');
  return { ok: true, traceId };
}

export function removeProbe(traceId: string): { ok: boolean; error?: string } {
  const before = state.scope.traces.length;
  state.scope.traces = state.scope.traces.filter((tr) => tr.id !== traceId);
  if (state.scope.traces.length === before) return { ok: false, error: `No scope trace "${traceId}".` };
  notify('scope');
  return { ok: true };
}

export function clearScope(): { ok: true } {
  state.scope.traces = [];
  notify('scope');
  return { ok: true };
}

export function showScope(visible: boolean): { ok: true; visible: boolean } {
  state.scope.visible = visible;
  notify('scope');
  return { ok: true, visible };
}

export function resolve(): Solution {
  return step(0);
}

// Called by the render loop with the real time since the last frame. Advances
// the simulation in small fixed sub-steps so the transient tracks wall-clock
// time at any frame rate (a low or throttled frame rate no longer makes it
// crawl), while a per-frame cap avoids a huge jump after the tab was paused.
const SIM_SUBSTEP = 1 / 120; // seconds of sim per integration step
const SIM_MAX_CATCHUP = 0.25; // max seconds of sim advanced in a single frame
export function advance(dtReal: number): void {
  if (!state.running) return;
  const scopeActive = state.scope.visible && state.scope.traces.length > 0;
  if (!needsTransient() && !scopeActive) return;
  let remaining = Math.min(SIM_MAX_CATCHUP, Math.max(0, dtReal));
  if (remaining <= 0) return;
  while (remaining > 1e-6) {
    const h = Math.min(SIM_SUBSTEP, remaining);
    simTime += h;
    solveStep(h);
    remaining -= h;
  }
  notify('solution');
}

// Reset the transient: discharge every capacitor and re-solve from t = 0.
export function resetSimulation(): { ok: true } {
  capVoltage = {};
  indCurrent = {};
  simTime = 0;
  for (const c of state.components) if (c.type === 'fuse') c.blown = false;
  for (const tr of state.scope.traces) tr.samples = [];
  resolve();
  notify('scope');
  return { ok: true };
}

function autoPlace(): { x: number; y: number } {
  // Fan new parts out on a coarse grid so they do not stack.
  const n = state.components.length;
  const cols = 4;
  return { x: (n % cols) * 4, y: Math.floor(n / cols) * 3 };
}

export interface AddOptions {
  x?: number;
  y?: number;
  rotation?: Rotation;
  value?: number;
  color?: LedColor;
  label?: string;
}

export function addComponent(type: ComponentType, opts: AddOptions = {}): { ok: true; id: string; pins: string[] } | { ok: false; error: string } {
  if (!CATALOG[type]) {
    return { ok: false, error: `Unknown component type "${type}". Valid types: ${Object.keys(CATALOG).join(', ')}.` };
  }
  const entry = CATALOG[type];
  const id = nextId(type);
  const place = opts.x !== undefined && opts.y !== undefined ? { x: opts.x, y: opts.y } : autoPlace();
  const value = opts.value !== undefined ? clampValue(type, opts.value) : entry.defaultValue;
  const color = opts.color && LED_COLORS.includes(opts.color) ? opts.color : 'red';

  const component: Component = {
    id, type,
    x: Math.round(place.x), y: Math.round(place.y),
    rotation: opts.rotation ?? 0,
    value,
    closed: false,
    color,
    wiper: 0.5,
    freq: 1,
    blown: false,
    label: opts.label ?? null,
  };
  record(null);
  if (type === 'capacitor') capVoltage[id] = 0;
  if (type === 'inductor') indCurrent[id] = 0;
  state.components.push(component);
  state.selectedId = id;
  state.selectedWireId = null;
  changes.record('added component', {
    target: id, to: type, summary: `${type} ${id} added`,
  });
  notify('components');
  resolve();
  return { ok: true, id, pins: pinNames(type) };
}

function clampValue(type: ComponentType, value: number): number {
  const entry = CATALOG[type];
  if (entry.unit === '') return value;
  return Math.max(entry.valueMin, Math.min(entry.valueMax, value));
}

export function removeComponent(id: string): { ok: boolean; error?: string } {
  const idx = state.components.findIndex((c) => c.id === id);
  if (idx === -1) return { ok: false, error: `No component with id "${id}".` };
  record(null);
  state.components.splice(idx, 1);
  state.scope.traces = state.scope.traces.filter((tr) => tr.componentId !== id);
  delete capVoltage[id];
  delete indCurrent[id];
  // Drop any wires that referenced this component's pins.
  state.wires = state.wires.filter((w) => !w.from.startsWith(`${id}.`) && !w.to.startsWith(`${id}.`));
  if (state.selectedId === id) state.selectedId = null;
  changes.record('removed component', { target: id, summary: `${id} removed` });
  notify('components');
  resolve();
  return { ok: true };
}

export function moveComponent(id: string, x: number, y: number, snap = true): { ok: boolean; error?: string } {
  const c = componentById(id);
  if (!c) return { ok: false, error: `No component with id "${id}".` };
  record(`move:${id}`);
  const wasAt = { x: c.x, y: c.y };
  c.x = snap ? Math.round(x) : x;
  c.y = snap ? Math.round(y) : y;
  changes.record('moved component', {
    target: id, from: wasAt, to: { x: c.x, y: c.y }, coalesce: true,
    summary: `${id} moved to (${c.x}, ${c.y})`,
  });
  notify('components');
  resolve();
  return { ok: true };
}

export function rotateComponent(id: string, rotation?: Rotation): { ok: boolean; error?: string; rotation?: Rotation } {
  const c = componentById(id);
  if (!c) return { ok: false, error: `No component with id "${id}".` };
  record(null);
  if (rotation !== undefined) c.rotation = (((rotation % 360) + 360) % 360) as Rotation;
  else c.rotation = ((c.rotation + 90) % 360) as Rotation;
  changes.record('rotated component', {
    target: id, to: c.rotation, summary: `${id} rotated to ${c.rotation}°`,
  });
  notify('components');
  resolve();
  return { ok: true, rotation: c.rotation };
}

export function setValue(id: string, value: number): { ok: boolean; error?: string; value?: number } {
  const c = componentById(id);
  if (!c) return { ok: false, error: `No component with id "${id}".` };
  if (CATALOG[c.type].unit === '') {
    return { ok: false, error: `${c.type} "${id}" has no numeric value to set.` };
  }
  record(`value:${id}`);
  const wasValue = c.value;
  c.value = clampValue(c.type, value);
  changes.record('changed value', {
    target: id, from: wasValue, to: c.value, coalesce: true,
    summary: `${id} set to ${c.value}${CATALOG[c.type].unit}`,
  });
  notify('components');
  resolve();
  return { ok: true, value: c.value };
}

export function setColor(id: string, color: LedColor): { ok: boolean; error?: string } {
  const c = componentById(id);
  if (!c || c.type !== 'led') return { ok: false, error: `No LED with id "${id}".` };
  if (!LED_COLORS.includes(color)) return { ok: false, error: `Unknown LED colour "${color}".` };
  record(null);
  const wasColour = c.color;
  c.color = color;
  changes.record('changed LED colour', {
    target: id, from: wasColour, to: color, summary: `${id} changed to ${color}`,
  });
  notify('components');
  resolve();
  return { ok: true };
}

export function setWiper(id: string, wiper: number): { ok: boolean; error?: string; wiper?: number } {
  const c = componentById(id);
  if (!c || c.type !== 'potentiometer') return { ok: false, error: `No potentiometer with id "${id}".` };
  record(`wiper:${id}`);
  const wasWiper = c.wiper;
  c.wiper = Math.min(1, Math.max(0, wiper));
  changes.record('moved wiper', {
    target: id, from: +wasWiper.toFixed(3), to: +c.wiper.toFixed(3), coalesce: true,
    summary: `${id} wiper moved to ${(c.wiper * 100).toFixed(0)}%`,
  });
  notify('components');
  resolve();
  return { ok: true, wiper: c.wiper };
}

export function setFrequency(id: string, freq: number): { ok: boolean; error?: string; freq?: number } {
  const c = componentById(id);
  if (!c || c.type !== 'acsource') return { ok: false, error: `No AC source with id "${id}".` };
  record(`freq:${id}`);
  const wasFreq = c.freq;
  c.freq = Math.min(1000, Math.max(0.01, freq));
  changes.record('changed frequency', {
    target: id, from: wasFreq, to: c.freq, coalesce: true,
    summary: `${id} set to ${c.freq} Hz`,
  });
  notify('components');
  resolve();
  return { ok: true, freq: c.freq };
}

export function toggleSwitch(id: string, closed?: boolean): { ok: boolean; error?: string; closed?: boolean } {
  const c = componentById(id);
  if (!c || c.type !== 'switch') return { ok: false, error: `No switch with id "${id}".` };
  record(null);
  c.closed = closed ?? !c.closed;
  changes.record(c.closed ? 'closed switch' : 'opened switch', {
    target: id, to: c.closed, summary: `${id} ${c.closed ? 'closed' : 'opened'}`,
  });
  notify('components');
  resolve();
  return { ok: true, closed: c.closed };
}

// ---- wires ----

export function pinRefValid(pinRef: string): boolean {
  const dot = pinRef.lastIndexOf('.');
  if (dot === -1) return false;
  const id = pinRef.slice(0, dot);
  const pin = pinRef.slice(dot + 1);
  const c = componentById(id);
  return !!c && pinNames(c.type).includes(pin);
}

export function connect(from: string, to: string): { ok: boolean; error?: string; wireId?: string } {
  if (!pinRefValid(from)) return { ok: false, error: `"${from}" is not a valid pin. Use the form "componentId.pin", e.g. "r1.a".` };
  if (!pinRefValid(to)) return { ok: false, error: `"${to}" is not a valid pin. Use the form "componentId.pin", e.g. "bat1.pos".` };
  if (from === to) return { ok: false, error: 'A pin cannot be wired to itself.' };
  const exists = state.wires.some(
    (w) => (w.from === from && w.to === to) || (w.from === to && w.to === from),
  );
  if (exists) return { ok: false, error: `${from} and ${to} are already connected.` };
  record(null);
  const id = `w${++wireCounter}`;
  state.wires.push({ id, from, to });
  changes.record('connected', {
    target: id, to: { from, to }, summary: `${from} wired to ${to}`,
  });
  notify('wires');
  resolve();
  return { ok: true, wireId: id };
}

export function disconnect(a: string, b: string): { ok: boolean; error?: string } {
  const kept = state.wires.filter(
    (w) => !((w.from === a && w.to === b) || (w.from === b && w.to === a)),
  );
  if (kept.length === state.wires.length) return { ok: false, error: `No wire between ${a} and ${b}.` };
  record(null);
  state.wires = kept;
  changes.record('disconnected', { from: { from: a, to: b }, summary: `${a} disconnected from ${b}` });
  notify('wires');
  resolve();
  return { ok: true };
}

export function removeWire(wireId: string): { ok: boolean; error?: string } {
  const kept = state.wires.filter((w) => w.id !== wireId);
  if (kept.length === state.wires.length) return { ok: false, error: `No wire "${wireId}".` };
  record(null);
  state.wires = kept;
  if (state.selectedWireId === wireId) state.selectedWireId = null;
  changes.record('disconnected', { target: wireId, summary: `wire ${wireId} removed` });
  notify('wires');
  resolve();
  return { ok: true };
}

export function clearAll(): { ok: true } {
  if (state.components.length > 0 || state.wires.length > 0) record(null);
  state.components = [];
  state.wires = [];
  state.scope.traces = [];
  state.selectedId = null;
  state.selectedWireId = null;
  capVoltage = {};
  indCurrent = {};
  simTime = 0;
  counters.clear();
  wireCounter = 0;
  changes.record('cleared board', { summary: 'every component and wire removed' });
  notify('components');
  resolve();
  return { ok: true };
}

export function clearWires(): { ok: true } {
  if (state.wires.length > 0) record(null);
  state.wires = [];
  changes.record('cleared wires', { summary: 'every wire removed, parts left in place' });
  notify('wires');
  resolve();
  return { ok: true };
}

// ---- selection, view, running ----

export function setSelected(id: string | null): void {
  state.selectedId = id;
  if (id !== null) state.selectedWireId = null;
  notify('selection');
}

export function setSelectedWire(id: string | null): void {
  state.selectedWireId = id;
  if (id !== null) state.selectedId = null;
  notify('selection');
}

export function setRunning(running: boolean): void {
  if (state.running !== running) {
    changes.record(running ? 'resumed simulation' : 'paused simulation', {
      to: running, summary: `simulation ${running ? 'resumed' : 'paused'}`,
    });
  }
  state.running = running;
  if (running) resolve();
  notify('running');
}

export function setView(patch: Partial<View>): void {
  state.view = { ...state.view, ...patch };
  notify('view');
}

export function setMessage(message: string | null): void {
  state.message = message;
}

export { LED_COLORS };
