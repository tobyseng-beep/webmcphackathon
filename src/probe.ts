import type { WebMcpTool } from './types';

const statusEl = document.querySelector<HTMLParagraphElement>('#status');
const logEl = document.querySelector<HTMLDivElement>('#log');

if (!statusEl || !logEl) throw new Error('Probe page is missing required elements.');

const log = (message: string): void => {
  logEl.textContent =
    (logEl.textContent === '(nothing yet)' ? '' : `${logEl.textContent}\n`) +
    `${new Date().toLocaleTimeString()}  ${message}`;
};

// The spec is still in flux across builds: accept either host object.
const host = document.modelContext ?? navigator.modelContext ?? null;

if (!host) {
  statusEl.className = 'bad';
  statusEl.textContent =
    'NOT AVAILABLE — no document.modelContext / navigator.modelContext on this page.';
} else {
  const where = document.modelContext ? 'document.modelContext' : 'navigator.modelContext';
  const methods = Object.keys(host)
    .concat(Object.getOwnPropertyNames(Object.getPrototypeOf(host) ?? {}))
    .filter((key) => key !== 'constructor');
  statusEl.className = 'ok';
  statusEl.textContent = `AVAILABLE at ${where} — methods: ${methods.join(', ')}`;

  const tool: WebMcpTool = {
    name: 'probe_ping',
    description:
      'Diagnostic. Echoes back a message to confirm the page can receive tool calls from the agent. Call this when asked to test the connection.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Any text to echo back.' },
      },
      required: ['message'],
    },
    execute: async (args) => {
      const message = typeof args.message === 'string' ? args.message : '';
      log(`probe_ping called with: ${JSON.stringify(message)}`);
      return { ok: true, echo: message, at: new Date().toISOString() };
    },
  };

  try {
    if (host.registerTool) {
      host.registerTool(tool);
      log('registered via registerTool()');
    } else if (host.provideContext) {
      host.provideContext({ tools: [tool] });
      log('registered via provideContext()');
    } else {
      statusEl.className = 'bad';
      statusEl.textContent += ' — but no registerTool/provideContext method found';
    }
  } catch (error) {
    statusEl.className = 'bad';
    statusEl.textContent =
      `registration threw: ${error instanceof Error ? error.message : String(error)}`;
  }
}
