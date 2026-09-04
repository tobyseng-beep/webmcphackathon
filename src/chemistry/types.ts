// Shared types for the atomic-structure sandbox.

export interface Atom {
  id: string;
  protons: number; // atomic number Z -> the element
  neutrons: number; // isotope
  electrons: number; // charge = protons - electrons
  x: number; // world-grid position
  y: number;
}

export type BondKind = 'covalent' | 'ionic';

export interface Bond {
  id: string;
  a: string; // atom id
  b: string; // atom id
  kind: BondKind;
  order: number; // 1 single, 2 double, 3 triple (covalent); 1 for ionic
}

export interface View {
  originX: number;
  originY: number;
  scale: number; // pixels per world unit
}

export type ChangeReason =
  | 'atoms'
  | 'bonds'
  | 'selection'
  | 'view'
  | 'history'
  | 'message';

export interface ChemState {
  atoms: Atom[];
  bonds: Bond[];
  selectedId: string | null;
  selectedBondId: string | null;
  view: View;
  message: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

// A connected group of bonded atoms and its molecular formula.
export interface Molecule {
  atomIds: string[];
  formula: string; // Hill-ordered, e.g. "H2O", "NaCl", "CO2"
  charge: number; // net charge of the group
}

// ---- WebMCP surface (identical shape to the other engines) ----

export interface JsonSchema {
  type: string;
  description?: string;
  enum?: readonly (string | number)[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
}

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface WebMcpHost {
  registerTool?: (tool: WebMcpTool) => void;
  provideContext?: (context: { tools: WebMcpTool[] }) => void;
}
