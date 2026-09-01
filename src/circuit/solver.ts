// DC circuit solver. Modified Nodal Analysis over the electrical nodes formed
// by wiring pins together. Resistors and lamps are linear; LEDs are diodes
// solved with a piecewise-linear model iterated to a consistent on/off state.
// The whole thing is sized for beginner circuits: a handful of parts, DC only.

import type { Component, ElementResult, Solution, Wire } from './types';
import {
  AMMETER_R,
  BATTERY_INTERNAL_R,
  BUZZER_MIN_POWER,
  DIODE_RON,
  DIODE_VF,
  DIODE_WARN_CURRENT,
  FUSE_R,
  LED_BURN_CURRENT,
  LED_FULL_CURRENT,
  LED_ON_CURRENT,
  LED_SPEC,
  LED_WARN_CURRENT,
  MOTOR_MIN_POWER,
  VOLTMETER_R,
  pinNames,
} from './components';

const GMIN = 1e-9; // ties every node weakly to reference so nothing floats
const R_SWITCH_CLOSED = 1e-3;
const R_OPEN = 1e12;
const LED_ROFF = 1e8;
const DIODE_ROFF = 1e8;
const CAP_SNAP_G = 1e5; // stiff conductance pinning a capacitor to its held voltage for a snapshot

// ---- union-find over pin refs ----

class DisjointSet {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (this.parent.get(x) === undefined) { this.parent.set(x, x); return x; }
    let root = x;
    let p = this.parent.get(root);
    while (p !== undefined && p !== root) { root = p; p = this.parent.get(root); }
    // path compression
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
}

// ---- dense linear solve (Gaussian elimination, partial pivot) ----

function solveLinear(A: number[][], z: number[]): number[] | null {
  const n = z.length;
  if (n === 0) return [];
  // augment
  const m = A.map((row, i) => [...row, z[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r][col]);
      if (v > best) { best = v; pivot = r; }
    }
    if (best < 1e-14) return null; // singular
    if (pivot !== col) { const tmp = m[col]; m[col] = m[pivot]; m[pivot] = tmp; }

    const diag = m[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = m[i][n] / m[i][i];
  return x;
}

function ref(compId: string, pin: string): string { return `${compId}.${pin}`; }

interface SolveOpts {
  dt?: number; // seconds; > 0 advances reactive parts one transient step, 0/undefined snapshots
  capVoltage?: Record<string, number>; // held capacitor voltages entering this solve
  indCurrent?: Record<string, number>; // held inductor currents entering this solve
  time?: number; // absolute sim time, for AC sources
}

export function solve(components: Component[], wires: Wire[], opts: SolveOpts = {}): Solution {
  const priorCap = opts.capVoltage ?? {};
  const priorInd = opts.indCurrent ?? {};
  const time = opts.time ?? 0;
  const dt = opts.dt ?? 0;
  const empty: Solution = {
    ok: false, nodeVoltage: {}, pinNode: {}, results: {}, capVoltage: {}, indCurrent: {}, warnings: [],
  };
  if (components.length === 0) return { ...empty, ok: true };

  const ds = new DisjointSet();

  // Every pin is a node; wires and grounds merge them.
  const pinRefsByComp = new Map<string, string[]>();
  for (const c of components) {
    const pins = pinNames(c.type);
    const refs = pins.map((p) => ref(c.id, p));
    refs.forEach((r) => ds.add(r));
    pinRefsByComp.set(c.id, refs);
  }
  for (const w of wires) { ds.add(w.from); ds.add(w.to); ds.union(w.from, w.to); }

  // Merge all ground pins together so there is a single reference node.
  const grounds = components.filter((c) => c.type === 'ground').map((c) => ref(c.id, 'gnd'));
  for (let i = 1; i < grounds.length; i++) ds.union(grounds[0], grounds[i]);

  // Map union-find roots to small integer node ids.
  const rootToNode = new Map<string, number>();
  const pinNode: Record<string, number> = {};
  let nextNode = 0;
  const nodeOf = (r: string): number => {
    const root = ds.find(r);
    let id = rootToNode.get(root);
    if (id === undefined) { id = nextNode++; rootToNode.set(root, id); }
    return id;
  };
  for (const refs of pinRefsByComp.values()) {
    for (const r of refs) pinNode[r] = nodeOf(r);
  }

  // Reference node: a ground if present, else a battery's negative, else 0.
  let referenceNode: number;
  if (grounds.length > 0) referenceNode = nodeOf(grounds[0]);
  else {
    const firstSource = components.find((c) => c.type === 'battery' || c.type === 'acsource');
    referenceNode = firstSource ? pinNode[ref(firstSource.id, 'neg')] : 0;
  }

  // Assign matrix rows to every non-reference node.
  const nodeRow = new Map<number, number>();
  let rows = 0;
  for (let id = 0; id < nextNode; id++) {
    if (id === referenceNode) continue;
    nodeRow.set(id, rows++);
  }
  const rowOf = (nodeId: number): number => (nodeId === referenceNode ? -1 : nodeRow.get(nodeId)!);

  // Batteries need an internal node (for series resistance) and a current unknown.
  const emfOf = (c: Component): number =>
    c.type === 'acsource' ? c.value * Math.sin(2 * Math.PI * (c.freq || 1) * time) : c.value;
  const vsources = components.filter((c) => c.type === 'battery' || c.type === 'acsource');
  const internalRow = new Map<string, number>();
  for (const b of vsources) internalRow.set(b.id, rows++);
  const sourceCol = new Map<string, number>();
  let sourceCount = 0;
  for (const b of vsources) sourceCol.set(b.id, rows + sourceCount++);
  const N = rows + sourceCount;

  const diodes = components.filter((c) => c.type === 'led' || c.type === 'diode');
  const diodeState = new Map<string, boolean>(); // true = conducting
  for (const d of diodes) diodeState.set(d.id, false);
  const diodeSpec = (c: Component): { vf: number; ron: number } =>
    c.type === 'led' ? { vf: LED_SPEC[c.color].vf, ron: LED_SPEC[c.color].ron } : { vf: DIODE_VF, ron: DIODE_RON };

  const nodeVoltageFor = (x: number[], nodeId: number): number => {
    const r = rowOf(nodeId);
    return r === -1 ? 0 : x[r];
  };

  let solution: number[] | null = null;

  const build = (): { A: number[][]; z: number[] } => {
    const A: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
    const z = new Array<number>(N).fill(0);

    const stampR = (ra: number, rb: number, g: number): void => {
      if (ra >= 0) A[ra][ra] += g;
      if (rb >= 0) A[rb][rb] += g;
      if (ra >= 0 && rb >= 0) { A[ra][rb] -= g; A[rb][ra] -= g; }
    };

    // weak tie to reference
    for (let r = 0; r < rows; r++) A[r][r] += GMIN;

    for (const c of components) {
      if (c.type === 'resistor' || c.type === 'lamp' || c.type === 'motor' || c.type === 'buzzer') {
        const R = Math.max(1e-6, c.value);
        const [pa, pb] = pinRefsByComp.get(c.id)!;
        stampR(rowOf(pinNode[pa]), rowOf(pinNode[pb]), 1 / R);
      } else if (c.type === 'switch' || c.type === 'fuse' || c.type === 'voltmeter' || c.type === 'ammeter') {
        const R = c.type === 'switch' ? (c.closed ? R_SWITCH_CLOSED : R_OPEN)
          : c.type === 'fuse' ? (c.blown ? R_OPEN : FUSE_R)
          : c.type === 'voltmeter' ? VOLTMETER_R
          : AMMETER_R;
        const [pa, pb] = pinRefsByComp.get(c.id)!;
        stampR(rowOf(pinNode[pa]), rowOf(pinNode[pb]), 1 / R);
      } else if (c.type === 'potentiometer') {
        const R = Math.max(1e-6, c.value);
        const w = Math.min(1, Math.max(0, c.wiper));
        const ra = rowOf(pinNode[ref(c.id, 'a')]);
        const rb = rowOf(pinNode[ref(c.id, 'b')]);
        const rw = rowOf(pinNode[ref(c.id, 'wiper')]);
        stampR(ra, rw, 1 / Math.max(1e-3, R * w));
        stampR(rw, rb, 1 / Math.max(1e-3, R * (1 - w)));
      } else if (c.type === 'currentsource') {
        const I = c.value * 1e-3; // mA -> A, flows out of pos into the circuit
        const rp = rowOf(pinNode[ref(c.id, 'pos')]);
        const rn = rowOf(pinNode[ref(c.id, 'neg')]);
        if (rp >= 0) z[rp] += I;
        if (rn >= 0) z[rn] -= I;
      } else if (c.type === 'inductor') {
        const L = Math.max(1e-9, c.value * 1e-3); // mH -> H
        const [pa, pb] = pinRefsByComp.get(c.id)!;
        const ra = rowOf(pinNode[pa]);
        const rb = rowOf(pinNode[pb]);
        const iprev = priorInd[c.id] ?? 0;
        if (dt > 0) {
          // backward Euler: i = (dt/L)(Va-Vb) + iprev
          const geq = dt / L;
          stampR(ra, rb, geq);
          if (ra >= 0) z[ra] -= iprev;
          if (rb >= 0) z[rb] += iprev;
        } else {
          // snapshot: holds its current, i.e. a current source of iprev (open at t=0)
          if (ra >= 0) z[ra] -= iprev;
          if (rb >= 0) z[rb] += iprev;
        }
      } else if (c.type === 'led' || c.type === 'diode') {
        const spec = diodeSpec(c);
        const on = diodeState.get(c.id)!;
        const anode = rowOf(pinNode[ref(c.id, 'anode')]);
        const cathode = rowOf(pinNode[ref(c.id, 'cathode')]);
        if (on) {
          const g = 1 / spec.ron;
          stampR(anode, cathode, g);
          if (anode >= 0) z[anode] += g * spec.vf;
          if (cathode >= 0) z[cathode] -= g * spec.vf;
        } else {
          stampR(anode, cathode, 1 / (c.type === 'led' ? LED_ROFF : DIODE_ROFF));
        }
      } else if (c.type === 'capacitor') {
        const cap = Math.max(1e-12, c.value * 1e-6); // µF -> F
        const [pa, pb] = pinRefsByComp.get(c.id)!;
        const ra = rowOf(pinNode[pa]);
        const rb = rowOf(pinNode[pb]);
        const vprev = priorCap[c.id] ?? 0;
        // dt > 0: backward-Euler companion (conductance C/dt + current source).
        // dt == 0: snapshot pinned to the held voltage with a stiff conductance.
        const geq = dt > 0 ? cap / dt : CAP_SNAP_G;
        stampR(ra, rb, geq);
        if (ra >= 0) z[ra] += geq * vprev;
        if (rb >= 0) z[rb] -= geq * vprev;
      } else if (c.type === 'battery' || c.type === 'acsource') {
        const pPos = rowOf(pinNode[ref(c.id, 'pos')]);
        const pNeg = rowOf(pinNode[ref(c.id, 'neg')]);
        const xRow = internalRow.get(c.id)!;
        const col = sourceCol.get(c.id)!;
        // Rint between pos and internal node
        stampR(pPos, xRow, 1 / BATTERY_INTERNAL_R);
        // ideal source between internal (+) and neg (−), emf per source type
        A[xRow][col] += 1;
        if (pNeg >= 0) A[pNeg][col] -= 1;
        A[col][xRow] += 1;
        if (pNeg >= 0) A[col][pNeg] -= 1;
        z[col] += emfOf(c);
      }
    }
    return { A, z };
  };

  // Iterate the diode states to consistency.
  const maxIter = 200;
  let iter = 0;
  for (; iter < maxIter; iter++) {
    const { A, z } = build();
    solution = solveLinear(A, z);
    if (!solution) break;

    let changed = false;
    for (const d of diodes) {
      const spec = diodeSpec(d);
      const va = nodeVoltageFor(solution, pinNode[ref(d.id, 'anode')]);
      const vc = nodeVoltageFor(solution, pinNode[ref(d.id, 'cathode')]);
      const vac = va - vc;
      const on = diodeState.get(d.id)!;
      if (!on && vac >= spec.vf) { diodeState.set(d.id, true); changed = true; }
      else if (on) {
        const i = (vac - spec.vf) / spec.ron;
        if (i < 0) { diodeState.set(d.id, false); changed = true; }
      }
    }
    if (!changed) break;
  }

  if (!solution) {
    return {
      ...empty,
      ok: false,
      reason: 'The circuit could not be solved (it may contain a short across a source with no resistance).',
      pinNode,
      capVoltage: priorCap,
      indCurrent: priorInd,
      warnings: ['Could not solve the circuit — check for a battery shorted directly across itself.'],
    };
  }

  const x = solution;
  const nodeVoltage: Record<number, number> = {};
  for (let id = 0; id < nextNode; id++) nodeVoltage[id] = nodeVoltageFor(x, id);

  const results: Record<string, ElementResult> = {};
  const capVoltageOut: Record<string, number> = {};
  const indCurrentOut: Record<string, number> = {};
  const warnings: string[] = [];

  for (const c of components) {
    if (c.type === 'ground') {
      results[c.id] = { current: 0, voltage: 0, power: 0 };
      continue;
    }
    if (['resistor', 'lamp', 'switch', 'motor', 'buzzer', 'fuse', 'voltmeter', 'ammeter'].includes(c.type)) {
      const [pa, pb] = pinRefsByComp.get(c.id)!;
      const va = nodeVoltage[pinNode[pa]];
      const vb = nodeVoltage[pinNode[pb]];
      const v = va - vb;
      const R = c.type === 'switch' ? (c.closed ? R_SWITCH_CLOSED : R_OPEN)
        : c.type === 'fuse' ? (c.blown ? R_OPEN : FUSE_R)
        : c.type === 'voltmeter' ? VOLTMETER_R
        : c.type === 'ammeter' ? AMMETER_R
        : Math.max(1e-6, c.value);
      const i = v / R;
      const power = i * i * R;
      const res: ElementResult = { current: i, voltage: v, power };
      if (c.type === 'lamp') {
        const rated = c.value > 0 ? (12 * 12) / c.value : 1; // ~12 V rating
        res.brightness = Math.max(0, Math.min(1, power / Math.max(0.05, rated)));
        res.lit = res.brightness > 0.03;
      } else if (c.type === 'motor') {
        res.lit = power > MOTOR_MIN_POWER;
        res.brightness = Math.max(0, Math.min(1, power / 0.5));
      } else if (c.type === 'buzzer') {
        res.lit = power > BUZZER_MIN_POWER;
        res.brightness = Math.max(0, Math.min(1, power / 0.5));
      } else if (c.type === 'voltmeter') {
        res.meter = v;
      } else if (c.type === 'ammeter') {
        res.meter = i;
      } else if (c.type === 'fuse') {
        if (c.blown) res.warning = 'Blown — reset the simulation to restore it.';
      }
      results[c.id] = res;
      continue;
    }
    if (c.type === 'potentiometer') {
      const va = nodeVoltage[pinNode[ref(c.id, 'a')]];
      const vb = nodeVoltage[pinNode[ref(c.id, 'b')]];
      const vw = nodeVoltage[pinNode[ref(c.id, 'wiper')]];
      const R = Math.max(1e-6, c.value);
      const i = (va - vb) / R;
      results[c.id] = { current: i, voltage: va - vb, power: Math.abs(i * (va - vb)), meter: vw };
      continue;
    }
    if (c.type === 'currentsource') {
      const vp = nodeVoltage[pinNode[ref(c.id, 'pos')]];
      const vn = nodeVoltage[pinNode[ref(c.id, 'neg')]];
      const i = c.value * 1e-3;
      results[c.id] = { current: i, voltage: vp - vn, power: Math.abs(i * (vp - vn)) };
      continue;
    }
    if (c.type === 'inductor') {
      const [pa, pb] = pinRefsByComp.get(c.id)!;
      const vab = nodeVoltage[pinNode[pa]] - nodeVoltage[pinNode[pb]];
      const L = Math.max(1e-9, c.value * 1e-3);
      const iprev = priorInd[c.id] ?? 0;
      const current = dt > 0 ? iprev + (dt / L) * vab : iprev;
      indCurrentOut[c.id] = current;
      results[c.id] = { current, voltage: vab, power: Math.abs(vab * current) };
      continue;
    }
    if (c.type === 'diode') {
      const spec = diodeSpec(c);
      const va = nodeVoltage[pinNode[ref(c.id, 'anode')]];
      const vc = nodeVoltage[pinNode[ref(c.id, 'cathode')]];
      const vac = va - vc;
      const on = diodeState.get(c.id)!;
      const i = on ? (vac - spec.vf) / spec.ron : vac / DIODE_ROFF;
      const res: ElementResult = { current: i, voltage: vac, power: Math.max(0, vac * i) };
      if (i > DIODE_WARN_CURRENT) res.warning = 'Very high current through the diode — add a series resistor.';
      else if (!on && vac < -0.5) res.warning = 'Reverse-biased: a diode blocks current from cathode to anode.';
      results[c.id] = res;
      continue;
    }
    if (c.type === 'capacitor') {
      const [pa, pb] = pinRefsByComp.get(c.id)!;
      const vab = nodeVoltage[pinNode[pa]] - nodeVoltage[pinNode[pb]];
      const cap = Math.max(1e-12, c.value * 1e-6);
      const vprev = priorCap[c.id] ?? 0;
      const current = dt > 0 ? (cap * (vab - vprev)) / dt : CAP_SNAP_G * (vab - vprev);
      capVoltageOut[c.id] = vab;
      results[c.id] = { current, voltage: vab, power: Math.max(0, vab * current) };
      continue;
    }
    if (c.type === 'led') {
      const spec = LED_SPEC[c.color];
      const va = nodeVoltage[pinNode[ref(c.id, 'anode')]];
      const vc = nodeVoltage[pinNode[ref(c.id, 'cathode')]];
      const vac = va - vc;
      const on = diodeState.get(c.id)!;
      const i = on ? (vac - spec.vf) / spec.ron : vac / LED_ROFF;
      const power = Math.max(0, vac * i);
      const brightness = on ? Math.max(0, Math.min(1, (i - LED_ON_CURRENT) / (LED_FULL_CURRENT - LED_ON_CURRENT))) : 0;
      const res: ElementResult = {
        current: i, voltage: vac, power,
        lit: on && i > LED_ON_CURRENT,
        brightness,
      };
      if (i > LED_BURN_CURRENT) {
        res.warning = 'Current is far too high — this LED would burn out. Add a series resistor.';
        warnings.push(`${c.id}: LED overcurrent (${(i * 1000).toFixed(0)} mA) — add a series resistor.`);
      } else if (i > LED_WARN_CURRENT) {
        res.warning = 'Current is high for an LED — a series resistor is recommended.';
      } else if (!on && vac < -0.5) {
        res.warning = 'Reverse-biased: an LED only conducts from anode to cathode.';
      }
      results[c.id] = res;
      continue;
    }
    if (c.type === 'battery' || c.type === 'acsource') {
      const vp = nodeVoltage[pinNode[ref(c.id, 'pos')]];
      const vn = nodeVoltage[pinNode[ref(c.id, 'neg')]];
      const xNode = internalRow.get(c.id)!;
      const vx = x[xNode];
      const current = (vx - vp) / BATTERY_INTERNAL_R; // positive when discharging (current out of +)
      results[c.id] = { current, voltage: vp - vn, power: Math.abs(current * (vp - vn)) };
      if (c.type === 'battery' && Math.abs(current) > 5) {
        warnings.push(`${c.id}: very large current (${current.toFixed(1)} A) — the battery is close to a short circuit.`);
      }
      continue;
    }
  }

  // Open-circuit hint: a source is present but essentially no current flows.
  const anyLoad = components.some((c) => c.type === 'resistor' || c.type === 'led' || c.type === 'lamp');
  const totalBatteryCurrent = vsources.reduce((sum, b) => sum + Math.abs(results[b.id]?.current ?? 0), 0);
  if (vsources.length > 0 && anyLoad && totalBatteryCurrent < 1e-5) {
    warnings.push('No current is flowing — the circuit is probably open (a wire, switch or connection is missing).');
  }

  return { ok: true, nodeVoltage, pinNode, results, capVoltage: capVoltageOut, indCurrent: indCurrentOut, warnings };
}
