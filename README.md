# Chalkboard

**A graphing sandbox an AI agent can actually draw on.**

Live: **https://tobyseng-beep.github.io/webmcphackathon/**

Built for the [WebMCP Challenge](https://webmcp.devpost.com).

---

## The idea

Ask a chatbot *"why does increasing `a` make the parabola narrower?"* and you get a
paragraph. The student reads a description of a motion they never see.

Chalkboard makes the explanation and the artifact the same object. The agent doesn't
describe the curve — it **grabs the slider and moves it** while it talks. The `a`
slider slides across the screen, the parabola visibly tightens, a label lands on the
vertex, and the words arrive as narration over a thing that is happening.

That only works because the page hands the agent real controls. WebMCP is what makes
that possible without an extension, an API key, or a bespoke integration: the page
declares its tools, and whatever agent the student already uses can drive them.

## Try it

The graph works on its own — type expressions, drag sliders, orbit the 3D surface.
To let an agent drive it, open the live URL in either:

- **ChatGPT desktop**, in the in-app browser, or
- **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled.

The badge in the top right reads **WebMCP · 14 tools** when registration succeeded, and
**WebMCP unavailable** otherwise. Every tool call the agent makes appears in the
*Agent activity* panel on the right as it arrives.

Things worth asking for:

- *"Load the parabola lesson, then show me why `a` changes the width."*
- *"Plot a damped oscillation and mark the first peak."*
- *"Where does `y = x³ − 3x` cross zero? Label the turning points."*
- *"Switch to 3D, graph `z = x² − y²`, and orbit so I can see the saddle."*

No agent handy? Open **Tool inspector** at the bottom right and call any tool by hand
with JSON arguments — same code path the agent uses.

## How WebMCP is implemented

Every tool is registered on `document.modelContext` at page load
([`src/tools.js`](src/tools.js)):

```js
document.modelContext.registerTool({
  name: 'animate_slider',
  description:
    'Sweep a parameter from one value to another over time, dragging the real ' +
    'on-screen slider so the student watches the curve deform continuously. ' +
    'This is the core teaching move of this app: when a student asks why a ' +
    'parameter has some effect, answer by animating it and narrating what they ' +
    'are about to see, rather than describing it in prose. Awaits the full sweep ' +
    'and resolves when the animation has finished, so any narration you send ' +
    'afterwards lands once the motion is complete.',
  inputSchema: {
    type: 'object',
    properties: {
      name:     { type: 'string', description: 'Slider to sweep.' },
      from:     { type: 'number', description: "Defaults to the slider's current value." },
      to:       { type: 'number', description: 'Ending value.' },
      duration: { type: 'number', description: 'Milliseconds, 200 to 10000.' },
    },
    required: ['name', 'to'],
  },
  execute: async ({ name, from, to, duration }) => {
    const result = await graph.animateSlider(name, from, to, duration);
    return result.ok ? { ...result, ...summary() } : result;
  },
});
```

Three things we found mattered more than expected:

**Return the parse error, not a failure.** `add_expression` on bad input returns
`{ ok: false, error: 'Could not parse "y = sin((": Unexpected end of expression (char 6)' }`.
The agent reads it, fixes the syntax and retries — the student never sees the stumble.
Tools that just fail make the agent apologise instead of correct.

**Echo the state back.** Every mutating tool returns the current expressions, sliders
and viewport, so the agent stays oriented without polling `list_expressions`.

**Write the description for a colleague, not a schema.** `"Set a parameter"` gets
ignored. Saying *when* to reach for a tool — and when to reach for a different one —
is what makes the agent choose `animate_slider` over `set_slider` at the moment where
the motion is the whole point.

## The tools

| Tool | What it does |
|---|---|
| `list_expressions` | Read the board: expressions, live slider values, viewport, mode |
| `add_expression` | Plot `y=f(x)`, `x=g(y)`, `z=f(x,y)`, `r=f(θ)` or an implicit equation; returns parse errors |
| `update_expression` | Change a curve in place, keeping its id and colour |
| `remove_expression` | Delete a curve |
| `define_slider` | Create a parameter or change its range, step and value |
| `set_slider` | Jump a parameter to a value |
| `animate_slider` | **Sweep a parameter over time, dragging the on-screen control** |
| `set_viewport` | Zoom and pan; also widens the search window for `find_features` |
| `set_camera` | Orbit the 3D camera (azimuth, polar angle, distance) |
| `evaluate` | Compute a number without plotting, using live slider values |
| `find_features` | **Roots, extrema, asymptotes, intersections; saddle/min/max on surfaces** |
| `annotate` | Pin a label to a coordinate with a leader line |
| `clear` | Clear annotations, or reset the board |
| `set_mode` | Switch between the 2D grapher and 3D surface plotter |
| `load_preset` | Load a lesson: expressions, ranges, camera and a teaching note |

`find_features` is what lets the agent reason instead of guess. It runs a real numeric
scan — bisection on sign changes, a blow-up probe to tell a vertical asymptote from the
edge of a domain, and the sign of the Hessian determinant to call a saddle a saddle. So
the agent says *"the vertex is at (1, −4)"* because it measured it, and `annotate` puts
the label exactly there.

## Architecture

One rule: **every state change goes through the mutation layer in
[`src/store.js`](src/store.js).** The sliders, the text boxes and the agent tools all
call the same functions. There is no separate agent path that could drift out of sync
with what is on screen.

```
src/store.js      state + every mutation (upsert, setSlider, animateSlider, setViewport…)
src/tools.js      WebMCP tool definitions; each execute() calls into store.js
src/features.js   numeric analysis behind find_features
src/normalize.js  LaTeX-ish input -> math.js source (\frac, \sqrt, ^{}, |x| …)
src/render2d.js   canvas renderer; pan/zoom writes back through setViewport
src/render3d.js   three.js surfaces; mouse orbit writes back through setCamera
src/ui.js         keyed DOM rows, updated in place so animation stays smooth
src/main.js       wiring, activity log, tool inspector, registration
```

The renderers are read-only consumers of state. Dragging the graph and calling
`set_viewport` are the same operation, so the agent can always read back where the
student actually is.

## Run locally

No build step and no package manager — `math.js` and `three.js` are vendored in
[`vendor/`](vendor/). Any static file server works:

```bash
python3 -m http.server 8777
```

Then open `http://localhost:8777`. Deploying is a matter of serving the directory;
this repo is published with GitHub Pages from `main`.

`probe.html` is a one-tool diagnostic page for checking whether a given browser exposes
WebMCP at all.

## Licence

MIT — see [LICENSE](LICENSE).
