// Wiring for the physics page. Boots the renderer, builds the three library
// sections and the selected-object inspector, drives the stage buttons, and
// registers the WebMCP tools -- mirroring the grapher's and the circuit
// board's main.ts, so all three pages behave the same way.

import * as physics from './store';
import { TOOLS } from './tools';
import { PRESETS } from './presets';
import { BLOCK_TYPES, CATALOG, DESIGN_TOOLS, OBJECT_TYPES } from './catalog';
import { MATERIALS, MATERIAL_ABOUT, frictionCoefficient } from './materials';
import * as render from './render';
import { canvasHit, initPhysicsRender } from './render';
import { mustQuery } from '../dom';
import { wireWebmcpTester } from '../webmcp-selftest';
import { watchWebMcp, type WebMcpStatus } from '../webmcp';
import type { Body, Material, ToolId } from './types';

const canvas = mustQuery<HTMLCanvasElement>('#physics-canvas');
const logEl = mustQuery<HTMLDivElement>('#log');
const eventLogEl = mustQuery<HTMLDivElement>('#event-log');
const badge = mustQuery<HTMLDivElement>('#mcp-badge');
const badgeText = mustQuery<HTMLSpanElement>('#mcp-text');
const designToolsEl = mustQuery<HTMLDivElement>('#design-tools');
const toolHint = mustQuery<HTMLParagraphElement>('#tool-hint');
const blockPalette = mustQuery<HTMLDivElement>('#block-palette');
const objectPalette = mustQuery<HTMLDivElement>('#object-palette');
const inspectorPanel = mustQuery<HTMLDivElement>('#inspector-panel');
const emptyHint = mustQuery<HTMLDivElement>('#empty-hint');
const banner = mustQuery<HTMLDivElement>('#stage-banner');
const stageChip = mustQuery<HTMLDivElement>('#stage-chip');
const stageLabel = mustQuery<HTMLSpanElement>('#stage-label');
const objectCount = mustQuery<HTMLDivElement>('#object-count');
const stageEl = document.querySelector<HTMLElement>('.stage')!;
const frictionBtn = mustQuery<HTMLButtonElement>('#friction-toggle');
const frictionLabel = mustQuery<HTMLSpanElement>('#friction-label');

/* ---------- activity log (identical pattern to the other pages) ---------- */

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
      const result = await physics.changes.as(
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

initPhysicsRender(canvas);

/* ---------- design tools ---------- */

const toolButtons = new Map<ToolId, HTMLButtonElement>();

for (const tool of DESIGN_TOOLS) {
  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.type = 'button';
  btn.title = tool.blurb;
  btn.innerHTML = `<svg viewBox="0 0 48 30" aria-hidden="true">${tool.icon}</svg><span>${tool.title}</span>`;
  btn.addEventListener('click', () => physics.setTool(tool.id));
  toolButtons.set(tool.id, btn);
  designToolsEl.append(btn);
}

function renderTools(): void {
  const active = physics.getState().tool;
  for (const [id, btn] of toolButtons) btn.classList.toggle('active', id === active);
  toolHint.textContent = DESIGN_TOOLS.find((t) => t.id === active)?.blurb ?? '';
  for (const id of ['select', 'draw', 'erase', 'force', 'velocity'] as ToolId[]) {
    stageEl.classList.toggle(`tool-${id}`, id === active);
  }
}

/* ---------- block and object palettes ---------- */

function startPaletteDrag(type: string, e: PointerEvent): void {
  e.preventDefault();
  const entry = CATALOG[type];
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = `<svg viewBox="0 0 48 30" aria-hidden="true">${entry.icon}</svg>`;
  document.body.append(ghost);

  const move = (ev: PointerEvent): void => {
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    ghost.classList.toggle('over-canvas', canvasHit(ev.clientX, ev.clientY) !== null);
  };
  const up = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    ghost.remove();
    const world = canvasHit(ev.clientX, ev.clientY);
    // Dropped in the box -> place there; a plain click drops it in the middle.
    void runTool('add_object', world ? { type, x: +world.x.toFixed(2), y: +world.y.toFixed(2) } : { type }, 'you');
  };
  move(e);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

for (const [types, container] of [[BLOCK_TYPES, blockPalette], [OBJECT_TYPES, objectPalette]] as const) {
  for (const type of types) {
    const entry = CATALOG[type];
    const btn = document.createElement('button');
    btn.className = 'part';
    btn.type = 'button';
    btn.title = entry.blurb;
    btn.innerHTML = `<svg viewBox="0 0 48 30" aria-hidden="true">${entry.icon}</svg><span>${entry.title}</span>`;
    btn.addEventListener('pointerdown', (e) => startPaletteDrag(type, e));
    container.append(btn);
  }
}

/* ---------- selected-object inspector ---------- */

let inspectorFor: string | null = null;

function numberRow(label: string, id: string, value: number, unit: string, step: number): string {
  return `<div class="insp-row">
    <label for="${id}">${label}</label>
    <div class="insp-value">
      <input id="${id}" type="number" step="${step}" value="${value}" />
      <span class="unit">${unit}</span>
    </div>
  </div>`;
}

function buildInspector(body: Body): void {
  const entry = CATALOG[body.type];
  const editable = physics.getState().stage === 'design';
  inspectorPanel.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'insp-title';
  title.innerHTML = `<span>${body.label}</span><span class="insp-id">${body.id}</span>`;
  inspectorPanel.append(title);

  const form = document.createElement('div');
  let html = '';
  if (body.kind === 'dynamic') html += numberRow('Mass', 'insp-mass', +body.mass.toFixed(2), 'kg', 0.1);
  html += numberRow('Bounciness', 'insp-rest', +body.restitution.toFixed(2), '0–0.98', 0.05);
  if (body.type !== 'line') {
    if (entry?.sizing === 'r') {
      html += numberRow('Radius', 'insp-radius', +body.radius.toFixed(2), 'm', 0.05);
    } else {
      html += `<div class="insp-pair">
        <div>${numberRow('Width', 'insp-width', +body.width.toFixed(2), 'm', 0.1)}</div>
        <div>${numberRow('Height', 'insp-height', +body.height.toFixed(2), 'm', 0.1)}</div>
      </div>`;
    }
    html += numberRow('Angle', 'insp-angle', +((body.angle * 180) / Math.PI).toFixed(1), '°', 5);
  }
  form.innerHTML = html;
  inspectorPanel.append(form);

  // Material is half of a friction pair, so it is worth showing even while
  // friction is off -- with a note saying it is currently inert.
  const matRow = document.createElement('div');
  matRow.className = 'insp-row';
  matRow.innerHTML = `<label for="insp-material">Surface material</label>
    <select id="insp-material">${MATERIALS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>`;
  inspectorPanel.append(matRow);
  const matSelect = matRow.querySelector<HTMLSelectElement>('#insp-material')!;
  matSelect.value = body.material;
  matSelect.disabled = !editable;
  matSelect.title = MATERIAL_ABOUT[body.material];
  matSelect.addEventListener('change', () => {
    physics.setProperty(body.id, { material: matSelect.value as Material });
  });

  for (const input of form.querySelectorAll<HTMLInputElement>('input')) {
    input.disabled = !editable;
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      if (input.id === 'insp-angle') physics.setAngle(body.id, v);
      else if (input.id === 'insp-mass') physics.setProperty(body.id, { mass: v });
      else if (input.id === 'insp-rest') physics.setProperty(body.id, { restitution: v });
      else if (input.id === 'insp-radius') physics.setProperty(body.id, { radius: v });
      else if (input.id === 'insp-width') physics.setProperty(body.id, { width: v });
      else if (input.id === 'insp-height') physics.setProperty(body.id, { height: v });
    });
  }

  const vectors = document.createElement('div');
  vectors.className = 'insp-vectors';
  vectors.id = 'insp-vectors';
  inspectorPanel.append(vectors);

  const actions = document.createElement('div');
  actions.className = 'insp-actions';
  if (body.kind === 'dynamic' && editable) {
    const clearMotion = document.createElement('button');
    clearMotion.textContent = 'Clear forces & velocity';
    clearMotion.addEventListener('click', () => void runTool('clear_motion', { id: body.id, what: 'all' }, 'you'));
    actions.append(clearMotion);
  }
  if (editable) {
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Delete';
    del.addEventListener('click', () => void runTool('remove_object', { id: body.id }, 'you'));
    actions.append(del);
  }
  inspectorPanel.append(actions);

  const reading = document.createElement('div');
  reading.className = 'insp-reading';
  reading.id = 'insp-reading';
  inspectorPanel.append(reading);

  if (body.kind === 'dynamic' && editable) {
    const note = document.createElement('p');
    note.className = 'insp-note';
    note.textContent = 'Pick the Force or Velocity tool, then drag from this object to aim an arrow. Longer drag, bigger value.';
    inspectorPanel.append(note);
  }
}

function syncInspector(body: Body): void {
  const set = (id: string, value: number): void => {
    const input = inspectorPanel.querySelector<HTMLInputElement>(`#${id}`);
    if (input && document.activeElement !== input) input.value = String(+value.toFixed(2));
  };
  set('insp-mass', body.mass);
  set('insp-rest', body.restitution);
  set('insp-radius', body.radius);
  set('insp-width', body.width);
  set('insp-height', body.height);
  set('insp-angle', (body.angle * 180) / Math.PI);

  const vectors = inspectorPanel.querySelector<HTMLDivElement>('#insp-vectors');
  if (vectors) {
    const editable = physics.getState().stage === 'design';
    vectors.innerHTML = '';
    for (const f of body.forces) {
      const chip = document.createElement('div');
      chip.className = 'vector-chip force';
      const unit = f.mode === 'start' ? 'N·s at t=0' : `N for ${f.duration}s`;
      chip.innerHTML = `<span>F (${f.fx.toFixed(1)}, ${f.fy.toFixed(1)}) ${unit}</span>`;
      if (editable) {
        const x = document.createElement('button');
        x.textContent = '✕';
        x.title = 'Remove this force';
        x.addEventListener('click', () => physics.removeForce(body.id, f.id));
        chip.append(x);
      }
      vectors.append(chip);
    }
    if (body.velocity) {
      const v = body.velocity;
      const chip = document.createElement('div');
      chip.className = 'vector-chip velocity';
      const unit = v.mode === 'start' ? 'm/s at t=0' : `m/s held ${v.duration}s`;
      chip.innerHTML = `<span>v (${v.vx.toFixed(1)}, ${v.vy.toFixed(1)}) ${unit}</span>`;
      if (editable) {
        const x = document.createElement('button');
        x.textContent = '✕';
        x.title = 'Remove the starting velocity';
        x.addEventListener('click', () => physics.clearVelocity(body.id));
        chip.append(x);
      }
      vectors.append(chip);
    }
  }

  const matSelect = inspectorPanel.querySelector<HTMLSelectElement>('#insp-material');
  if (matSelect && document.activeElement !== matSelect) matSelect.value = body.material;

  const reading = inspectorPanel.querySelector<HTMLDivElement>('#insp-reading');
  if (!reading) return;
  const rows: string[] = [];
  rows.push(`<span class="k">position</span> (${body.x.toFixed(2)}, ${body.y.toFixed(2)}) m`);
  // Friction only means anything as a pair, so quote it against the floor.
  const state = physics.getState();
  if (state.friction) {
    const mu = frictionCoefficient(body.material, 'concrete');
    rows.push(`<span class="k">μ vs floor</span> ${mu.toFixed(2)} (${body.material} on concrete)`);
  } else {
    rows.push(`<span class="k">material</span> ${body.material} — friction is off, so it has no effect yet`);
  }
  if (body.kind === 'dynamic') {
    const speed = Math.hypot(body.vx, body.vy);
    rows.push(`<span class="k">velocity</span> (${body.vx.toFixed(2)}, ${body.vy.toFixed(2)}) m/s`);
    rows.push(`<span class="k">speed</span> ${speed.toFixed(2)} m/s`);
    rows.push(`<span class="k">KE</span> ${physics.kineticEnergy(body).toFixed(2)} J · <span class="k">PE</span> ${physics.potentialEnergy(body).toFixed(2)} J`);
    const forces = physics.activeForces(body);
    for (const f of forces) {
      rows.push(`<span class="k">${f.label}</span> (${f.fx.toFixed(1)}, ${f.fy.toFixed(1)}) N`);
    }
    if (physics.isSupported(body)) rows.push('<span class="k">supported</span> resting on a surface — normal force balances gravity');
  } else {
    rows.push('<span class="k">fixed</span> never moves; bears weight like the floor');
  }
  reading.innerHTML = rows.join('<br>');
}

function renderInspector(): void {
  const state = physics.getState();
  const id = state.selectedId;
  if (!id) {
    inspectorFor = null;
    inspectorPanel.innerHTML = '<p class="empty">Select an object in the box to edit it. Press <code>Delete</code> to remove it.</p>';
    return;
  }
  const body = physics.bodyById(id);
  if (!body) {
    inspectorFor = null;
    inspectorPanel.innerHTML = '<p class="empty">Select an object in the box to edit it.</p>';
    return;
  }
  const key = `${id}:${state.stage === 'design' ? 'edit' : 'locked'}`;
  if (inspectorFor !== key) {
    buildInspector(body);
    inspectorFor = key;
  }
  syncInspector(body);
}

/* ---------- stage chrome ---------- */

const btnStart = mustQuery<HTMLButtonElement>('#btn-start');
const btnPause = mustQuery<HTMLButtonElement>('#btn-pause');
const btnEnd = mustQuery<HTMLButtonElement>('#btn-end');
const btnRetry = mustQuery<HTMLButtonElement>('#btn-retry');
const btnReset = mustQuery<HTMLButtonElement>('#btn-reset');

btnStart.addEventListener('click', () => {
  const stage = physics.getState().stage;
  void runTool(stage === 'paused' ? 'resume_simulation' : 'start_simulation', {}, 'you').then(showResult);
});
frictionBtn.addEventListener('click', () => {
  void runTool('set_friction', { enabled: !physics.getState().friction }, 'you').then(showResult);
});
btnPause.addEventListener('click', () => void runTool('pause_simulation', {}, 'you').then(showResult));
btnEnd.addEventListener('click', () => void runTool('end_simulation', {}, 'you').then(showResult));
btnRetry.addEventListener('click', () => void runTool('retry_simulation', {}, 'you').then(showResult));
btnReset.addEventListener('click', () => void runTool('reset_simulation', {}, 'you').then(showResult));

let flash: string | null = null;
let flashUntil = 0;

function showResult(result: unknown): void {
  if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
    flash = String((result as { error?: string }).error ?? 'That did not work.');
    flashUntil = performance.now() + 4000;
  }
}

function renderStageChrome(): void {
  const state = physics.getState();
  const stage = state.stage;

  stageChip.className = `stage-chip ${stage === 'running' ? 'running' : stage === 'paused' ? 'paused' : stage === 'ended' ? 'ended' : ''}`;
  stageLabel.textContent = stage === 'design'
    ? 'Pre-simulation'
    : stage === 'running'
      ? `Simulating · ${state.time.toFixed(1)} s`
      : stage === 'paused'
        ? `Paused · ${state.time.toFixed(1)} s`
        : `Post-simulation · ${state.time.toFixed(1)} s`;

  const used = physics.userBodies().length;
  objectCount.textContent = `${used} / ${state.objectCap} objects`;
  objectCount.style.color = used >= state.objectCap ? 'var(--bad)' : '';

  btnStart.textContent = stage === 'paused' ? '▶ Resume' : '▶ Start';
  btnStart.disabled = stage === 'running' || stage === 'ended';
  btnPause.disabled = stage !== 'running';
  btnEnd.disabled = stage !== 'running' && stage !== 'paused';
  btnRetry.disabled = !state.canRetry || stage === 'running' || stage === 'paused';
  btnReset.disabled = false;

  // Friction is fixed for the duration of a run so retry replays it faithfully.
  frictionBtn.classList.toggle('on', state.friction);
  frictionBtn.disabled = stage !== 'design';
  frictionLabel.textContent = state.friction ? 'Friction: on' : 'Friction: off';

  emptyHint.hidden = used > 0;

  if (flash && performance.now() < flashUntil) {
    banner.hidden = false;
    banner.textContent = flash;
  } else if (stage === 'ended' && state.endReason) {
    flash = null;
    banner.hidden = false;
    banner.textContent = `Run finished — ${state.endReason} Retry to run the same layout again, or Reset to clear the box.`;
  } else {
    flash = null;
    banner.hidden = true;
  }
}

/* ---------- run log ---------- */

let lastEventCount = -1;

function renderEventLog(): void {
  const events = physics.getState().events;
  if (events.length === lastEventCount) return;
  lastEventCount = events.length;
  if (events.length === 0) {
    eventLogEl.innerHTML = '<p class="empty">Collisions and the reason a run ended appear here.</p>';
    return;
  }
  eventLogEl.innerHTML = '';
  for (const event of events.slice(-40).reverse()) {
    const row = document.createElement('div');
    row.className = `event-entry ${event.kind}`;
    row.innerHTML = `<span class="t">${event.t.toFixed(2)}s</span>${event.text}`;
    eventLogEl.append(row);
  }
}

/* ---------- subscriptions ---------- */

physics.subscribe(() => {
  renderTools();
  renderInspector();
  renderStageChrome();
  renderEventLog();
});

/* ---------- keyboard ---------- */

window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const state = physics.getState();
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
    e.preventDefault();
    void runTool('remove_object', { id: state.selectedId }, 'you').then(showResult);
  } else if (e.key === ' ') {
    e.preventDefault();
    const next = state.stage === 'running' ? 'pause_simulation'
      : state.stage === 'paused' ? 'resume_simulation'
      : 'start_simulation';
    void runTool(next, {}, 'you').then(showResult);
  }
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
});

/* ---------- tool inspector (identical pattern to the other pages) ---------- */

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
    sample[key] = p.type === 'number' ? 0 : p.type === 'boolean' ? true : p.type === 'array' ? [] : '';
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
wireWebmcpTester(badge, badgeText, 'describe_sandbox', () => registeredToolCount);

/* ---------- first paint ---------- */

suppressLogging = true;
runTool('load_preset', { name: 'ramp_slide' }, 'you')
  .finally(() => { suppressLogging = false; });
renderTools();
renderInspector();
renderStageChrome();
renderEventLog();

(window as unknown as { physicsboard: unknown }).physicsboard = { physics, TOOLS, runTool, render };
