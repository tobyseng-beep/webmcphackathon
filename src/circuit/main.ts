// Wiring for the circuit page. Boots the renderer, builds the palette and the
// selected-part inspector, registers the WebMCP tools, and mirrors every tool
// call into the on-screen activity log -- the same shape as the grapher's
// main.ts, so the two pages behave consistently.

import * as circuit from './store';
import { TOOLS, registerTools } from './tools';
import { PRESETS } from './presets';
import { CATALOG, COMPONENT_ORDER, LED_SPEC } from './components';
import { initCircuitRender } from './render';
import { mustQuery } from '../dom';
import type { Component, ComponentType, LedColor } from './types';

const canvas = mustQuery<HTMLCanvasElement>('#circuit-canvas');
const logEl = mustQuery<HTMLDivElement>('#log');
const badge = mustQuery<HTMLDivElement>('#mcp-badge');
const badgeText = mustQuery<HTMLSpanElement>('#mcp-text');
const paletteEl = mustQuery<HTMLDivElement>('#palette');
const inspectorPanel = mustQuery<HTMLDivElement>('#inspector-panel');
const emptyHint = mustQuery<HTMLDivElement>('#empty-hint');
const warningBar = mustQuery<HTMLDivElement>('#warning-bar');

/* ---------- activity log (identical pattern to the grapher) ---------- */

type CallSource = 'you' | 'agent';
let callSource: CallSource | null = null;

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
    const entry = logCall(tool.name, args, source);
    try {
      const result = await inner(args ?? {});
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
        entry.classList.add('fail');
      }
      return result;
    } catch (err) {
      entry.classList.add('fail');
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
};

for (const type of COMPONENT_ORDER) {
  const entry = CATALOG[type];
  const btn = document.createElement('button');
  btn.className = 'part';
  btn.type = 'button';
  btn.title = entry.blurb;
  btn.innerHTML = `<svg viewBox="0 0 48 30" aria-hidden="true">${ICONS[type]}</svg><span>${entry.title}</span>`;
  btn.addEventListener('click', () => { circuit.addComponent(type); });
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
    const isLog = entry.unit === 'Ω';
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
  const reading = inspectorPanel.querySelector<HTMLDivElement>('#insp-reading');
  if (!reading) return;
  const res = circuit.getState().solution?.results[c.id];
  if (!res || c.type === 'ground') { reading.textContent = c.type === 'ground' ? 'Reference node (0 V).' : 'No reading yet.'; return; }
  const parts: string[] = [];
  parts.push(`I = ${(res.current * 1000).toFixed(2)} mA`);
  parts.push(`V = ${res.voltage.toFixed(2)} V`);
  if (res.power > 1e-6) parts.push(`P = ${(res.power * 1000).toFixed(1)} mW`);
  if (res.lit) parts.push('<span class="lit">lit ●</span>');
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
  const running = !circuit.getState().running;
  circuit.setRunning(running);
  simToggle.classList.toggle('paused', !running);
  simLabel.textContent = running ? 'Simulating' : 'Paused';
});

mustQuery<HTMLButtonElement>('#sim-reset').addEventListener('click', () => {
  circuit.resetSimulation();
});

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
  presetSelect.value = '';
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

const status = registerTools();
if (status.available) {
  badge.className = 'badge ok';
  badgeText.textContent = `WebMCP · ${status.registered} tools`;
  badge.title = `Registered ${status.registered} tools on ${status.host}`;
} else {
  badge.className = 'badge off';
  badgeText.textContent = 'WebMCP unavailable';
  badge.title =
    'No document.modelContext on this page. Open in the ChatGPT desktop in-app browser, ' +
    'or Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled. ' +
    'The tool inspector on the right still works.';
}

/* ---------- first paint ---------- */

runTool('load_preset', { name: 'led_basic' }, 'you').then(() => {
  logEl.innerHTML = '<p class="empty">Tool calls from the agent appear here as they arrive.</p>';
});
renderInspector();
updateChrome();

(window as unknown as { circuitboard: unknown }).circuitboard = { circuit, TOOLS, runTool };
