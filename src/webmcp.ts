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
  waiting?: boolean;
  reason?: string;
}

function findHost(): { host: WebMcpHostLike; name: string } | null {
  const doc = (document as unknown as { modelContext?: WebMcpHostLike }).modelContext;
  if (doc) return { host: doc, name: 'document.modelContext' };

  // Kept for older WebMCP hosts. Chromium 150+ uses document.modelContext.
  const nav = (navigator as unknown as { modelContext?: WebMcpHostLike }).modelContext;
  if (nav) return { host: nav, name: 'navigator.modelContext' };
  return null;
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
      reason: 'Waiting for the browser to expose document.modelContext.',
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

  const connect = async (): Promise<void> => {
    if (stopped || connecting || connected) return;
    connecting = true;
    try {
      const status = await registerWebMcpTools(tools);
      if (stopped) return;
      onStatus(status);
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
