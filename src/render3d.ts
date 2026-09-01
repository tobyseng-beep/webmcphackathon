// three.js surface renderer for z = f(x,y). Orbiting with the mouse writes
// through store.setCamera, so `set_camera` and the user's drag are the same
// operation -- the agent can always read back where the camera actually is.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { getState, scope, setCamera } from './store';
import type { Annotation, Expression, Viewport } from './types';

const SPAN = 10;
const GRID = 96;

let renderer: THREE.WebGLRenderer;
let sceneRoot: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let container: HTMLDivElement;
let labelLayer: HTMLDivElement;
const surfaces = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>>();
let axesGroup: THREE.Group | null = null;
let axesViewportKey = '';
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

  buildAxes(getState().viewport);
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

interface WorldTransform {
  x: (value: number) => number;
  y: (value: number) => number;
  z: (value: number) => number;
}

function worldTransform(view: Viewport): WorldTransform {
  const maxExtent = Math.max(
    Math.abs(view.xmin),
    Math.abs(view.xmax),
    Math.abs(view.ymin),
    Math.abs(view.ymax),
    Math.abs(view.zmin),
    Math.abs(view.zmax),
    Number.EPSILON,
  );
  const scale = SPAN / maxExtent;

  return {
    x: (value) => value * scale,
    y: (value) => value * scale,
    z: (value) => value * scale,
  };
}

function buildAxes(view: Viewport): void {
  const viewportKey = [
    view.xmin, view.xmax, view.ymin, view.ymax, view.zmin, view.zmax,
  ].join(':');
  if (axesGroup && viewportKey === axesViewportKey) return;

  if (axesGroup) {
    sceneRoot.remove(axesGroup);
    axesGroup.traverse((object) => {
      if (object instanceof THREE.Line) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
  }

  const world = worldTransform(view);
  axesGroup = new THREE.Group();
  const mk = (a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.renderOrder = 2;
    return line;
  };
  const V = THREE.Vector3;
  const x0 = world.x(0), y0 = world.y(0), z0 = world.z(0);
  axesGroup.add(mk(new V(world.x(view.xmin), y0, z0), new V(world.x(view.xmax), y0, z0), 0xc74440));
  axesGroup.add(mk(new V(x0, world.y(view.ymin), z0), new V(x0, world.y(view.ymax), z0), 0x388c46));
  axesGroup.add(mk(new V(x0, y0, world.z(view.zmin)), new V(x0, y0, world.z(view.zmax)), 0x2d70b3));

  const gridSize = Math.max(
    Math.abs(world.x(view.xmin)),
    Math.abs(world.x(view.xmax)),
    Math.abs(world.y(view.ymin)),
    Math.abs(world.y(view.ymax)),
  ) * 2;
  const grid = new THREE.GridHelper(gridSize, 20, 0xc7d0dc, 0xe4e9f0);
  grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default; we want XY
  grid.position.z = z0;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const material of gridMaterials) {
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    material.opacity = 1;
  }
  grid.renderOrder = 0;
  axesGroup.add(grid);

  sceneRoot.add(axesGroup);
  axesViewportKey = viewportKey;
}

function surfaceGeometry(expr: Expression, view: Viewport): THREE.BufferGeometry {
  const { xmin, xmax, ymin, ymax } = view;
  const world = worldTransform(view);
  const base = scope();
  const fn = expr.fn;
  if (!fn) return new THREE.BufferGeometry();
  const N = GRID;

  interface SurfaceVertex {
    x: number;
    y: number;
    z: number;
  }

  const samples: Array<SurfaceVertex | null> = new Array((N + 1) * (N + 1));

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = xmin + (i / N) * (xmax - xmin);
      const y = ymin + (j / N) * (ymax - ymin);
      base.x = x; base.y = y;
      let evaluated: unknown;
      try { evaluated = fn.evaluate(base); } catch { evaluated = NaN; }
      const z = typeof evaluated === 'number' ? evaluated : Number(evaluated);
      const k = j * (N + 1) + i;
      samples[k] = Number.isFinite(z) ? { x, y, z } : null;
    }
  }

  const cold = new THREE.Color('#2d70b3');
  const warm = new THREE.Color('#c74440');
  const tmp = new THREE.Color();
  const positions: number[] = [];
  const colors: number[] = [];

  const interpolateAtZ = (a: SurfaceVertex, b: SurfaceVertex, z: number): SurfaceVertex => {
    const t = (z - a.z) / (b.z - a.z);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z,
    };
  };

  const clipAtZ = (
    polygon: SurfaceVertex[],
    bound: number,
    keepAbove: boolean,
  ): SurfaceVertex[] => {
    if (polygon.length === 0) return polygon;
    const clipped: SurfaceVertex[] = [];
    let previous = polygon[polygon.length - 1];
    let previousInside = keepAbove ? previous.z >= bound : previous.z <= bound;

    for (const current of polygon) {
      const currentInside = keepAbove ? current.z >= bound : current.z <= bound;
      if (currentInside !== previousInside) {
        clipped.push(interpolateAtZ(previous, current, bound));
      }
      if (currentInside) clipped.push(current);
      previous = current;
      previousInside = currentInside;
    }
    return clipped;
  };

  const appendVertex = (vertex: SurfaceVertex): void => {
    positions.push(world.x(vertex.x), world.y(vertex.y), world.z(vertex.z));
    const t = Math.min(1, Math.max(0, (vertex.z - view.zmin) / (view.zmax - view.zmin)));
    tmp.copy(cold).lerp(warm, t);
    colors.push(tmp.r, tmp.g, tmp.b);
  };

  const appendTriangle = (
    a: SurfaceVertex | null,
    b: SurfaceVertex | null,
    c: SurfaceVertex | null,
  ): void => {
    if (!a || !b || !c) return;
    let polygon = clipAtZ([a, b, c], view.zmin, true);
    polygon = clipAtZ(polygon, view.zmax, false);
    for (let i = 1; i + 1 < polygon.length; i++) {
      appendVertex(polygon[0]);
      appendVertex(polygon[i]);
      appendVertex(polygon[i + 1]);
    }
  };

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1), d = c + 1;
      appendTriangle(samples[a], samples[c], samples[b]);
      appendTriangle(samples[b], samples[c], samples[d]);
    }
  }

  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  raw.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const geo = mergeVertices(raw);
  raw.dispose();
  geo.computeVertexNormals();
  return geo;
}

export function rebuild(): void {
  if (!ready) return;
  const state = getState();
  buildAxes(state.viewport);
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
    } else {
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
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
  const world = worldTransform(getState().viewport);
  return new THREE.Vector3(
    world.x(note.x),
    world.y(note.y),
    world.z(note.z ?? 0),
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
