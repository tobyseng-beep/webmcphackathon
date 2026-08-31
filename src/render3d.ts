// three.js surface renderer for z = f(x,y). Orbiting with the mouse writes
// through store.setCamera, so `set_camera` and the user's drag are the same
// operation -- the agent can always read back where the camera actually is.

import * as THREE from 'three';
import { getState, scope, setCamera } from './store';
import type { Annotation, Expression, Viewport } from './types';

const SPAN = 10; // world half-width; viewport is normalized into [-SPAN, SPAN]
const GRID = 96;

let renderer: THREE.WebGLRenderer;
let sceneRoot: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let container: HTMLDivElement;
let labelLayer: HTMLDivElement;
const surfaces = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>>();
let axesGroup: THREE.Group;
let ready = false;

export function initRender3D(containerEl: HTMLDivElement, labelEl: HTMLDivElement): void {
  container = containerEl;
  labelLayer = labelEl;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);

  sceneRoot = new THREE.Scene();
  sceneRoot.background = new THREE.Color('#f7f9fc');

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);

  sceneRoot.add(new THREE.AmbientLight(0xffffff, 0.72));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(18, 22, 30);
  sceneRoot.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-20, -10, 12);
  sceneRoot.add(fill);

  buildAxes();
  attachInteraction();
  resize3D();
  window.addEventListener('resize', resize3D);
  ready = true;
  animate();
}

export function resize3D(): void {
  if (!renderer || !container) return;
  const rect = container.getBoundingClientRect();
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function buildAxes(): void {
  axesGroup = new THREE.Group();
  const mk = (a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  };
  const V = THREE.Vector3;
  axesGroup.add(mk(new V(-SPAN, 0, 0), new V(SPAN, 0, 0), 0xc74440));
  axesGroup.add(mk(new V(0, -SPAN, 0), new V(0, SPAN, 0), 0x388c46));
  axesGroup.add(mk(new V(0, 0, -SPAN), new V(0, 0, SPAN), 0x2d70b3));

  const grid = new THREE.GridHelper(SPAN * 2, 20, 0xc7d0dc, 0xe4e9f0);
  grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default; we want XY
  grid.position.z = -SPAN;
  axesGroup.add(grid);

  sceneRoot.add(axesGroup);
}

function surfaceGeometry(expr: Expression, view: Viewport): THREE.BufferGeometry {
  const { xmin, xmax, ymin, ymax } = view;
  const base = scope();
  const fn = expr.fn;
  if (!fn) return new THREE.BufferGeometry();
  const N = GRID;
  const positions = new Float32Array((N + 1) * (N + 1) * 3);
  const colors = new Float32Array((N + 1) * (N + 1) * 3);
  const zs = new Float32Array((N + 1) * (N + 1));

  let zlo = Infinity, zhi = -Infinity;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = xmin + (i / N) * (xmax - xmin);
      const y = ymin + (j / N) * (ymax - ymin);
      base.x = x; base.y = y;
      let evaluated: unknown;
      try { evaluated = fn.evaluate(base); } catch { evaluated = NaN; }
      const z = typeof evaluated === 'number' ? evaluated : Number(evaluated);
      const k = j * (N + 1) + i;
      zs[k] = z;
      if (Number.isFinite(z)) { if (z < zlo) zlo = z; if (z > zhi) zhi = z; }
    }
  }
  if (!Number.isFinite(zlo)) { zlo = -1; zhi = 1; }
  if (zhi - zlo < 1e-9) { zhi = zlo + 1; }

  // Clip extreme values so one pole does not flatten the whole surface.
  const clipLo = Math.max(zlo, view.zmin);
  const clipHi = Math.min(zhi, view.zmax);
  const lo = clipHi > clipLo ? clipLo : zlo;
  const hi = clipHi > clipLo ? clipHi : zhi;
  const zScale = SPAN / Math.max(Math.abs(lo), Math.abs(hi), 1e-6);

  const cold = new THREE.Color('#2d70b3');
  const warm = new THREE.Color('#c74440');
  const tmp = new THREE.Color();

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const z = zs[k];
      const clamped = Number.isFinite(z) ? Math.min(hi, Math.max(lo, z)) : 0;
      positions[k * 3 + 0] = -SPAN + (i / N) * SPAN * 2;
      positions[k * 3 + 1] = -SPAN + (j / N) * SPAN * 2;
      positions[k * 3 + 2] = clamped * zScale;
      const t = (clamped - lo) / (hi - lo);
      tmp.copy(cold).lerp(warm, Number.isFinite(t) ? t : 0.5);
      colors[k * 3 + 0] = tmp.r; colors[k * 3 + 1] = tmp.g; colors[k * 3 + 2] = tmp.b;
    }
  }

  const indices = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1), d = c + 1;
      if (![zs[a], zs[b], zs[c], zs[d]].every(Number.isFinite)) continue;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.userData.zScale = zScale;
  return geo;
}

export function rebuild(): void {
  if (!ready) return;
  const state = getState();
  const wanted = state.expressions.filter((e) => e.kind === 'explicit_z' && e.visible && !e.error);
  const wantedIds = new Set(wanted.map((e) => e.id));

  for (const [id, mesh] of surfaces) {
    if (wantedIds.has(id)) continue;
    sceneRoot.remove(mesh);
    mesh.geometry.dispose();
    surfaces.delete(id);
  }

  for (const expr of wanted) {
    const geo = surfaceGeometry(expr, state.viewport);
    const existing = surfaces.get(expr.id);
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geo;
      existing.userData.zScale = geo.userData.zScale;
    } else {
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.96,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.zScale = geo.userData.zScale;
      sceneRoot.add(mesh);
      surfaces.set(expr.id, mesh);
    }
  }
}

function applyCamera(): void {
  const { theta, phi, distance } = getState().camera;
  const th = (theta * Math.PI) / 180;
  const ph = (phi * Math.PI) / 180;
  camera.position.set(
    distance * Math.sin(ph) * Math.cos(th),
    distance * Math.sin(ph) * Math.sin(th),
    distance * Math.cos(ph)
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
}

function worldFor(note: Annotation): THREE.Vector3 {
  const { xmin, xmax, ymin, ymax } = getState().viewport;
  const anySurface = surfaces.values().next().value;
  const storedScale = anySurface?.userData.zScale;
  const zScale = typeof storedScale === 'number' ? storedScale : 1;
  return new THREE.Vector3(
    -SPAN + ((note.x - xmin) / (xmax - xmin)) * SPAN * 2,
    -SPAN + ((note.y - ymin) / (ymax - ymin)) * SPAN * 2,
    (note.z ?? 0) * zScale
  );
}

function drawLabels(): void {
  if (!labelLayer) return;
  const state = getState();
  const notes = state.annotations;
  while (labelLayer.children.length > notes.length) labelLayer.lastElementChild?.remove();
  while (labelLayer.children.length < notes.length) {
    const el = document.createElement('div');
    el.className = 'label3d';
    labelLayer.appendChild(el);
  }
  const rect = container.getBoundingClientRect();
  notes.forEach((note, i) => {
    const el = labelLayer.children[i] as HTMLElement;
    const v = worldFor(note).project(camera);
    const behind = v.z > 1;
    el.textContent = note.text;
    el.style.display = behind ? 'none' : 'block';
    el.style.left = `${(v.x * 0.5 + 0.5) * rect.width}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * rect.height}px`;
  });
}

function animate(): void {
  requestAnimationFrame(animate);
  if (getState().mode !== '3d' || !ready) return;
  applyCamera();
  renderer.render(sceneRoot, camera);
  drawLabels();
}

function attachInteraction(): void {
  const el = renderer.domElement;
  let dragging = false;
  let last: [number, number] = [0, 0];
  el.addEventListener('pointerdown', (e) => {
    dragging = true; last = [e.clientX, e.clientY];
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const cam = getState().camera;
    setCamera({
      theta: cam.theta - (e.clientX - last[0]) * 0.4,
      phi: cam.phi - (e.clientY - last[1]) * 0.4,
    });
    last = [e.clientX, e.clientY];
  });
  const end = () => { dragging = false; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    setCamera({ distance: getState().camera.distance * Math.exp(e.deltaY * 0.0015) });
  }, { passive: false });
}
