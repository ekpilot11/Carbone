/**
 * This practice always uses the same IOL design, so these are fixed rather
 * than re-entered per patient. Keep in sync with frontend/src/lib/constants.ts.
 */
export const IOL_MODEL = "Biconvex";
export const A_CONSTANT = 118.4;
export const LENS_FACTOR = 1.57;

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
