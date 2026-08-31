// Wiring. Boots the renderers, registers the WebMCP tools, and mirrors every
// tool call into the on-screen activity log so a spectator can see what the
// agent is doing to the board.

import * as graph from './store.js';
import { TOOLS, registerTools } from './tools.js';
import { PRESETS } from './presets.js';
import { initRender2D, draw as draw2D, resize2D } from './render2d.js';
import { initRender3D, rebuild as rebuild3D, resize3D } from './render3d.js';
import { renderAll, focusLastExpression } from './ui.js';

const canvas2d = document.getElementById('canvas2d');
const stage3d = document.getElementById('stage3d');
const labels3d = document.getElementById('labels3d');
const logEl = document.getElementById('log');
const badge = document.getElementById('mcp-badge');
const badgeText = document.getElementById('mcp-text');

/* ---------- activity log ---------- */

let callSource = null;

function logCall(name, args, source) {
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
  while (logEl.children.length > 60) logEl.lastChild.remove();
  return entry;
}

// Wrap each tool once, before registration, so agent calls and hand-run calls
// share the same logging path.
for (const tool of TOOLS) {
  const inner = tool.execute;
  tool.execute = async (args) => {
    const source = callSource ?? 'agent';
    const entry = logCall(tool.name, args, source);
    try {
      const result = await inner(args ?? {});
      if (result && result.ok === false) entry.classList.add('fail');
      return result;
    } catch (err) {
      entry.classList.add('fail');
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  };
}

async function runTool(name, args, source = 'you') {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `No tool named ${name}` };
  callSource = source;
  try { return await tool.execute(args); }
  finally { callSource = null; }
}

document.getElementById('clear-log').addEventListener('click', () => {
  logEl.innerHTML = '<p class="empty">Tool calls from the agent appear here as they arrive.</p>';
});

/* ---------- renderers ---------- */

initRender2D(canvas2d);
initRender3D(stage3d, labels3d);

function applyMode() {
  const mode = graph.getState().mode;
  const is3d = mode === '3d';
  canvas2d.hidden = is3d;
  stage3d.hidden = !is3d;
  document.getElementById('mode-2d').classList.toggle('active', !is3d);
  document.getElementById('mode-3d').classList.toggle('active', is3d);
  document.getElementById('mode-2d').setAttribute('aria-selected', String(!is3d));
  document.getElementById('mode-3d').setAttribute('aria-selected', String(is3d));
  if (is3d) { resize3D(); rebuild3D(); } else { resize2D(); }
}

graph.subscribe((reason) => {
  renderAll(reason);
  if (reason === 'mode') { applyMode(); return; }
  if (graph.getState().mode === '3d') {
    if (reason !== 'camera') rebuild3D();
  } else {
    draw2D();
  }
});

document.getElementById('mode-2d').addEventListener('click', () => graph.setMode('2d'));
document.getElementById('mode-3d').addEventListener('click', () => graph.setMode('3d'));

document.getElementById('add-expr').addEventListener('click', () => {
  graph.upsert(null, { latex: '' });
  focusLastExpression();
});

/* ---------- presets ---------- */

const presetSelect = document.getElementById('preset-select');
for (const [name, preset] of Object.entries(PRESETS)) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = `${preset.title} (${preset.mode.toUpperCase()})`;
  presetSelect.append(option);
}
presetSelect.addEventListener('change', async () => {
  if (!presetSelect.value) return;
  await runTool('load_preset', { name: presetSelect.value }, 'you');
  presetSelect.value = '';
});

/* ---------- tool inspector ---------- */

const toolSelect = document.getElementById('tool-select');
const toolDesc = document.getElementById('tool-desc');
const toolArgs = document.getElementById('tool-args');
const toolResult = document.getElementById('tool-result');

for (const tool of TOOLS) {
  const option = document.createElement('option');
  option.value = tool.name;
  option.textContent = tool.name;
  toolSelect.append(option);
}

function describeTool() {
  const tool = TOOLS.find((t) => t.name === toolSelect.value);
  if (!tool) return;
  const first = tool.description.split('. ')[0];
  toolDesc.textContent = first.endsWith('.') ? first : first + '.';
  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const sample = {};
  for (const key of Object.keys(props)) {
    if (!required.includes(key)) continue;
    const type = props[key].type;
    sample[key] = type === 'number' ? 1 : type === 'boolean' ? true : '';
  }
  toolArgs.value = JSON.stringify(sample, null, 2);
}
toolSelect.addEventListener('change', describeTool);
describeTool();

document.getElementById('tool-run').addEventListener('click', async () => {
  let args;
  try {
    args = JSON.parse(toolArgs.value || '{}');
  } catch (err) {
    toolResult.textContent = 'Arguments are not valid JSON: ' + err.message;
    return;
  }
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

applyMode();
runTool('load_preset', { name: 'parabola_family' }, 'you').then(() => {
  logEl.innerHTML = '<p class="empty">Tool calls from the agent appear here as they arrive.</p>';
});

window.chalkboard = { graph, TOOLS, runTool };
