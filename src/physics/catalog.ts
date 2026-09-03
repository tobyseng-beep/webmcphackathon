// The library the sidebar renders and the tools describe: design tools, static
// blocks, and movable objects. One definition per entry, so the palette, the
// WebMCP `list_library` tool and the geometry builder can never drift apart.

import type { Material, Shape, ToolId, Vec2 } from './types';

/* ---------------- shape builders ---------------- */

/** A rectangle centred on the local origin, wound counter-clockwise. */
export function rectShape(w: number, h: number): Shape {
  return {
    kind: 'poly',
    verts: [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ],
  };
}

/** Turn a polyline into a chain of thin quads, so a track can bear weight. */
export function thickenPolyline(points: Vec2[], thickness: number): Shape[] {
  const half = thickness / 2;
  const shapes: Shape[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i];
    const q = points[i + 1];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    // Overrun each end by half the thickness so the joints do not gap.
    const ax = p.x - ux * half;
    const ay = p.y - uy * half;
    const bx = q.x + ux * half;
    const by = q.y + uy * half;
    shapes.push({
      kind: 'poly',
      verts: [
        { x: ax - nx * half, y: ay - ny * half },
        { x: bx - nx * half, y: by - ny * half },
        { x: bx + nx * half, y: by + ny * half },
        { x: ax + nx * half, y: ay + ny * half },
      ],
    });
  }
  return shapes;
}

export const TRACK_THICKNESS = 0.16;

function arcPoints(w: number, h: number, from: number, to: number, steps: number, cx: number, cy: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push({ x: cx + w * Math.cos(t), y: cy + h * Math.sin(t) });
  }
  return pts;
}

/* ---------------- design tools ---------------- */

export interface DesignTool {
  id: ToolId;
  title: string;
  blurb: string;
  icon: string;
}

export const DESIGN_TOOLS: DesignTool[] = [
  {
    id: 'select',
    title: 'Select',
    blurb: 'Click an object to select it, drag it to move it. Only works before the run starts.',
    icon: '<path d="M18 6 L18 24 L23 19 L26.5 26 L30 24.5 L26.5 17.5 L33 17 Z" fill="currentColor"/>',
  },
  {
    id: 'draw',
    title: 'Draw line',
    blurb: 'Drag inside the box to draw a solid line. Drawn lines are fixed in place and bear weight, like the floor.',
    icon: '<path d="M6 24 C 16 24, 18 8, 28 8 C 36 8, 38 16, 44 16" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="6" cy="24" r="2.4" fill="currentColor"/>',
  },
  {
    id: 'erase',
    title: 'Erase',
    blurb: 'Click any object to delete it. The walls and floor of the box cannot be erased.',
    icon: '<path d="M12 24 L22 8 L36 8 L26 24 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><line x1="8" y1="26" x2="40" y2="26" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  },
  {
    id: 'force',
    title: 'Force',
    blurb: 'Drag from an object to aim a force arrow. Choose a one-off kick at the start, or a push held for up to 10 seconds.',
    icon: '<circle cx="12" cy="16" r="5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1.8"/><line x1="18" y1="16" x2="36" y2="16" stroke="currentColor" stroke-width="2.4"/><path d="M42 16 L34 11.5 L34 20.5 Z" fill="currentColor"/>',
  },
  {
    id: 'velocity',
    title: 'Velocity',
    blurb: 'Drag from an object to set how fast it is already moving when the run starts, or hold that speed for up to 10 seconds.',
    icon: '<circle cx="12" cy="16" r="5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1.8"/><line x1="19" y1="16" x2="38" y2="16" stroke="currentColor" stroke-width="2.4" stroke-dasharray="4 3"/><path d="M43 16 L35 11.5 L35 20.5 Z" fill="currentColor"/><path d="M8 8 L14 8 M8 24 L14 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
];

/* ---------------- blocks and objects ---------------- */

export type Section = 'block' | 'object';

export interface LibraryEntry {
  type: string;
  title: string;
  section: Section;
  kind: 'static' | 'dynamic';
  blurb: string;
  icon: string;
  color: string;
  width: number; // default footprint in metres
  height: number;
  radius: number; // circles only
  mass: number; // kg, dynamic objects only
  restitution: number;
  material: Material; // default surface; friction is looked up per pair
  /** Which size fields the inspector and set_property expose. */
  sizing: 'wh' | 'r';
  build: (w: number, h: number, r: number) => Shape[];
}

const CATALOG_LIST: LibraryEntry[] = [
  /* ---- blocks: fixed scenery that bears weight ---- */
  {
    type: 'ramp',
    title: 'Ramp',
    section: 'block',
    kind: 'static',
    blurb: 'A right-triangle incline. The classic "block slides down a slope" setup — rotate it to face the other way.',
    icon: '<path d="M6 25 L42 25 L6 7 Z" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    color: '#64748b',
    width: 3.2, height: 1.8, radius: 0,
    mass: 0, restitution: 0.2, sizing: 'wh',
    material: 'concrete',
    build: (w, h) => [{
      kind: 'poly',
      verts: [
        { x: -w / 2, y: -h / 2 },
        { x: w / 2, y: -h / 2 },
        { x: -w / 2, y: h / 2 },
      ],
    }],
  },
  {
    type: 'platform',
    title: 'Platform',
    section: 'block',
    kind: 'static',
    blurb: 'A flat shelf fixed in mid-air. Drop things onto it, or launch them off the end.',
    icon: '<rect x="5" y="13" width="38" height="5" rx="1.5" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="2"/>',
    color: '#64748b',
    width: 3, height: 0.28, radius: 0,
    mass: 0, restitution: 0.2, sizing: 'wh',
    material: 'concrete',
    build: (w, h) => [rectShape(w, h)],
  },
  {
    type: 'wall',
    title: 'Wall',
    section: 'block',
    kind: 'static',
    blurb: 'A fixed vertical barrier. Use it to stop a slide, or as one side of a channel.',
    icon: '<rect x="21" y="4" width="6" height="24" rx="1.5" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="2"/>',
    color: '#64748b',
    width: 0.3, height: 2.4, radius: 0,
    mass: 0, restitution: 0.2, sizing: 'wh',
    material: 'concrete',
    build: (w, h) => [rectShape(w, h)],
  },
  {
    type: 'step',
    title: 'Block',
    section: 'block',
    kind: 'static',
    blurb: 'A solid immovable box. Stack a few into steps, or use one as a table for a collision demo.',
    icon: '<rect x="12" y="9" width="24" height="16" rx="1.5" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="2"/>',
    color: '#64748b',
    width: 1.4, height: 1, radius: 0,
    mass: 0, restitution: 0.2, sizing: 'wh',
    material: 'concrete',
    build: (w, h) => [rectShape(w, h)],
  },
  {
    type: 'curve',
    title: 'Quarter-pipe',
    section: 'block',
    kind: 'static',
    blurb: 'A concave curved ramp. A ball released on it converts height into speed smoothly, with no corner to bounce off.',
    icon: '<path d="M6 6 C 6 22, 14 25, 42 25" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
    color: '#475569',
    width: 3, height: 2, radius: 0,
    mass: 0, restitution: 0.15, sizing: 'wh',
    material: 'steel',
    build: (w, h) => thickenPolyline(
      arcPoints(w, h, Math.PI, 1.5 * Math.PI, 60, w / 2, h / 2),
      TRACK_THICKNESS,
    ),
  },
  {
    type: 'coaster',
    title: 'Coaster dip',
    section: 'block',
    kind: 'static',
    blurb: 'A valley of track: high at both ends, low in the middle. Frictionless, so a cart released on one side climbs back to the same height on the other.',
    icon: '<path d="M5 8 C 14 8, 16 24, 24 24 C 32 24, 34 8, 43 8" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
    color: '#475569',
    width: 6, height: 2, radius: 0,
    mass: 0, restitution: 0.1, sizing: 'wh',
    material: 'steel',
    build: (w, h) => {
      const pts: Vec2[] = [];
      const steps = 140;
      for (let i = 0; i <= steps; i++) {
        const x = -w / 2 + (w * i) / steps;
        pts.push({ x, y: (-h / 2) * Math.cos((2 * Math.PI * x) / w) });
      }
      return thickenPolyline(pts, TRACK_THICKNESS);
    },
  },
  {
    type: 'loop',
    title: 'Loop',
    section: 'block',
    kind: 'static',
    blurb: 'A closed circular track. Put a ball inside it and give it a fast sideways start: above a critical speed it stays on the track over the top, below it the ball leaves the wall and falls — which is the whole lesson.',
    icon: '<circle cx="24" cy="15" r="11" stroke="currentColor" stroke-width="3" fill="none"/>',
    color: '#475569',
    width: 3.4, height: 3.4, radius: 0,
    mass: 0, restitution: 0.1, sizing: 'wh',
    material: 'steel',
    build: (w, h) => thickenPolyline(
      arcPoints(w / 2, h / 2, 0, 2 * Math.PI, 160, 0, 0),
      TRACK_THICKNESS,
    ),
  },

  /* ---- objects: things that move once the run starts ---- */
  {
    type: 'ball',
    title: 'Ball',
    section: 'object',
    kind: 'dynamic',
    blurb: 'A solid ball. Bounces a few times before settling — raise its bounciness to keep it going longer.',
    icon: '<circle cx="24" cy="15" r="10" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="11" r="2.6" fill="currentColor" fill-opacity="0.5"/>',
    color: '#2d70b3',
    width: 0.7, height: 0.7, radius: 0.35,
    mass: 1, restitution: 0.45, sizing: 'r',
    material: 'rubber',
    build: (_w, _h, r) => [{ kind: 'circle', r }],
  },
  {
    type: 'cube',
    title: 'Cube',
    section: 'object',
    kind: 'dynamic',
    blurb: 'A square block. It topples and rotates on impact, so it is the one to use when the lesson is about torque or tipping.',
    icon: '<rect x="14" y="5" width="20" height="20" rx="2" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="2"/>',
    color: '#7c3aed',
    width: 0.7, height: 0.7, radius: 0,
    mass: 1, restitution: 0.15, sizing: 'wh',
    material: 'wood',
    build: (w, h) => [rectShape(w, h)],
  },
  {
    type: 'cart',
    title: 'Cart',
    section: 'object',
    kind: 'dynamic',
    blurb: 'A roller-coaster car. Heavier and wider than a cube, meant to be released onto a dip or sent through the loop.',
    icon: '<path d="M9 8 L39 8 L36 20 L12 20 Z" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="17" cy="24" r="3.4" fill="currentColor"/><circle cx="31" cy="24" r="3.4" fill="currentColor"/>',
    color: '#b45309',
    width: 1, height: 0.55, radius: 0,
    mass: 2, restitution: 0.1, sizing: 'wh',
    material: 'steel',
    build: (w, h) => [rectShape(w, h)],
  },
  {
    type: 'plank',
    title: 'Plank',
    section: 'object',
    kind: 'dynamic',
    blurb: 'A long thin bar. Balance it across two blocks for a see-saw, or drop it flat to show how a long body lands.',
    icon: '<rect x="5" y="12" width="38" height="6" rx="1.5" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="2"/>',
    color: '#0f766e',
    width: 1.8, height: 0.2, radius: 0,
    mass: 1.5, restitution: 0.1, sizing: 'wh',
    material: 'wood',
    build: (w, h) => [rectShape(w, h)],
  },
];

export const CATALOG: Record<string, LibraryEntry> = Object.fromEntries(
  CATALOG_LIST.map((entry) => [entry.type, entry]),
);

export const BLOCK_TYPES = CATALOG_LIST.filter((e) => e.section === 'block').map((e) => e.type);
export const OBJECT_TYPES = CATALOG_LIST.filter((e) => e.section === 'object').map((e) => e.type);
export const PLACEABLE_TYPES = [...BLOCK_TYPES, ...OBJECT_TYPES];

/** Drawn lines are not in the palette but share the body machinery. */
export const LINE_COLOR = '#334155';
