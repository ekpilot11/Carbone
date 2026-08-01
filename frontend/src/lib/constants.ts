/**
 * This practice's own constants, used unless a lens is picked from the
 * dropdown. They start in the form and stay editable. Keep in sync with
 * backend/src/constants.ts.
 */
export const IOL_MODEL = "Biconvex";
export const A_CONSTANT = 118.4;
export const LENS_FACTOR = 1.57;

/**
 * The bands the calculator itself prints beside those two fields
 * ("(-2.0~5.0)" and "(112~125)"). A value outside them would be rejected by
 * the site, so it is caught here instead of after a wasted run.
 */
export const CONSTANT_RANGES = {
  lensFactor: { min: -2, max: 5 },
  aConstant: { min: 112, max: 125 },
} as const;

export function constantInRange(value: string, range: { min: number; max: number }): boolean {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed >= range.min && parsed <= range.max;
}

/**
 * The calculator's keratometric index radio pair, at the top of its form.
 * 1.3375 is the site's default and what nearly every keratometer reports
 * against; 1.332 is the true corneal refractive index, used by some
 * devices. Kept as strings so they match the site's own labels exactly.
 */
export const K_INDEX_OPTIONS = ["1.3375", "1.332"] as const;
export type KIndex = (typeof K_INDEX_OPTIONS)[number];
export const DEFAULT_K_INDEX: KIndex = "1.3375";
