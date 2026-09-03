// Numeric argument checking shared by every board's mutation layer.
//
// Tool arguments arrive as arbitrary JSON, so a number-typed field can turn up
// as a string, null or nothing at all. Left unchecked those become NaN, and NaN
// is uniquely bad here: it fails every comparison, so range checks wave it
// through, and it lands in state as a null that no reading can explain. The
// board ends up broken with nothing having reported a problem.
//
// Guards live in the stores rather than in the tools, so the on-screen controls
// are covered by the same check.

/** An error message when `value` is not a finite number, or null when it is. */
export function badNumber(label: string, value: unknown): string | null {
  if (Number.isFinite(Number(value)) && value !== null && value !== '') return null;
  return `${label} must be a number; got ${JSON.stringify(value)}.`;
}

/**
 * Check several labelled values at once, skipping any that are undefined --
 * an omitted optional argument is not an error. Returns the first complaint.
 */
export function badNumbers(entries: Record<string, unknown>): string | null {
  for (const [label, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    const problem = badNumber(label, value);
    if (problem) return problem;
  }
  return null;
}
