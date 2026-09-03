// Wiring for the chemistry page: periodic table, atom/bond inspector, activity
// log, bond mode, undo/redo, formula bar, tool inspector and WebMCP registration.

import * as chem from './store';
import { TOOLS } from './tools';
import { PRESETS } from './presets';
import { ELEMENTS, CATEGORY_COLOR } from './elements';
import { atomInfo } from './atom';
import { analyzeStructure } from './analysis';
import { initChemRender, clientToGrid, setBondMode, isBondMode, fitView } from './render';
import { mustQuery } from '../dom';
import type { Atom, Bond, BondKind } from './types';
import { wireWebmcpTester } from '../webmcp-selftest';
import { watchWebMcp, renderBadge, type WebMcpStatus } from '../webmcp';

const canvas = mustQuery<HTMLCanvasElement>('#chem-canvas');
const logEl = mustQuery<HTMLDivElement>('#log');
const badge = mustQuery<HTMLDivElement>('#mcp-badge');
const badgeText = mustQuery<HTMLSpanElement>('#mcp-text');
const periodicEl = mustQuery<HTMLDivElement>('#periodic');
const inspectorPanel = mustQuery<HTMLDivElement>('#inspector-panel');
const emptyHint = mustQuery<HTMLDivElement>('#empty-hint');
const formulaBar = mustQuery<HTMLDivElement>('#formula-bar');
const structureWarning = mustQuery<HTMLDivElement>('#structure-warning');
const statusBar = mustQuery<HTMLDivElement>('#status-bar');
const stage = mustQuery<HTMLElement>('.stage');
const undoBtn = mustQuery<HTMLButtonElement>('#undo-btn');
const redoBtn = mustQuery<HTMLButtonElement>('#redo-btn');
const bondBtn = mustQuery<HTMLButtonElement>('#bond-btn');

/* ---------- activity log ---------- */

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
    if (source === 'agent') { agentCallCount++; refreshBadge(); }
    const entry = suppressLogging ? null : logCall(tool.name, args, source);
    try {
      // Attribute every mutation this call makes. A WebMCP agent calls
      // execute() directly rather than going through runTool, so this is the
      // only place that sees every caller.
      const result = await chem.changes.as(
        source === 'you' ? 'user' : 'agent',
        () => inner(args ?? {}),
      );
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) entry?.classList.add('fail');
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
  try { return await tool.execute(args); } finally { callSource = null; }
}
mustQuery<HTMLButtonElement>('#clear-log').addEventListener('click', () => {
  logEl.innerHTML = '<p class="empty">Tool calls from the agent appear here as they arrive.</p>';
});

/* ---------- renderer ---------- */

initChemRender(canvas);

/* ---------- periodic table ---------- */

function startPaletteDrag(z: number, e: PointerEvent): void {
  e.preventDefault();
  const el = ELEMENTS.find((x) => x.z === z)!;
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = el.symbol;
  ghost.style.background = CATEGORY_COLOR[el.category];
  document.body.append(ghost);
  const move = (ev: PointerEvent): void => { ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; };
  const up = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    ghost.remove();
    const grid = clientToGrid(ev.clientX, ev.clientY);
    if (grid) chem.addAtom(z, { x: grid.x, y: grid.y });
    else chem.addAtom(z);
  };
  move(e);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

for (const el of ELEMENTS) {
  const cell = document.createElement('button');
  cell.className = 'pt-cell';
  cell.type = 'button';
  cell.style.setProperty('--cat', CATEGORY_COLOR[el.category]);
  cell.style.gridColumn = String(el.group);
  cell.style.gridRow = String(el.period);
  cell.title = `${el.name} (${el.symbol}), Z=${el.z}`;
  cell.innerHTML = `<span class="pt-z">${el.z}</span>${el.symbol}`;
  cell.addEventListener('pointerdown', (e) => startPaletteDrag(el.z, e));
  periodicEl.append(cell);
}

/* ---------- bond mode + undo/redo ---------- */

bondBtn.addEventListener('click', () => {
  setBondMode(!isBondMode());
  bondBtn.classList.toggle('active', isBondMode());
});
undoBtn.addEventListener('click', () => chem.undo());
redoBtn.addEventListener('click', () => chem.redo());
window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) chem.redo(); else chem.undo(); }
  else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); chem.redo(); }
});

/* ---------- inspector ---------- */

function stepper(label: string, dotColor: string, value: number, onChange: (v: number) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'stepper-row';
  row.innerHTML = `<span class="lbl"><span class="dot" style="background:${dotColor}"></span>${label}</span>`;
  const s = document.createElement('div');
  s.className = 'stepper';
  const minus = document.createElement('button'); minus.textContent = '−';
  const count = document.createElement('span'); count.className = 'count'; count.textContent = String(value);
  const plus = document.createElement('button'); plus.textContent = '+';
  minus.addEventListener('click', () => onChange(value - 1));
  plus.addEventListener('click', () => onChange(value + 1));
  s.append(minus, count, plus);
  row.append(s);
  return row;
}

function buildAtomInspector(atom: Atom): void {
  inspectorPanel.innerHTML = '';
  const info = atomInfo(atom);
  const bonding = analyzeStructure(chem.getState()).atoms.get(atom.id);

  const title = document.createElement('div');
  title.className = 'insp-title';
  title.innerHTML = `<span class="insp-el">${info.symbol}${info.chargeLabel ? `<sup>${info.chargeLabel}</sup>` : ''}</span><span class="insp-name">${info.name}</span>`;
  inspectorPanel.append(title);

  const sub = document.createElement('div');
  sub.className = 'insp-sub';
  sub.textContent = `Z ${atom.protons} · mass ${info.massNumber} · shells ${info.shells.join('·') || '—'}`;
  inspectorPanel.append(sub);

  inspectorPanel.append(stepper('Protons', '#ef4444', atom.protons, (v) => chem.setProtons(atom.id, v)));
  inspectorPanel.append(stepper('Neutrons', '#94a3b8', atom.neutrons, (v) => chem.setNeutrons(atom.id, v)));
  inspectorPanel.append(stepper('Electrons', '#2d70b3', atom.electrons, (v) => chem.setElectrons(atom.id, v)));

  const reading = document.createElement('div');
  reading.className = 'insp-reading';
  const chargeText = info.charge === 0 ? 'neutral' : `${info.chargeLabel} ion`;
  const formal = bonding?.formalCharge ?? info.charge;
  const shellElectrons = bonding?.shellElectrons ?? info.valence;
  const shellTarget = bonding?.shellTarget ?? (atom.protons <= 2 ? 2 : 8);
  const shellName = shellTarget === 2 ? 'Duet' : 'Octet';
  const shellStatus = shellElectrons === shellTarget
    ? 'complete ✓'
    : shellElectrons < shellTarget
      ? `${shellTarget - shellElectrons} short`
      : `${shellElectrons - shellTarget} over`;
  reading.innerHTML =
    `<span class="k">Charge:</span> ${info.charge > 0 ? '+' : ''}${info.charge} (${chargeText})<br>` +
    `<span class="k">Valence electrons:</span> ${info.valence}<br>` +
    `<span class="k">Nonbonding electrons:</span> ${bonding?.nonbondingElectrons ?? info.valence}<br>` +
    `<span class="k">Bond order total:</span> ${bonding?.bondOrder ?? 0}<br>` +
    `<span class="k">${shellName}:</span> ${shellElectrons}/${shellTarget} (${shellStatus})<br>` +
    `<span class="k">Formal charge:</span> ${formal > 0 ? '+' : ''}${formal}`;
  inspectorPanel.append(reading);

  const actions = document.createElement('div');
  actions.className = 'insp-actions';
  if (info.charge !== 0) {
    const neutral = document.createElement('button');
    neutral.textContent = 'Make neutral';
    neutral.addEventListener('click', () => chem.setElectrons(atom.id, atom.protons));
    actions.append(neutral);
  }
  const del = document.createElement('button');
  del.className = 'danger'; del.textContent = 'Delete';
  del.addEventListener('click', () => chem.removeAtom(atom.id));
  actions.append(del);
  inspectorPanel.append(actions);
}

function buildBondInspector(bond: Bond): void {
  inspectorPanel.innerHTML = '';
  const a = chem.atomById(bond.a), b = chem.atomById(bond.b);
  const title = document.createElement('div');
  title.className = 'insp-title';
  title.innerHTML = `<span class="insp-el">Bond</span><span class="insp-name">${a ? atomInfo(a).symbol : '?'} – ${b ? atomInfo(b).symbol : '?'}</span>`;
  inspectorPanel.append(title);

  const kindRow = document.createElement('div');
  kindRow.className = 'bond-kind';
  for (const k of ['covalent', 'ionic'] as BondKind[]) {
    const btn = document.createElement('button');
    btn.textContent = k;
    if (bond.kind === k) btn.classList.add('on');
    btn.addEventListener('click', () => chem.setBond(bond.id, { kind: k }));
    kindRow.append(btn);
  }
  inspectorPanel.append(kindRow);

  if (bond.kind === 'covalent') {
    const orderRow = document.createElement('div');
    orderRow.className = 'bond-kind';
    for (const o of [1, 2, 3]) {
      const btn = document.createElement('button');
      btn.textContent = o === 1 ? 'single' : o === 2 ? 'double' : 'triple';
      if (bond.order === o) btn.classList.add('on');
      btn.addEventListener('click', () => chem.setBond(bond.id, { order: o }));
      orderRow.append(btn);
    }
    inspectorPanel.append(orderRow);
  }

  const actions = document.createElement('div');
  actions.className = 'insp-actions';
  const del = document.createElement('button');
  del.className = 'danger'; del.textContent = 'Delete bond';
  del.addEventListener('click', () => chem.removeBond(bond.id));
  actions.append(del);
  inspectorPanel.append(actions);
}

function renderInspector(): void {
  const s = chem.getState();
  if (s.selectedBondId) { const bond = chem.bondById(s.selectedBondId); if (bond) { buildBondInspector(bond); return; } }
  if (s.selectedId) { const atom = chem.atomById(s.selectedId); if (atom) { buildAtomInspector(atom); return; } }
  inspectorPanel.innerHTML = '<p class="empty">Select an atom to edit its protons, neutrons and electrons — or a bond to change its type.</p>';
}

/* ---------- formula bar + status ---------- */

function formulaHtml(formula: string, charge: number): string {
  const html = formula.replace(/(\d+)/g, '<sub>$1</sub>');
  const chg = charge === 0 ? '' : `<span class="chg">${Math.abs(charge) === 1 ? '' : Math.abs(charge)}${charge > 0 ? '+' : '−'}</span>`;
  return html + chg;
}
function updateChrome(): void {
  const s = chem.getState();
  const analysis = analyzeStructure(s);
  emptyHint.hidden = s.atoms.length > 0;
  undoBtn.disabled = !s.canUndo;
  redoBtn.disabled = !s.canRedo;

  const mols = chem.molecules();
  const compound = mols.length === 1 ? mols[0] : null;
  if (compound) {
    formulaBar.hidden = false;
    formulaBar.innerHTML = `<span class="formula-chip">${formulaHtml(compound.formula, compound.charge)}</span>`;
  } else {
    formulaBar.hidden = true;
    formulaBar.textContent = '';
  }

  structureWarning.hidden = analysis.valid;
  stage.classList.toggle('has-structure-warning', !analysis.valid);
  if (!analysis.valid) {
    const shown = analysis.warnings.slice(0, 2);
    const extra = analysis.warnings.length - shown.length;
    structureWarning.textContent = `⚠ Invalid structure: ${shown.join(' ')}${extra > 0 ? ` (+${extra} more)` : ''}`;
  }

  if (s.message) { statusBar.hidden = false; statusBar.textContent = s.message; }
  else statusBar.hidden = true;
}

chem.subscribe(() => { renderInspector(); updateChrome(); });

/* ---------- presets ---------- */

const presetSelect = mustQuery<HTMLSelectElement>('#preset-select');
for (const [name, preset] of Object.entries(PRESETS)) {
  const option = document.createElement('option');
  option.value = name; option.textContent = preset.title;
  presetSelect.append(option);
}
presetSelect.addEventListener('change', async () => {
  if (!presetSelect.value) return;
  const result = await runTool('load_preset', { name: presetSelect.value }, 'you') as { note?: string };
  if (result?.note) chem.setMessage(result.note);
  requestAnimationFrame(fitView);
});

/* ---------- tool inspector ---------- */

const toolSelect = mustQuery<HTMLSelectElement>('#tool-select');
const toolDesc = mustQuery<HTMLParagraphElement>('#tool-desc');
const toolArgs = mustQuery<HTMLTextAreaElement>('#tool-args');
const toolResult = mustQuery<HTMLPreElement>('#tool-result');
for (const tool of TOOLS) {
  const option = document.createElement('option');
  option.value = tool.name; option.textContent = tool.name;
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
    sample[key] = props[key].type === 'number' ? 0 : '';
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

/* ---------- registration ---------- */

let registeredToolCount = 0;
// Registration proves the page offered its tools; only a real call proves an
// agent is on the other end, so the badge reports these.
let agentCallCount = 0;
let lastStatus: WebMcpStatus = { available: false, registered: 0, host: null, waiting: true };
function showWebMcpStatus(status: WebMcpStatus): void {
  registeredToolCount = status.registered;
  lastStatus = status;
  renderBadge(badge, badgeText, status, agentCallCount);
}
/** Repaint after an agent call, so the badge can report live traffic. */
function refreshBadge(): void {
  renderBadge(badge, badgeText, lastStatus, agentCallCount);
}
watchWebMcp(TOOLS, showWebMcpStatus);
wireWebmcpTester(badge, badgeText, 'list_atoms', () => registeredToolCount);

/* ---------- first paint ---------- */

suppressLogging = true;
runTool('load_preset', { name: 'water' }, 'you').then((r) => {
  const res = r as { note?: string };
  if (res?.note) chem.setMessage(res.note);
  requestAnimationFrame(fitView);
}).finally(() => { suppressLogging = false; });
renderInspector();
updateChrome();

(window as unknown as { chemistryboard: unknown }).chemistryboard = { chem, TOOLS, runTool };
