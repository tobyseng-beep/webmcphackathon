// Friction is a property of a *pair* of surfaces, not of one object, so it
// lives in a lookup table rather than on the bodies. Every object carries a
// material; when two of them touch, the coefficient comes from this table.
//
// The values are the dry, unlubricated figures a textbook table gives, rounded
// to two places. The model uses one coefficient per pair rather than separate
// static and kinetic values -- see the note in tools.ts.

import type { Material } from './types';

export const MATERIALS: Material[] = ['rubber', 'wood', 'steel', 'concrete', 'ice'];

export const MATERIAL_ABOUT: Record<Material, string> = {
  rubber: 'Grippiest surface here. A rubber ball on concrete stops almost at once.',
  wood: 'Middling grip. The everyday default for a block or a plank.',
  steel: 'Fairly slippery against most things, and very slippery on ice.',
  concrete: 'Rough and grippy. The floor, the walls and the blocks are concrete.',
  ice: 'Nearly frictionless. Use it to get the idealised behaviour back for one object.',
};

// Written once per unordered pair; lookup sorts the two names before joining.
const PAIRS: Record<string, number> = {
  'concrete|rubber': 0.90,
  'rubber|rubber': 1.10,
  'rubber|wood': 0.75,
  'rubber|steel': 0.65,
  'ice|rubber': 0.15,

  'wood|wood': 0.35,
  'concrete|wood': 0.55,
  'steel|wood': 0.30,
  'ice|wood': 0.08,

  'steel|steel': 0.50,
  'concrete|steel': 0.45,
  'ice|steel': 0.03,

  'concrete|concrete': 0.70,
  'concrete|ice': 0.10,

  'ice|ice': 0.03,
};

function key(a: Material, b: Material): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Coefficient of friction between two materials in contact. */
export function frictionCoefficient(a: Material, b: Material): number {
  return PAIRS[key(a, b)] ?? 0.3;
}

/** The whole table, for the inspector and the WebMCP tool. */
export function frictionPairs(): { a: Material; b: Material; mu: number }[] {
  const out: { a: Material; b: Material; mu: number }[] = [];
  for (let i = 0; i < MATERIALS.length; i++) {
    for (let j = i; j < MATERIALS.length; j++) {
      out.push({ a: MATERIALS[i], b: MATERIALS[j], mu: frictionCoefficient(MATERIALS[i], MATERIALS[j]) });
    }
  }
  return out;
}
