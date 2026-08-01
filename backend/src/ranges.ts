export interface Range {
  min: number;
  max: number;
}

/**
 * Physiologic input ranges, taken from the Barrett calculator's own field
 * hints. Anything outside these is a misread, not a measurement — the scan
 * endpoint drops such values rather than letting them reach a surgical
 * calculation. Keep in sync with frontend/src/lib/ocrText.ts.
 */
export const RANGES = {
  keratometry: { min: 30, max: 60 },
  axialLength: { min: 12, max: 38 },
  acd: { min: 0.5, max: 6 },
  lensThickness: { min: 2, max: 8 },
  wtw: { min: 8, max: 14 },
} as const satisfies Record<string, Range>;

export function inRange(value: unknown, range: Range): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;
}
