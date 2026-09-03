// Coordinate readout box that follows the cursor over the 2D canvas or the 3D
// surface. Both renderers report the raw graph coordinate under the pointer
// here; this module applies snapping (if enabled) and formatting, and
// positions the box, so the two renderers do not each reimplement the rule.

import { getState } from './store';
import { decimalsForStep, snapToMinorGrid } from './gridmath';

let box: HTMLDivElement;
let dot: HTMLDivElement | null = null;
let stageEl: HTMLElement;
let snapCursor: HTMLDivElement | null = null;
let markerLayer: HTMLDivElement | null = null;

export function initHoverBox(
  boxEl: HTMLDivElement,
  stage: HTMLElement,
  dotEl?: HTMLDivElement,
  cursorEl?: HTMLDivElement,
  markersEl?: HTMLDivElement,
): void {
  box = boxEl;
  stageEl = stage;
  dot = dotEl ?? null;
  snapCursor = cursorEl ?? null;
  markerLayer = markersEl ?? null;
}

/**
 * Put the stand-in pointer at a viewport coordinate, tip first, or hide it.
 * The SVG's hotspot is its top-left corner, matching a real arrow cursor.
 */
export function showSnapCursor(point: { x: number; y: number } | null): void {
  if (!snapCursor || !stageEl) return;
  if (!point) { snapCursor.hidden = true; return; }
  const rect = stageEl.getBoundingClientRect();
  snapCursor.style.left = `${point.x - rect.left}px`;
  snapCursor.style.top = `${point.y - rect.top}px`;
  snapCursor.hidden = false;
}

/** Viewport coordinates of a point worth marking. */
export interface MarkerSpec {
  x: number;
  y: number;
}

/**
 * Ring each curve/curve crossing with the same circle the cursor wears when it
 * snaps, so the board reads in one visual language: a circle means "a point you
 * can land on". The cursor's own is filled, these are hollow, so the live
 * pointer is never confused with a place it could go.
 */
export function showIntersectionMarkers(markers: MarkerSpec[]): void {
  if (!markerLayer || !stageEl) return;
  const rect = stageEl.getBoundingClientRect();

  // Keep the node count in step with the marker count, then place what is left.
  while (markerLayer.children.length > markers.length) markerLayer.lastElementChild?.remove();
  while (markerLayer.children.length < markers.length) {
    const el = document.createElement('div');
    el.className = 'intersection-dot';
    markerLayer.append(el);
  }
  markers.forEach((marker, i) => {
    const el = markerLayer!.children[i] as HTMLDivElement;
    el.style.left = `${marker.x - rect.left}px`;
    el.style.top = `${marker.y - rect.top}px`;
    el.hidden = false;
  });
}

export interface HoverAxis {
  label: string;
  value: number;
  /** Spacing of the major grid line for this axis; minor lines are 1/5 of this. */
  majorStep: number;
  /**
   * Pre-resolved value that overrides ordinary grid snapping (e.g. the caller
   * already snapped this axis onto a plotted curve). Ignored when snapping is
   * off, so the readout still shows the raw cursor position.
   */
  resolvedValue?: number;
}

/**
 * `pageX`/`pageY` are viewport coordinates (e.g. from a PointerEvent) used to
 * anchor the readout box. When `marker` is given (the snapped point on a
 * curve, in viewport coordinates) a dot is drawn there; pass null to hide it.
 */
export function showHover(
  pageX: number,
  pageY: number,
  axes: HoverAxis[],
  marker?: { x: number; y: number } | null,
): void {
  if (!box || !stageEl) return;
  const snapping = getState().snapping;

  const parts = axes.map(({ label, value, majorStep, resolvedValue }) => {
    // A value already resolved onto a curve always wins; otherwise the grid
    // toggle decides between a grid-snapped and a raw reading.
    const out = resolvedValue !== undefined ? resolvedValue
      : snapping ? snapToMinorGrid(value, majorStep).value
      : value;
    const decimals = decimalsForStep(majorStep) + 1;
    return `${label}: ${out.toFixed(decimals)}`;
  });
  box.textContent = parts.join('  ');
  box.hidden = false;

  const stageRect = stageEl.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  let left = pageX - stageRect.left + 14;
  let top = pageY - stageRect.top - 12;
  if (left + w > stageRect.width - 4) left = pageX - stageRect.left - w - 14;
  if (top < 4) top = pageY - stageRect.top + 18;
  if (top + h > stageRect.height - 4) top = stageRect.height - h - 4;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;

  if (dot) {
    if (marker) {
      dot.style.left = `${marker.x - stageRect.left}px`;
      dot.style.top = `${marker.y - stageRect.top}px`;
      dot.hidden = false;
    } else {
      dot.hidden = true;
    }
  }
}

export function hideHover(): void {
  if (box) box.hidden = true;
  if (dot) dot.hidden = true;
  if (snapCursor) snapCursor.hidden = true;
}
