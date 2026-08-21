/**
 * This practice's own constants, used unless a lens is picked from the
 * dropdown. They start in the form and stay editable. Keep in sync with
 * backend/src/constants.ts.
 */
export const IOL_MODEL = "Biconvex";

/**
 * What the form starts with. The pair is deliberately consistent — 1.36 is
 * the Lens Factor the calculator derives from an A Constant of 118 — so
 * whichever of the two is typed into the site, it settles on the same
 * place. An inconsistent default would mean the untouched box quietly
 * overruling the one that was set.
 */
export const A_CONSTANT = 118;
export const LENS_FACTOR = 1.36;

/**
 * The calculator's own reference pair, and the slope through it.
 *
 * Not the same thing as the defaults above, and it must not be confused
 * with them: this is where the *calculator's* constant line is anchored,
 * and every one of the 37 lenses in its dropdown sits on it (which is what
 * `lenses.test.ts` checks). Changing what this practice pre-fills must
 * never move that line.
 */
export const CONSTANT_LINE = {
  aConstant: 118.4,
  lensFactor: 1.57,
  aPerLensFactor: 1.9195,
} as const;

/**
 * The bands the calculator itself prints beside those two fields
 * ("(-2.0~5.0)" and "(112~125)"). A value outside them would be rejected by
 * the site, so it is caught here instead of after a wasted run.
 */
export const CONSTANT_RANGES = {
  lensFactor: { min: -2, max: 5 },
  aConstant: { min: 112, max: 125 },
} as const;

/**
 * How the calculator ties its two constants together.
 *
 * They are one value in two units: type into either box on the site and it
 * recomputes the other from this relationship. Every one of the 37 lenses in
 * its own dropdown follows it exactly — which is what `lenses.test.ts`
 * checks, and why it can be relied on here.
 *
 * It is used only to show, in this form, what the site is about to hold. The
 * calculation itself uses the site's own arithmetic: one constant is typed
 * in, the site derives its partner, and both are read back off the page
 * afterwards.
 */
export function aConstantFor(lensFactor: number): number {
  const { aConstant, lensFactor: anchor, aPerLensFactor } = CONSTANT_LINE;
  return Number((aConstant + (lensFactor - anchor) * aPerLensFactor).toFixed(2));
}

export function lensFactorFor(aConstant: number): number {
  const { aConstant: anchor, lensFactor, aPerLensFactor } = CONSTANT_LINE;
  return Number((lensFactor + (aConstant - anchor) / aPerLensFactor).toFixed(2));
}

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
