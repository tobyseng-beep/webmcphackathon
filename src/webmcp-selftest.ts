// WebMCP self-test. Drives the page's live `document.modelContext` the same way
// an agent host would -- discovers the registered tools with getTools() and
// does a safe, read-only executeTool() round-trip -- so you can confirm the
// whole WebMCP path works without needing an agent to type at it.
//
// Wire it to the connection badge: clicking the badge runs the test and reports
// in the console (and briefly on the badge). Nothing here mutates the board.

interface ModelContextLike {
  registerTool?: (tool: unknown) => void;
  provideContext?: (ctx: unknown) => void;
  getTools?: () => unknown;
  executeTool?: (a: unknown, b?: unknown) => unknown;
}

export interface SelfTestResult {
  available: boolean;
  host: string | null;
  toolCount: number;
  toolNames: string[];
  roundTrip: 'ok' | 'failed' | 'unsupported';
  executeStyle: string | null;
  detail: string;
}

function hostLike(): { host: ModelContextLike; name: string } | null {
  const doc = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (doc) return { host: doc, name: 'document.modelContext' };
  const nav = (navigator as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (nav) return { host: nav, name: 'navigator.modelContext' };
  return null;
}

/** Run the self-test. `readOnlyTool` should be a tool that only reads state. */
export async function runWebmcpSelfTest(readOnlyTool: string): Promise<SelfTestResult> {
  const found = hostLike();
  if (!found) {
    return {
      available: false, host: null, toolCount: 0, toolNames: [], roundTrip: 'unsupported', executeStyle: null,
      detail: 'document.modelContext is not present. Open this page in the ChatGPT desktop in-app browser, or in Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled and relaunched.',
    };
  }
  const { host, name } = found;

  // Discover tools the way a host does.
  let toolNames: string[] = [];
  let discoveredTools: unknown[] = [];
  try {
    if (typeof host.getTools === 'function') {
      const tools = await Promise.resolve(host.getTools() as unknown);
      if (Array.isArray(tools)) {
        discoveredTools = tools;
        toolNames = tools.map((t) => (t && typeof t === 'object' && 'name' in t ? String((t as { name: unknown }).name) : String(t)));
      }
    }
  } catch { /* ignore */ }

  // Safe round-trip: call a read-only tool through the real transport, trying
  // both documented executeTool shapes.
  let roundTrip: 'ok' | 'failed' | 'unsupported' = 'unsupported';
  let executeStyle: string | null = null;
  if (typeof host.executeTool === 'function') {
    const registeredTool = discoveredTools.find((tool) => (
      tool && typeof tool === 'object' && 'name' in tool &&
      String((tool as { name: unknown }).name) === readOnlyTool
    ));
    const attempts: { style: string; run: () => unknown }[] = [
      ...(registeredTool ? [
        { style: 'executeTool(tool, args)', run: () => host.executeTool!(registeredTool, {}) },
        { style: 'executeTool(tool, JSON)', run: () => host.executeTool!(registeredTool, '{}') },
      ] : []),
      { style: 'executeTool(name, args)', run: () => host.executeTool!(readOnlyTool, {}) },
      { style: 'executeTool({ name, arguments })', run: () => host.executeTool!({ name: readOnlyTool, arguments: {} }) },
      { style: 'executeTool({ name, input })', run: () => host.executeTool!({ name: readOnlyTool, input: {} }) },
    ];
    roundTrip = 'failed';
    for (const attempt of attempts) {
      try {
        const result = await Promise.resolve(attempt.run());
        if (result !== undefined && result !== null) { roundTrip = 'ok'; executeStyle = attempt.style; break; }
      } catch { /* try next shape */ }
    }
  }

  const okTools = toolNames.length > 0 || typeof host.registerTool === 'function';
  const detail = roundTrip === 'ok'
    ? `WebMCP is working — ${toolNames.length} tool(s) discovered and a live round-trip succeeded via ${executeStyle}.`
    : roundTrip === 'failed'
      ? `Host found and ${toolNames.length} tool(s) discovered, but executeTool did not return a result for "${readOnlyTool}". The host may expose tools to the agent without a direct executeTool for pages.`
      : `Host found (${okTools ? 'tools registered' : 'no tools'}); this host does not expose executeTool for page-side testing, so use an agent or the Tool inspector.`;

  return { available: true, host: name, toolCount: toolNames.length, toolNames, roundTrip, executeStyle, detail };
}

/** Attach the self-test to a connection badge: click it to test and report. */
export function wireWebmcpTester(
  badge: HTMLElement,
  badgeText: HTMLElement,
  readOnlyTool: string,
  registeredCount: number | (() => number),
): void {
  badge.style.cursor = 'pointer';
  badge.title = (badge.title ? badge.title + '  ' : '') + '(click to run a WebMCP self-test)';
  badge.addEventListener('click', async () => {
    const original = badgeText.textContent;
    const currentRegistered = typeof registeredCount === 'function' ? registeredCount() : registeredCount;
    badgeText.textContent = 'testing…';
    const r = await runWebmcpSelfTest(readOnlyTool);
    // Console report
    console.group('%cWebMCP self-test', 'font-weight:700');
    console.log('available:', r.available, '| host:', r.host);
    console.log('registered on this page:', currentRegistered, '| discovered via getTools():', r.toolCount);
    if (r.toolNames.length) console.log('tools:', r.toolNames.join(', '));
    console.log('executeTool round-trip:', r.roundTrip, r.executeStyle ? `(${r.executeStyle})` : '');
    console.log(r.detail);
    console.groupEnd();
    // Badge feedback
    if (!r.available) { badgeText.textContent = 'WebMCP unavailable'; }
    else if (r.roundTrip === 'ok') { badgeText.textContent = `WebMCP ✓ ${r.toolCount} tools`; }
    else { badgeText.textContent = `WebMCP · ${currentRegistered} tools`; }
    badge.title = r.detail;
    setTimeout(() => { if (badgeText.textContent === 'testing…') badgeText.textContent = original; }, 50);
  });
}
