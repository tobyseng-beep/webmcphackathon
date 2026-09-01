// WebMCP surface. Every execute() below routes into src/store.ts -- the same
// functions the on-screen controls call. Descriptions are written as
// instructions to a competent colleague, because the description string is the
// only context the agent has when choosing a tool.

import * as graph from './store';
import { findFeatures } from './features';
import { PRESETS, presetNames } from './presets';
import type {
  BoardMode,
  CameraState,
  ExpressionPatch,
  NumericScope,
  SliderSpec,
  Viewport,
  WebMcpTool,
} from './types';

const summary = () => {
  const s = graph.getState();
  return {
    mode: s.mode,
    expressions: graph.list().map((e) => ({
      id: e.id, latex: e.latex, kind: e.kind,
      ...(e.visible ? {} : { visible: false }),
      ...(e.error ? { error: e.error } : {}),
    })),
    sliders: s.sliders.map((sl) => ({ name: sl.name, value: +sl.value.toFixed(4), min: sl.min, max: sl.max })),
    viewport: s.viewport,
  };
};

const toolDefinitions = [
  {
    name: 'list_expressions',
    description:
      'Read the current state of the graph: every expression with its id, the sliders with their live values, the visible viewport, and whether the board is in 2D or 3D mode. Call this first whenever you are not certain what is already on screen, and after any change you did not make yourself. Expression ids returned here are what update_expression, remove_expression and find_features expect.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, ...summary() }),
  },

  {
    name: 'add_expression',
    description:
      'Plot a new expression and render it immediately. Accepts plain math ("y = a*x^2 + b") or LaTeX ("y = \\\\frac{x}{2}"). In 2D it supports y = f(x), x = g(y), polar and implicit equations. In 3D it supports surfaces oriented as z = f(x,y), y = f(x,z), or x = f(y,z); a bare expression is treated as z = expression. Free variables automatically become sliders while x, y, z and the polar coordinate theta do not, so "y = a*sin(b*x)" creates sliders a and b in one call. A slider is removed when its parameter no longer appears in any expression. If the expression does not parse, this returns ok:false with the parser error -- read it, fix the syntax, and call again rather than reporting failure to the student.',
    inputSchema: {
      type: 'object',
      properties: {
        latex: { type: 'string', description: 'The expression or equation to plot, e.g. "y = a*x^2" or "z = x^2 - y^2".' },
        id: { type: 'string', description: 'Optional stable id. Supply one if you intend to update or remove this expression later.' },
        color: { type: 'string', description: 'Optional CSS colour, e.g. "#c74440". Defaults to the next colour in the palette.' },
      },
      required: ['latex'],
    },
    execute: async ({ latex, id, color }: { latex: string; id?: string; color?: string }) => {
      const result = graph.upsert(id ?? null, { latex, color });
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'update_expression',
    description:
      'Replace the formula of an expression already on the graph, keeping its id and colour so the student sees the same curve change rather than a new one appear. Use this when refining an example ("now make it a cubic"). Returns a parser error without modifying anything if the new formula is invalid.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id from list_expressions.' },
        latex: { type: 'string', description: 'The replacement expression.' },
        color: { type: 'string' },
        visible: { type: 'boolean', description: 'Set false to hide the curve without deleting it.' },
      },
      required: ['id'],
    },
    execute: async ({ id, latex, color, visible }: { id: string; latex?: string; color?: string; visible?: boolean }) => {
      if (!graph.byId(id)) return { ok: false, error: `No expression with id "${id}". Call list_expressions to see current ids.` };
      const patch: ExpressionPatch = {};
      if (latex !== undefined) patch.latex = latex;
      if (color !== undefined) patch.color = color;
      if (visible !== undefined) patch.visible = visible;
      const result = graph.upsert(id, patch);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'remove_expression',
    description:
      'Delete one expression from the graph by id. Prefer setting visible:false through update_expression when you may want the curve back shortly, so the student keeps their place.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id from list_expressions.' } },
      required: ['id'],
    },
    execute: async ({ id }: { id: string }) => {
      const result = graph.remove(id);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'define_slider',
    description:
      'Change the range, step or value of a parameter slider already used by an expression. Add the parameter to an expression first; sliders exist only while their parameter appears on the board. Use this to widen a range when a demonstration needs values the current range does not reach (animate_slider widens automatically, but a manual set_slider will clamp).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Parameter name already present in an expression. Coordinates and reserved math values cannot be sliders.' },
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number', description: 'Drag increment. Use 0.01 for smooth parameters, 1 for integer-valued ones.' },
        value: { type: 'number', description: 'Starting value. Clamped into [min, max].' },
      },
      required: ['name'],
    },
    execute: async ({ name, min, max, step, value }: SliderSpec & { name: string }) => {
      const result = graph.defineSlider(name, { min, max, step, value });
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_slider',
    description:
      'Jump a parameter straight to a value. The on-screen slider moves and every curve using that parameter re-renders. Use this to set up a starting condition before an explanation. When the point of the moment is to let the student SEE the effect of a change, use animate_slider instead -- a jump cut teaches much less than a sweep.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'number' },
      },
      required: ['name', 'value'],
    },
    execute: async ({ name, value }: { name: string; value: number }) => {
      const result = graph.setSlider(name, value);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'animate_slider',
    description:
      'Sweep a parameter from one value to another over time, dragging the real on-screen slider so the student watches the curve deform continuously. This is the core teaching move of this app: when a student asks why a parameter has some effect, answer by animating it and narrating what they are about to see, rather than describing it in prose. Awaits the full sweep and resolves when the animation has finished, so any narration you send afterwards lands once the motion is complete. Widens the slider range automatically if from/to fall outside it. Animate one parameter at a time -- two at once is unreadable.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Slider to sweep.' },
        from: { type: 'number', description: 'Starting value. Defaults to the slider\'s current value.' },
        to: { type: 'number', description: 'Ending value.' },
        duration: { type: 'number', description: 'Milliseconds, 200 to 10000. Around 2000 reads well for a single idea; use 3000+ when the student needs to track a subtle change.' },
      },
      required: ['name', 'to'],
    },
    execute: async ({ name, from, to, duration }: { name: string; from?: number; to: number; duration?: number }) => {
      const result = await graph.animateSlider(name, from, to, duration);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_viewport',
    description:
      'Set the visible x and y range (and z range in 3D). Use it to zoom onto the region that actually matters -- a root near the origin, the tail of a decay curve -- so the student is looking at the thing being discussed. Also widens the search window for find_features, which only reports features inside the current viewport. Pass only the bounds you want to change.',
    inputSchema: {
      type: 'object',
      properties: {
        xmin: { type: 'number' }, xmax: { type: 'number' },
        ymin: { type: 'number' }, ymax: { type: 'number' },
        zmin: { type: 'number', description: '3D only: clips the surface height.' },
        zmax: { type: 'number', description: '3D only: clips the surface height.' },
      },
    },
    execute: async (args: Partial<Viewport>) => {
      const result = graph.setViewport(args ?? {});
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_camera',
    description:
      '3D only. Orbit the camera around the surface. theta is the azimuth in degrees (rotates around the vertical axis), phi is the polar angle in degrees where 0 looks straight down from above and 90 is edge-on at the horizon, and distance is how far back the camera sits. This matters more than it sounds: a saddle point is invisible from directly overhead, so orbit to roughly phi 80 before explaining one, and use phi near 5 to show contour-like structure from above.',
    inputSchema: {
      type: 'object',
      properties: {
        theta: { type: 'number', description: 'Azimuth in degrees.' },
        phi: { type: 'number', description: 'Polar angle in degrees, 1 (top-down) to 179.' },
        distance: { type: 'number', description: 'Camera distance, 2 to 200. Around 34 frames a typical surface.' },
      },
    },
    execute: async (args: Partial<CameraState>) => {
      const s = graph.getState();
      if (s.mode !== '3d') return { ok: false, error: 'The board is in 2D mode. Call set_mode with "3d" first.' };
      const result = graph.setCamera(args ?? {});
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'evaluate',
    description:
      'Compute a numeric value without plotting anything. Current slider values are in scope, so "a*x^2" evaluates with the slider a the student is looking at. Use this to check an answer, to get a coordinate before calling annotate, or to state a specific number in your explanation instead of estimating from the picture.',
    inputSchema: {
      type: 'object',
      properties: {
        latex: { type: 'string', description: 'Expression to evaluate, e.g. "a*x^2 + 1" or "sin(pi/4)".' },
        at: {
          type: 'object',
          description: 'Variable values, e.g. {"x": 2} or {"x": 1, "y": -1}. Overrides slider values of the same name.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, t: { type: 'number' } },
        },
      },
      required: ['latex'],
    },
    execute: async ({ latex, at }: { latex: string; at?: NumericScope }) => graph.evaluateAt(latex, at ?? {}),
  },

  {
    name: 'find_features',
    description:
      'Numerically locate the interesting points of a curve or surface inside the current viewport, so you can reason from real coordinates instead of guessing from the algebra. For y = f(x) it returns roots, maxima, minima, vertical asymptotes, the y-intercept, and intersections with the other visible curves. For a 3D surface z = f(x,y) it returns critical points classified as maximum, minimum or saddle from the sign of the Hessian determinant. Call this before you make a claim about where something crosses zero or turns around, and before annotate so the label lands exactly on the feature. Features outside the viewport are not found -- widen it with set_viewport if you expect more.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Expression id from list_expressions.' } },
      required: ['id'],
    },
    execute: async ({ id }: { id: string }) => findFeatures(id),
  },

  {
    name: 'annotate',
    description:
      'Pin a short text label to a specific point on the graph, with a leader line to the exact coordinate. Use it to make your reasoning persist on the artifact after you stop talking: mark the vertex, label the asymptote, name the saddle point. Get the coordinates from find_features or evaluate rather than eyeballing them. Keep the text to a few words -- long labels cover the curve.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number', description: '3D only: the surface height at (x, y).' },
        text: { type: 'string', description: 'A few words, e.g. "vertex (-1, -4)" or "saddle point".' },
      },
      required: ['x', 'y', 'text'],
    },
    execute: async ({ x, y, z, text }: { x: number; y: number; z?: number; text: string }) => graph.annotate({ x, y, z, text }),
  },

  {
    name: 'clear',
    description:
      'Wipe part of the board. what:"annotations" removes the pinned labels but keeps the curves -- use this between explanations so labels do not pile up. what:"all" resets expressions, sliders and annotations for a fresh topic. Ask the student before clearing work they created themselves.',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['all', 'annotations'], description: 'Defaults to "annotations".' },
      },
    },
    execute: async ({ what }: { what?: 'all' | 'annotations' } = {}) => {
      const result = what === 'all' ? graph.clearAll() : graph.clearAnnotations();
      return { ...result, ...summary() };
    },
  },

  {
    name: 'set_mode',
    description:
      'Switch the board between the 2D grapher and the 3D surface plotter. In 3D, equations beginning with x, y, or z render as surfaces solved for that axis. Switching does not delete anything, so you can move back and forth. Call this before plotting a surface, otherwise the student sees a blank 2D board.',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['2d', '3d'] } },
      required: ['mode'],
    },
    execute: async ({ mode }: { mode: BoardMode }) => {
      const result = graph.setMode(mode);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'load_preset',
    description:
      'Load a ready-made lesson set-up: expressions, slider ranges, viewport, camera and a teaching note, all in one call. Faster and less error-prone than building a standard scenario expression by expression. Call with no arguments to list what is available. The returned teaching_note tells you which parameter is worth animating and what the student should notice -- read it before you start explaining.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Preset key. Omit to list the available presets.',
          enum: Object.keys(PRESETS),
        },
      },
    },
    execute: async ({ name }: { name?: string } = {}) => {
      if (!name) return { ok: true, presets: presetNames(), note: 'Call again with one of these names.' };
      const preset = PRESETS[name];
      if (!preset) {
        return { ok: false, error: `Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}.` };
      }
      graph.clearAll();
      graph.setMode(preset.mode);
      graph.setViewport(preset.viewport);
      if (preset.camera) graph.setCamera(preset.camera);
      for (const slider of preset.sliders) graph.defineSlider(slider.name, slider);
      const ids = [];
      for (const latex of preset.expressions) {
        const r = graph.upsert(null, { latex });
        if (r.ok) ids.push(r.id);
      }
      // Slider ranges are reapplied because auto-creation during upsert uses
      // defaults for any parameter the preset did not declare.
      for (const slider of preset.sliders) graph.defineSlider(slider.name, slider);
      return {
        ok: true, preset: name, title: preset.title,
        teaching_note: preset.teaching_note,
        expression_ids: ids, ...summary(),
      };
    },
  },
] as const;

// Each executor has a schema-specific argument type above. WebMCP itself
// exposes a heterogeneous tool list, so erase only that argument distinction
// at the registration boundary.
export const TOOLS = toolDefinitions as unknown as WebMcpTool[];

/**
 * Register every tool with the browser's WebMCP host.
 *
 * The API surface differs slightly between builds, so we accept either host
 * object and either registration method rather than failing on the whole page.
 */
export function registerTools() {
  const host = document.modelContext ?? navigator.modelContext ?? null;
  if (!host) return { available: false, registered: 0, host: null };

  const hostName = document.modelContext ? 'document.modelContext' : 'navigator.modelContext';
  let registered = 0;

  if (typeof host.registerTool === 'function') {
    for (const tool of TOOLS) {
      try { host.registerTool(tool); registered++; }
      catch (err) { console.error(`[webmcp] failed to register ${tool.name}:`, err); }
    }
  } else if (typeof host.provideContext === 'function') {
    try { host.provideContext({ tools: TOOLS }); registered = TOOLS.length; }
    catch (err) { console.error('[webmcp] provideContext failed:', err); }
  } else {
    return { available: false, registered: 0, host: hostName, reason: 'no registerTool/provideContext method' };
  }

  return { available: true, registered, host: hostName };
}
