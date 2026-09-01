// WebMCP surface for the circuit board. Every execute() routes into
// src/circuit/store.ts -- the same functions the palette and canvas use.
// Descriptions are written as instructions to a competent colleague, since the
// description is the only context the agent has when choosing a tool.

import * as circuit from './store';
import { CATALOG, COMPONENT_ORDER, LED_SPEC, pinNames } from './components';
import { loadPreset, presetNames, PRESETS } from './presets';
import { LED_COLORS } from './store';
import type { Component, WebMcpTool } from './types';

function reading(id: string): Record<string, unknown> | undefined {
  const res = circuit.getState().solution?.results[id];
  if (!res) return undefined;
  const out: Record<string, unknown> = {
    current_mA: +(res.current * 1000).toFixed(3),
    voltage_V: +res.voltage.toFixed(3),
  };
  if (res.lit !== undefined) out.lit = res.lit;
  if (res.brightness !== undefined) out.brightness = +res.brightness.toFixed(2);
  if (res.meter !== undefined) out.meter = +res.meter.toFixed(4);
  if (res.warning) out.warning = res.warning;
  return out;
}

function describe(c: Component): Record<string, unknown> {
  const entry = CATALOG[c.type];
  const out: Record<string, unknown> = {
    id: c.id,
    type: c.type,
    position: { x: c.x, y: c.y },
    rotation: c.rotation,
    pins: pinNames(c.type),
  };
  if (entry.unit) out.value = `${c.value}${entry.unit}`;
  if (c.type === 'switch') out.closed = c.closed;
  if (c.type === 'led') out.color = c.color;
  const r = reading(c.id);
  if (r) out.reading = r;
  return out;
}

function summary(): Record<string, unknown> {
  const s = circuit.getState();
  const sol = s.solution;
  return {
    components: s.components.map(describe),
    wires: s.wires.map((w) => ({ id: w.id, from: w.from, to: w.to })),
    has_ground: s.components.some((c) => c.type === 'ground'),
    warnings: sol?.warnings ?? [],
    running: s.running,
  };
}

const toolDefinitions = [
  {
    name: 'list_components',
    description:
      'Read the whole board: every component with its id, type, position, value, orientation and live reading (current in mA, voltage across it, and whether an LED or lamp is lit), plus every wire, whether a ground is present, and any warnings from the last solve. Call this first whenever you are unsure what is on the board, and after any change you did not make yourself. The ids returned here are what every other tool expects. Pin names are listed per component; wire them with connect using "id.pin" refs such as "r1.a" or "bat1.pos".',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, ...summary() }),
  },

  {
    name: 'list_component_types',
    description:
      'List the kinds of part you can add, with the pins each one has, the unit of its value, and a one-line description of what it does. Use this when deciding which component to place, or to remind yourself of a part\'s pin names before wiring it.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({
      ok: true,
      types: COMPONENT_ORDER.map((type) => {
        const e = CATALOG[type];
        return {
          type,
          title: e.title,
          pins: e.pins.map((p) => p.name),
          value_unit: e.unit || null,
          value_range: e.unit ? { min: e.valueMin, max: e.valueMax, default: e.defaultValue } : null,
          polar: e.polar,
          about: e.blurb,
        };
      }),
      led_colors: LED_COLORS.map((c) => ({ color: c, forward_voltage_V: LED_SPEC[c].vf })),
    }),
  },

  {
    name: 'add_component',
    description:
      'Place a new part on the board and wire nothing yet. type is one of battery, resistor, led, lamp, switch, ground. Give value in the part\'s unit (volts for a battery, ohms for a resistor or lamp; ignored for the others). Optionally set position x,y on the integer grid (parts are two units long, so space them at least two apart), a rotation of 0, 90, 180 or 270 degrees, and for an LED a color. Returns the new id and its pin names — wire them up with connect. If you omit x and y the part is auto-placed on a free grid slot.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: COMPONENT_ORDER, description: 'Which part to add.' },
        value: { type: 'number', description: 'Volts for a battery, ohms for a resistor or lamp.' },
        x: { type: 'number', description: 'Grid x (integer). Omit to auto-place.' },
        y: { type: 'number', description: 'Grid y (integer). Omit to auto-place.' },
        rotation: { type: 'number', enum: ['0', '90', '180', '270'], description: 'Orientation in degrees.' },
        color: { type: 'string', enum: LED_COLORS, description: 'LED colour (LED only).' },
      },
      required: ['type'],
    },
    execute: async (args: Record<string, unknown>) => {
      const type = String(args.type) as Component['type'];
      const rotation = args.rotation !== undefined ? (Number(args.rotation) as 0 | 90 | 180 | 270) : undefined;
      const result = circuit.addComponent(type, {
        value: args.value !== undefined ? Number(args.value) : undefined,
        x: args.x !== undefined ? Number(args.x) : undefined,
        y: args.y !== undefined ? Number(args.y) : undefined,
        rotation,
        color: args.color as Component['color'] | undefined,
      });
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'connect',
    description:
      'Run a wire between two pins so current can flow through them. Each pin is written "componentId.pin", e.g. connect("bat1.pos", "r1.a"). Wiring two pins puts them on the same electrical node — chain parts pin-to-pin to build a loop, and remember a circuit only works when it forms a complete loop back to the battery. Returns a parse-style error if a pin name is wrong, so read it and retry rather than reporting failure.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First pin, e.g. "bat1.pos".' },
        to: { type: 'string', description: 'Second pin, e.g. "r1.a".' },
      },
      required: ['from', 'to'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = circuit.connect(String(args.from), String(args.to));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'disconnect',
    description:
      'Remove the wire between two pins, written the same way as connect: disconnect("r1.b", "led1.anode"). Use this to break a connection without deleting either part.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['from', 'to'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = circuit.disconnect(String(args.from), String(args.to));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_value',
    description:
      'Change a component\'s value: resistance in ohms for a resistor or lamp, voltage in volts for a battery. The board re-solves immediately, so follow with read_measurements (or read the reading in the return) to see the effect. This is the main teaching lever — e.g. lower a series resistor and watch the LED current climb toward the overcurrent warning.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Component id from list_components.' },
        value: { type: 'number', description: 'New value in the component\'s unit.' },
      },
      required: ['id', 'value'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = circuit.setValue(String(args.id), Number(args.value));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'toggle_switch',
    description:
      'Open or close a switch. Pass closed:true or closed:false to set it directly, or omit closed to flip it. A closed switch behaves like a wire; an open one breaks the circuit. Great for showing cause and effect — close it and narrate the LED coming on.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Switch id.' },
        closed: { type: 'boolean', description: 'Desired state. Omit to toggle.' },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const closed = args.closed === undefined ? undefined : Boolean(args.closed);
      const result = circuit.toggleSwitch(String(args.id), closed);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_led_color',
    description:
      'Change an LED\'s colour, which also changes its forward voltage (red ≈ 1.8 V up to blue/white ≈ 3 V). Handy when a demonstration needs a specific colour, or to show why a blue LED needs more supply voltage than a red one to light.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'LED id.' },
        color: { type: 'string', enum: LED_COLORS },
      },
      required: ['id', 'color'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = circuit.setColor(String(args.id), args.color as Component['color']);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'configure',
    description:
      'Set a component-specific setting that is not its main value: the wiper position of a potentiometer (0 = fully toward pin a, 1 = fully toward pin b) or the frequency of an AC source in hertz. For example configure({id:"pot1", wiper:0.25}) taps off a quarter of the way, and configure({id:"ac1", frequency:2}) makes the AC source oscillate at 2 Hz. Pass only the field that applies to the part.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Component id.' },
        wiper: { type: 'number', description: 'Potentiometer wiper, 0 to 1.' },
        frequency: { type: 'number', description: 'AC source frequency in Hz.' },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const id = String(args.id);
      let result: { ok: boolean; error?: string } = { ok: false, error: 'Nothing to configure — pass wiper or frequency.' };
      if (args.wiper !== undefined) result = circuit.setWiper(id, Number(args.wiper));
      else if (args.frequency !== undefined) result = circuit.setFrequency(id, Number(args.frequency));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'rotate_component',
    description:
      'Rotate a part in 90-degree steps. Pass rotation as 0, 90, 180 or 270 to set it, or omit to turn it a quarter-turn clockwise. Rotating never changes the electrics, only how the part sits on the grid and where its pins land — useful for laying out a tidy loop.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        rotation: { type: 'number', enum: ['0', '90', '180', '270'] },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const rotation = args.rotation !== undefined ? (Number(args.rotation) as 0 | 90 | 180 | 270) : undefined;
      const result = circuit.rotateComponent(String(args.id), rotation);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'move_component',
    description:
      'Move a part to grid position x,y. Wires stay attached and follow the pins, so this only tidies the layout — it never changes the circuit. Parts are two grid units long; keep them at least two apart so their pins do not overlap.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['id', 'x', 'y'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = circuit.moveComponent(String(args.id), Number(args.x), Number(args.y));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'remove_component',
    description:
      'Delete a part and any wires attached to it. Ask the student before removing work they built themselves.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = circuit.removeComponent(String(args.id));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'read_measurements',
    description:
      'Return the full solved state: the voltage at every electrical node, and for every component its current (mA), the voltage across it, its power, and whether an LED or lamp is lit — plus any warnings such as overcurrent or an open circuit. Call this before making a numeric claim, so you state measured values instead of estimating them from the schematic.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const sol = circuit.resolve();
      if (!sol.ok) return { ok: false, error: sol.reason ?? 'The circuit could not be solved.', warnings: sol.warnings };
      const nodes = Object.entries(sol.nodeVoltage).map(([id, v]) => ({ node: Number(id), voltage_V: +v.toFixed(3) }));
      return {
        ok: true,
        nodes,
        components: circuit.getState().components.map((c) => ({ id: c.id, type: c.type, ...(reading(c.id) ?? {}) })),
        warnings: sol.warnings,
      };
    },
  },

  {
    name: 'measure',
    description:
      'Act like a multimeter: return the voltage between two pins, from minus to. measure("r1.a", "r1.b") gives the voltage across r1; measure against a ground pin gives a node voltage. Both pins must be on parts that exist. Use this to answer "what is the voltage here" precisely rather than reading it off the picture.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Pin to measure at, e.g. "r1.a".' },
        to: { type: 'string', description: 'Reference pin, e.g. "bat1.neg" or a ground pin.' },
      },
      required: ['from', 'to'],
    },
    execute: async (args: Record<string, unknown>) => {
      const sol = circuit.resolve();
      if (!sol.ok) return { ok: false, error: sol.reason ?? 'The circuit could not be solved.' };
      const from = String(args.from), to = String(args.to);
      if (!circuit.pinRefValid(from)) return { ok: false, error: `"${from}" is not a valid pin (use "id.pin").` };
      if (!circuit.pinRefValid(to)) return { ok: false, error: `"${to}" is not a valid pin (use "id.pin").` };
      const nFrom = sol.pinNode[from];
      const nTo = sol.pinNode[to];
      const v = (sol.nodeVoltage[nFrom] ?? 0) - (sol.nodeVoltage[nTo] ?? 0);
      return { ok: true, from, to, voltage_V: +v.toFixed(3) };
    },
  },

  {
    name: 'clear',
    description:
      'Wipe the board. what:"wires" removes every wire but keeps the parts where they are, so you can rewire without re-placing. what:"all" removes everything for a fresh start. Ask the student before clearing work they made themselves.',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['all', 'wires'], description: 'Defaults to "all".' },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const result = args.what === 'wires' ? circuit.clearWires() : circuit.clearAll();
      return { ...result, ...summary() };
    },
  },

  {
    name: 'reset_simulation',
    description:
      'Discharge every capacitor and restart the simulation from time zero. Use this before demonstrating an RC charging curve so the capacitor starts empty, or to replay a transient from the beginning. Has no effect on a purely resistive circuit.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const result = circuit.resetSimulation();
      return { ...result, ...summary() };
    },
  },

  {
    name: 'load_preset',
    description:
      'Load a ready-made starter circuit — parts, values and wiring in one call — instead of building a standard scenario piece by piece. Call with no arguments to list what is available. The returned note explains what the circuit shows and which value is worth changing, so read it before you start teaching.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: Object.keys(PRESETS), description: 'Preset key. Omit to list them.' },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      if (!args.name) return { ok: true, presets: presetNames(), note: 'Call again with one of these names.' };
      const result = loadPreset(String(args.name));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },
];

export const TOOLS = toolDefinitions as unknown as WebMcpTool[];

export function registerTools(): { available: boolean; registered: number; host: string | null; reason?: string } {
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
