// The single mutation layer for the chemistry board. The periodic table, the
// canvas and the WebMCP tools all call these functions. Includes undo/redo and
// molecule (connected-component) formula computation.

import type { Atom, Bond, BondKind, ChangeReason, ChemState, Molecule, View } from './types';
import { createChangeLog } from '../changelog';
import { badNumbers } from '../numbers';
import { defaultNeutrons, elementByZ, elementBySymbol, MAX_Z } from './elements';

const state: ChemState = {
  atoms: [],
  bonds: [],
  selectedId: null,
  selectedBondId: null,
  view: { originX: -8, originY: -6, scale: 60 },
  message: null,
  canUndo: false,
  canRedo: false,
};

/** What changed on this board, and who changed it. */
export const changes = createChangeLog();

type Listener = (reason: ChangeReason, state: ChemState) => void;
const listeners = new Set<Listener>();
let atomCounter = 0;
let bondCounter = 0;

function notify(reason: ChangeReason): void {
  // A listener that throws must not abort the mutation part-way through, nor
  // strand a promise that resolves after notifying (animate_slider did exactly
  // that: a bad value made a renderer throw, and the agent waited forever).
  for (const fn of listeners) {
    try { fn(reason, state); }
    catch (err) { console.error('[chemistry] listener failed:', err); }
  }
}
export function subscribe(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }
export function getState(): ChemState { return state; }
export function atomById(id: string): Atom | undefined { return state.atoms.find((a) => a.id === id); }
export function bondById(id: string): Bond | undefined { return state.bonds.find((b) => b.id === id); }
function invalidateMessage(): boolean {
  if (state.message === null) return false;
  state.message = null;
  return true;
}

// ---- undo / redo ----

interface Snapshot { atoms: Atom[]; bonds: Bond[]; }
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
const MAX_HISTORY = 100;
let coalesceKey: string | null = null;
let coalesceAt = 0;
let batching = false;

function snapshot(): Snapshot {
  return { atoms: state.atoms.map((a) => ({ ...a })), bonds: state.bonds.map((b) => ({ ...b })) };
}
function refreshHistoryFlags(): void { state.canUndo = undoStack.length > 0; state.canRedo = redoStack.length > 0; }

function pushHistory(key: string | null): void {
  if (batching) return;
  const now = performance.now();
  if (key !== null && key === coalesceKey && now - coalesceAt < 700) { coalesceAt = now; return; }
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  coalesceKey = key; coalesceAt = now;
  refreshHistoryFlags(); notify('history');
}
export function commitHistory(): void { coalesceKey = null; }

function restore(snap: Snapshot): void {
  state.atoms = snap.atoms.map((a) => ({ ...a }));
  state.bonds = snap.bonds.map((b) => ({ ...b }));
  state.selectedId = null; state.selectedBondId = null; coalesceKey = null;
  notify('atoms'); notify('bonds');
}
export function undo(): { ok: boolean; error?: string } {
  if (undoStack.length === 0) return { ok: false, error: 'Nothing to undo.' };
  redoStack.push(snapshot()); restore(undoStack.pop()!); refreshHistoryFlags();
  changes.record('undid', { summary: 'the last change was undone' });
  notify('history');
  return { ok: true };
}
export function redo(): { ok: boolean; error?: string } {
  if (redoStack.length === 0) return { ok: false, error: 'Nothing to redo.' };
  undoStack.push(snapshot()); restore(redoStack.pop()!); refreshHistoryFlags();
  changes.record('redid', { summary: 'the last undone change was reapplied' });
  notify('history');
  return { ok: true };
}
export function beginBatch(): void {
  if (!batching) { undoStack.push(snapshot()); if (undoStack.length > MAX_HISTORY) undoStack.shift(); redoStack.length = 0; }
  batching = true; coalesceKey = null;
}
export function endBatch(): void { batching = false; coalesceKey = null; refreshHistoryFlags(); notify('history'); }

// ---- atoms ----

function autoPlace(): { x: number; y: number } {
  const n = state.atoms.length;
  return { x: (n % 4) * 5, y: Math.floor(n / 4) * 5 };
}

export interface AddAtomOptions { x?: number; y?: number; neutrons?: number; electrons?: number; }

export function addAtom(z: number, opts: AddAtomOptions = {}): { ok: boolean; id?: string; error?: string } {
  const bad = badNumbers({ atomic_number: z, neutrons: opts.neutrons, electrons: opts.electrons, x: opts.x, y: opts.y });
  if (bad) return { ok: false, error: bad };
  const zi = Math.round(z);
  if (!elementByZ(zi)) return { ok: false, error: `No element with atomic number ${z}. Valid range is 1 to ${MAX_Z}.` };
  pushHistory(null);
  const place = opts.x !== undefined && opts.y !== undefined ? { x: opts.x, y: opts.y } : autoPlace();
  const atom: Atom = {
    id: 'atom' + (++atomCounter),
    protons: zi,
    neutrons: opts.neutrons !== undefined ? Math.max(0, Math.round(opts.neutrons)) : defaultNeutrons(zi),
    electrons: opts.electrons !== undefined ? Math.max(0, Math.round(opts.electrons)) : zi,
    x: Math.round(place.x), y: Math.round(place.y),
  };
  state.atoms.push(atom);
  state.selectedId = atom.id; state.selectedBondId = null;
  changes.record('added atom', {
    target: atom.id, to: { protons: atom.protons, neutrons: atom.neutrons, electrons: atom.electrons },
    summary: `${elementByZ(zi)?.symbol ?? 'atom'} ${atom.id} added`,
  });
  const messageChanged = invalidateMessage();
  notify('atoms');
  if (messageChanged) notify('message');
  return { ok: true, id: atom.id };
}

export function removeAtom(id: string): { ok: boolean; error?: string } {
  const idx = state.atoms.findIndex((a) => a.id === id);
  if (idx === -1) return { ok: false, error: `No atom "${id}".` };
  pushHistory(null);
  const [gone] = state.atoms.splice(idx, 1);
  state.bonds = state.bonds.filter((b) => b.a !== id && b.b !== id);
  if (state.selectedId === id) state.selectedId = null;
  changes.record('removed atom', {
    target: id, from: { protons: gone.protons },
    summary: `${id} removed, along with any bonds to it`,
  });
  const messageChanged = invalidateMessage();
  notify('atoms');
  if (messageChanged) notify('message');
  return { ok: true };
}

function setParticle(id: string, field: 'protons' | 'neutrons' | 'electrons', value: number): { ok: boolean; error?: string } {
  const atom = atomById(id);
  if (!atom) return { ok: false, error: `No atom "${id}".` };
  // A missing or non-numeric count used to sail through as NaN and leave the
  // atom with a null particle count -- broken, and reported as ok:true.
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${field} must be a number; got ${JSON.stringify(value)}.` };
  }
  let v = Math.round(value);
  if (field === 'protons') { if (v < 1) v = 1; if (v > MAX_Z) v = MAX_Z; }
  else v = Math.max(0, v);
  const elementChanged = field === 'protons' && atom.protons !== v;
  pushHistory(`${field}:${id}`);
  const was = atom[field];
  atom[field] = v;
  changes.record(`changed ${field}`, {
    target: id, from: was, to: v, coalesce: true,
    summary: `${id} now has ${v} ${field}`,
  });
  const messageChanged = elementChanged && invalidateMessage();
  notify('atoms');
  if (messageChanged) notify('message');
  return { ok: true };
}
export function setProtons(id: string, n: number) { return setParticle(id, 'protons', n); }
export function setNeutrons(id: string, n: number) { return setParticle(id, 'neutrons', n); }
export function setElectrons(id: string, n: number) { return setParticle(id, 'electrons', n); }

export function moveAtom(id: string, x: number, y: number, snap = true): { ok: boolean; error?: string } {
  const atom = atomById(id);
  if (!atom) return { ok: false, error: `No atom "${id}".` };
  const bad = badNumbers({ x, y });
  if (bad) return { ok: false, error: bad };
  pushHistory(`move:${id}`);
  const wasAt = { x: atom.x, y: atom.y };
  atom.x = snap ? Math.round(x) : x;
  atom.y = snap ? Math.round(y) : y;
  changes.record('moved atom', {
    target: id, from: wasAt, to: { x: atom.x, y: atom.y }, coalesce: true,
    summary: `${id} moved to (${atom.x}, ${atom.y})`,
  });
  notify('atoms');
  return { ok: true };
}

// ---- bonds ----

export function addBond(aId: string, bId: string, kind: BondKind = 'covalent', order = 1): { ok: boolean; id?: string; error?: string } {
  if (!atomById(aId)) return { ok: false, error: `No atom "${aId}".` };
  if (!atomById(bId)) return { ok: false, error: `No atom "${bId}".` };
  if (aId === bId) return { ok: false, error: 'An atom cannot bond to itself.' };
  if (state.bonds.some((b) => (b.a === aId && b.b === bId) || (b.a === bId && b.b === aId))) {
    return { ok: false, error: `${aId} and ${bId} are already bonded.` };
  }
  pushHistory(null);
  const bond: Bond = { id: 'bond' + (++bondCounter), a: aId, b: bId, kind, order: kind === 'ionic' ? 1 : Math.max(1, Math.min(3, Math.round(order))) };
  state.bonds.push(bond);
  state.selectedBondId = bond.id; state.selectedId = null;
  changes.record('bonded', {
    target: bond.id, to: { a: aId, b: bId, kind: bond.kind, order: bond.order },
    summary: `${aId} bonded to ${bId} (${bond.kind}, order ${bond.order})`,
  });
  const messageChanged = invalidateMessage();
  notify('bonds');
  if (messageChanged) notify('message');
  return { ok: true, id: bond.id };
}

export function setBond(id: string, patch: { kind?: BondKind; order?: number }): { ok: boolean; error?: string } {
  const bond = bondById(id);
  if (!bond) return { ok: false, error: `No bond "${id}".` };
  // A NaN order does not stay local: it propagates into every bonded atom's
  // electron count and formal charge, so the whole structure reads as null.
  const bad = badNumbers({ order: patch.order });
  if (bad) return { ok: false, error: bad };
  pushHistory(null);
  if (patch.kind) bond.kind = patch.kind;
  if (patch.order !== undefined) bond.order = Math.max(1, Math.min(3, Math.round(patch.order)));
  if (bond.kind === 'ionic') bond.order = 1;
  changes.record('changed bond', {
    target: id, to: { kind: bond.kind, order: bond.order },
    summary: `${id} is now ${bond.kind}, order ${bond.order}`,
  });
  const messageChanged = invalidateMessage();
  notify('bonds');
  if (messageChanged) notify('message');
  return { ok: true };
}

export function removeBond(id: string): { ok: boolean; error?: string } {
  const idx = state.bonds.findIndex((b) => b.id === id);
  if (idx === -1) return { ok: false, error: `No bond "${id}".` };
  pushHistory(null);
  state.bonds.splice(idx, 1);
  if (state.selectedBondId === id) state.selectedBondId = null;
  changes.record('removed bond', { target: id, summary: `bond ${id} removed` });
  const messageChanged = invalidateMessage();
  notify('bonds');
  if (messageChanged) notify('message');
  return { ok: true };
}

export function clearAll(): { ok: true } {
  if (state.atoms.length > 0 || state.bonds.length > 0) pushHistory(null);
  state.atoms = []; state.bonds = [];
  state.selectedId = null; state.selectedBondId = null;
  atomCounter = 0; bondCounter = 0;
  changes.record('cleared board', { summary: 'every atom and bond removed' });
  const messageChanged = invalidateMessage();
  notify('atoms');
  if (messageChanged) notify('message');
  return { ok: true };
}

// ---- molecules / formulas ----

export function molecules(): Molecule[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r) ?? r; return r; };
  for (const a of state.atoms) parent.set(a.id, a.id);
  for (const b of state.bonds) {
    const ra = find(b.a), rb = find(b.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, string[]>();
  for (const a of state.atoms) {
    const r = find(a.id);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(a.id);
  }
  const out: Molecule[] = [];
  for (const ids of groups.values()) {
    const counts = new Map<string, number>();
    let charge = 0;
    for (const id of ids) {
      const atom = atomById(id)!;
      const sym = elementByZ(atom.protons)?.symbol ?? '?';
      counts.set(sym, (counts.get(sym) ?? 0) + 1);
      charge += atom.protons - atom.electrons;
    }
    out.push({ atomIds: ids, formula: hillFormula(counts), charge });
  }
  return out;
}

// Order elements for a formula: carbon compounds use the Hill system (C, H,
// then alphabetical); everything else writes the metal / cation first, then by
// group -- so NaCl, CaCl2, H2O, CO2 come out the way a student expects.
function hillFormula(counts: Map<string, number>): string {
  const syms = [...counts.keys()];
  let ordered: string[];
  if (counts.has('C')) {
    ordered = ['C'];
    if (counts.has('H')) ordered.push('H');
    for (const s of syms.filter((x) => x !== 'C' && x !== 'H').sort()) ordered.push(s);
  } else {
    const isMetal = (sym: string): boolean => {
      const c = elementBySymbol(sym)?.category;
      return c === 'alkali' || c === 'alkaline' || c === 'transition' || c === 'post-transition' ||
        c === 'lanthanide' || c === 'actinide';
    };
    ordered = syms.sort((a, b) => {
      const ma = isMetal(a) ? 0 : 1, mb = isMetal(b) ? 0 : 1;
      if (ma !== mb) return ma - mb;
      const ga = elementBySymbol(a)?.group ?? 99, gb = elementBySymbol(b)?.group ?? 99;
      if (ga !== gb) return ga - gb;
      return a.localeCompare(b);
    });
  }
  return ordered.map((s) => (counts.get(s)! > 1 ? `${s}${counts.get(s)}` : s)).join('');
}

// ---- selection, view, message ----

export function setSelected(id: string | null): void {
  state.selectedId = id;
  if (id !== null) state.selectedBondId = null;
  notify('selection');
}
export function setSelectedBond(id: string | null): void {
  state.selectedBondId = id;
  if (id !== null) state.selectedId = null;
  notify('selection');
}
export function setView(patch: Partial<View>): void { state.view = { ...state.view, ...patch }; notify('view'); }
export function setMessage(message: string | null): void { state.message = message; notify('message'); }
