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
  unit: '' | 'V' | 'Ω';
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
  'battery', 'resistor', 'led', 'lamp', 'switch', 'ground',
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
export const BATTERY_INTERNAL_R = 0.5; // ohms, keeps a dead short finite

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
