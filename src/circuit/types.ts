// Shared types for the circuit sandbox. The electrical model is deliberately
// small and beginner-shaped: DC only, a handful of two-terminal parts plus
// ground. Everything an agent or a student can touch is described here.

export type ComponentType =
  | 'battery'
  | 'resistor'
  | 'led'
  | 'lamp'
  | 'switch'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'potentiometer'
  | 'currentsource'
  | 'acsource'
  | 'fuse'
  | 'voltmeter'
  | 'ammeter'
  | 'motor'
  | 'buzzer'
  | 'ground';

export type Rotation = 0 | 90 | 180 | 270;

export type LedColor = 'red' | 'green' | 'blue' | 'yellow' | 'white';

export interface Component {
  id: string;
  type: ComponentType;
  x: number; // world-grid anchor (integer units)
  y: number;
  rotation: Rotation;
  value: number; // volts (battery) or ohms (resistor, lamp); ignored otherwise
  closed: boolean; // switch only
  color: LedColor; // led only
  wiper: number; // potentiometer wiper position, 0..1
  freq: number; // AC source frequency, Hz
  blown: boolean; // fuse
  label: string | null;
}

export interface Wire {
  id: string;
  from: string; // pin ref, "<componentId>.<pin>"
  to: string;
}

export interface PinDef {
  name: string;
  dx: number; // offset from anchor in world units, before rotation
  dy: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

// One solved two-terminal element result.
export interface ElementResult {
  current: number; // amps, signed along the component's own pin order
  voltage: number; // volts across (pin0 minus pin1)
  power: number; // watts dissipated (>= 0)
  lit?: boolean; // led / lamp / motor / buzzer active
  brightness?: number; // 0..1
  meter?: number; // reading a voltmeter/ammeter displays
  warning?: string; // e.g. overcurrent, reverse-biased, blown
}

export interface Solution {
  ok: boolean;
  reason?: string; // why the solve is degenerate, if it is
  // Electrical node id -> voltage relative to the reference node (0 V).
  nodeVoltage: Record<number, number>;
  pinNode: Record<string, number>; // pin ref -> node id
  results: Record<string, ElementResult>; // component id -> result
  capVoltage: Record<string, number>; // capacitor id -> voltage across it after this solve
  indCurrent: Record<string, number>; // inductor id -> current through it after this solve
  warnings: string[];
}

export interface View {
  originX: number; // world coord at screen-left, in world units
  originY: number; // world coord at screen-top (y grows downward on screen)
  scale: number; // pixels per world unit
}

export type ChangeReason =
  | 'components'
  | 'wires'
  | 'selection'
  | 'view'
  | 'running'
  | 'solution'
  | 'history'
  | 'scope';

export type ScopeQuantity = 'voltage' | 'current';

export interface ScopeSample {
  t: number; // sim time, seconds
  v: number; // value (volts, or milliamps for a current trace)
}

export interface ScopeTrace {
  id: string; // "<componentId>:<quantity>"
  componentId: string;
  quantity: ScopeQuantity;
  label: string;
  color: string;
  samples: ScopeSample[];
}

export interface ScopeState {
  visible: boolean;
  traces: ScopeTrace[];
  windowSeconds: number; // width of the visible time window
}

export interface CircuitState {
  components: Component[];
  wires: Wire[];
  selectedId: string | null;
  selectedWireId: string | null;
  running: boolean;
  view: View;
  solution: Solution | null;
  scope: ScopeState;
  canUndo: boolean;
  canRedo: boolean;
  message: string | null; // transient status line for the UI
}

// ---- WebMCP surface (kept structurally identical to the grapher's) ----

export interface JsonSchema {
  type: string;
  description?: string;
  enum?: readonly string[];
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
