import type { EvalFunction, MathNode } from 'mathjs';

export type BoardMode = '2d' | '3d';
export type ExpressionKind =
  | 'empty'
  | 'error'
  | 'explicit_y'
  | 'explicit_x'
  | 'explicit_z'
  | 'polar'
  | 'implicit'
  | 'point';

export type NumericScope = Record<string, number>;

export interface Expression {
  id: string;
  latex: string;
  color: string;
  visible: boolean;
  kind: ExpressionKind;
  fn: EvalFunction | null;
  node: MathNode | null;
  source?: string;
  error: string | null;
  vars: string[];
}

export interface Slider {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface Viewport {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  zmin: number;
  zmax: number;
}

export interface CameraState {
  theta: number;
  phi: number;
  distance: number;
}

export interface Annotation {
  id: string;
  x: number;
  y: number;
  z: number | null;
  text: string;
}

export interface BoardState {
  mode: BoardMode;
  expressions: Expression[];
  sliders: Slider[];
  annotations: Annotation[];
  viewport: Viewport;
  camera: CameraState;
  snapping: boolean;
  snapToCurve: boolean;
}

export type MutationReason =
  | 'expressions'
  | 'sliders'
  | 'viewport'
  | 'camera'
  | 'mode'
  | 'annotations'
  | 'settings';

export interface SliderSpec {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
}

export interface ExpressionPatch {
  latex?: string;
  color?: string;
  visible?: boolean;
}

export type Success<T extends object = object> = { ok: true } & T;
export type Failure = { ok: false; error: string };
export type Result<T extends object = object> = Success<T> | Failure;

export interface Preset {
  title: string;
  mode: BoardMode;
  viewport: Partial<Viewport> & Pick<Viewport, 'xmin' | 'xmax' | 'ymin' | 'ymax'>;
  camera?: Partial<CameraState>;
  sliders: Array<Slider & { name: string }>;
  expressions: string[];
  teaching_note: string;
}

export interface JsonSchema {
  type: string;
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
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
