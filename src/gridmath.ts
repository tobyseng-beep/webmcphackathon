// Grid-line math shared by the 2D canvas grid, the 3D hover readout, and the
// coordinate snapping feature. Kept in one place so the lines a snap locks to
// are always the same lines a renderer would actually draw.

/** A "nice" (1/2/5 * 10^n) spacing that divides `span` into roughly `target` steps. */
export function niceStep(span: number, target: number): number {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return mult * mag;
}

/** How many decimal places a label needs to distinguish steps of this size. */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, -Math.floor(Math.log10(step)));
}

export interface SnapResult {
  value: number;
  snapped: boolean;
}

/**
 * Snap `raw` to the nearest minor grid line (majorStep / subdivisions apart)
 * when it is within a quarter of that minor spacing, otherwise leave it be.
 */
export function snapToMinorGrid(raw: number, majorStep: number, subdivisions = 5): SnapResult {
  if (!Number.isFinite(raw) || !Number.isFinite(majorStep) || majorStep <= 0) {
    return { value: raw, snapped: false };
  }
  const minor = majorStep / subdivisions;
  const nearest = Math.round(raw / minor) * minor;
  const threshold = minor / 4;
  if (Math.abs(raw - nearest) <= threshold) return { value: nearest, snapped: true };
  return { value: raw, snapped: false };
}
