export interface WebMcpToolLike {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (args: Record<string, unknown>) => unknown;
}

interface WebMcpHostLike {
  registerTool?: (tool: WebMcpToolLike) => void | Promise<void>;
  provideContext?: (context: { tools: WebMcpToolLike[] }) => void | Promise<void>;
  getTools?: () => unknown | Promise<unknown>;
}

export interface WebMcpStatus {
  available: boolean;
  registered: number;
  host: string | null;
  /** Still inside the grace period where a late-attaching host might appear. */
  waiting?: boolean;
  /**
   * We have waited long enough to say this browser does not offer WebMCP.
   * Polling continues quietly so a host attaching later still connects, but the
   * badge must stop claiming to be mid-connection -- a spinner that never
   * resolves is indistinguishable from a broken page.
   */
  settled?: boolean;
  reason?: string;
}

/**
 * Where the different WebMCP builds put the host. Chromium 150+ uses
 * document.modelContext; 149 and the earlier origin trial used
 * navigator.modelContext; some embedders hang it off window. Check all of them
 * rather than assuming, because guessing wrong looks exactly like "no agent".
 */
function findHost(): { host: WebMcpHostLike; name: string } | null {
  const candidates: [string, unknown][] = [
    ['document.modelContext', (document as unknown as { modelContext?: unknown }).modelContext],
    ['navigator.modelContext', (navigator as unknown as { modelContext?: unknown }).modelContext],
    ['window.modelContext', (window as unknown as { modelContext?: unknown }).modelContext],
    ['navigator.agent', (navigator as unknown as { agent?: unknown }).agent],
  ];
  for (const [name, value] of candidates) {
    if (!value || typeof value !== 'object') continue;
    const host = value as WebMcpHostLike;
    if (typeof host.registerTool === 'function' || typeof host.provideContext === 'function') {
      return { host, name };
    }
  }
  return null;
}

/** Names of the host objects present, for reporting when none is usable. */
export function describeHostSurface(): string {
  const seen: string[] = [];
  if ((document as unknown as { modelContext?: unknown }).modelContext) seen.push('document.modelContext');
  if ((navigator as unknown as { modelContext?: unknown }).modelContext) seen.push('navigator.modelContext');
  if ((window as unknown as { modelContext?: unknown }).modelContext) seen.push('window.modelContext');
  return seen.length ? seen.join(', ') : 'none';
}

async function discoveredToolCount(host: WebMcpHostLike, names: Set<string>): Promise<number> {
  if (typeof host.getTools !== 'function') return 0;
  try {
    const tools = await Promise.resolve(host.getTools());
    if (!Array.isArray(tools)) return 0;
    return tools.filter((tool) => (
      tool && typeof tool === 'object' && 'name' in tool &&
      names.has(String((tool as { name: unknown }).name))
    )).length;
  } catch {
    return 0;
  }
}

/** Register tools on the currently exposed WebMCP host and await real results. */
export async function registerWebMcpTools(
  tools: readonly WebMcpToolLike[],
): Promise<WebMcpStatus> {
  const found = findHost();
  if (!found) {
    return {
      available: false,
      registered: 0,
      host: null,
      waiting: true,
      reason: `No WebMCP host yet (present: ${describeHostSurface()}).`,
    };
  }

  const { host, name } = found;
  let registered = 0;
  const names = new Set(tools.map((tool) => tool.name));

  if (typeof host.registerTool === 'function') {
    for (const tool of tools) {
      try {
        await Promise.resolve(host.registerTool(tool));
        registered++;
      } catch (err) {
        // During hot reload a browser may still own the previous registration.
        // Discovery below distinguishes that harmless case from a real failure.
        console.warn(`[webmcp] could not register ${tool.name}:`, err);
      }
    }
    registered = Math.max(registered, await discoveredToolCount(host, names));
  } else if (typeof host.provideContext === 'function') {
    try {
      await Promise.resolve(host.provideContext({ tools: [...tools] }));
      registered = tools.length;
    } catch (err) {
      console.error('[webmcp] provideContext failed:', err);
    }
  } else {
    return {
      available: true,
      registered: 0,
      host: name,
      reason: 'The WebMCP host has no supported tool registration method.',
    };
  }

  return {
    available: true,
    registered,
    host: name,
    reason: registered === 0 ? 'WebMCP is connected, but no page tools registered.' : undefined,
  };
}

/**
 * How long to keep saying "connecting" before admitting the browser has no
 * WebMCP. Hosts that inject late do so within a second or two.
 */
const GRACE_MS = 4000;

/**
 * Register immediately, then keep looking until a late-injected WebMCP host
 * appears. Some agent browsers attach modelContext after page scripts start.
 */
export function watchWebMcp(
  tools: readonly WebMcpToolLike[],
  onStatus: (status: WebMcpStatus) => void,
): () => void {
  let stopped = false;
  let connecting = false;
  let connected = false;
  let interval = 0;
  const startedAt = Date.now();

  const connect = async (): Promise<void> => {
    if (stopped || connecting || connected) return;
    connecting = true;
    try {
      const status = await registerWebMcpTools(tools);
      if (stopped) return;
      // Past the grace period with still no host, say so plainly. Polling
      // carries on underneath, so a host that attaches later still connects.
      onStatus(
        status.available || Date.now() - startedAt < GRACE_MS
          ? status
          : { ...status, waiting: false, settled: true },
      );
      if (status.available && status.registered > 0) {
        connected = true;
        window.clearInterval(interval);
      }
    } finally {
      connecting = false;
    }
  };

  void connect();
  interval = window.setInterval(() => void connect(), 1000);
  window.addEventListener('focus', connect);
  document.addEventListener('visibilitychange', connect);

  return () => {
    stopped = true;
    window.clearInterval(interval);
    window.removeEventListener('focus', connect);
    document.removeEventListener('visibilitychange', connect);
  };
}

/**
 * Paint the connection badge from a status, in one place for all four boards.
 *
 * Two states matter beyond "connected". Once the watcher settles without a
 * host, the badge has to say so plainly: a label that reads "waiting" forever
 * is indistinguishable from a broken page, and it hides the one thing the
 * student can act on. And registration alone is not proof of an agent -- the
 * tools can be registered with nothing on the other end -- so once calls start
 * arriving the badge reports those instead, which is the evidence that the
 * connection is live.
 */
export function renderBadge(
  badge: HTMLElement,
  badgeText: HTMLElement,
  status: WebMcpStatus,
  agentCalls: number,
): void {
  if (status.available && status.registered > 0) {
    badge.className = 'badge ok';
    badgeText.textContent = agentCalls > 0
      ? `Agent live · ${agentCalls} call${agentCalls === 1 ? '' : 's'}`
      : `WebMCP ready · ${status.registered} tools`;
    badge.title = agentCalls > 0
      ? `${status.registered} tools registered on ${status.host}. ${agentCalls} call${agentCalls === 1 ? '' : 's'} received; each one is listed in the activity panel. Click to run a self-test.`
      : `${status.registered} tools registered on ${status.host}. No agent has called one yet — ask it to do something and this badge will say so. Click to run a self-test.`;
    return;
  }

  if (status.available) {
    badge.className = 'badge off';
    badgeText.textContent = 'WebMCP · no tools';
    badge.title = status.reason ?? 'The browser exposed WebMCP, but tool registration failed.';
    return;
  }

  if (status.settled) {
    badge.className = 'badge off';
    badgeText.textContent = 'No agent connected';
    badge.title = `No WebMCP host on this page (globals present: ${describeHostSurface()}). `
      + 'Chrome needs 149+ with chrome://flags/#enable-webmcp-testing Enabled and a full relaunch — a reload is not enough. '
      + 'The ChatGPT desktop in-app browser works too. The Tool inspector drives the same tools without either. Click to run a self-test.';
    return;
  }

  badge.className = 'badge checking';
  badgeText.textContent = 'Looking for an agent…';
  badge.title = `${status.reason ?? ''} The page connects by itself as soon as a host appears.`;
}
