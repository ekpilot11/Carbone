/**
 * Helpers for reading numbers out of OCR text from thermal-printed
 * ophthalmology reports. Every pattern here was derived from real OCR
 * output of the clinic's printouts (see the fixtures in the parser tests),
 * not from what the printouts look like to a human.
 */

/**
 * OCR routinely splits a decimal across whitespace ("22 .98", "45 . 06",
 * "43, 04") and reads the separator as a comma. Rejoining these first lets
 * every downstream pattern use one simple number shape.
 */
export function normalizeOcrNumbers(text: string): string {
  return text.replace(/(\d)\s*[.,]\s*(\d)/g, "$1.$2");
}

export interface Range {
  min: number;
  max: number;
}

/**
 * Physiologic input ranges, taken from the Barrett calculator's own field
 * hints. Values outside these are OCR noise — filtering on them is what
 * lets the parsers ignore corrupted digits instead of feeding a wrong
 * number into a surgical calculation.
 */
export const RANGES = {
  keratometry: { min: 30, max: 60 },
  axialLength: { min: 12, max: 38 },
  acd: { min: 0.5, max: 6 },
  lensThickness: { min: 2, max: 8 },
  vitreousDepth: { min: 5, max: 30 },
} as const satisfies Record<string, Range>;

export function inRange(value: number | undefined, range: Range): value is number {
  return value !== undefined && Number.isFinite(value) && value >= range.min && value <= range.max;
}

/** Every decimal number in the text, in reading order. */
export function decimalsIn(text: string): number[] {
  return [...text.matchAll(/\d+\.\d+/g)].map((m) => Number.parseFloat(m[0]));
}
