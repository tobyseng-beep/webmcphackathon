# Smarterboard

**A graphing sandbox an AI agent can actually draw on.**

Live: **https://tobyseng-beep.github.io/webmcphackathon/**

Built for the [WebMCP Challenge](https://webmcp.devpost.com).

---

## The idea

Ask a chatbot *"why does increasing `a` make the parabola narrower?"* and you get a
paragraph. The student reads a description of a motion they never see.

Smarterboard makes the explanation and the artifact the same object. The agent doesn't
describe the curve — it **grabs the slider and moves it** while it talks. The `a`
slider slides across the screen, the parabola visibly tightens, a label lands on the
vertex, and the words arrive as narration over a thing that is happening.

That only works because the page hands the agent real controls. WebMCP is what makes
that possible without an extension, an API key, or a bespoke integration: the page
declares its tools, and whatever agent the student already uses can drive them.

## Try it

> Testing the WebMCP tools (self-test, Chrome flag, ChatGPT desktop, Tool inspector): see [TESTING.md](TESTING.md).

The live URL opens a menu of learning tools. **2D** and **3D** open the grapher
(`graph.html?mode=2d` / `?mode=3d`); **Circuits**, **Physics** and **Chemistry** open
their own sandboxes. Every page's logo links back to the menu.

The menu registers two tools of its own — `list_learning_tools` and `open_tool` — so an
agent can open the right board before the student has clicked anything.

The graph works on its own — type expressions, drag sliders, orbit the 3D surface.
Parameters used by an expression appear automatically (excluding the coordinate
variables `x`, `y` and `z`) and disappear when no expression uses them. Slider values
can also be entered directly to two decimal places.
To let an agent drive it, open the live URL in either:

- **ChatGPT desktop**, in the in-app browser, or
- **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled.

The badge in the top right shows how many tools the current board registered (20 on the
grapher). If the browser attaches WebMCP after page load, the badge connects
automatically. Every tool call the agent makes appears in the *Agent activity* panel.

Things worth asking for:

- *"Load the parabola lesson, then show me why `a` changes the width."*
- *"Plot a damped oscillation and mark the first peak."*
- *"Where does `y = x³ − 3x` cross zero? Label the turning points."*
- *"Switch to 3D, graph `z = x² − y²`, and orbit so I can see the saddle."*

No agent handy? Open **Tool inspector** at the bottom right and call any tool by hand
with JSON arguments — same code path the agent uses.

## How WebMCP is implemented

The grapher's 20 tools are registered on `document.modelContext`
([`src/tools.ts`](src/tools.ts)); the other sandboxes register their own toolsets:

```ts
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
| `add_expression` | Plot 2D curves, points in `(x,y)` form, or 3D surfaces solved for any axis; returns parse errors |
| `plot_point` | Plot and optionally label an exact coordinate on the 2D graph |
| `update_expression` | Change a curve in place, keeping its id and colour |
| `remove_expression` | Delete a curve |
| `define_slider` | Create a parameter or change its range, step and value |
| `set_slider` | Jump a parameter to a value |
| `animate_slider` | **Sweep a parameter over time, dragging the on-screen control** |
| `set_viewport` | Zoom and pan; also widens the search window for `find_features` |
| `set_camera` | Orbit the 3D camera (azimuth, polar angle, distance) |
| `evaluate` | Compute a number without plotting, using live slider values |
| `find_features` | **Roots, extrema, asymptotes, crossings with any curve kind; saddle/min/max on surfaces** |
| `set_snapping` | Read or change the board's curve/grid snapping, which the student also controls |
| `read_changes` | **What changed since a revision, and whether the student or the agent did it** |
| `annotate` | Pin a label to a coordinate with a leader line |
| `clear` | Clear annotations, or reset the board |
| `set_mode` | Switch between the 2D grapher and 3D surface plotter |
| `load_preset` | Load a lesson: expressions, ranges, camera and a teaching note |

### Snapping and the cursor

With **Snap to curve** on, the pointer does not merely report a nearby curve — it
rides it. The native cursor is hidden and a stand-in pointer is drawn at the snapped
point, so there is one pointer on screen sitting on the line rather than a cursor in one
place and a marker in another. It takes a deliberate pull (25 px, against a 17 px
capture) to come off a curve, so the pointer stays put while sliding along it without
ever being trapped.

Every radius is deliberately tight. Snapping should feel like the cursor settling onto a
line it was already near; a grabby snap is something the student works around rather than
uses.

Magnetism comes in three strengths, because not every point on a curve is equally worth
landing on ([`src/snap.ts`](src/snap.ts)):

| Tier | What it is | Reach |
|---|---|---|
| `curve` | anywhere along a plotted curve | 17 px perpendicular |
| `curve-grid` | where a curve crosses one of the graph's own grid lines | 6 px radial |
| `curve-curve` | **where two plotted curves cross each other** | **10 px radial** |

A crossing of two of the student's own curves is the most meaningful point on the board,
so it pulls from nearly twice as far as a grid crossing and outranks it when both are in
range.

Those crossings mark themselves, too: up to three of them wear the same circle the cursor
does when it snaps — hollow rather than filled, so a place you *could* land on never
looks like the live pointer. Above three the board is too busy and they all stand down. A
marker also stands down when the pointer comes within 36 px of its point, so the cursor's
own circle and readout take over rather than stacking two circles on one spot.

Snapping applies to every kind of curve the board can draw, not just `y=f(x)`. What
differs is what each kind can offer, and the search is built around exactly that: an
**explicit** or **implicit** curve has a *field* — a signed quantity that is zero on the
curve — while an **explicit** or **polar** curve has a *parameterisation* it can be
walked along. Given any two curves, whichever one can be walked is walked, and the
other's field is root-found along the way, which collapses almost every pairing into the
same one-dimensional search:

| Pair | How it is solved |
|---|---|
| explicit ∩ explicit | walk one, root-find the other's field |
| explicit ∩ implicit | walk the explicit one, root-find `F(x, y)` |
| polar ∩ explicit or implicit | walk the polar one in θ |
| implicit ∩ implicit | grid scan for cells both curves enter, then 2D Newton |
| polar ∩ polar | thinned polyline against polyline |

An implicit `F` is divided by its own gradient before use, which turns it into an
approximate signed distance — otherwise `x²+y²−25` and `1000(x²+y²−25)` would need
different tolerances despite being the same circle. Detection still runs on the raw `F`,
which is a fifth of the evaluations and has the same zero set.

Two cases need catching beyond a plain sign change, because neither one changes sign:

- **A root landing exactly on a sample.** The common case for the tidy numbers a lesson is
  built from — `y = 5` meets `y = x` at exactly `x = 5`.
- **A tangency**, where two curves touch without crossing: `y = x²` meets `y = 0` at the
  origin, and the difference dips to zero and comes straight back up. Each local minimum
  of |difference| is refined by ternary search and kept only if it actually reaches zero,
  so `y = x²` touching `y = 0` is found while `y = x² + 0.05` correctly is not.

Curves that lie on top of each other are reported as having no crossing at all, rather
than one at every sample. The search is memoised on the curves, their sliders and the
viewport, so it runs when the board changes rather than on every mouse move.

`find_features` is what lets the agent reason instead of guess. It runs a real numeric
scan — bisection on sign changes, a blow-up probe to tell a vertical asymptote from the
edge of a domain, and the sign of the Hessian determinant to call a saddle a saddle. So
the agent says *"the vertex is at (1, −4)"* because it measured it, and `annotate` puts
the label exactly there.

## The physics sandbox

`physics.html` is a 2D mechanics box with the three stages a problem actually has.

**Pre-simulation.** Nothing acts on anything. Objects float exactly where they are put,
so a scene can be built in any order — drop the ball in mid-air first and slide the ramp
underneath it afterwards. This is the only stage in which anything can be edited.

**Simulation.** Gravity and normal (contact) forces switch on and the floating objects
fall. **Friction is a switch, off by default** (see below); there is never any air
resistance. A run ends in exactly three ways, per the spec: you end it, every movable
object has been at rest for 5 seconds, or 30 seconds elapse.

**Post-simulation.** Everything freezes where it stopped and the readings stay
queryable. **Retry** restores the layout — positions, forces and velocities — exactly as
it was the instant the last run started, which is what makes "change one thing and run it
again" an honest comparison. **Reset** empties the box.

The library has the three sections the brief asks for:

| Section | Contents |
|---|---|
| Design tools | select, draw line, erase, force, velocity |
| Blocks (fixed, bear weight) | ramp, platform, wall, block, quarter-pipe, coaster dip, loop |
| Objects (move) | ball, cube, cart, plank |

During the design stage the forces and velocities you have set up stay drawn on their
objects, because that is the scene you are about to run. Once the run starts, the live
velocity readout is **hover-only** — a box full of moving objects would otherwise be a
thicket of arrows — so point at an object to get its arrow and speed, or select it to
keep a full readout (position, velocity, energies, live forces) in the sidebar.

Drawn lines bear weight exactly like the floor, so an agent can build a slope the block
library does not have. The floor and both side walls are solid supports; the top is open,
so a launched object leaves the view and falls back in rather than hitting a lid. At most
**15 objects** can be in the box at once.

### Friction

The **Friction** button above the box turns Coulomb friction on and off for the whole
sandbox. Off is the idealised case a first course starts with; on is the next lesson. It
can only be changed in the pre-simulation stage, so a run stays reproducible and
**Retry** replays it faithfully — which makes "run it frictionless, then retry with
friction on" a one-click comparison.

Friction is a property of the **pair** of surfaces in contact, not of one object. Every
object carries a material, and the coefficient comes from a table
([`src/physics/materials.ts`](src/physics/materials.ts)). The floor, the walls and the
blocks are concrete; balls are rubber, cubes and planks wood, carts and tracks steel.

| μ | rubber | wood | steel | concrete | ice |
|---|---|---|---|---|---|
| **rubber** | 1.10 | 0.75 | 0.65 | 0.90 | 0.15 |
| **wood** | 0.75 | 0.35 | 0.30 | 0.55 | 0.08 |
| **steel** | 0.65 | 0.30 | 0.50 | 0.45 | 0.03 |
| **concrete** | 0.90 | 0.55 | 0.45 | 0.70 | 0.10 |
| **ice** | 0.15 | 0.08 | 0.03 | 0.10 | 0.03 |

The solver clamps each contact's tangential impulse to the Coulomb cone (|jt| ≤ μ·jn),
so static friction is not special-cased — a block simply stays put until tanθ exceeds μ,
and starts sliding when it does. Two simplifications worth stating to a student: there is
one coefficient per pair rather than separate static and kinetic values, and there is no
rolling resistance, so a ball that ends up rolling rather than sliding keeps rolling.

The solver is impulse-based rigid-body dynamics over convex polygons and circles, written
from scratch in [`src/physics/engine.ts`](src/physics/engine.ts) — no physics library. It
was checked against the closed-form answers:

| Check | Predicted | Measured |
|---|---|---|
| Free fall from 8 m, impact speed | 12.251 m/s | 12.262 m/s |
| Free fall from 8 m, time | 1.249 s | 1.250 s |
| Block on a 29.4° frictionless ramp, `a = g sinθ` | 4.809 m/s² | 4.810 m/s² |
| 9 N on 3 kg, `a = F/m` (Δv between t = 1 s and t = 2 s) | 3.000 m/s² | 3.000 m/s² |
| Momentum through a 2 kg / 1 kg head-on collision | conserved | conserved exactly |
| Rebound height, `h′ = e²h` (e = 0.2 / 0.5 / 0.85) | 0.59 / 1.99 / 5.15 m | 0.58 / 2.00 / 5.19 m |
| Loop-the-loop threshold `v = √(5gr)` | 8.11 m/s | clears the top at 8.5 m/s |
| Sliding on the flat, `a = −μg` (ice, μ = 0.10) | −0.981 m/s² | −0.981 m/s² |
| The same, at 3 kg and at 20 kg | mass-independent | −0.981 m/s² both |
| Block on a 26.6° ramp, μ = 0.90 > tanθ = 0.50 | does not slide | does not slide |
| Block on the same ramp, `a = g(sinθ − μcosθ)` (ice) | 3.51 m/s² | 3.51 m/s² |

Flat surfaces and free flight are exact. Curved tracks are tessellated into many short
straight segments, so a body riding one loses a few percent of its energy per pass at the
joints — the tool descriptions say so, so an agent teaches the trend there rather than the
last decimal place.

### The physics tools

| Tool | What it does |
|---|---|
| `describe_sandbox` | The rules, the stage, the units, the box, what is and is not modelled |
| `list_library` | The three library sections with sizes, masses and what each shape is for |
| `list_objects` / `get_object` | Every object, or one in depth with its motion history |
| `add_object` / `draw_line` | Place a block or object; draw an arbitrary weight-bearing line |
| `move_object` / `rotate_object` / `set_property` | Position, angle, mass, bounciness, size, material |
| `set_friction` | **Turn Coulomb friction on or off for the whole sandbox** |
| `list_friction_pairs` | **The μ table for every material pair, and each object's material** |
| `apply_force` | **A kick at t=0, or a force held for up to 10 s** |
| `set_velocity` | **A starting velocity, or one held for up to 10 s** |
| `clear_motion` / `remove_object` / `set_gravity` | Undo the motion setup, delete, change g |
| `start` / `pause` / `resume` / `end` / `retry` / `reset_simulation` | The stage machine |
| `read_simulation` | **Positions, velocities, forces, energies and momentum totals** |
| `read_telemetry` | The recorded motion of one object, sampled 20×/second |
| `read_events` | **Every collision with its impact speed, and why the run ended** |
| `load_preset` | A ready-made scene with a note on what it demonstrates |

`read_events` and `read_telemetry` are what let the agent narrate instead of guess. It
says *"it hit the floor at 12.4 m/s, then at 6.1, then at 3.0"* because the run recorded
each impact, and `read_simulation` reports kinetic and potential energy side by side so a
claim about conservation is a measurement rather than an assertion.

## Architecture

One rule: **every state change goes through its sandbox's mutation layer.** The controls
and agent tools call the same store functions, so there is no separate agent path that
could drift out of sync with what is on screen.

```
index.html        the Explore menu; src/menu.ts scatters the equations and
                  registers list_learning_tools + open_tool
graph.html        the grapher itself; reads ?mode=2d|3d to pick the opening board
src/types.ts      shared board, expression, result, preset and WebMCP types
src/store.ts      state + every mutation (upsert, setSlider, animateSlider, setViewport…)
src/tools.ts      WebMCP tool definitions; each execute() calls into store.ts
src/features.ts   numeric analysis behind find_features
src/normalize.ts  LaTeX-ish input -> math.js source (\frac, \sqrt, ^{}, |x| …)
src/render2d.ts   canvas renderer; pan/zoom writes back through setViewport
src/snap.ts       cursor snapping tiers and the curve/curve crossing search
src/render3d.ts   three.js surfaces; mouse orbit writes back through setCamera
src/ui.ts         keyed DOM rows, updated in place so animation stays smooth
src/main.ts       wiring, activity log, tool inspector, registration
src/webmcp.ts     shared late-host detection and awaited tool registration

physics.html            the physics sandbox
src/physics/types.ts    body, shape, stage, event and telemetry types
src/physics/engine.ts   the solver: contacts, impulses, integration (no DOM)
src/physics/catalog.ts  the library: design tools, blocks, objects, shape builders
src/physics/materials.ts the friction table: mu for every pair of surface materials
src/physics/store.ts    state + every mutation + the three-stage machine + the clock
src/physics/render.ts   canvas renderer and pointer tools (draw, erase, force, velocity)
src/physics/presets.ts  ready-made scenes with teaching notes
src/physics/tools.ts    WebMCP tool definitions; each execute() calls into store.ts
src/physics/main.ts     wiring, library palettes, inspector, stage buttons, registration

circuit.html            the circuit sandbox
src/circuit/store.ts    circuit state and mutations
src/circuit/solver.ts   live circuit analysis
src/circuit/tools.ts    circuit WebMCP tools
src/circuit/main.ts     palette, inspector, scope, activity and registration

chemistry.html            the atom and molecule sandbox
src/chemistry/store.ts    atom, bond and view mutations
src/chemistry/analysis.ts structure and valence analysis
src/chemistry/tools.ts    chemistry WebMCP tools
src/chemistry/main.ts     periodic table, inspector, activity and registration
```

`engine.ts` has no DOM dependency and `store.advance(seconds)` is separate from the
frame loop, so the simulation can be stepped deterministically without a browser clock —
which is how the numbers in the table above were measured.

The renderers are read-only consumers of state. Dragging the graph and calling
`set_viewport` are the same operation, so the agent can always read back where the
student actually is.

## Run locally

Install dependencies and start the Vite development server:

```bash
npm ci
npm run dev
```

Vite prints the local URL (normally `http://localhost:5173`). Other useful commands:

```bash
npm run typecheck
npm run build
npm run preview
```

`mathjs` and `three` are npm dependencies. `npm run build` bundles the TypeScript
app into `dist/` with a relative asset base, so it works at the existing
`/webmcphackathon/` GitHub Pages project URL. A GitHub Actions workflow runs
`npm ci`, typechecks, builds, uploads `dist/`, and deploys it to Pages on pushes to
`main` (and can also be started manually).

`probe.html` is a one-tool diagnostic page for checking whether a given browser exposes
WebMCP at all.

## Licence

MIT — see [LICENSE](LICENSE).
