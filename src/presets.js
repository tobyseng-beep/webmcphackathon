// Lesson presets. These are the seam the Physics 1 / Physics 2 modes plug into
// later: a preset is just an expression set plus slider ranges plus a viewport.

export const PRESETS = {
  sine_family: {
    title: 'Transformations of a sine wave',
    mode: '2d',
    viewport: { xmin: -7, xmax: 7, ymin: -5, ymax: 5 },
    sliders: [
      { name: 'A', min: -4, max: 4, step: 0.01, value: 1 },
      { name: 'B', min: 0.1, max: 5, step: 0.01, value: 1 },
      { name: 'C', min: -3.14, max: 3.14, step: 0.01, value: 0 },
      { name: 'D', min: -3, max: 3, step: 0.01, value: 0 },
    ],
    expressions: ['y = A*sin(B*(x - C)) + D'],
    teaching_note: 'A is amplitude, B is angular frequency (period = 2pi/B), C is phase shift, D is vertical offset. Animate one at a time so the student can attribute the change.',
  },
  parabola_family: {
    title: 'Standard-form parabola',
    mode: '2d',
    viewport: { xmin: -8, xmax: 8, ymin: -6, ymax: 8 },
    sliders: [
      { name: 'a', min: -3, max: 3, step: 0.01, value: 1 },
      { name: 'b', min: -6, max: 6, step: 0.01, value: 0 },
      { name: 'c', min: -6, max: 6, step: 0.01, value: 0 },
    ],
    expressions: ['y = a*x^2 + b*x + c'],
    teaching_note: 'Vertex sits at x = -b/(2a). Increasing |a| narrows the parabola because the same rise is reached at a smaller x. Use find_features to name the vertex and roots.',
  },
  projectile: {
    title: 'Projectile trajectory',
    mode: '2d',
    viewport: { xmin: -1, xmax: 26, ymin: -1, ymax: 12 },
    sliders: [
      { name: 'v', min: 1, max: 25, step: 0.1, value: 14 },
      { name: 'a', min: 0.05, max: 1.5, step: 0.01, value: 0.8 },
      { name: 'g', min: 1, max: 20, step: 0.1, value: 9.8 },
    ],
    expressions: ['y = tan(a)*x - (g*x^2)/(2*v^2*(cos(a))^2)'],
    teaching_note: 'Trajectory of a projectile launched at angle a (radians) with speed v. Range is maximised at a = pi/4 with no drag -- animate a from 0.1 to 1.4 and let the student watch the range peak and fall back.',
  },
  damped_oscillator: {
    title: 'Damped harmonic motion',
    mode: '2d',
    viewport: { xmin: 0, xmax: 20, ymin: -4, ymax: 4 },
    sliders: [
      { name: 'A', min: 0, max: 4, step: 0.01, value: 3 },
      { name: 'k', min: 0, max: 1, step: 0.005, value: 0.15 },
      { name: 'w', min: 0.1, max: 6, step: 0.01, value: 2 },
    ],
    expressions: ['y = A*e^(-k*x)*cos(w*x)', 'y = A*e^(-k*x)', 'y = -A*e^(-k*x)'],
    teaching_note: 'The second and third expressions are the decay envelope. Raising k shrinks the envelope without changing the oscillation rate -- a clean way to separate damping from frequency.',
  },
  wave_beats: {
    title: 'Beats from two close frequencies',
    mode: '2d',
    viewport: { xmin: 0, xmax: 40, ymin: -3, ymax: 3 },
    sliders: [
      { name: 'w', min: 0.5, max: 5, step: 0.01, value: 2 },
      { name: 'd', min: 0, max: 1, step: 0.005, value: 0.2 },
    ],
    expressions: ['y = sin(w*x) + sin((w + d)*x)'],
    teaching_note: 'The beat envelope has angular frequency d/2. Animating d from 0 upward makes the beat pattern appear out of a pure tone.',
  },
  rc_charging: {
    title: 'RC charging curve',
    mode: '2d',
    viewport: { xmin: 0, xmax: 10, ymin: -0.5, ymax: 6 },
    sliders: [
      { name: 'V', min: 0, max: 5, step: 0.01, value: 5 },
      { name: 'R', min: 0.1, max: 5, step: 0.01, value: 1 },
      { name: 'C', min: 0.1, max: 5, step: 0.01, value: 1 },
    ],
    expressions: ['y = V*(1 - e^(-x/(R*C)))', 'y = V'],
    teaching_note: 'One time constant is RC, where the capacitor reaches 63.2% of V. The flat line is the asymptote. Changing R and C by reciprocal amounts leaves the curve unchanged -- a good "why" question.',
  },
  unit_circle: {
    title: 'Circle as an implicit equation',
    mode: '2d',
    viewport: { xmin: -8, xmax: 8, ymin: -6, ymax: 6 },
    sliders: [{ name: 'r', min: 0.1, max: 6, step: 0.01, value: 3 }],
    expressions: ['x^2 + y^2 = r^2'],
    teaching_note: 'This is not a function of x, so it is rendered as an implicit contour. Good for showing why the vertical line test matters.',
  },
  saddle: {
    title: 'Saddle surface',
    mode: '3d',
    viewport: { xmin: -4, xmax: 4, ymin: -4, ymax: 4, zmin: -16, zmax: 16 },
    camera: { theta: 40, phi: 62, distance: 36 },
    sliders: [],
    expressions: ['z = x^2 - y^2'],
    teaching_note: 'The origin is a critical point that is a minimum along x and a maximum along y -- a saddle. Use set_camera to orbit to phi near 85 so the student sees the crossing curvature edge-on.',
  },
  gaussian_hill: {
    title: 'Gaussian hill',
    mode: '3d',
    viewport: { xmin: -4, xmax: 4, ymin: -4, ymax: 4, zmin: -1, zmax: 4 },
    camera: { theta: 35, phi: 62, distance: 34 },
    sliders: [
      { name: 'A', min: 0, max: 4, step: 0.01, value: 3 },
      { name: 's', min: 0.2, max: 4, step: 0.01, value: 1.2 },
    ],
    expressions: ['z = A*e^(-(x^2 + y^2)/s^2)'],
    teaching_note: 'A scales height, s scales width. Useful for building intuition before introducing the 2D normal distribution.',
  },
  ripple: {
    title: 'Radial ripple',
    mode: '3d',
    viewport: { xmin: -8, xmax: 8, ymin: -8, ymax: 8, zmin: -2, zmax: 2 },
    camera: { theta: 30, phi: 58, distance: 36 },
    sliders: [{ name: 'k', min: 0.2, max: 4, step: 0.01, value: 1.4 }],
    expressions: ['z = sin(k*sqrt(x^2 + y^2))/(1 + sqrt(x^2 + y^2))'],
    teaching_note: 'A decaying radial wave. Raising k packs the rings closer without changing the decay -- separates wavelength from amplitude falloff.',
  },
};

export function presetNames() {
  return Object.entries(PRESETS).map(([name, p]) => ({ name, title: p.title, mode: p.mode }));
}
