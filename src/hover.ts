// Coordinate readout box that follows the cursor over the 2D canvas or the 3D
// surface. Both renderers report the raw graph coordinate under the pointer
// here; this module applies snapping (if enabled) and formatting, and
// positions the box, so the two renderers do not each reimplement the rule.

import { getState } from './store';
import { decimalsForStep, snapToMinorGrid } from './gridmath';

let box: HTMLDivElement;
let stageEl: HTMLElement;

export function initHoverBox(boxEl: HTMLDivElement, stage: HTMLElement): void {
  box = boxEl;
  stageEl = stage;
}

export interface HoverAxis {
  label: string;
  value: number;
  /** Spacing of the major grid line for this axis; minor lines are 1/5 of this. */
  majorStep: number;
}

/** `pageX`/`pageY` are viewport coordinates (e.g. from a PointerEvent). */
export function showHover(pageX: number, pageY: number, axes: HoverAxis[]): void {
  if (!box || !stageEl) return;
  const snapping = getState().snapping;

  const parts = axes.map(({ label, value, majorStep }) => {
    const result = snapping ? snapToMinorGrid(value, majorStep) : { value, snapped: false };
    const decimals = decimalsForStep(majorStep) + 1;
    return `${label}: ${result.value.toFixed(decimals)}`;
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
}

export function hideHover(): void {
  if (box) box.hidden = true;
}
