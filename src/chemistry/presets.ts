// Starter structures. A preset builds atoms + bonds via the store (the same
// calls a student or agent makes), bundled into one undo step with a note.

import * as chem from './store';

interface Placed { id: string; }

function atom(z: number, x: number, y: number, opts: { neutrons?: number; electrons?: number } = {}): Placed {
  const r = chem.addAtom(z, { x, y, ...opts });
  if (!r.ok || !r.id) throw new Error(r.error);
  return { id: r.id };
}

export interface Preset { title: string; note: string; build: () => void; }

export const PRESETS: Record<string, Preset> = {
  water: {
    title: 'Water — H₂O (covalent)',
    note: 'One oxygen shares an electron pair with each of two hydrogens: two single covalent bonds. Oxygen needs two electrons to complete its octet, which is exactly what the two hydrogens provide. Notice the bent shape.',
    build: () => {
      chem.clearAll();
      const o = atom(8, 3, 3);
      const h1 = atom(1, 0, 1);
      const h2 = atom(1, 0, 5);
      chem.addBond(o.id, h1.id, 'covalent', 1);
      chem.addBond(o.id, h2.id, 'covalent', 1);
    },
  },
  salt: {
    title: 'Salt — NaCl (ionic)',
    note: 'Sodium gives its single outer electron to chlorine. Sodium becomes Na+ and chlorine becomes Cl-, and the opposite charges attract — an ionic bond. Set sodium to 10 electrons and chlorine to 18 to see the full octets they both gain.',
    build: () => {
      chem.clearAll();
      const na = atom(11, 1, 3, { electrons: 10 });
      const cl = atom(17, 7, 3, { electrons: 18 });
      chem.addBond(na.id, cl.id, 'ionic', 1);
    },
  },
  carbon_dioxide: {
    title: 'Carbon dioxide — CO₂ (double bonds)',
    note: 'Carbon forms a double covalent bond to each oxygen — four shared pairs in all — so every atom reaches an octet. A linear molecule. Click a bond to see it is a double bond (order 2).',
    build: () => {
      chem.clearAll();
      const c = atom(6, 4, 3);
      const o1 = atom(8, 0, 3);
      const o2 = atom(8, 8, 3);
      chem.addBond(c.id, o1.id, 'covalent', 2);
      chem.addBond(c.id, o2.id, 'covalent', 2);
    },
  },
  methane: {
    title: 'Methane — CH₄',
    note: 'Carbon shares one electron pair with each of four hydrogens, filling its outer shell to eight. The classic first organic molecule.',
    build: () => {
      chem.clearAll();
      const c = atom(6, 4, 4);
      const h = [atom(1, 1, 1), atom(1, 7, 1), atom(1, 1, 7), atom(1, 7, 7)];
      for (const hy of h) chem.addBond(c.id, hy.id, 'covalent', 1);
    },
  },
  oxygen_gas: {
    title: 'Oxygen gas — O₂',
    note: 'Two oxygen atoms share two electron pairs — a double bond — so both complete their octets. This is the oxygen we breathe.',
    build: () => {
      chem.clearAll();
      const a = atom(8, 2, 3);
      const b = atom(8, 6, 3);
      chem.addBond(a.id, b.id, 'covalent', 2);
    },
  },
  isotopes: {
    title: 'Isotopes of hydrogen',
    note: 'Three hydrogen atoms with the same one proton but 0, 1 and 2 neutrons: protium, deuterium and tritium. Same element (same protons), different mass number. Change the neutron count on any atom to make an isotope.',
    build: () => {
      chem.clearAll();
      atom(1, 1, 3, { neutrons: 0 });
      atom(1, 4, 3, { neutrons: 1 });
      atom(1, 7, 3, { neutrons: 2 });
    },
  },
};

export function presetNames(): { name: string; title: string }[] {
  return Object.entries(PRESETS).map(([name, p]) => ({ name, title: p.title }));
}
export function loadPreset(name: string): { ok: boolean; error?: string; note?: string; title?: string } {
  const preset = PRESETS[name];
  if (!preset) return { ok: false, error: `Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}.` };
  chem.beginBatch();
  try { preset.build(); } finally { chem.endBatch(); }
  chem.setSelected(null); chem.setSelectedBond(null);
  chem.setMessage(preset.note);
  return { ok: true, note: preset.note, title: preset.title };
}
