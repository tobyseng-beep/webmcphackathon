// WebMCP surface for the physics sandbox. Every execute() routes into
// src/physics/store.ts -- the same functions the palette and canvas use.
// Descriptions are written as instructions to a competent colleague, since the
// description is the only context the agent has when choosing a tool.

import * as physics from './store';
import {
  BLOCK_TYPES,
  CATALOG,
  DESIGN_TOOLS,
  OBJECT_TYPES,
  PLACEABLE_TYPES,
} from './catalog';
import { MATERIALS, MATERIAL_ABOUT, frictionPairs } from './materials';
import { PRESETS, loadPreset, presetNames } from './presets';
import type { ApplyMode, Body, Material, WebMcpTool } from './types';

const round = (v: number, places = 3): number => +v.toFixed(places);

/** The house rules, repeated wherever an agent might need them. */
const RULES = [
  'Gravity and normal (contact) forces always act. Friction is a switch, off by default — see set_friction. With it off the sandbox models the idealised frictionless problems a first mechanics course sets; with it on, Coulomb friction acts at every contact. There is never any air resistance.',
  'Friction belongs to the pair of surfaces touching, not to one object: every object has a material (rubber, wood, steel, concrete, ice) and the coefficient comes from a table of material pairs. Call list_friction_pairs for the table, and set the material with set_property. The model uses one coefficient per pair rather than separate static and kinetic values, and there is no rolling resistance, so a ball that is rolling rather than sliding keeps rolling.',
  'Positions are in metres with +y upward and the origin at the bottom-left inside corner of the box. Velocities are m/s, forces newtons, masses kilograms, angles degrees counter-clockwise.',
  'The floor and the two side walls are solid supports and bear weight. The top is open, so a launched object can leave the top of the view and fall back in.',
  'Objects can only be added, moved or edited in the pre-simulation ("design") stage, where nothing acts on them and they simply float where you put them.',
  'A run ends when you call end_simulation, when every movable object has been at rest for 5 seconds, or after 30 seconds — whichever comes first.',
  `At most ${physics.OBJECT_CAP} objects can be in the box at once (the box walls do not count).`,
  'Flat surfaces and free flight are exact: free fall, projectile arcs, F=ma and momentum in a collision all match the textbook equations closely. Curved tracks (quarter-pipe, coaster dip, loop) are built from many short straight segments, so a body riding one loses a few percent of its energy per pass at the joints. Teach the trend on those, not the last decimal place.',
];

function describeBody(body: Body): Record<string, unknown> {
  const state = physics.getState();
  const entry = CATALOG[body.type];
  const out: Record<string, unknown> = {
    id: body.id,
    type: body.type,
    label: body.label,
    moves: body.kind === 'dynamic',
    position: { x: round(body.x), y: round(body.y) },
    angle_deg: round((body.angle * 180) / Math.PI, 1),
    restitution: body.restitution,
    material: body.material,
  };
  if (state.friction) {
    const floor = physics.bodyById('floor');
    if (floor) out.friction_vs_floor = physics.frictionBetween(body, floor);
  }
  if (body.type === 'line') out.size = { length_m: round(body.width, 2) };
  else if (entry?.sizing === 'r') out.size = { radius_m: round(body.radius, 3) };
  else out.size = { width_m: round(body.width, 3), height_m: round(body.height, 3) };

  if (body.kind === 'dynamic') {
    out.mass_kg = round(body.mass);
    out.velocity = { vx: round(body.vx), vy: round(body.vy) };
    out.speed_m_s = round(Math.hypot(body.vx, body.vy));
    out.angular_velocity_rad_s = round(body.omega);
    out.kinetic_energy_J = round(physics.kineticEnergy(body));
    out.potential_energy_J = round(physics.potentialEnergy(body));
    out.momentum_kg_m_s = { px: round(body.mass * body.vx), py: round(body.mass * body.vy) };
    out.forces_now_N = physics.activeForces(body).map((f) => ({
      source: f.label, fx: round(f.fx), fy: round(f.fy),
    }));
    if (body.forces.length > 0) {
      out.planned_forces = body.forces.map((f) => ({
        force_id: f.id,
        mode: f.mode,
        fx: f.fx,
        fy: f.fy,
        unit: f.mode === 'start' ? 'N·s' : 'N',
        duration_s: f.duration,
      }));
    }
    if (body.velocity) {
      out.planned_velocity = {
        mode: body.velocity.mode,
        vx: body.velocity.vx,
        vy: body.velocity.vy,
        duration_s: body.velocity.duration,
      };
    }
    if (state.stage !== 'design') {
      out.at_rest_for_s = round(body.restFor, 2);
      out.resting_on_support = physics.isSupported(body);
      out.max_speed_m_s = round(body.maxSpeed);
      out.max_height_m = round(body.maxHeight);
      out.distance_travelled_m = round(body.pathLength, 2);
    }
  }
  return out;
}

function summary(): Record<string, unknown> {
  const state = physics.getState();
  const objects = physics.userBodies();
  const movable = objects.filter((b) => b.kind === 'dynamic');
  const out: Record<string, unknown> = {
    stage: state.stage,
    stage_meaning: state.stage === 'design'
      ? 'Pre-simulation: objects float, no forces act, and everything can be edited.'
      : state.stage === 'running'
        ? 'Simulating: gravity and contact forces are acting.'
        : state.stage === 'paused'
          ? 'Simulating but paused mid-run. Call resume_simulation to continue, or end_simulation to finish.'
          : 'Post-simulation: everything is frozen where it stopped. Call retry_simulation or reset_simulation to edit again.',
    time_s: round(state.time),
    time_limit_s: physics.MAX_RUN_SECONDS,
    gravity_m_s2: state.gravity,
    friction_enabled: state.friction,
    friction: state.friction ? 'on — Coulomb friction at every contact, coefficient from the material pair' : 'off — frictionless, the idealised case',
    world_box: { width_m: state.world.width, height_m: state.world.height, origin: 'bottom-left inside corner, +y up' },
    objects_used: objects.length,
    object_cap: state.objectCap,
    movable_objects: movable.length,
    active_design_tool: state.tool,
    // Bumped by every change from either side; compare against the last value
    // you saw to know whether the sandbox moved under you.
    revision: physics.changes.revision(),
    objects: objects.map(describeBody),
  };
  if (state.stage === 'running') {
    out.all_at_rest_for_s = round(physics.restProgress(), 2);
    out.auto_end_when_at_rest_for_s = physics.REST_SECONDS;
  }
  if (state.endReason) out.end_reason = state.endReason;
  return out;
}

function energyTotals(): Record<string, unknown> {
  const movable = physics.userBodies().filter((b) => b.kind === 'dynamic');
  let ke = 0;
  let pe = 0;
  let px = 0;
  let py = 0;
  for (const body of movable) {
    ke += physics.kineticEnergy(body);
    pe += physics.potentialEnergy(body);
    px += body.mass * body.vx;
    py += body.mass * body.vy;
  }
  return {
    kinetic_J: round(ke),
    potential_J: round(pe),
    total_mechanical_J: round(ke + pe),
    momentum_kg_m_s: { px: round(px), py: round(py) },
    note: 'Potential energy is measured from the floor (y = 0). With no friction or drag, the total should stay constant except where an inelastic collision removes some.',
  };
}

function mode(value: unknown): ApplyMode {
  return value === 'continuous' ? 'continuous' : 'start';
}

const toolDefinitions = [
  {
    name: 'describe_sandbox',
    description:
      'Read the rules and the current situation before you do anything else: which of the three stages the sandbox is in, the size of the box and where its origin is, the units every other tool uses, gravity, how many of the 15 object slots are used, and the physics that is and is not modelled (no friction, no air resistance). Call this first in a new conversation, and whenever you are unsure whether you are allowed to edit right now.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, rules: RULES, ...summary() }),
  },

  {
    name: 'list_library',
    description:
      'List everything that can be placed or used, in the three sections the student sees: design tools (select, draw line, erase, force, velocity), blocks (fixed scenery that bears weight — ramps, platforms, walls, quarter-pipes, coaster dips, loops) and objects (things that move once the run starts — ball, cube, cart, plank). Each entry gives its default size, default mass and a one-line note on what it is for. Read this before add_object so you pick a shape that actually matches the problem.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({
      ok: true,
      design_tools: DESIGN_TOOLS.map((t) => ({ id: t.id, title: t.title, about: t.blurb })),
      blocks: BLOCK_TYPES.map((type) => {
        const e = CATALOG[type];
        return {
          type, title: e.title, about: e.blurb, fixed_in_place: true,
          default_size: { width_m: e.width, height_m: e.height },
          default_material: e.material,
        };
      }),
      objects: OBJECT_TYPES.map((type) => {
        const e = CATALOG[type];
        return {
          type, title: e.title, about: e.blurb, fixed_in_place: false,
          default_size: e.sizing === 'r' ? { radius_m: e.radius } : { width_m: e.width, height_m: e.height },
          default_mass_kg: e.mass,
          default_restitution: e.restitution,
          default_material: e.material,
        };
      }),
      note: 'Blocks never move, no matter what hits them. Objects fall, bounce and rotate once the simulation starts.',
    }),
  },

  {
    name: 'list_objects',
    description:
      'Read everything in the box: every object with its id, type, position, angle, size, mass, bounciness, and — while a run is going — its velocity, speed, kinetic and potential energy, momentum, the forces acting on it right now, and how long it has been at rest. Call this whenever you are unsure what is on screen, and after any change you did not make yourself. The ids returned here are what every other tool expects.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, ...summary(), energy: energyTotals() }),
  },

  {
    name: 'get_object',
    description:
      'Everything about one object, including its full motion history so far (time, position and velocity sampled 20 times a second while the run is going). Use this to make a precise claim about one thing — "it was doing 12.4 m/s when it hit the floor" — instead of estimating from the picture.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Object id from list_objects.' } },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const body = physics.bodyById(String(args.id));
      if (!body) return { ok: false, error: `No object with id "${String(args.id)}".` };
      const samples = physics.getTelemetry(body.id);
      const step = Math.max(1, Math.ceil(samples.length / 60));
      return {
        ok: true,
        object: describeBody(body),
        history: samples.filter((_, i) => i % step === 0 || i === samples.length - 1),
        history_note: 'Sampled every 0.05 s while running, then downsampled to at most about 60 points. Call read_telemetry for the full series.',
      };
    },
  },

  {
    name: 'add_object',
    description:
      'Place something in the box during the pre-simulation stage. type is one of the block or object types from list_library — blocks (ramp, platform, wall, step, curve, coaster, loop) are fixed scenery that bears weight, objects (ball, cube, cart, plank) are what actually moves. Give x and y in metres from the bottom-left of the box; anything you place simply floats there until the run starts, so you can build the scene in any order. Optionally set the size, mass and restitution (bounciness, 0 = a dead stop, 1 = bounces back to the same height). Returns the new id, which every other tool expects.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: PLACEABLE_TYPES, description: 'What to place.' },
        x: { type: 'number', description: 'Centre x in metres, 0 at the left wall.' },
        y: { type: 'number', description: 'Centre y in metres, 0 at the floor.' },
        angle: { type: 'number', description: 'Rotation in degrees counter-clockwise. Handy for tilting a ramp or a platform.' },
        width: { type: 'number', description: 'Width in metres (rectangular and triangular shapes).' },
        height: { type: 'number', description: 'Height in metres (rectangular and triangular shapes).' },
        radius: { type: 'number', description: 'Radius in metres (ball only).' },
        mass: { type: 'number', description: 'Mass in kilograms. Ignored for blocks, which never move.' },
        restitution: { type: 'number', description: 'Bounciness from 0 to 0.98. 0.2 settles quickly, 0.85 bounces for a long time.' },
        material: { type: 'string', enum: MATERIALS, description: 'Surface material, which sets friction against whatever it touches. Only matters when friction is on. Defaults per type — see list_library.' },
      },
      required: ['type'],
    },
    execute: async (args: Record<string, unknown>) => {
      const num = (k: string): number | undefined => (args[k] === undefined ? undefined : Number(args[k]));
      const result = physics.addObject(String(args.type), {
        x: num('x'), y: num('y'), angle: num('angle'),
        width: num('width'), height: num('height'), radius: num('radius'),
        mass: num('mass'), restitution: num('restitution'),
        material: args.material as Material | undefined,
      });
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'draw_line',
    description:
      'Draw a solid line or curve from a list of points, the same thing the student gets from the draw tool. The result is one fixed object that bears weight exactly like the floor, so this is how you build a shape the block library does not have — an arbitrary slope, a funnel, a bowl, a stepped path. Give at least two points in metres; give many points to draw a curve. Counts as one object against the 15-object cap however many points you use.',
    inputSchema: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          description: 'The path, as [{x, y}, {x, y}, …] in metres. Two points make a straight line.',
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
        },
      },
      required: ['points'],
    },
    execute: async (args: Record<string, unknown>) => {
      const raw = Array.isArray(args.points) ? args.points : [];
      const points = raw
        .map((p) => (p && typeof p === 'object' ? { x: Number((p as Record<string, unknown>).x), y: Number((p as Record<string, unknown>).y) } : null))
        .filter((p): p is { x: number; y: number } => p !== null && Number.isFinite(p.x) && Number.isFinite(p.y));
      if (points.length < 2) return { ok: false, error: 'Give at least two points, as [{x, y}, {x, y}].' };
      const result = physics.drawLine(points);
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'move_object',
    description:
      'Move an object to a new centre position, in metres. Only works in the pre-simulation stage, where objects float wherever you put them regardless of what is underneath. Use this to line a ball up at the top of a ramp, or to drop something from a specific height.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        x: { type: 'number', description: 'New centre x in metres.' },
        y: { type: 'number', description: 'New centre y in metres.' },
      },
      required: ['id', 'x', 'y'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = physics.moveObject(String(args.id), Number(args.x), Number(args.y));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'rotate_object',
    description:
      'Set an object\'s angle in degrees counter-clockwise. Rotating a ramp turns the slope the other way; rotating a platform makes an incline out of it; rotating a plank stands it on end. Pre-simulation stage only.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        angle: { type: 'number', description: 'Angle in degrees, counter-clockwise from horizontal.' },
      },
      required: ['id', 'angle'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = physics.setAngle(String(args.id), Number(args.angle));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_property',
    description:
      'Change an object\'s mass, bounciness, size or surface material. This is the main teaching lever: double the mass and show that a frictionless slide is unaffected, raise restitution from 0.2 to 0.85 and watch the ball keep bouncing, or change the material from rubber to ice and watch the same block stop skidding. Material only matters while friction is switched on, and it is one half of a pair — see list_friction_pairs. Mass only applies to movable objects; blocks are immovable whatever you set. Pre-simulation stage only.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        mass: { type: 'number', description: 'Mass in kilograms (movable objects only).' },
        restitution: { type: 'number', description: 'Bounciness, 0 to 0.98.' },
        material: { type: 'string', enum: MATERIALS, description: 'Surface material, one half of the friction pair.' },
        width: { type: 'number', description: 'New width in metres.' },
        height: { type: 'number', description: 'New height in metres.' },
        radius: { type: 'number', description: 'New radius in metres (ball only).' },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const num = (k: string): number | undefined => (args[k] === undefined ? undefined : Number(args[k]));
      const result = physics.setProperty(String(args.id), {
        mass: num('mass'), restitution: num('restitution'),
        material: args.material as Material | undefined,
        width: num('width'), height: num('height'), radius: num('radius'),
      });
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_friction',
    description:
      'Switch Coulomb friction on or off for the whole sandbox. Off (the default) is the idealised frictionless case: a block on a slope always slides, and nothing sliding on the flat ever stops. On, every contact also resists sliding, with the coefficient taken from the materials of the two surfaces touching — so a rubber ball on concrete (mu 0.90) stops almost at once while steel on ice (mu 0.03) barely slows. The natural lesson is to run a scene both ways: start frictionless, then retry_simulation, turn friction on, and run the identical layout again. Pre-simulation stage only, so that a run stays reproducible.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true to switch friction on, false for the frictionless case.' },
      },
      required: ['enabled'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = physics.setFriction(Boolean(args.enabled));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'list_friction_pairs',
    description:
      'The friction table: the coefficient for every pair of the five materials (rubber, wood, steel, concrete, ice), what each material is like, and which material each object in the box currently has. Friction is a property of the pair in contact, not of one object, so this is what you quote when explaining why one block skids further than another — and what you read before choosing a material with set_property.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({
      ok: true,
      friction_enabled: physics.getState().friction,
      materials: MATERIALS.map((m) => ({ material: m, about: MATERIAL_ABOUT[m] })),
      pairs: frictionPairs().map((p) => ({ between: [p.a, p.b], mu: p.mu })),
      objects: physics.userBodies().map((b) => ({ id: b.id, type: b.type, material: b.material })),
      box: { floor_and_walls: 'concrete' },
      note: 'One coefficient per pair: static and kinetic friction are not modelled separately, and there is no rolling resistance.',
    }),
  },

  {
    name: 'apply_force',
    description:
      'Attach a force to a movable object, to be applied when the run starts. mode:"start" is a single kick at t=0 and fx/fy are an impulse in newton-seconds, so the object leaves with velocity impulse/mass. mode:"continuous" holds a steady push of fx/fy newtons from t=0 for duration seconds — at most 10 — and the object accelerates at F/m the whole time, then coasts (there is no friction to slow it afterwards). +x is right, +y is up. You can attach several forces to the same object; they add. Pre-simulation stage only.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Movable object id.' },
        fx: { type: 'number', description: 'Horizontal component: newtons if continuous, newton-seconds if a start kick.' },
        fy: { type: 'number', description: 'Vertical component, positive upward.' },
        mode: { type: 'string', enum: ['start', 'continuous'], description: 'A single kick at t=0, or a force held for up to 10 seconds. Defaults to "start".' },
        duration: { type: 'number', description: 'Seconds to hold a continuous force, 0.05 to 10.' },
      },
      required: ['id', 'fx', 'fy'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = physics.addForce(
        String(args.id), Number(args.fx), Number(args.fy),
        mode(args.mode), Number(args.duration ?? 1),
      );
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_velocity',
    description:
      'Give a movable object a velocity for the start of the run. mode:"start" means it is already travelling at vx, vy the instant the run begins and gravity takes over immediately — this is how you set up a projectile. mode:"continuous" holds it at exactly that velocity for duration seconds (at most 10), ignoring gravity while the hold lasts, then releases it — use it to drive something onto a ramp at a known speed. Replaces any velocity already set on that object. Pre-simulation stage only.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Movable object id.' },
        vx: { type: 'number', description: 'Horizontal velocity in m/s, positive to the right.' },
        vy: { type: 'number', description: 'Vertical velocity in m/s, positive upward.' },
        mode: { type: 'string', enum: ['start', 'continuous'], description: 'Starting velocity, or a velocity held for up to 10 seconds. Defaults to "start".' },
        duration: { type: 'number', description: 'Seconds to hold a continuous velocity, 0.05 to 10.' },
      },
      required: ['id', 'vx', 'vy'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = physics.setStartVelocity(
        String(args.id), Number(args.vx), Number(args.vy),
        mode(args.mode), Number(args.duration ?? 1),
      );
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'clear_motion',
    description:
      'Remove the forces and/or the starting velocity you attached to an object, leaving the object itself in place. Use what:"forces" to drop every force, what:"velocity" to drop the starting velocity, or what:"all" for both — for example to show the same scene falling under gravity alone.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        what: { type: 'string', enum: ['all', 'forces', 'velocity'], description: 'Defaults to "all".' },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const id = String(args.id);
      const what = args.what === 'forces' || args.what === 'velocity' ? args.what : 'all';
      let result: physics.Result = { ok: true };
      if (what === 'forces' || what === 'all') result = physics.clearForces(id);
      if (result.ok && (what === 'velocity' || what === 'all')) result = physics.clearVelocity(id);
      return result.ok ? { ...result, cleared: what, ...summary() } : result;
    },
  },

  {
    name: 'remove_object',
    description:
      'Delete one object from the box, freeing a slot against the 15-object cap. The floor and the side walls are part of the box and cannot be removed. Ask the student before deleting something they built themselves.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = physics.removeObject(String(args.id));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'set_gravity',
    description:
      'Change gravity in m/s². Earth is 9.81, the Moon 1.62, Jupiter 24.8, and 0 turns it off entirely so objects drift in straight lines. A memorable way to show that in the absence of air resistance the acceleration is the same for every mass. Pre-simulation stage only.',
    inputSchema: {
      type: 'object',
      properties: { gravity: { type: 'number', description: 'Downward acceleration in m/s², 0 to 50.' } },
      required: ['gravity'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = physics.setGravity(Number(args.gravity));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'select_design_tool',
    description:
      'Switch the tool the student\'s pointer is holding: "select" to move things, "draw" to draw lines by hand, "erase" to click objects away, "force" and "velocity" to drag arrows onto an object. You mostly do not need this — add_object, draw_line, apply_force and set_velocity all work regardless — but switching the visible tool makes what you are doing legible on screen while you narrate it.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: DESIGN_TOOLS.map((t) => t.id), description: 'Which design tool to hold.' },
      },
      required: ['tool'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = physics.setTool(args.tool as never);
      return { ...result, ...summary() };
    },
  },

  {
    name: 'start_simulation',
    description:
      'Leave the pre-simulation stage and start the run: gravity switches on, the forces and velocities you attached are applied, and everything floating falls. Needs at least one movable object. The run ends by itself once every object has been at rest for 5 seconds, or after 30 seconds, whichever comes first. Poll list_objects or read_simulation while it runs to narrate what is happening.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const result = physics.startSimulation();
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'pause_simulation',
    description:
      'Freeze the run where it is without ending it, so you can talk about a specific moment — the instant of a collision, or the top of an arc. Everything keeps its velocity; call resume_simulation to continue from exactly there.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const result = physics.pauseSimulation();
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'resume_simulation',
    description: 'Continue a paused run from where it stopped, with every velocity intact.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const result = physics.resumeSimulation();
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'end_simulation',
    description:
      'End the run now and move to the post-simulation stage: everything freezes exactly where it is, and the readings stay available so you can talk about the final state. This is the first of the three ways a run ends; the other two (everything at rest for 5 seconds, and the 30-second limit) happen on their own.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const result = physics.endSimulation('You ended the run.');
      return result.ok ? { ...result, ...summary(), energy: energyTotals() } : result;
    },
  },

  {
    name: 'retry_simulation',
    description:
      'Put every object back exactly where it was just before the last run started, including the forces and velocities that were attached, and return to the pre-simulation stage. This is the tool for "now change one thing and run it again" — retry, adjust a single value with set_property or set_velocity, then start_simulation, so the comparison is honest.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const result = physics.retrySimulation();
      return result.ok ? { ...result, ...summary() } : result;
    },
  },

  {
    name: 'reset_simulation',
    description:
      'Empty the box completely and return to the pre-simulation stage: every object, line, force and velocity is gone. Use retry_simulation instead if you only want to run the same scene again. Ask the student before wiping work they built themselves.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const result = physics.resetSimulation();
      return { ...result, ...summary() };
    },
  },

  {
    name: 'read_simulation',
    description:
      'The full live readout in one call: the stage and elapsed time, gravity, every object\'s position, velocity, speed, acceleration-producing forces, energies and momentum, plus the totals for kinetic energy, potential energy and momentum across the whole box. Call this before stating any number, so you quote a measurement instead of estimating one from the picture — and call it twice, a moment apart, when you want to describe how something is changing.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({
      ok: true,
      ...summary(),
      energy: energyTotals(),
      recent_events: physics.getState().events.slice(-8),
    }),
  },

  {
    name: 'read_changes',
    description:
      'What has changed in the sandbox, and who changed it. Every readback carries a `revision`; pass the last one you saw as `since` and this returns only what happened after it, oldest first. Each entry names the actor -- "user" for the student building the scene directly, "agent" for a tool call -- along with the action and the object it touched. This is the edit history, and is different from read_events: that one reports what the *physics* did during a run (collisions, coming to rest), while this reports what a *person* did to the scene. Dragging an object into place arrives as one entry spanning the drag.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'number', description: 'Return only changes after this revision. Omit for everything still held.' },
      },
    },
    execute: async (args: Record<string, unknown>) => (
      // Silently returning everything when `since` is unreadable would answer a
      // different question from the one that was asked.
      args.since !== undefined && !Number.isFinite(Number(args.since))
        ? { ok: false, error: `since must be a number; got ${JSON.stringify(args.since)}.` }
        : {
      ok: true,
      revision: physics.changes.revision(),
      changes: physics.changes.since(args.since === undefined ? undefined : Number(args.since)),
      note: 'Oldest first. Selecting an object is not a change and is not recorded.',
    }),
  },

  {
    name: 'read_telemetry',
    description:
      'The recorded motion of one object through the run: time, position and velocity sampled every 0.05 s. Use it to answer questions the live state cannot — when it was fastest, how high it actually got, how long it took to fall, whether the speed really went flat once a timed force stopped. Pass max_points to thin the series out before you read it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Object id.' },
        max_points: { type: 'number', description: 'Downsample to at most this many points. Defaults to 80.' },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      const id = String(args.id);
      const body = physics.bodyById(id);
      if (!body) return { ok: false, error: `No object with id "${id}".` };
      const samples = physics.getTelemetry(id);
      if (samples.length === 0) {
        return { ok: false, error: `No motion has been recorded for ${id} yet — start_simulation first.` };
      }
      const max = Math.max(2, Math.min(Number(args.max_points ?? 80), 400));
      const step = Math.max(1, Math.ceil(samples.length / max));
      const series = samples.filter((_, i) => i % step === 0 || i === samples.length - 1);
      return {
        ok: true,
        id,
        sample_interval_s: 0.05,
        points: series.length,
        max_speed_m_s: round(body.maxSpeed),
        max_height_m: round(body.maxHeight),
        distance_travelled_m: round(body.pathLength, 2),
        series,
      };
    },
  },

  {
    name: 'read_events',
    description:
      'The run\'s event log: when the run started, every collision with the two objects involved and the closing speed at impact, the moment everything came to rest, and why the run ended. This is what you narrate from — it turns "the ball bounced a few times" into "it hit the floor at 12.4 m/s, then at 6.1, then at 3.0".',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['all', 'collision'], description: 'Filter the log. Defaults to "all".' },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const events = physics.getState().events;
      const filtered = args.kind === 'collision' ? events.filter((e) => e.kind === 'collision') : events;
      return {
        ok: true,
        stage: physics.getState().stage,
        end_reason: physics.getState().endReason,
        count: filtered.length,
        events: filtered,
      };
    },
  },

  {
    name: 'load_preset',
    description:
      'Load a ready-made scene — objects, sizes, forces and velocities in one call — instead of building a standard problem piece by piece. Call with no arguments to list what is available. Each preset returns a note saying what it demonstrates and which number is worth changing, so read that before you start teaching. Loading a preset clears the box and returns to the pre-simulation stage, so call start_simulation afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: Object.keys(PRESETS), description: 'Preset key. Omit to list them.' },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      if (!args.name) return { ok: true, presets: presetNames(), note: 'Call again with one of these names.' };
      const result = loadPreset(String(args.name));
      return result.ok ? { ...result, ...summary() } : result;
    },
  },
];

export const TOOLS = toolDefinitions as unknown as WebMcpTool[];

export function registerTools(): { available: boolean; registered: number; host: string | null; reason?: string } {
  const host = document.modelContext ?? navigator.modelContext ?? null;
  if (!host) return { available: false, registered: 0, host: null };

  const hostName = document.modelContext ? 'document.modelContext' : 'navigator.modelContext';
  let registered = 0;

  if (typeof host.registerTool === 'function') {
    for (const tool of TOOLS) {
      try { host.registerTool(tool); registered++; }
      catch (err) { console.error(`[webmcp] failed to register ${tool.name}:`, err); }
    }
  } else if (typeof host.provideContext === 'function') {
    try { host.provideContext({ tools: TOOLS }); registered = TOOLS.length; }
    catch (err) { console.error('[webmcp] provideContext failed:', err); }
  } else {
    return { available: false, registered: 0, host: hostName, reason: 'no registerTool/provideContext method' };
  }
  return { available: true, registered, host: hostName };
}
