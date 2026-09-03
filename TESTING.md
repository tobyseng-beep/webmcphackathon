# Testing the WebMCP capabilities

Every tool in Smarterboard is registered on `document.modelContext` via
`document.modelContext.registerTool({...})`. Here are four ways to test them,
from "no agent needed" to "a real agent drives it".

The pages and their tools:

| Page | URL | Tools | A read-only tool to test with |
|---|---|---|---|
| 2D / 3D grapher | `/graph.html` | 20 | `list_expressions` |
| Circuit sandbox | `/circuit.html` | 25 | `list_components` |
| Chemistry sandbox | `/chemistry.html` | 16 | `list_atoms` |
| Physics sandbox | `/physics.html` | 28 | `describe_sandbox` |
| Explore menu | `/index.html` | 2 | `list_learning_tools` |

---

## 1. The built-in self-test (fastest end-to-end check)

Every page shows a **WebMCP badge** in the top-right. **Click it** to run a
self-test: it discovers the tools through `document.modelContext.getTools()` and
does a safe, read-only `executeTool()` round-trip — the same path an agent host
uses — then reports in the badge and the browser console.

- In a normal browser the badge reads **“Waiting for WebMCP…”** and keeps
  checking in case an agent host attaches after the page loads. Clicking it
  tells you how to enable WebMCP (below).
- In a WebMCP-enabled browser it reads **“WebMCP ✓ N tools”** and the console
  prints the discovered tool names and the round-trip result.

Open the console (⌥⌘J / Ctrl-Shift-J) to see the full report.

## 2. Chrome 149+ with the WebMCP flag (no agent, real transport)

1. Open `chrome://flags/#enable-webmcp-testing`, set it **Enabled**, and
   **Relaunch** (a reload is not enough — the whole browser must restart).
2. Open the deployed URL, e.g. `https://tobyseng-beep.github.io/webmcphackathon/circuit.html`.
3. Click the badge → it should turn to **“WebMCP ✓”**.
4. Or drive the tools directly from the DevTools console:

   ```js
   const mc = document.modelContext;
   (await mc.getTools()).map(t => t.name);        // list every registered tool
   const tools = await mc.getTools();
   const list = tools.find(t => t.name === 'list_components');
   await mc.executeTool(list, {});                   // run one (read-only)
   const add = tools.find(t => t.name === 'add_component');
   await mc.executeTool(add, { type: 'resistor', value: 220 });
   ```

   `executeTool` takes the registered tool object returned by `getTools()`.
   The built-in self-test also supports Chrome builds that require the
   arguments to be JSON-stringified.

## 3. ChatGPT desktop (a real agent, no flag needed)

1. Open the ChatGPT desktop app and load the page in its **in-app browser**:

   ```bash
   open -a "ChatGPT" "https://tobyseng-beep.github.io/webmcphackathon/circuit.html"
   ```

2. Confirm the badge reads **“WebMCP ✓”** (click it to self-test).
3. Ask in the composer — the agent picks and calls the tools; watch the
   **Agent activity** panel fill in:

   - Grapher: *“Load the parabola lesson and show me why `a` changes the width.”*
   - Circuit: *“Build a circuit that lights a red LED from a 9 V battery, safely, then plot the current.”*
   - Chemistry: *“Build a water molecule and explain the covalent bonds,”* or
     *“Make a sodium ion and a chloride ion, then bond them.”*
   - Physics: *“Drop a ball from 8 m and tell me how fast it lands,”*
     *“Build a ramp, slide a 2 kg block down it, and check the acceleration against
     g·sinθ,”* *“Run it, then retry with double the mass and tell me what changed,”* or
     *“Turn friction on and show me which surfaces slide on a 27° ramp and which stick.”*

The thing worth watching is whether it reaches for the *right* tool (e.g.
`animate_slider` over `set_slider`, `bond` with the correct kind) — that is what
the tool descriptions are written to steer.

## 4. The Tool inspector (works even without WebMCP)

Every engine has a **Tool inspector** (bottom-right). Pick a tool, edit the JSON
arguments, and **Run tool** — it executes through the identical code path the
agent uses and shows the raw result. Use this to unit-test a tool's behaviour in
any browser, no flag or agent required.
