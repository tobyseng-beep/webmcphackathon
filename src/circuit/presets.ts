// Starter circuits. A preset is just a sequence of store calls -- the same
// calls a student or an agent would make -- bundled so a whole scenario loads
// in one step. Each carries a teaching note the agent can read before it
// starts explaining.

import * as circuit from './store';
import type { LedColor, Rotation } from './types';

interface Placed { id: string; }

function place(
  type: Parameters<typeof circuit.addComponent>[0],
  x: number, y: number,
  extra: { rotation?: Rotation; value?: number; color?: LedColor } = {},
): Placed {
  const r = circuit.addComponent(type, { x, y, ...extra });
  if (!r.ok) throw new Error(r.error);
  return { id: r.id };
}

export interface Preset {
  title: string;
  note: string;
  build: () => void;
}

export const PRESETS: Record<string, Preset> = {
  led_basic: {
    title: 'LED with a series resistor',
    note: 'The textbook first circuit: a 9 V battery drives a red LED through a 330 Ω resistor. The resistor sets the current — about (9 − 2)/330 ≈ 21 mA — so the LED lights safely. Try lowering the resistor and watch the current (and the overcurrent warning) climb.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const res = place('resistor', 2, 1, { value: 330 });
      const led = place('led', 4, 2, { rotation: 90, color: 'red' });
      circuit.connect(`${bat.id}.pos`, `${res.id}.a`);
      circuit.connect(`${res.id}.b`, `${led.id}.anode`);
      circuit.connect(`${led.id}.cathode`, `${bat.id}.neg`);
    },
  },

  led_no_resistor: {
    title: 'LED with no resistor (why you need one)',
    note: 'The same LED straight across the battery with nothing to limit the current. The solver flags an overcurrent — this is what burns real LEDs out. Add a resistor in series to fix it.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const led = place('led', 3, 2, { rotation: 90, color: 'red' });
      circuit.connect(`${bat.id}.pos`, `${led.id}.anode`);
      circuit.connect(`${led.id}.cathode`, `${bat.id}.neg`);
    },
  },

  switch_led: {
    title: 'Switch controlling an LED',
    note: 'A switch in series with the resistor and LED. Toggle it (toggle_switch, or click it) to open and close the loop — closed lights the LED, open breaks the circuit and the current drops to zero.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const sw = place('switch', 2, 1, {});
      const res = place('resistor', 4, 1, { value: 330 });
      const led = place('led', 6, 2, { rotation: 90, color: 'green' });
      circuit.connect(`${bat.id}.pos`, `${sw.id}.a`);
      circuit.connect(`${sw.id}.b`, `${res.id}.a`);
      circuit.connect(`${res.id}.b`, `${led.id}.anode`);
      circuit.connect(`${led.id}.cathode`, `${bat.id}.neg`);
      circuit.toggleSwitch(sw.id, true);
    },
  },

  series_resistors: {
    title: 'Two resistors in series',
    note: 'A 1 kΩ and a 2 kΩ resistor in series across 9 V, with a ground at the bottom. The same current flows through both; the voltage splits in proportion to resistance, so the midpoint sits near 6 V. A good setup for measure() between the midpoint and ground.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const r1 = place('resistor', 2, 1, { value: 1000 });
      const r2 = place('resistor', 4, 2, { rotation: 90, value: 2000 });
      const gnd = place('ground', 0, 5, {});
      circuit.connect(`${bat.id}.pos`, `${r1.id}.a`);
      circuit.connect(`${r1.id}.b`, `${r2.id}.a`);
      circuit.connect(`${r2.id}.b`, `${bat.id}.neg`);
      circuit.connect(`${bat.id}.neg`, `${gnd.id}.gnd`);
    },
  },

  parallel_resistors: {
    title: 'Two resistors in parallel',
    note: 'A 1 kΩ and a 470 Ω resistor side by side across the battery. Each sees the full 9 V, so the smaller resistor carries more current. The battery current is the sum of the two branch currents.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const r1 = place('resistor', 3, 1, { rotation: 90, value: 1000 });
      const r2 = place('resistor', 5, 1, { rotation: 90, value: 470 });
      circuit.connect(`${bat.id}.pos`, `${r1.id}.a`);
      circuit.connect(`${r1.id}.a`, `${r2.id}.a`);
      circuit.connect(`${r1.id}.b`, `${bat.id}.neg`);
      circuit.connect(`${r2.id}.b`, `${bat.id}.neg`);
    },
  },

  voltage_divider: {
    title: 'Voltage divider driving a lamp',
    note: 'Two resistors divide the 9 V down, and a lamp hangs off the midpoint to ground. Change the ratio of the resistors and watch the lamp brighten or dim as the tap voltage moves.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const r1 = place('resistor', 2, 1, { value: 1000 });
      const r2 = place('resistor', 4, 2, { rotation: 90, value: 1000 });
      const lamp = place('lamp', 6, 2, { rotation: 90, value: 300 });
      const gnd = place('ground', 0, 5, {});
      circuit.connect(`${bat.id}.pos`, `${r1.id}.a`);
      circuit.connect(`${r1.id}.b`, `${r2.id}.a`);
      circuit.connect(`${r1.id}.b`, `${lamp.id}.a`);
      circuit.connect(`${r2.id}.b`, `${bat.id}.neg`);
      circuit.connect(`${lamp.id}.b`, `${bat.id}.neg`);
      circuit.connect(`${bat.id}.neg`, `${gnd.id}.gnd`);
    },
  },

  traffic_lights: {
    title: 'Three LEDs in parallel',
    note: 'Red, yellow and green LEDs, each with its own series resistor, all fed from one battery. Because each LED has its own resistor they light independently — a nice contrast with putting LEDs in series, where one gap stops them all.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 3, { rotation: 90, value: 9 });
      const colors: LedColor[] = ['red', 'yellow', 'green'];
      colors.forEach((color, i) => {
        const x = 3 + i * 2;
        const res = place('resistor', x, 1, { rotation: 90, value: 330 });
        const led = place('led', x, 4, { rotation: 90, color });
        circuit.connect(`${bat.id}.pos`, `${res.id}.a`);
        circuit.connect(`${res.id}.b`, `${led.id}.anode`);
        circuit.connect(`${led.id}.cathode`, `${bat.id}.neg`);
      });
    },
  },
  rc_charging: {
    title: 'RC charging curve',
    note: 'A capacitor charging through a resistor from a 9 V supply, gated by a switch. Reset the simulation, then close the switch and watch the capacitor voltage rise toward 9 V along the classic exponential curve. The time constant is R×C — here 10 kΩ × 100 µF = 1 second, so it is about 63% charged after 1 s and nearly full after 5 s. Change R or C to make it charge faster or slower.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const sw = place('switch', 2, 1, {});
      const res = place('resistor', 4, 1, { value: 10000 });
      const cap = place('capacitor', 6, 2, { rotation: 90, value: 100 });
      const gnd = place('ground', 0, 5, {});
      circuit.connect(`${bat.id}.pos`, `${sw.id}.a`);
      circuit.connect(`${sw.id}.b`, `${res.id}.a`);
      circuit.connect(`${res.id}.b`, `${cap.id}.a`);
      circuit.connect(`${cap.id}.b`, `${bat.id}.neg`);
      circuit.connect(`${bat.id}.neg`, `${gnd.id}.gnd`);
      circuit.toggleSwitch(sw.id, true);
    },
  },

  diode_protection: {
    title: 'Diode blocks reverse current',
    note: 'A diode in series with an LED and resistor. With the battery this way round the diode conducts (about 0.7 V across it) and the LED lights. Flip the battery voltage negative, or reverse the diode, and it blocks — nothing lights. This is how a diode protects a circuit from reversed power.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const d = place('diode', 2, 1, {});
      const res = place('resistor', 4, 1, { value: 330 });
      const led = place('led', 6, 2, { rotation: 90, color: 'blue' });
      circuit.connect(`${bat.id}.pos`, `${d.id}.anode`);
      circuit.connect(`${d.id}.cathode`, `${res.id}.a`);
      circuit.connect(`${res.id}.b`, `${led.id}.anode`);
      circuit.connect(`${led.id}.cathode`, `${bat.id}.neg`);
    },
  },

  pot_dimmer: {
    title: 'Potentiometer LED dimmer',
    note: 'A potentiometer feeding an LED through a resistor. Slide the wiper (configure with a wiper from 0 to 1, or drag the slider) and the LED brightens and dims as the tapped voltage changes. This is exactly how a real dimmer knob works.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const pot = place('potentiometer', 3, 1, { value: 10000 });
      const res = place('resistor', 5, 1, { value: 330 });
      const led = place('led', 7, 2, { rotation: 90, color: 'red' });
      const gnd = place('ground', 0, 5, {});
      circuit.connect(`${bat.id}.pos`, `${pot.id}.a`);
      circuit.connect(`${pot.id}.b`, `${bat.id}.neg`);
      circuit.connect(`${pot.id}.wiper`, `${res.id}.a`);
      circuit.connect(`${res.id}.b`, `${led.id}.anode`);
      circuit.connect(`${led.id}.cathode`, `${bat.id}.neg`);
      circuit.connect(`${bat.id}.neg`, `${gnd.id}.gnd`);
      circuit.setWiper(pot.id, 0.7);
    },
  },

  rl_circuit: {
    title: 'RL current ramp',
    note: 'An inductor charging through a resistor, gated by a switch. Reset the simulation, then close the switch: the inductor resists the sudden change, so the current starts at zero and ramps up along an exponential curve toward its final value (V/R). The time constant is L/R.',
    build: () => {
      circuit.clearAll();
      const bat = place('battery', 0, 2, { rotation: 90, value: 9 });
      const sw = place('switch', 2, 1, {});
      const res = place('resistor', 4, 1, { value: 100 });
      const ind = place('inductor', 6, 2, { rotation: 90, value: 2000 });
      const gnd = place('ground', 0, 5, {});
      circuit.connect(`${bat.id}.pos`, `${sw.id}.a`);
      circuit.connect(`${sw.id}.b`, `${res.id}.a`);
      circuit.connect(`${res.id}.b`, `${ind.id}.a`);
      circuit.connect(`${ind.id}.b`, `${bat.id}.neg`);
      circuit.connect(`${bat.id}.neg`, `${gnd.id}.gnd`);
      circuit.toggleSwitch(sw.id, true);
    },
  },

  ac_demo: {
    title: 'AC source with a meter',
    note: 'A sine-wave source driving a resistor, with a voltmeter across it and an ammeter in series. Keep the simulation running and watch the readings swing positive and negative each cycle. Raise the frequency with configure to speed it up.',
    build: () => {
      circuit.clearAll();
      const ac = place('acsource', 0, 2, { rotation: 90, value: 5 });
      const am = place('ammeter', 2, 1, {});
      const res = place('resistor', 4, 1, { value: 1000 });
      const vm = place('voltmeter', 4, 4, { rotation: 90 });
      const gnd = place('ground', 0, 5, {});
      circuit.connect(`${ac.id}.pos`, `${am.id}.a`);
      circuit.connect(`${am.id}.b`, `${res.id}.a`);
      circuit.connect(`${res.id}.b`, `${ac.id}.neg`);
      circuit.connect(`${res.id}.a`, `${vm.id}.a`);
      circuit.connect(`${res.id}.b`, `${vm.id}.b`);
      circuit.connect(`${ac.id}.neg`, `${gnd.id}.gnd`);
    },
  },

};

export function presetNames(): { name: string; title: string }[] {
  return Object.entries(PRESETS).map(([name, p]) => ({ name, title: p.title }));
}

export function loadPreset(name: string): { ok: boolean; error?: string; note?: string; title?: string } {
  const preset = PRESETS[name];
  if (!preset) return { ok: false, error: `Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}.` };
  circuit.beginBatch();
  try { preset.build(); } finally { circuit.endBatch(); }
  return { ok: true, note: preset.note, title: preset.title };
}
