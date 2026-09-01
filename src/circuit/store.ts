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

const LED_COLORS: LedColor[] = ['red', 'green', 'blue', 'yellow', 'white'];

const state: CircuitState = {
  components: [],
  wires: [],
  selectedId: null,
  running: true,
  view: { originX: -8, originY: -6, scale: 46 },
  solution: null,
  message: null,
};

type Listener = (reason: ChangeReason, state: CircuitState) => void;
const listeners = new Set<Listener>();

const counters = new Map<ComponentType, number>();
let wireCounter = 0;

const ID_PREFIX: Record<ComponentType, string> = {
  battery: 'bat', resistor: 'r', led: 'led', lamp: 'lamp', switch: 'sw', ground: 'gnd',
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

// Re-run the solve and publish it. Every mutating function ends by calling this.
export function resolve(): Solution {
  const solution = solve(state.components, state.wires);
  state.solution = solution;
  notify('solution');
  return solution;
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
    closed: type === 'switch' ? false : false,
    color,
    label: opts.label ?? null,
  };
  state.components.push(component);
  state.selectedId = id;
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
  state.components.splice(idx, 1);
  // Drop any wires that referenced this component's pins.
  state.wires = state.wires.filter((w) => !w.from.startsWith(`${id}.`) && !w.to.startsWith(`${id}.`));
  if (state.selectedId === id) state.selectedId = null;
  notify('components');
  resolve();
  return { ok: true };
}

export function moveComponent(id: string, x: number, y: number): { ok: boolean; error?: string } {
  const c = componentById(id);
  if (!c) return { ok: false, error: `No component with id "${id}".` };
  c.x = Math.round(x); c.y = Math.round(y);
  notify('components');
  resolve();
  return { ok: true };
}

export function rotateComponent(id: string, rotation?: Rotation): { ok: boolean; error?: string; rotation?: Rotation } {
  const c = componentById(id);
  if (!c) return { ok: false, error: `No component with id "${id}".` };
  if (rotation !== undefined) c.rotation = (((rotation % 360) + 360) % 360) as Rotation;
  else c.rotation = ((c.rotation + 90) % 360) as Rotation;
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
  c.value = clampValue(c.type, value);
  notify('components');
  resolve();
  return { ok: true, value: c.value };
}

export function setColor(id: string, color: LedColor): { ok: boolean; error?: string } {
  const c = componentById(id);
  if (!c || c.type !== 'led') return { ok: false, error: `No LED with id "${id}".` };
  if (!LED_COLORS.includes(color)) return { ok: false, error: `Unknown LED colour "${color}".` };
  c.color = color;
  notify('components');
  resolve();
  return { ok: true };
}

export function toggleSwitch(id: string, closed?: boolean): { ok: boolean; error?: string; closed?: boolean } {
  const c = componentById(id);
  if (!c || c.type !== 'switch') return { ok: false, error: `No switch with id "${id}".` };
  c.closed = closed ?? !c.closed;
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
  const id = `w${++wireCounter}`;
  state.wires.push({ id, from, to });
  notify('wires');
  resolve();
  return { ok: true, wireId: id };
}

export function disconnect(a: string, b: string): { ok: boolean; error?: string } {
  const before = state.wires.length;
  state.wires = state.wires.filter(
    (w) => !((w.from === a && w.to === b) || (w.from === b && w.to === a)),
  );
  if (state.wires.length === before) return { ok: false, error: `No wire between ${a} and ${b}.` };
  notify('wires');
  resolve();
  return { ok: true };
}

export function removeWire(wireId: string): { ok: boolean; error?: string } {
  const before = state.wires.length;
  state.wires = state.wires.filter((w) => w.id !== wireId);
  if (state.wires.length === before) return { ok: false, error: `No wire "${wireId}".` };
  notify('wires');
  resolve();
  return { ok: true };
}

export function clearAll(): { ok: true } {
  state.components = [];
  state.wires = [];
  state.selectedId = null;
  counters.clear();
  wireCounter = 0;
  notify('components');
  resolve();
  return { ok: true };
}

export function clearWires(): { ok: true } {
  state.wires = [];
  notify('wires');
  resolve();
  return { ok: true };
}

// ---- selection, view, running ----

export function setSelected(id: string | null): void {
  state.selectedId = id;
  notify('selection');
}

export function setRunning(running: boolean): void {
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
