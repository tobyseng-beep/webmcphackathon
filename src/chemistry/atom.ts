// Atomic-model helpers: electron shells (Bohr diagram), valence, charge, mass
// number and the notation a Chem 1 student expects.

import { elementByZ } from './elements';
import type { Atom } from './types';

// Aufbau subshell order, each mapped to the principal shell it belongs to.
// Filling electrons through this list reproduces the correct Bohr shell counts
// for neutral main-group atoms and their common ions (e.g. Ca [2,8,8,2],
// Kr [2,8,18,8], Na+ [2,8], Cl- [2,8,8]).
const SUBSHELLS: { shell: number; cap: number }[] = [
  { shell: 1, cap: 2 }, // 1s
  { shell: 2, cap: 2 }, // 2s
  { shell: 2, cap: 6 }, // 2p
  { shell: 3, cap: 2 }, // 3s
  { shell: 3, cap: 6 }, // 3p
  { shell: 4, cap: 2 }, // 4s
  { shell: 3, cap: 10 }, // 3d
  { shell: 4, cap: 6 }, // 4p
  { shell: 5, cap: 2 }, // 5s
  { shell: 4, cap: 10 }, // 4d
  { shell: 5, cap: 6 }, // 5p
  { shell: 6, cap: 2 }, // 6s
  { shell: 4, cap: 14 }, // 4f
  { shell: 5, cap: 10 }, // 5d
  { shell: 6, cap: 6 }, // 6p
  { shell: 7, cap: 2 }, // 7s
  { shell: 5, cap: 14 }, // 5f
  { shell: 6, cap: 10 }, // 6d
  { shell: 7, cap: 6 }, // 7p
];

/** Electrons per principal shell, innermost first. */
export function shells(electrons: number): number[] {
  const perShell: Record<number, number> = {};
  let e = Math.max(0, Math.round(electrons));
  for (const sub of SUBSHELLS) {
    if (e <= 0) break;
    const put = Math.min(sub.cap, e);
    perShell[sub.shell] = (perShell[sub.shell] ?? 0) + put;
    e -= put;
  }
  if (e > 0) perShell[8] = (perShell[8] ?? 0) + e; // overflow safety
  const maxShell = Object.keys(perShell).length ? Math.max(...Object.keys(perShell).map(Number)) : 0;
  const out: number[] = [];
  for (let i = 1; i <= maxShell; i++) out.push(perShell[i] ?? 0);
  return out;
}

/** Electrons in the outermost occupied shell. */
export function valenceElectrons(electrons: number): number {
  const s = shells(electrons);
  return s.length ? s[s.length - 1] : 0;
}

export interface AtomInfo {
  symbol: string;
  name: string;
  z: number;
  charge: number; // protons - electrons
  massNumber: number; // protons + neutrons
  shells: number[];
  valence: number;
  isIon: boolean;
  isIsotope: boolean; // neutrons != the element's typical count
  chargeLabel: string; // e.g. "2+", "1-", ""
  formula: string; // symbol with charge, e.g. "Na+", "O2-"
}

function chargeToLabel(charge: number): string {
  if (charge === 0) return '';
  const mag = Math.abs(charge);
  return `${mag === 1 ? '' : mag}${charge > 0 ? '+' : '-'}`;
}

export function atomInfo(atom: Atom): AtomInfo {
  const el = elementByZ(atom.protons);
  const charge = atom.protons - atom.electrons;
  const s = shells(atom.electrons);
  const chargeLabel = chargeToLabel(charge);
  const symbol = el?.symbol ?? '?';
  return {
    symbol,
    name: el?.name ?? 'unknown',
    z: atom.protons,
    charge,
    massNumber: atom.protons + atom.neutrons,
    shells: s,
    valence: s.length ? s[s.length - 1] : 0,
    isIon: charge !== 0,
    isIsotope: false, // filled in by the caller if it knows the default
    chargeLabel,
    formula: symbol + (chargeLabel ? chargeLabel : ''),
  };
}

// How many more electrons the outer shell wants to reach a full octet (or duet
// for shell 1). Used to hint how many covalent bonds an atom will form.
export function octetNeed(electrons: number): number {
  const s = shells(electrons);
  if (s.length === 0) return 1;
  const outer = s[s.length - 1];
  const target = s.length === 1 ? 2 : 8;
  return Math.max(0, target - outer);
}
