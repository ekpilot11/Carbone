/**
 * This practice always uses the same IOL design, so these are fixed rather
 * than re-entered per patient. Keep in sync with frontend/src/lib/constants.ts.
 */
export const IOL_MODEL = "Biconvex";

/**
 * What the form starts with. The pair is consistent — 1.36 is the Lens
 * Factor the calculator derives from an A Constant of 118 — so it doesn't
 * matter which of the two gets typed into the site: it lands in the same
 * place either way. (These are the practice's defaults, not the anchor of
 * the calculator's own constant line; that is 1.57 / 118.4 and lives in the
 * frontend's CONSTANT_LINE.)
 */
export const A_CONSTANT = 118;
export const LENS_FACTOR = 1.36;

/**
 * The calculator's default lens-dropdown option: "use the constants I typed
 * in" — i.e. this practice's A Constant / Lens Factor above. Every other
 * option carries the manufacturer's own constants, which the site fills in
 * itself; those are never guessed here.
 */
export const PERSONAL_CONSTANT = "Personal Constant";

/**
 * The calculator's keratometric index radio pair. Kept as strings so they
 * match the site's own "K Index 1.3375" / "K Index 1.332" labels exactly.
 * Keep in sync with frontend/src/lib/constants.ts.
 */
export const K_INDEX_OPTIONS = ["1.3375", "1.332"] as const;
export type KIndex = (typeof K_INDEX_OPTIONS)[number];
export const DEFAULT_K_INDEX: KIndex = "1.3375";
