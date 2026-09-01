// Component catalogue: electrical parameters, pin geometry, and the schematic
// symbol for each part. Rendering reads from here; the store reads pin
// positions from here so the solver and the picture always agree on where a
// terminal is.

import type { Component, ComponentType, LedColor, PinDef, Rotation, Vec2 } from './types';

export interface CatalogEntry {
  type: ComponentType;
  title: string;
  blurb: string; // shown in the palette tooltip and returned to the agent
  pins: PinDef[];
  defaultValue: number; // volts or ohms; 0 where unused
  unit: '' | 'V' | 'Ω' | 'µF' | 'mH' | 'mA' | 'A';
  valueMin: number;
  valueMax: number;
  polar: boolean; // does pin order matter electrically?
}

// Two-terminal parts sit horizontally by default: pin 0 on the left at (-1,0),
// pin 1 on the right at (+1,0). Ground is the only one-terminal part.
const HORIZONTAL: PinDef[] = [
  { name: 'a', dx: -1, dy: 0 },
  { name: 'b', dx: 1, dy: 0 },
];

export const CATALOG: Record<ComponentType, CatalogEntry> = {
  battery: {
    type: 'battery',
    title: 'Battery',
    blurb: 'A DC voltage source. "pos" is the + terminal, "neg" is the −. Set its value in volts. Has a little internal resistance, so a dead short draws a large but finite current instead of infinity.',
    pins: [
      { name: 'pos', dx: -1, dy: 0 },
      { name: 'neg', dx: 1, dy: 0 },
    ],
    defaultValue: 9,
    unit: 'V',
    valueMin: 0,
    valueMax: 24,
    polar: true,
  },
  resistor: {
    type: 'resistor',
    title: 'Resistor',
    blurb: 'Limits current. Set its value in ohms. Not polar, so either pin can face either way.',
    pins: HORIZONTAL,
    defaultValue: 220,
    unit: 'Ω',
    valueMin: 1,
    valueMax: 1_000_000,
    polar: false,
  },
  led: {
    type: 'led',
    title: 'LED',
    blurb: 'Lights up when current flows from "anode" to "cathode" and the voltage across it reaches its forward drop (colour-dependent). Blocks current the other way. Almost always needs a series resistor — without one it draws too much current and is flagged as burning out.',
    pins: [
      { name: 'anode', dx: -1, dy: 0 },
      { name: 'cathode', dx: 1, dy: 0 },
    ],
    defaultValue: 0,
    unit: '',
    valueMin: 0,
    valueMax: 0,
    polar: true,
  },
  lamp: {
    type: 'lamp',
    title: 'Lamp',
    blurb: 'A small incandescent bulb — really just a resistor that glows with the power through it. Set its value in ohms. Not polar, and unlike an LED it does not care about direction.',
    pins: HORIZONTAL,
    defaultValue: 100,
    unit: 'Ω',
    valueMin: 1,
    valueMax: 100_000,
    polar: false,
  },
  switch: {
    type: 'switch',
    title: 'Switch',
    blurb: 'Opens or closes the circuit. Closed acts like a wire; open breaks the connection. Toggle it with toggle_switch or by clicking it.',
    pins: HORIZONTAL,
    defaultValue: 0,
    unit: '',
    valueMin: 0,
    valueMax: 0,
    polar: false,
  },
  capacitor: {
    type: 'capacitor',
    title: 'Capacitor',
    blurb: 'Stores charge. Set its value in microfarads. It blocks steady direct current but passes the surge while it charges, so it acts like a wire the instant power is applied and like an open circuit once full. Pair it with a resistor to watch the classic RC charging curve build up over time.',
    pins: HORIZONTAL,
    defaultValue: 100,
    unit: 'µF',
    valueMin: 0.1,
    valueMax: 10000,
    polar: false,
  },
  diode: {
    type: 'diode',
    title: 'Diode',
    blurb: 'A one-way valve for current. It conducts from anode to cathode once about 0.7 V is across it, and blocks the other way. Unlike an LED it gives off no light; use it to protect a circuit or to rectify. It is polar, so the direction matters.',
    pins: [
      { name: 'anode', dx: -1, dy: 0 },
      { name: 'cathode', dx: 1, dy: 0 },
    ],
    defaultValue: 0,
    unit: '',
    valueMin: 0,
    valueMax: 0,
    polar: true,
  },
  inductor: {
    type: 'inductor',
    title: 'Inductor',
    blurb: 'Stores energy in a magnetic field and resists sudden changes in current. Set its value in millihenries. It acts like an open circuit the instant power is applied, then ramps up to a full short as its current builds along an exponential curve. Pair it with a resistor to see the RL curve.',
    pins: HORIZONTAL,
    defaultValue: 100,
    unit: 'mH',
    valueMin: 1,
    valueMax: 10000,
    polar: false,
  },
  potentiometer: {
    type: 'potentiometer',
    title: 'Potentiometer',
    blurb: 'A variable resistor with three pins: two ends ("a" and "b") and a "wiper" that taps off a point in between. Set its total resistance in ohms and slide the wiper from 0 to 1 to divide the voltage. This is the knob behind volume controls and LED dimmers.',
    pins: [
      { name: 'a', dx: -1, dy: 0 },
      { name: 'b', dx: 1, dy: 0 },
      { name: 'wiper', dx: 0, dy: -1 },
    ],
    defaultValue: 10000,
    unit: 'Ω',
    valueMin: 100,
    valueMax: 1000000,
    polar: false,
  },
  currentsource: {
    type: 'currentsource',
    title: 'Current source',
    blurb: 'Pushes a fixed current out of its "pos" terminal no matter what, the current-driven counterpart of a battery. Set its value in milliamps. Always give it a path to flow through — an open current source drives its voltage sky-high.',
    pins: [
      { name: 'pos', dx: -1, dy: 0 },
      { name: 'neg', dx: 1, dy: 0 },
    ],
    defaultValue: 10,
    unit: 'mA',
    valueMin: 0,
    valueMax: 1000,
    polar: true,
  },
  acsource: {
    type: 'acsource',
    title: 'AC source',
    blurb: 'An alternating voltage source whose output swings as a sine wave. Set its peak amplitude in volts; its frequency in hertz is a separate setting. The simulation must be running to see it oscillate — watch the current reverse direction each half cycle, especially through a capacitor or inductor.',
    pins: [
      { name: 'pos', dx: -1, dy: 0 },
      { name: 'neg', dx: 1, dy: 0 },
    ],
    defaultValue: 5,
    unit: 'V',
    valueMin: 0,
    valueMax: 24,
    polar: true,
  },
  fuse: {
    type: 'fuse',
    title: 'Fuse',
    blurb: 'A safety part that behaves like a wire until the current through it exceeds its rating, then blows open permanently to protect the rest of the circuit. Set its rating in amps. Reset the simulation to restore a blown fuse.',
    pins: HORIZONTAL,
    defaultValue: 1,
    unit: 'A',
    valueMin: 0.1,
    valueMax: 20,
    polar: false,
  },
  voltmeter: {
    type: 'voltmeter',
    title: 'Voltmeter',
    blurb: 'Measures the voltage between its two pins without disturbing the circuit (it draws essentially no current). Wire it in parallel with whatever you want to measure across.',
    pins: HORIZONTAL,
    defaultValue: 0,
    unit: '',
    valueMin: 0,
    valueMax: 0,
    polar: false,
  },
  ammeter: {
    type: 'ammeter',
    title: 'Ammeter',
    blurb: 'Measures the current flowing through it, acting like a plain wire otherwise. Wire it in series, in the path whose current you want to read.',
    pins: HORIZONTAL,
    defaultValue: 0,
    unit: '',
    valueMin: 0,
    valueMax: 0,
    polar: false,
  },
  motor: {
    type: 'motor',
    title: 'Motor',
    blurb: 'A small DC motor, modelled as a resistive load that spins when current flows through it. Set its resistance in ohms — lower means more current and faster spin. Not polar; reversing it would just spin it the other way.',
    pins: HORIZONTAL,
    defaultValue: 50,
    unit: 'Ω',
    valueMin: 1,
    valueMax: 10000,
    polar: false,
  },
  buzzer: {
    type: 'buzzer',
    title: 'Buzzer',
    blurb: 'A piezo buzzer, modelled as a resistive load that sounds when current flows. Set its resistance in ohms. Handy as an audible "is current flowing?" indicator.',
    pins: HORIZONTAL,
    defaultValue: 100,
    unit: 'Ω',
    valueMin: 1,
    valueMax: 10000,
    polar: false,
  },
  ground: {
    type: 'ground',
    title: 'Ground',
    blurb: 'The 0 V reference. Every voltage the simulator reports is measured relative to ground. A circuit does not strictly need one, but adding one makes the node voltages meaningful.',
    pins: [{ name: 'gnd', dx: 0, dy: -1 }],
    defaultValue: 0,
    unit: '',
    valueMin: 0,
    valueMax: 0,
    polar: false,
  },
};

export const COMPONENT_ORDER: ComponentType[] = [
  'battery', 'resistor', 'led', 'lamp', 'switch',
  'capacitor', 'inductor', 'diode', 'potentiometer', 'currentsource',
  'acsource', 'fuse', 'voltmeter', 'ammeter', 'motor', 'buzzer', 'ground',
];

// Forward voltage and on-resistance per LED colour. These set where the LED
// "turns on" and how steeply current rises after it does.
export const LED_SPEC: Record<LedColor, { vf: number; ron: number; hex: string }> = {
  red: { vf: 1.8, ron: 12, hex: '#ef4444' },
  yellow: { vf: 2.0, ron: 12, hex: '#f59e0b' },
  green: { vf: 2.1, ron: 14, hex: '#22c55e' },
  blue: { vf: 2.9, ron: 16, hex: '#3b82f6' },
  white: { vf: 3.0, ron: 16, hex: '#e5e7eb' },
};

export const LED_ON_CURRENT = 0.001; // amps at which a glow becomes visible
export const LED_FULL_CURRENT = 0.018; // amps for full brightness
export const LED_WARN_CURRENT = 0.03; // amps above which we warn
export const LED_BURN_CURRENT = 0.06; // amps we call "burning out"
export const BATTERY_INTERNAL_R = 0.05; // ohms; keeps a dead short finite while terminals read close to nominal
export const DIODE_VF = 0.7; // silicon forward drop
export const DIODE_RON = 5; // on-resistance
export const DIODE_WARN_CURRENT = 1.0; // amps
export const VOLTMETER_R = 1e9; // effectively open
export const AMMETER_R = 1e-3; // effectively a wire
export const FUSE_R = 1e-3; // intact fuse
export const MOTOR_MIN_POWER = 0.02; // watts to visibly spin
export const BUZZER_MIN_POWER = 0.02; // watts to sound

function rotate(dx: number, dy: number, rotation: Rotation): Vec2 {
  switch (rotation) {
    case 90: return { x: -dy, y: dx };
    case 180: return { x: -dx, y: -dy };
    case 270: return { x: dy, y: -dx };
    default: return { x: dx, y: dy };
  }
}

/** World-grid position of one pin, accounting for the component's rotation. */
export function pinPosition(component: Component, pinName: string): Vec2 {
  const entry = CATALOG[component.type];
  const pin = entry.pins.find((p) => p.name === pinName) ?? entry.pins[0];
  const r = rotate(pin.dx, pin.dy, component.rotation);
  return { x: component.x + r.x, y: component.y + r.y };
}

export function pinNames(type: ComponentType): string[] {
  return CATALOG[type].pins.map((p) => p.name);
}

/** All pin refs ("id.pin") for a component. */
export function pinRefs(component: Component): string[] {
  return CATALOG[component.type].pins.map((p) => `${component.id}.${p.name}`);
}
