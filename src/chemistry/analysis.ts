// Bond-aware Lewis-structure analysis. The atom model stores each atom's total
// electrons; this layer allocates outer-shell electrons between covalent bonds
// and nonbonding positions while preserving each connected component's budget.

import { atomInfo, valenceElectrons } from './atom';
import type { Atom, Bond, ChemState } from './types';

export interface AtomBondingAnalysis {
  atomId: string;
  bondOrder: number;
  nonbondingElectrons: number;
  bondingElectrons: number;
  shellElectrons: number;
  shellTarget: number;
  formalCharge: number;
  valid: boolean;
  issue: string | null;
}

export interface StructureAnalysis {
  atoms: Map<string, AtomBondingAnalysis>;
  valid: boolean;
  warnings: string[];
}

function connectedComponents(atoms: Atom[], bonds: Bond[]): Atom[][] {
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const neighbors = new Map(atoms.map((atom) => [atom.id, [] as string[]]));
  for (const bond of bonds) {
    neighbors.get(bond.a)?.push(bond.b);
    neighbors.get(bond.b)?.push(bond.a);
  }

  const seen = new Set<string>();
  const components: Atom[][] = [];
  for (const atom of atoms) {
    if (seen.has(atom.id)) continue;
    const ids = [atom.id];
    const component: Atom[] = [];
    seen.add(atom.id);
    while (ids.length > 0) {
      const id = ids.pop()!;
      const member = byId.get(id);
      if (member) component.push(member);
      for (const neighbor of neighbors.get(id) ?? []) {
        if (!seen.has(neighbor)) { seen.add(neighbor); ids.push(neighbor); }
      }
    }
    components.push(component);
  }
  return components;
}

function signedCharge(charge: number): string {
  if (charge === 0) return '0';
  return `${charge > 0 ? '+' : '−'}${Math.abs(charge)}`;
}

function lewisValence(atom: Atom): number {
  const neutralValence = valenceElectrons(atom.protons);
  const ionicCharge = atom.protons - atom.electrons;
  return Math.max(0, neutralValence - ionicCharge);
}

export function analyzeStructure(state: Pick<ChemState, 'atoms' | 'bonds'>): StructureAnalysis {
  const results = new Map<string, AtomBondingAnalysis>();
  const warnings: string[] = [];
  const covalentOrder = new Map(state.atoms.map((atom) => [atom.id, 0]));
  for (const bond of state.bonds) {
    if (bond.kind !== 'covalent') continue;
    covalentOrder.set(bond.a, (covalentOrder.get(bond.a) ?? 0) + bond.order);
    covalentOrder.set(bond.b, (covalentOrder.get(bond.b) ?? 0) + bond.order);
  }

  for (const component of connectedComponents(state.atoms, state.bonds)) {
    const ids = new Set(component.map((atom) => atom.id));
    const componentBonds = state.bonds.filter((bond) => ids.has(bond.a) && ids.has(bond.b));
    const hasBonds = componentBonds.length > 0;
    const sharedPairs = componentBonds.reduce(
      (total, bond) => total + (bond.kind === 'covalent' ? bond.order : 0),
      0,
    );
    const electronBudget = component.reduce((total, atom) => total + lewisValence(atom), 0);
    const remainingBudget = Math.max(0, electronBudget - sharedPairs * 2);

    const lone = new Map<string, number>();
    for (const atom of component) {
      lone.set(atom.id, Math.max(0, lewisValence(atom) - (covalentOrder.get(atom.id) ?? 0)));
    }

    // Over-bonded atoms cannot provide their usual one electron per bond. Move
    // the missing electrons out of another atom's lone pool, preferring atoms
    // that are currently beyond their duet/octet.
    let assigned = [...lone.values()].reduce((total, count) => total + count, 0);
    while (assigned > remainingBudget) {
      const donor = component
        .filter((atom) => (lone.get(atom.id) ?? 0) > 0)
        .sort((a, b) => {
          const overflowA = (lone.get(a.id) ?? 0) + 2 * (covalentOrder.get(a.id) ?? 0) - (a.protons <= 2 ? 2 : 8);
          const overflowB = (lone.get(b.id) ?? 0) + 2 * (covalentOrder.get(b.id) ?? 0) - (b.protons <= 2 ? 2 : 8);
          return overflowB - overflowA || (lone.get(b.id) ?? 0) - (lone.get(a.id) ?? 0);
        })[0];
      if (!donor) break;
      lone.set(donor.id, (lone.get(donor.id) ?? 0) - 1);
      assigned--;
    }
    while (assigned < remainingBudget) {
      const receiver = component
        .slice()
        .sort((a, b) => {
          const deficitA = (a.protons <= 2 ? 2 : 8) - ((lone.get(a.id) ?? 0) + 2 * (covalentOrder.get(a.id) ?? 0));
          const deficitB = (b.protons <= 2 ? 2 : 8) - ((lone.get(b.id) ?? 0) + 2 * (covalentOrder.get(b.id) ?? 0));
          return deficitB - deficitA;
        })[0];
      if (!receiver) break;
      lone.set(receiver.id, (lone.get(receiver.id) ?? 0) + 1);
      assigned++;
    }

    if (hasBonds && electronBudget < sharedPairs * 2) {
      warnings.push(`Not enough valence electrons for ${sharedPairs} covalent bond pair${sharedPairs === 1 ? '' : 's'}.`);
    }

    for (const atom of component) {
      const bondOrder = covalentOrder.get(atom.id) ?? 0;
      const nonbondingElectrons = lone.get(atom.id) ?? 0;
      const shellTarget = atom.protons <= 2 ? 2 : 8;
      // Covalent atoms count both electrons in every shared pair. Ions with no
      // covalent bonds use their actual occupied outer shell (Na+ is [2,8])
      // even though Lewis notation correctly shows it with zero dots.
      const shellElectrons = bondOrder > 0
        ? nonbondingElectrons + bondOrder * 2
        : valenceElectrons(atom.electrons);
      const formalCharge = valenceElectrons(atom.protons) - nonbondingElectrons - bondOrder;
      const valid = shellElectrons === shellTarget;
      const shellName = shellTarget === 2 ? 'duet' : 'octet';
      const issue = valid
        ? null
        : `${atomInfo(atom).symbol} (${atom.id}) has ${shellElectrons}/${shellTarget} electrons in its ${shellName} and formal charge ${signedCharge(formalCharge)}.`;
      if (hasBonds && issue) warnings.push(issue);
      results.set(atom.id, {
        atomId: atom.id,
        bondOrder,
        nonbondingElectrons,
        bondingElectrons: bondOrder * 2,
        shellElectrons,
        shellTarget,
        formalCharge,
        valid,
        issue,
      });
    }
  }

  return { atoms: results, valid: warnings.length === 0, warnings };
}
