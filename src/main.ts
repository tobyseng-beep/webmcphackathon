// Wiring. Boots the renderers, registers the WebMCP tools, and mirrors every
// tool call into the on-screen activity log so a spectator can see what the
// agent is doing to the board.

import * as graph from './store';
import { TOOLS, registerTools } from './tools';
import { PRESETS } from './presets';
import { initRender2D, draw as draw2D, resize2D } from './render2d';
import { initRender3D, rebuild as rebuild3D, resize3D } from './render3d';
import { renderAll, focusLastExpression } from './ui';
import { mustQuery } from './dom';

const canvas2d = mustQuery<HTMLCanvasElement>('#canvas2d');
const stage3d = mustQuery<HTMLDivElement>('#stage3d');
const labels3d = mustQuery<HTMLDivElement>('#labels3d');
const logEl = mustQuery<HTMLDivElement>('#log');
const badge = mustQuery<HTMLDivElement>('#mcp-badge');
const badgeText = mustQuery<HTMLSpanElement>('#mcp-text');

/* ---------- activity log ---------- */

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

// Wrap each tool once, before registration, so agent calls and hand-run calls
// share the same logging path.
for (const tool of TOOLS) {
  const inner = tool.execute;
  tool.execute = async (args) => {
    const source = callSource ?? 'agent';
    const entry = logCall(tool.name, args, source);
    try {
      const result = await inner(args ?? {});
      if (
        result &&
        typeof result === 'object' &&
        'ok' in result &&
        result.ok === false
      ) entry.classList.add('fail');
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

/* ---------- renderers ---------- */

initRender2D(canvas2d);
initRender3D(stage3d, labels3d);

function applyMode(): void {
  const mode = graph.getState().mode;
  const is3d = mode === '3d';
  canvas2d.hidden = is3d;
  stage3d.hidden = !is3d;
  mustQuery<HTMLButtonElement>('#mode-2d').classList.toggle('active', !is3d);
  mustQuery<HTMLButtonElement>('#mode-3d').classList.toggle('active', is3d);
  mustQuery<HTMLButtonElement>('#mode-2d').setAttribute('aria-selected', String(!is3d));
  mustQuery<HTMLButtonElement>('#mode-3d').setAttribute('aria-selected', String(is3d));
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

mustQuery<HTMLButtonElement>('#mode-2d').addEventListener('click', () => graph.setMode('2d'));
mustQuery<HTMLButtonElement>('#mode-3d').addEventListener('click', () => graph.setMode('3d'));

mustQuery<HTMLButtonElement>('#add-expr').addEventListener('click', () => {
  graph.upsert(null, { latex: '' });
  focusLastExpression();
});

/* ---------- presets ---------- */

const presetSelect = mustQuery<HTMLSelectElement>('#preset-select');
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
  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const sample: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (!required.includes(key)) continue;
    const type = props[key].type;
    sample[key] = type === 'number' ? 1 : type === 'boolean' ? true : '';
  }
  toolArgs.value = JSON.stringify(sample, null, 2);
}
toolSelect.addEventListener('change', describeTool);
describeTool();

mustQuery<HTMLButtonElement>('#tool-run').addEventListener('click', async () => {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(toolArgs.value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Arguments must be a JSON object.');
    }
    args = parsed as Record<string, unknown>;
  } catch (err) {
    toolResult.textContent = 'Arguments are not valid JSON: ' +
      (err instanceof Error ? err.message : String(err));
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

// The menu links here as graph.html?mode=2d / ?mode=3d. Choosing the opening
// preset is enough to set the board mode, since each preset declares its own.
const startIn3D = new URLSearchParams(location.search).get('mode') === '3d';
runTool('load_preset', { name: startIn3D ? 'saddle' : 'parabola_family' }, 'you').then(() => {
  logEl.innerHTML = '<p class="empty">Tool calls from the agent appear here as they arrive.</p>';
});

window.chalkboard = { graph, TOOLS, runTool };
