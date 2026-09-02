// WebMCP surface for the chemistry board. Every execute() routes into
// src/chemistry/store.ts. Descriptions are written as instructions to a
// competent colleague.

import * as chem from './store';
import { atomInfo } from './atom';
import { analyzeStructure, type AtomBondingAnalysis } from './analysis';
import { ELEMENTS, elementByZ, elementBySymbol, MAX_Z } from './elements';
import { suggestBondKind } from './render';
import { loadPreset, presetNames, PRESETS } from './presets';
import type { Atom, BondKind, WebMcpTool } from './types';

function describeAtom(a: Atom, bonding?: AtomBondingAnalysis): Record<string, unknown> {
  const info = atomInfo(a);
  return {
    id: a.id,
    element: info.symbol,
    name: info.name,
    protons: a.protons,
    neutrons: a.neutrons,
    electrons: a.electrons,
    charge: info.charge,
    mass_number: info.massNumber,
    shells: info.shells,
    valence: info.valence,
    nonbonding_electrons: bonding?.nonbondingElectrons ?? info.valence,
    bonding_electrons: bonding?.bondingElectrons ?? 0,
    shell_electrons: bonding?.shellElectrons ?? info.valence,
    shell_target: bonding?.shellTarget ?? (a.protons <= 2 ? 2 : 8),
    formal_charge: bonding?.formalCharge ?? info.charge,
    valid_structure: bonding?.valid ?? true,
    position: { x: a.x, y: a.y },
  };
}

function summary(): Record<string, unknown> {
  const s = chem.getState();
  const analysis = analyzeStructure(s);
  return {
    atoms: s.atoms.map((atom) => describeAtom(atom, analysis.atoms.get(atom.id))),
    bonds: s.bonds.map((b) => ({ id: b.id, a: b.a, b: b.b, kind: b.kind, order: b.order })),
    molecules: chem.molecules().map((m) => ({ formula: m.formula, atoms: m.atomIds, charge: m.charge })),
    structure_valid: analysis.valid,
    structure_warnings: analysis.warnings,
  };
}

function resolveZ(args: Record<string, unknown>): number | null {
  if (args.element !== undefined) {
    const el = elementBySymbol(String(args.element));
    if (el) return el.z;
    const n = Number(args.element);
    if (Number.isFinite(n)) return n;
    return null;
  }
  if (args.z !== undefined) return Number(args.z);
  return null;
}

const toolDefinitions = [
  {
    name: 'list_atoms',
    description:
      'Read the whole board: every atom with its element, particle counts, valence, bond-aware shell count and formal charge; every bond; molecular formulas; and any invalid-structure warnings. Call this first to orient, and after any change you did not make. The ids returned here are what the other tools expect.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, ...summary() }),
  },
  {
    name: 'list_elements',
    description:
      'List the elements available in the periodic table (hydrogen through krypton, atomic numbers 1 to 36), with symbol, name, category and typical mass. Use it to pick an element or recall an atomic number before adding an atom.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({
      ok: true,
      elements: ELEMENTS.map((e) => ({ z: e.z, symbol: e.symbol, name: e.name, category: e.category, mass: e.mass })),
    }),
  },
  {
    name: 'add_atom',
    description:
      'Add an atom to the board. Identify the element by symbol (element:"O") or atomic number (z:8). It starts neutral (electrons = protons) with the most common isotope\'s neutron count, unless you override neutrons or electrons. Optionally set grid position x,y. Returns the new atom id. To make an ion, set electrons; to make an isotope, set neutrons.',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Element symbol, e.g. "O", "Na", "Cl".' },
        z: { type: 'number', description: 'Atomic number instead of a symbol.' },
        x: { type: 'number' }, y: { type: 'number' },
        neutrons: { type: 'number', description: 'Override neutron count (isotope).' },
        electrons: { type: 'number', description: 'Override electron count (ion).' },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const z = resolveZ(args);
      if (z === null || !elementByZ(Math.round(z))) {
        return { ok: false, error: `Unknown element. Give a symbol like "O" or an atomic number 1..${MAX_Z}.` };
      }
      const result = chem.addAtom(z, {
        x: args.x !== undefined ? Number(args.x) : undefined,
        y: args.y !== undefined ? Number(args.y) : undefined,
        neutrons: args.neutrons !== undefined ? Number(args.neutrons) : undefined,
        electrons: args.electrons !== undefined ? Number(args.electrons) : undefined,
      });
      return result.ok ? { ...result, ...summary() } : result;
    },
  },
  {
    name: 'set_protons',
    description:
      'Change an atom\'s proton count. This changes which element it is (protons ARE the element). Range 1 to 36. A powerful teaching move: add a proton to lithium and watch it become beryllium. The electron and neutron counts stay put, so the charge may change until you adjust them.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, count: { type: 'number' } }, required: ['id', 'count'] },
    execute: async (args: Record<string, unknown>) => {
      const r = chem.setProtons(String(args.id), Number(args.count));
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
  {
    name: 'set_neutrons',
    description:
      'Change an atom\'s neutron count. Neutrons change the mass number and make isotopes but not the element or the charge. For example, carbon with 6 neutrons is carbon-12; with 8 it is carbon-14.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, count: { type: 'number' } }, required: ['id', 'count'] },
    execute: async (args: Record<string, unknown>) => {
      const r = chem.setNeutrons(String(args.id), Number(args.count));
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
  {
    name: 'set_electrons',
    description:
      'Change an atom\'s electron count, which sets its charge (charge = protons − electrons). Fewer electrons than protons makes a positive cation; more makes a negative anion. E.g. sodium with 10 electrons is Na+, chlorine with 18 is Cl−. Use this to show how atoms reach a full octet by gaining or losing electrons.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, count: { type: 'number' } }, required: ['id', 'count'] },
    execute: async (args: Record<string, unknown>) => {
      const r = chem.setElectrons(String(args.id), Number(args.count));
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
  {
    name: 'bond',
    description:
      'Bond two atoms into a molecule. Give two atom ids. kind is "covalent" (shared electrons, between non-metals) or "ionic" (transferred electrons, between a metal and a non-metal); omit it to let the board choose based on the elements. order is 1, 2 or 3 for single/double/triple covalent bonds. Bonding updates the molecular formula, which you can read from list_atoms.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'First atom id.' },
        b: { type: 'string', description: 'Second atom id.' },
        kind: { type: 'string', enum: ['covalent', 'ionic'] },
        order: { type: 'number', enum: ['1', '2', '3'], description: 'Covalent bond order.' },
      },
      required: ['a', 'b'],
    },
    execute: async (args: Record<string, unknown>) => {
      const a = String(args.a), b = String(args.b);
      const kind = (args.kind as BondKind | undefined) ?? suggestBondKind(a, b);
      const r = chem.addBond(a, b, kind, args.order !== undefined ? Number(args.order) : 1);
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
  {
    name: 'set_bond',
    description:
      'Change an existing bond: its kind ("covalent"/"ionic") or its order (1/2/3 for single/double/triple). Ionic bonds are always order 1.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        kind: { type: 'string', enum: ['covalent', 'ionic'] },
        order: { type: 'number', enum: ['1', '2', '3'] },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const r = chem.setBond(String(args.id), {
        kind: args.kind as BondKind | undefined,
        order: args.order !== undefined ? Number(args.order) : undefined,
      });
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
  {
    name: 'remove_bond',
    description: 'Delete a bond by id, breaking the two atoms apart.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    execute: async (args: Record<string, unknown>) => {
      const r = chem.removeBond(String(args.id));
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
  {
    name: 'remove_atom',
    description: 'Delete an atom and any bonds attached to it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    execute: async (args: Record<string, unknown>) => {
      const r = chem.removeAtom(String(args.id));
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
  {
    name: 'move_atom',
    description: 'Move an atom to grid position x,y. Bonds follow; this only tidies the layout.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['id', 'x', 'y'] },
    execute: async (args: Record<string, unknown>) => {
      const r = chem.moveAtom(String(args.id), Number(args.x), Number(args.y));
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
  {
    name: 'clear',
    description: 'Remove every atom and bond for a fresh start. Ask the student before clearing their work.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ...chem.clearAll(), ...summary() }),
  },
  {
    name: 'undo',
    description: 'Undo the last change to the board. Safe to call repeatedly to step further back.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => { const r = chem.undo(); return r.ok ? { ...r, ...summary() } : r; },
  },
  {
    name: 'redo',
    description: 'Redo the change that was just undone.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => { const r = chem.redo(); return r.ok ? { ...r, ...summary() } : r; },
  },
  {
    name: 'load_preset',
    description:
      'Load a ready-made structure — a molecule or an atomic-structure demo — with a teaching note, in one call. Call with no arguments to list what is available. The note explains the bonding and what the student should notice.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', enum: Object.keys(PRESETS) } } },
    execute: async (args: Record<string, unknown>) => {
      if (!args.name) return { ok: true, presets: presetNames(), note: 'Call again with one of these names.' };
      const r = loadPreset(String(args.name));
      return r.ok ? { ...r, ...summary() } : r;
    },
  },
] satisfies WebMcpTool[];

export const TOOLS = toolDefinitions as unknown as WebMcpTool[];

export function registerTools(): { available: boolean; registered: number; host: string | null } {
  const host = document.modelContext ?? navigator.modelContext ?? null;
  if (!host) return { available: false, registered: 0, host: null };
  const hostName = document.modelContext ? 'document.modelContext' : 'navigator.modelContext';
  let registered = 0;
  if (typeof host.registerTool === 'function') {
    for (const tool of TOOLS) { try { host.registerTool(tool); registered++; } catch (err) { console.error('[webmcp] register failed', err); } }
  } else if (typeof host.provideContext === 'function') {
    try { host.provideContext({ tools: TOOLS }); registered = TOOLS.length; } catch (err) { console.error('[webmcp] provideContext failed', err); }
  } else {
    return { available: false, registered: 0, host: hostName };
  }
  return { available: true, registered, host: hostName };
}
