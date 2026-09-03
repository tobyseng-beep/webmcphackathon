// Shared types for the 2D physics sandbox. The model is deliberately
// classroom-shaped: rigid bodies in a box, gravity and normal forces only --
// no friction and no air resistance -- so the numbers an agent reads back
// match the equations a student is being taught.

export interface Vec2 {
  x: number;
  y: number;
}

/** A convex collision shape in a body's local frame (centroid at the origin). */
export type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'poly'; verts: Vec2[] };

export type BodyKind = 'dynamic' | 'static';

/** Surface a body is made of. Friction is looked up per pair of these. */
export type Material = 'rubber' | 'wood' | 'steel' | 'concrete' | 'ice';

/** Three phases the whole page moves through, plus `paused` inside the run. */
export type Stage = 'design' | 'running' | 'paused' | 'ended';

/** A start-of-run kick, or a force held for up to 10 seconds. */
export type ApplyMode = 'start' | 'continuous';

export interface AppliedForce {
  id: string;
  fx: number; // newtons (continuous) or newton-seconds (start impulse)
  fy: number;
  mode: ApplyMode;
  duration: number; // seconds the force is held; ignored when mode is 'start'
}

export interface VelocitySpec {
  vx: number; // m/s
  vy: number;
  mode: ApplyMode;
  duration: number; // seconds the velocity is held; ignored when mode is 'start'
}

export interface Body {
  id: string;
  type: string; // catalog key: ball, cube, ramp, line, ...
  kind: BodyKind;
  label: string;

  x: number; // centre of mass, world metres, +y is up
  y: number;
  angle: number; // radians, counter-clockwise

  vx: number; // m/s
  vy: number;
  omega: number; // rad/s

  mass: number; // kg (Infinity-equivalent for statics: invMass 0)
  invMass: number;
  inertia: number;
  invInertia: number;
  restitution: number; // 0 = perfectly inelastic, 1 = perfectly elastic
  material: Material; // one half of a friction pair; only matters when friction is on

  shapes: Shape[]; // compound for drawn lines and curved tracks
  width: number; // nominal footprint, used by the inspector and resizing
  height: number;
  radius: number; // circles only

  color: string;
  forces: AppliedForce[];
  velocity: VelocitySpec | null;

  wall: boolean; // the box boundary itself: not user-owned, not counted
  restFor: number; // seconds this body has been below the rest threshold
  maxSpeed: number; // run statistics, reset at each start
  maxHeight: number;
  pathLength: number;
}

export type EventKind = 'start' | 'collision' | 'rest' | 'end' | 'note';

export interface PhysicsEvent {
  t: number; // simulation time, seconds
  kind: EventKind;
  a?: string; // body id
  b?: string; // the other body id, for collisions
  speed?: number; // approach speed along the contact normal, m/s
  text: string;
}

export interface TelemetrySample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type ToolId = 'select' | 'draw' | 'erase' | 'force' | 'velocity';

export interface WorldBox {
  width: number; // metres
  height: number;
}

export type ChangeReason =
  | 'bodies'
  | 'selection'
  | 'stage'
  | 'tool'
  | 'tick'
  | 'events';

export interface PhysicsState {
  stage: Stage;
  time: number; // seconds since the run started
  tool: ToolId;
  gravity: number; // m/s^2, positive magnitude pulling -y
  friction: boolean; // off by default: the idealised frictionless sandbox
  world: WorldBox;
  bodies: Body[];
  selectedId: string | null;
  events: PhysicsEvent[];
  endReason: string | null;
  canRetry: boolean;
  message: string | null;
  objectCap: number;
}

// ---- WebMCP surface (kept structurally identical to the other pages') ----

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
