// Ready-made scenes. Each one is a standard first-year mechanics problem set
// up in the box, with a note saying what it demonstrates and which number is
// worth changing -- the agent reads that note before it starts teaching.

import * as physics from './store';

export interface Preset {
  title: string;
  note: string;
  /** Presets make claims that depend on it, so each one declares it. */
  friction?: boolean;
  build: () => void;
}

export const PRESETS: Record<string, Preset> = {
  free_fall: {
    title: 'Free fall',
    note: 'One ball released from 8 m with nothing else in the box. It should hit the floor at about 12.5 m/s after 1.28 s. Read the telemetry and check v² = 2gh against the measured landing speed.',
    build: () => {
      physics.addObject('ball', { x: 8, y: 8, radius: 0.35, mass: 1, restitution: 0.35 });
    },
  },

  ramp_slide: {
    title: 'Block on a ramp',
    note: 'A cube resting near the top of a ramp. With friction off (the default) the block accelerates down the slope at g·sinθ and then keeps going along the floor forever. Change the ramp height to change the angle and watch the acceleration change with it — then switch friction on and run the identical layout again to see how much of that is left.',
    build: () => {
      physics.addObject('ramp', { x: 4, y: 0.9, width: 3.2, height: 1.8 });
      physics.addObject('cube', { x: 2.9, y: 2.1, width: 0.7, height: 0.7, mass: 2 });
    },
  },

  projectile: {
    title: 'Projectile launch',
    note: 'A ball starting on the floor with 9 m/s at roughly 55°. With no air resistance the path is a parabola: compare the peak height the telemetry reports against v²sin²θ / 2g, and the range against v²sin(2θ)/g.',
    build: () => {
      const ball = physics.addObject('ball', { x: 1.6, y: 0.5, radius: 0.3, mass: 0.5, restitution: 0.4 });
      if (ball.ok) physics.setStartVelocity(String(ball.id), 5.2, 7.4, 'start', 0);
    },
  },

  coaster_dip: {
    title: 'Coaster dip',
    note: 'A cart released at the top of one side of a valley, with friction off. Watch height turn into speed and back again: read kinetic and potential energy at the bottom and at the top and check they add to roughly the same total. Curved track is built from many short straight segments, so the cart loses a few percent of its energy per pass at the joints and each swing is a little lower than the last — the trend is the lesson, not the last decimal.',
    build: () => {
      physics.addObject('coaster', { x: 8, y: 1.3, width: 7, height: 2.4 });
      physics.addObject('cart', { x: 5.1, y: 2.75, width: 1, height: 0.55, mass: 2, restitution: 0.05 });
    },
  },

  loop: {
    title: 'Loop the loop',
    note: 'A ball inside a circular track, started fast along the bottom, with friction off. Riding the inside of a loop of radius r needs at least v = sqrt(5gr) at the bottom to stay on the track over the top. Lower the starting velocity a little at a time and find the speed where the ball peels off.',
    build: () => {
      physics.addObject('loop', { x: 8, y: 2.0, width: 3.4, height: 3.4 });
      const ball = physics.addObject('ball', { x: 8, y: 0.65, radius: 0.28, mass: 1, restitution: 0.05 });
      if (ball.ok) physics.setStartVelocity(String(ball.id), 8.5, 0, 'start', 0);
    },
  },

  collision: {
    title: 'Head-on collision',
    note: 'Two balls sliding toward each other on the floor at equal speed, one twice the mass of the other. Momentum is conserved; how much kinetic energy survives depends on the bounciness, so set both restitutions to 0 for a perfectly inelastic hit and to 0.95 for a nearly elastic one, and compare.',
    build: () => {
      const a = physics.addObject('ball', { x: 4, y: 0.4, radius: 0.4, mass: 2, restitution: 0.5 });
      const b = physics.addObject('ball', { x: 12, y: 0.4, radius: 0.3, mass: 1, restitution: 0.5 });
      if (a.ok) physics.setStartVelocity(String(a.id), 3, 0, 'start', 0);
      if (b.ok) physics.setStartVelocity(String(b.id), -3, 0, 'start', 0);
    },
  },

  constant_push: {
    title: 'Constant push',
    note: 'A 3 kg cube on the floor with a 9 N horizontal force held for 2 seconds, then released. While the force acts the cube accelerates at F/m = 3 m/s²; after it stops the cube keeps its speed exactly, because friction is off and there is never any air resistance. Read the telemetry and check both halves: the speed rising at 3 m/s² to 6 m/s, then going flat at t = 2 s. It coasts into the right wall a little over a second later.',
    build: () => {
      const cube = physics.addObject('cube', { x: 1.5, y: 0.4, width: 0.8, height: 0.8, mass: 3, restitution: 0.05 });
      if (cube.ok) physics.addForce(String(cube.id), 9, 0, 'continuous', 2);
    },
  },

  friction_ramp: {
    title: 'Friction: three surfaces',
    note: 'Three identical 26.6° ramps with an identical 1 kg block on each, differing only in what the block is made of — rubber (mu 0.90 on concrete), steel (0.45) and ice (0.10). A block slides only when tanθ exceeds mu, and tan 26.6° = 0.50, so the rubber block should not move at all while the other two do, at g(sinθ − mu·cosθ): about 0.44 m/s² for steel and 3.51 m/s² for ice, against 4.39 m/s² if friction were off. Read the telemetry for each and compare. This is the one preset that starts with friction switched on.',
    friction: true,
    build: () => {
      const blocks: [number, 'rubber' | 'steel' | 'ice'][] = [[3, 'rubber'], [8, 'steel'], [13, 'ice']];
      for (const [cx, material] of blocks) {
        physics.addObject('ramp', { x: cx, y: 0.8, width: 3.2, height: 1.6 });
        physics.addObject('cube', {
          x: cx - 0.99, y: 1.6, width: 0.5, height: 0.5,
          angle: -26.57, mass: 1, restitution: 0.05, material,
        });
      }
    },
  },

  bounce_test: {
    title: 'Bounce comparison',
    note: 'Three balls dropped from the same height with different bounciness (0.2, 0.5, 0.85). Each rebound reaches restitution² times the previous height, so this is the scene for talking about energy lost in an inelastic collision.',
    build: () => {
      physics.addObject('ball', { x: 4, y: 7, radius: 0.32, mass: 1, restitution: 0.2 });
      physics.addObject('ball', { x: 8, y: 7, radius: 0.32, mass: 1, restitution: 0.5 });
      physics.addObject('ball', { x: 12, y: 7, radius: 0.32, mass: 1, restitution: 0.85 });
    },
  },
};

export function presetNames(): { name: string; title: string; about: string }[] {
  return Object.entries(PRESETS).map(([name, preset]) => ({
    name,
    title: preset.title,
    about: preset.note,
  }));
}

export function loadPreset(name: string): { ok: boolean; error?: string; loaded?: string; note?: string; preset_sets_friction?: boolean } {
  const preset = PRESETS[name];
  if (!preset) {
    return { ok: false, error: `Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}.` };
  }
  // Clearing also returns the sandbox to the pre-simulation stage, so a preset
  // can be loaded straight from a finished run.
  physics.clearAll();
  // Set friction before building, so the note the agent reads back is true of
  // the scene it is looking at.
  physics.setFriction(preset.friction === true);
  preset.build();
  physics.select(null);
  // Not called `friction`: the tool merges summary() over this, which reports
  // the sandbox-wide friction state in prose under that name.
  return { ok: true, loaded: name, note: preset.note, preset_sets_friction: preset.friction === true };
}
