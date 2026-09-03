// Wiring for the circuit page. Boots the renderer, builds the palette and the
// selected-part inspector, registers the WebMCP tools, and mirrors every tool
// call into the on-screen activity log -- the same shape as the grapher's
// main.ts, so the two pages behave consistently.

import * as circuit from './store';
import { TOOLS } from './tools';
import { PRESETS } from './presets';
import { CATALOG, COMPONENT_ORDER, LED_SPEC } from './components';
import { initCircuitRender, clientToGrid } from './render';
import { initScope, resizeScope } from './scope';
import { mustQuery } from '../dom';
import type { Component, ComponentType, LedColor } from './types';
import { wireWebmcpTester } from '../webmcp-selftest';
import { watchWebMcp, type WebMcpStatus } from '../webmcp';

const canvas = mustQuery<HTMLCanvasElement>('#circuit-canvas');
const logEl = mustQuery<HTMLDivElement>('#log');
const badge = mustQuery<HTMLDivElement>('#mcp-badge');
const badgeText = mustQuery<HTMLSpanElement>('#mcp-text');
const paletteEl = mustQuery<HTMLDivElement>('#palette');
const inspectorPanel = mustQuery<HTMLDivElement>('#inspector-panel');
const emptyHint = mustQuery<HTMLDivElement>('#empty-hint');
const warningBar = mustQuery<HTMLDivElement>('#warning-bar');
const scopePanel = mustQuery<HTMLDivElement>('#scope-panel');
const scopeCanvas = mustQuery<HTMLCanvasElement>('#scope-canvas');
const scopeLegend = mustQuery<HTMLDivElement>('#scope-legend');
const undoBtn = mustQuery<HTMLButtonElement>('#undo-btn');
const redoBtn = mustQuery<HTMLButtonElement>('#redo-btn');

/* ---------- activity log (identical pattern to the grapher) ---------- */

type CallSource = 'you' | 'agent';
let callSource: CallSource | null = null;
let suppressLogging = false;

function logCall(name: string, args: Record<string, unknown>, source: CallSource): HTMLDivElement {
  const empty = logEl.querySelector('.empty');
  if (empty) empty.remove();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const title = document.createElement('div');
  title.className = 'log-name';
  title.textContent = name;
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = source === 'you' ? 'you' : 'agent';
  title.append(time);
  const argsEl = document.createElement('div');
  argsEl.className = 'log-args';
  const printed = JSON.stringify(args ?? {});
  argsEl.textContent = printed.length > 160 ? printed.slice(0, 160) + '…' : printed;
  entry.append(title, argsEl);
  logEl.prepend(entry);
  while (logEl.children.length > 60) logEl.lastElementChild?.remove();
  return entry;
}

for (const tool of TOOLS) {
  const inner = tool.execute;
  tool.execute = async (args) => {
    const source = callSource ?? 'agent';
    const entry = suppressLogging ? null : logCall(tool.name, args, source);
    try {
      // Attribute every mutation this call makes. A WebMCP agent calls
      // execute() directly rather than going through runTool, so this is the
      // only place that sees every caller.
      const result = await circuit.changes.as(
        source === 'you' ? 'user' : 'agent',
        () => inner(args ?? {}),
      );
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
        entry?.classList.add('fail');
      }
      if (tool.name === 'load_preset' && result && typeof result === 'object' && 'ok' in result && result.ok !== false) {
        const name = typeof args?.name === 'string' ? args.name : '';
        if (name in PRESETS) presetSelect.value = name;
      }
      return result;
    } catch (err) {
      entry?.classList.add('fail');
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

async function runTool(name: string, args: Record<string, unknown>, source: CallSource = 'you'): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `No tool named ${name}` };
  callSource = source;
  try { return await tool.execute(args); }
  finally { callSource = null; }
}

mustQuery<HTMLButtonElement>('#clear-log').addEventListener('click', () => {
  logEl.innerHTML = '<p class="empty">Tool calls from the agent appear here as they arrive.</p>';
});

/* ---------- renderer ---------- */

initCircuitRender(canvas);
initScope(scopeCanvas);

/* ---------- palette ---------- */

const ICONS: Record<ComponentType, string> = {
  battery: '<line x1="16" y1="15" x2="16" y2="5" stroke="currentColor" stroke-width="2"/><line x1="16" y1="10" x2="30" y2="10" stroke="currentColor" stroke-width="2"/><line x1="30" y1="18" x2="30" y2="2" stroke="currentColor" stroke-width="2"/><line x1="30" y1="10" x2="42" y2="10" stroke="currentColor" stroke-width="2"/><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" stroke-width="2"/>',
  resistor: '<polyline points="4,15 12,15 15,7 21,23 27,7 33,23 36,15 44,15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  led: '<line x1="4" y1="15" x2="16" y2="15" stroke="currentColor" stroke-width="2"/><path d="M16 6 L16 24 L30 15 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><line x1="30" y1="6" x2="30" y2="24" stroke="currentColor" stroke-width="2"/><line x1="30" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/><path d="M22 4 l4 -4 M27 5 l4 -4" stroke="currentColor" stroke-width="1.5"/>',
  lamp: '<line x1="4" y1="15" x2="12" y2="15" stroke="currentColor" stroke-width="2"/><circle cx="23" cy="15" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M17 9 L29 21 M17 21 L29 9" stroke="currentColor" stroke-width="1.6"/><line x1="34" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  switch: '<line x1="4" y1="17" x2="16" y2="17" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="17" r="2.5" fill="currentColor"/><circle cx="32" cy="17" r="2.5" fill="currentColor"/><line x1="16" y1="17" x2="31" y2="7" stroke="currentColor" stroke-width="2"/><line x1="32" y1="17" x2="44" y2="17" stroke="currentColor" stroke-width="2"/>',
  ground: '<line x1="23" y1="2" x2="23" y2="14" stroke="currentColor" stroke-width="2"/><line x1="13" y1="14" x2="33" y2="14" stroke="currentColor" stroke-width="2"/><line x1="17" y1="19" x2="29" y2="19" stroke="currentColor" stroke-width="2"/><line x1="20" y1="24" x2="26" y2="24" stroke="currentColor" stroke-width="2"/>',
  capacitor: '<line x1="4" y1="15" x2="20" y2="15" stroke="currentColor" stroke-width="2"/><line x1="20" y1="6" x2="20" y2="24" stroke="currentColor" stroke-width="2.4"/><line x1="28" y1="6" x2="28" y2="24" stroke="currentColor" stroke-width="2.4"/><line x1="28" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  diode: '<line x1="4" y1="15" x2="16" y2="15" stroke="currentColor" stroke-width="2"/><path d="M16 7 L16 23 L30 15 Z" fill="currentColor" fill-opacity="0.55" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><line x1="30" y1="7" x2="30" y2="23" stroke="currentColor" stroke-width="2"/><line x1="30" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  inductor: '<line x1="4" y1="17" x2="12" y2="17" stroke="currentColor" stroke-width="2"/><path d="M12 17 a4 4 0 0 1 8 0 a4 4 0 0 1 8 0 a4 4 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="2"/><line x1="36" y1="17" x2="44" y2="17" stroke="currentColor" stroke-width="2"/>',
  potentiometer: '<polyline points="6,20 12,20 15,12 21,28 27,12 33,28 36,20 42,20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><line x1="24" y1="2" x2="24" y2="12" stroke="currentColor" stroke-width="2"/><path d="M24 12 l-3 -4 l6 0 z" fill="currentColor"/>',
  currentsource: '<circle cx="24" cy="15" r="11" fill="none" stroke="currentColor" stroke-width="2"/><line x1="24" y1="9" x2="24" y2="21" stroke="currentColor" stroke-width="2"/><path d="M24 9 l-3 4 l6 0 z" fill="currentColor"/><line x1="4" y1="15" x2="13" y2="15" stroke="currentColor" stroke-width="2"/><line x1="35" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  acsource: '<circle cx="24" cy="15" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 15 q3 -6 6 0 t6 0" fill="none" stroke="currentColor" stroke-width="2"/><line x1="4" y1="15" x2="13" y2="15" stroke="currentColor" stroke-width="2"/><line x1="35" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  fuse: '<line x1="4" y1="15" x2="12" y2="15" stroke="currentColor" stroke-width="2"/><rect x="12" y="10" width="24" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="14" y1="15" x2="34" y2="15" stroke="currentColor" stroke-width="1.6"/><line x1="36" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  voltmeter: '<line x1="4" y1="15" x2="13" y2="15" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="15" r="11" fill="none" stroke="currentColor" stroke-width="2"/><text x="24" y="20" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor">V</text><line x1="35" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  ammeter: '<line x1="4" y1="15" x2="13" y2="15" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="15" r="11" fill="none" stroke="currentColor" stroke-width="2"/><text x="24" y="20" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor">A</text><line x1="35" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  motor: '<line x1="4" y1="15" x2="13" y2="15" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="15" r="11" fill="none" stroke="currentColor" stroke-width="2"/><text x="24" y="20" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor">M</text><line x1="35" y1="15" x2="44" y2="15" stroke="currentColor" stroke-width="2"/>',
  buzzer: '<line x1="6" y1="15" x2="14" y2="15" stroke="currentColor" stroke-width="2"/><path d="M14 8 h8 l8 7 -8 7 h-8 z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><line x1="34" y1="15" x2="42" y2="15" stroke="currentColor" stroke-width="2"/>',
};

function startPaletteDrag(type: ComponentType, e: PointerEvent): void {
  e.preventDefault();
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = `<svg viewBox="0 0 48 30" aria-hidden="true">${ICONS[type]}</svg>`;
  document.body.append(ghost);
  const move = (ev: PointerEvent): void => {
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    ghost.classList.toggle('over-canvas', clientToGrid(ev.clientX, ev.clientY) !== null);
  };
  const up = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    ghost.remove();
    const grid = clientToGrid(ev.clientX, ev.clientY);
    // Dropped on the canvas -> place there; a plain click (released on the
    // palette) falls back to auto-placement.
    if (grid) circuit.addComponent(type, { x: grid.x, y: grid.y });
    else circuit.addComponent(type);
  };
  move(e);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

for (const type of COMPONENT_ORDER) {
  const entry = CATALOG[type];
  const btn = document.createElement('button');
  btn.className = 'part';
  btn.type = 'button';
  btn.title = entry.blurb;
  btn.innerHTML = `<svg viewBox="0 0 48 30" aria-hidden="true">${ICONS[type]}</svg><span>${entry.title}</span>`;
  btn.addEventListener('pointerdown', (e) => startPaletteDrag(type, e));
  paletteEl.append(btn);
}

/* ---------- selected-component inspector ---------- */

let inspectorFor: string | null = null;

function logToValue(type: ComponentType, t: number): number {
  const e = CATALOG[type];
  const lo = Math.log10(e.valueMin), hi = Math.log10(e.valueMax);
  const v = Math.pow(10, lo + t * (hi - lo));
  // round to 2 significant figures for tidy values
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.max(e.valueMin, Math.min(e.valueMax, Math.round(v / mag) * mag));
}
function valueToLog(type: ComponentType, v: number): number {
  const e = CATALOG[type];
  const lo = Math.log10(e.valueMin), hi = Math.log10(e.valueMax);
  return (Math.log10(Math.max(e.valueMin, v)) - lo) / (hi - lo);
}

function buildInspector(c: Component): void {
  const entry = CATALOG[c.type];
  inspectorPanel.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'insp-title';
  title.innerHTML = `<span class="insp-type">${entry.title}</span><span class="insp-id">${c.id}</span>`;
  inspectorPanel.append(title);

  if (entry.unit) {
    const row = document.createElement('div');
    row.className = 'insp-row';
    const isLog = entry.unit === 'Ω' || entry.unit === 'mH';
    row.innerHTML = `
      <label for="insp-num">Value</label>
      <div class="insp-value">
        <input id="insp-num" type="number" step="any" />
        <span class="unit">${entry.unit}</span>
      </div>
      <input id="insp-range" type="range" min="0" max="1000" step="1" />`;
    inspectorPanel.append(row);

    const num = row.querySelector<HTMLInputElement>('#insp-num')!;
    const range = row.querySelector<HTMLInputElement>('#insp-range')!;
    if (isLog) {
      range.addEventListener('input', () => circuit.setValue(c.id, logToValue(c.type, Number(range.value) / 1000)));
    } else {
      range.min = String(entry.valueMin); range.max = String(entry.valueMax); range.step = '0.1';
      range.addEventListener('input', () => circuit.setValue(c.id, Number(range.value)));
    }
    num.addEventListener('input', () => {
      const v = Number(num.value);
      if (Number.isFinite(v)) circuit.setValue(c.id, v);
    });
    range.addEventListener('change', () => circuit.commitHistory());
    num.addEventListener('change', () => circuit.commitHistory());
  }

  if (c.type === 'led') {
    const row = document.createElement('div');
    row.className = 'insp-row';
    row.innerHTML = `<label for="insp-color">Colour</label>
      <select id="insp-color">${circuit.LED_COLORS.map((col) => `<option value="${col}">${col} (${LED_SPEC[col].vf} V)</option>`).join('')}</select>`;
    inspectorPanel.append(row);
    const sel = row.querySelector<HTMLSelectElement>('#insp-color')!;
    sel.value = c.color;
    sel.addEventListener('change', () => circuit.setColor(c.id, sel.value as LedColor));
  }

  if (c.type === 'potentiometer') {
    const row = document.createElement('div');
    row.className = 'insp-row';
    row.innerHTML = `<label for="insp-wiper">Wiper position</label>
      <input id="insp-wiper" type="range" min="0" max="100" step="1" />`;
    inspectorPanel.append(row);
    const wr = row.querySelector<HTMLInputElement>('#insp-wiper')!;
    wr.value = String(Math.round(c.wiper * 100));
    wr.addEventListener('input', () => circuit.setWiper(c.id, Number(wr.value) / 100));
    wr.addEventListener('change', () => circuit.commitHistory());
  }

  if (c.type === 'acsource') {
    const row = document.createElement('div');
    row.className = 'insp-row';
    row.innerHTML = `<label for="insp-freq">Frequency</label>
      <div class="insp-value"><input id="insp-freq" type="number" step="any" /><span class="unit">Hz</span></div>`;
    inspectorPanel.append(row);
    const fr = row.querySelector<HTMLInputElement>('#insp-freq')!;
    fr.value = String(c.freq);
    fr.addEventListener('input', () => { const v = Number(fr.value); if (Number.isFinite(v)) circuit.setFrequency(c.id, v); });
  }

  const actions = document.createElement('div');
  actions.className = 'insp-actions';
  if (c.type === 'switch') {
    const toggle = document.createElement('button');
    toggle.textContent = c.closed ? 'Open switch' : 'Close switch';
    toggle.addEventListener('click', () => circuit.toggleSwitch(c.id));
    actions.append(toggle);
  }
  if (c.type !== 'ground') {
    const rot = document.createElement('button');
    rot.textContent = 'Rotate';
    rot.addEventListener('click', () => circuit.rotateComponent(c.id));
    actions.append(rot);
  }
  if (c.type !== 'ground') {
    const scopeV = document.createElement('button');
    scopeV.className = 'probe';
    scopeV.textContent = 'Scope V';
    scopeV.title = 'Plot this part\'s voltage on the oscilloscope';
    scopeV.addEventListener('click', () => circuit.addProbe(c.id, 'voltage'));
    const scopeI = document.createElement('button');
    scopeI.className = 'probe';
    scopeI.textContent = 'Scope I';
    scopeI.title = 'Plot the current through this part on the oscilloscope';
    scopeI.addEventListener('click', () => circuit.addProbe(c.id, 'current'));
    actions.append(scopeV, scopeI);
  }
  const del = document.createElement('button');
  del.className = 'danger';
  del.textContent = 'Delete';
  del.addEventListener('click', () => circuit.removeComponent(c.id));
  actions.append(del);
  inspectorPanel.append(actions);

  const reading = document.createElement('div');
  reading.className = 'insp-reading';
  reading.id = 'insp-reading';
  inspectorPanel.append(reading);
}

function syncInspector(c: Component): void {
  const entry = CATALOG[c.type];
  if (entry.unit) {
    const num = inspectorPanel.querySelector<HTMLInputElement>('#insp-num');
    const range = inspectorPanel.querySelector<HTMLInputElement>('#insp-range');
    if (num && document.activeElement !== num) num.value = String(c.value);
    if (range && document.activeElement !== range) {
      range.value = entry.unit === 'Ω' ? String(Math.round(valueToLog(c.type, c.value) * 1000)) : String(c.value);
    }
  }
  if (c.type === 'switch') {
    const toggle = inspectorPanel.querySelector<HTMLButtonElement>('.insp-actions button');
    if (toggle) toggle.textContent = c.closed ? 'Open switch' : 'Close switch';
  }
  if (c.type === 'potentiometer') {
    const wr = inspectorPanel.querySelector<HTMLInputElement>('#insp-wiper');
    if (wr && document.activeElement !== wr) wr.value = String(Math.round(c.wiper * 100));
  }
  if (c.type === 'acsource') {
    const fr = inspectorPanel.querySelector<HTMLInputElement>('#insp-freq');
    if (fr && document.activeElement !== fr) fr.value = String(c.freq);
  }
  const reading = inspectorPanel.querySelector<HTMLDivElement>('#insp-reading');
  if (!reading) return;
  const res = circuit.getState().solution?.results[c.id];
  if (!res || c.type === 'ground') { reading.textContent = c.type === 'ground' ? 'Reference node (0 V).' : 'No reading yet.'; return; }
  const parts: string[] = [];
  if (res.meter !== undefined) {
    parts.push(c.type === 'voltmeter' ? `reads ${res.meter.toFixed(2)} V` : `reads ${(res.meter * 1000).toFixed(2)} mA`);
  }
  parts.push(`I = ${(res.current * 1000).toFixed(2)} mA`);
  parts.push(`V = ${res.voltage.toFixed(2)} V`);
  if (res.power > 1e-6) parts.push(`P = ${(res.power * 1000).toFixed(1)} mW`);
  if (res.lit) parts.push(c.type === 'motor' ? '<span class="lit">spinning ●</span>' : c.type === 'buzzer' ? '<span class="lit">sounding ●</span>' : '<span class="lit">lit ●</span>');
  let html = parts.join('<br>');
  if (res.warning) html += `<br><span class="warn">${res.warning}</span>`;
  reading.innerHTML = html;
}

function renderInspector(): void {
  const state = circuit.getState();
  if (state.selectedWireId) {
    inspectorFor = null;
    const w = state.wires.find((x) => x.id === state.selectedWireId);
    inspectorPanel.innerHTML = `<div class="insp-title"><span class="insp-type">Wire</span><span class="insp-id">${state.selectedWireId}</span></div>`
      + `<p class="empty" style="padding-left:0">${w ? `${w.from} ↔ ${w.to}` : ''}</p>`
      + '<div class="insp-actions"><button id="insp-wire-del" class="danger">Delete wire</button></div>';
    inspectorPanel.querySelector<HTMLButtonElement>('#insp-wire-del')?.addEventListener('click', () => {
      if (state.selectedWireId) circuit.removeWire(state.selectedWireId);
    });
    return;
  }
  const id = state.selectedId;
  if (!id) {
    inspectorFor = null;
    inspectorPanel.innerHTML = '<p class="empty">Select a part on the board to edit it, or click a wire to remove it. Press <code>R</code> to rotate, <code>Delete</code> to remove.</p>';
    return;
  }
  const c = circuit.componentById(id);
  if (!c) { inspectorFor = null; renderInspector(); return; }
  if (inspectorFor !== id) { buildInspector(c); inspectorFor = id; }
  syncInspector(c);
}

/* ---------- warning bar + empty hint ---------- */

function updateChrome(): void {
  const state = circuit.getState();
  emptyHint.hidden = state.components.length > 0;
  undoBtn.disabled = !state.canUndo;
  redoBtn.disabled = !state.canRedo;
  renderScopeChrome();
  renderSimToggle();
  const warnings = state.running ? state.solution?.warnings ?? [] : [];
  if (warnings.length > 0) {
    warningBar.hidden = false;
    warningBar.textContent = warnings[0];
  } else {
    warningBar.hidden = true;
  }
}

circuit.subscribe(() => { renderInspector(); updateChrome(); });

/* ---------- simulation toggle ---------- */

const simToggle = mustQuery<HTMLButtonElement>('#sim-toggle');
const simLabel = mustQuery<HTMLSpanElement>('#sim-label');
simToggle.addEventListener('click', () => {
  circuit.setRunning(!circuit.getState().running);
});

// Read the button's appearance off the store rather than setting it in the
// click handler: the agent can pause too, and the button has to say so.
function renderSimToggle(): void {
  const running = circuit.getState().running;
  simToggle.classList.toggle('paused', !running);
  simLabel.textContent = running ? 'Simulating' : 'Paused';
}

mustQuery<HTMLButtonElement>('#sim-reset').addEventListener('click', () => {
  circuit.resetSimulation();
});

/* ---------- undo / redo ---------- */

undoBtn.addEventListener('click', () => circuit.undo());
redoBtn.addEventListener('click', () => circuit.redo());
window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) circuit.redo(); else circuit.undo();
  } else if (mod && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    circuit.redo();
  }
});

/* ---------- oscilloscope ---------- */

const scopeBtn = mustQuery<HTMLButtonElement>('#scope-btn');
scopeBtn.addEventListener('click', () => circuit.showScope(!circuit.getState().scope.visible));
mustQuery<HTMLButtonElement>('#scope-close').addEventListener('click', () => circuit.showScope(false));
mustQuery<HTMLButtonElement>('#scope-clear').addEventListener('click', () => circuit.clearScope());

function renderScopeChrome(): void {
  const scope = circuit.getState().scope;
  const wasHidden = scopePanel.hidden;
  scopePanel.hidden = !scope.visible;
  scopeBtn.classList.toggle('active', scope.visible);
  if (!scope.visible) return;
  if (wasHidden) requestAnimationFrame(resizeScope);
  scopeLegend.innerHTML = '';
  for (const tr of scope.traces) {
    const chip = document.createElement('span');
    chip.className = 'scope-chip';
    chip.innerHTML = `<span class="swatch" style="background:${tr.color}"></span>${tr.label}`;
    const x = document.createElement('button');
    x.textContent = '✕'; x.title = 'Remove trace';
    x.addEventListener('click', () => circuit.removeProbe(tr.id));
    chip.append(x);
    scopeLegend.append(chip);
  }
}

/* ---------- presets ---------- */

const presetSelect = mustQuery<HTMLSelectElement>('#preset-select');
for (const [name, preset] of Object.entries(PRESETS)) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = preset.title;
  presetSelect.append(option);
}
presetSelect.addEventListener('change', async () => {
  if (!presetSelect.value) return;
  await runTool('load_preset', { name: presetSelect.value }, 'you');
});

/* ---------- tool inspector (identical pattern to the grapher) ---------- */

const toolSelect = mustQuery<HTMLSelectElement>('#tool-select');
const toolDesc = mustQuery<HTMLParagraphElement>('#tool-desc');
const toolArgs = mustQuery<HTMLTextAreaElement>('#tool-args');
const toolResult = mustQuery<HTMLPreElement>('#tool-result');

for (const tool of TOOLS) {
  const option = document.createElement('option');
  option.value = tool.name;
  option.textContent = tool.name;
  toolSelect.append(option);
}

function describeTool(): void {
  const tool = TOOLS.find((t) => t.name === toolSelect.value);
  if (!tool) return;
  const first = tool.description.split('. ')[0];
  toolDesc.textContent = first.endsWith('.') ? first : first + '.';
  const props = tool.inputSchema.properties ?? {};
  const required = tool.inputSchema.required ?? [];
  const sample: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (!required.includes(key)) continue;
    const p = props[key];
    sample[key] = p.type === 'number' ? 0 : p.type === 'boolean' ? true : '';
  }
  toolArgs.value = JSON.stringify(sample, null, 2);
}
toolSelect.addEventListener('change', describeTool);
describeTool();

mustQuery<HTMLButtonElement>('#tool-run').addEventListener('click', async () => {
  let args: Record<string, unknown>;
  try { args = JSON.parse(toolArgs.value || '{}'); }
  catch (err) { toolResult.textContent = 'Arguments are not valid JSON: ' + (err instanceof Error ? err.message : String(err)); return; }
  const result = await runTool(toolSelect.value, args, 'you');
  toolResult.textContent = JSON.stringify(result, null, 2);
});

/* ---------- WebMCP registration ---------- */

let registeredToolCount = 0;
function showWebMcpStatus(status: WebMcpStatus): void {
  registeredToolCount = status.registered;
  if (status.available && status.registered > 0) {
    badge.className = 'badge ok';
    badgeText.textContent = `WebMCP · ${status.registered} tools`;
    badge.title = `Registered ${status.registered} tools on ${status.host}`;
  } else if (status.available) {
    badge.className = 'badge off';
    badgeText.textContent = 'WebMCP connected · no tools';
    badge.title = status.reason ?? 'The browser exposed WebMCP, but tool registration failed.';
  } else {
    badge.className = 'badge checking';
    badgeText.textContent = 'Waiting for WebMCP…';
    badge.title = `${status.reason} The page will connect automatically when the host becomes available.`;
  }
}
watchWebMcp(TOOLS, showWebMcpStatus);
wireWebmcpTester(badge, badgeText, 'list_components', () => registeredToolCount);

/* ---------- first paint ---------- */

suppressLogging = true;
runTool('load_preset', { name: 'led_basic' }, 'you')
  .finally(() => { suppressLogging = false; });
renderInspector();
updateChrome();

(window as unknown as { circuitboard: unknown }).circuitboard = { circuit, TOOLS, runTool };
