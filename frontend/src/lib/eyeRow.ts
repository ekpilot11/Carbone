import { IOL_MODEL } from "./constants";
import { isPersonalConstant } from "./lenses";
import type { BiometryReading, EyeInput, EyeSide, KeratometryReading } from "./types";

export interface EyeRowState {
  side: EyeSide;
  /** Measured K1 — by convention always the lower of the two K values. */
  k1: string;
  /** Measured K2 — by convention always the higher of the two K values. */
  k2: string;
  axialLength: string;
  acd: string;
  /** The calculator's "Optional:" block — blank is a valid, complete answer. */
  lensThickness: string;
  wtw: string;
  targetRefraction: string;
}

export function emptyRow(side: EyeSide): EyeRowState {
  return {
    side,
    k1: "",
    k2: "",
    axialLength: "",
    acd: "",
    lensThickness: "",
    wtw: "",
    // This practice always targets emmetropia; kept as an explicit, editable 0.
    targetRefraction: "0",
  };
}

export function applyKeratometry(row: EyeRowState, reading: KeratometryReading): EyeRowState {
  return {
    ...row,
    k1: reading.k1.toFixed(2),
    k2: reading.k2.toFixed(2),
  };
}

/**
 * Lens thickness and WTW are deliberately left alone: they are entered by
 * hand only, so a scan never overwrites (or blanks) what was typed.
 */
export function applyBiometry(row: EyeRowState, reading: BiometryReading): EyeRowState {
  return {
    ...row,
    axialLength: reading.axialLength.toFixed(2),
    acd: reading.acd.toFixed(2),
  };
}

export function isRowComplete(row: EyeRowState): boolean {
  return [row.k1, row.k2, row.axialLength, row.acd, row.targetRefraction].every(
    (value) => value.trim() !== "",
  );
}

/**
 * True when no measurement was entered for this eye. The refraction target
 * is ignored because it defaults to "0" on purpose.
 */
export function isRowEmpty(row: EyeRowState): boolean {
  return [row.k1, row.k2, row.axialLength, row.acd, row.lensThickness, row.wtw].every(
    (value) => value.trim() === "",
  );
}

/**
 * True when this eye's K values are in an impossible order.
 *
 * K1 is the flatter meridian by definition, so K1 greater than K2 is not a
 * finding — it is a typo, a swapped pair, or two values that came from
 * different eyes. Whichever it is, nobody can tell from the numbers alone,
 * so the eye is held back for a person rather than reordered into something
 * that looks plausible. Equal values are fine: a spherical cornea is real.
 */
export function kOrderSuspect(row: EyeRowState): boolean {
  const k1 = Number(row.k1);
  const k2 = Number(row.k2);
  if (row.k1.trim() === "" || row.k2.trim() === "") return false;
  return Number.isFinite(k1) && Number.isFinite(k2) && k1 > k2;
}

/** Complete, and not contradicting itself — what an eye needs to be sent. */
export function isRowUsable(row: EyeRowState): boolean {
  return isRowComplete(row) && !kOrderSuspect(row);
}

/** The values the calculator needs before it will accept an eye. */
export const REQUIRED_FIELDS = ["axialLength", "k1", "k2", "acd", "targetRefraction"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** Which required values this eye is still missing, in form order. */
export function missingFields(row: EyeRowState): RequiredField[] {
  return REQUIRED_FIELDS.filter((field) => row[field].trim() === "");
}

/** Why nothing can be calculated, as a key the UI turns into the current language. */
export type PlanProblem = "empty" | "nothingComplete";

export type CalculationPlan =
  | { ok: true; sides: EyeSide[]; skipped: EyeSide[]; suspect: EyeSide[] }
  | { ok: false; reason: PlanProblem; skipped: EyeSide[]; suspect: EyeSide[] };

/**
 * Decides which eyes go to the calculator.
 *
 * An eye is sent only when every value it needs is there. A half-read eye —
 * K values but no axial length, say, which is what a photo of a two-eye
 * topography strip and a one-eye A-scan gives you — is left out rather than
 * submitted incomplete, and the caller names it so the omission is visible.
 * The calculator accepts a single eye, so the other one still runs.
 */
export function planCalculation(od: EyeRowState, os: EyeRowState): CalculationPlan {
  const rows: Record<EyeSide, EyeRowState> = { OD: od, OS: os };
  const sides = (["OD", "OS"] as const).filter((side) => isRowUsable(rows[side]));
  // "Skipped" means started but unfinished; an untouched eye is simply absent.
  const skipped = (["OD", "OS"] as const).filter(
    (side) => !isRowEmpty(rows[side]) && !isRowComplete(rows[side]),
  );
  // Complete, but the K values contradict themselves — held back for a
  // person, and named so it is obvious why nothing happened.
  const suspect = (["OD", "OS"] as const).filter((side) => kOrderSuspect(rows[side]));

  if (sides.length > 0) return { ok: true, sides, skipped, suspect };
  return {
    ok: false,
    reason: skipped.length > 0 || suspect.length > 0 ? "nothingComplete" : "empty",
    skipped,
    suspect,
  };
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

/** The form-wide IOL settings: the lens dropdown plus its two constants. */
export interface LensSettings {
  lens: string;
  lensFactor: string;
  aConstant: string;
  /**
   * Which constant the clinician set. The calculator's two boxes are one
   * value in two units, so only one can be typed into it — the site derives
   * the other. Absent means the Lens Factor, which is where the form starts.
   */
  constantSource?: "lensFactor" | "aConstant";
}

/**
 * Sends the K values exactly as they stand.
 *
 * This used to quietly swap them when K1 came in higher than K2. That looks
 * like tidiness and is actually the opposite: a labelled pair in the wrong
 * order is a transcription error, and silently reordering it produces a
 * confident IOL power from numbers nobody has checked. K1 > K2 is now
 * refused upstream (see `kOrderSuspect`) and corrected by a person, so
 * anything reaching here has already been looked at.
 *
 * Reading two unlabelled numbers off a photographed printout is a different
 * matter — deciding which is K1 there is labelling, not correction, and the
 * scan path still does it.
 */
export function toEyeInput(row: EyeRowState, settings: LensSettings): EyeInput {
  return {
    side: row.side,
    keratometry: { k1: Number(row.k1), k2: Number(row.k2) },
    biometry: {
      axialLength: Number(row.axialLength),
      acd: Number(row.acd),
      lensThickness: optionalNumber(row.lensThickness),
      wtw: optionalNumber(row.wtw),
    },
    manual: { targetRefraction: Number(row.targetRefraction) },
    // The constants ride along for a personal-constant run; for a named lens
    // the calculator supplies its own and these are ignored.
    iol: {
      iolModel: IOL_MODEL,
      lens: settings.lens,
      aConstant: Number(settings.aConstant),
      lensFactor: Number(settings.lensFactor),
      constantSource: settings.constantSource,
    },
  };
}

/**
 * The manual-entry fallback. A named lens carries the calculator's own
 * constants, so this practice's personal constants are listed only when
 * they actually apply — copying them under a named lens would invite
 * typing them over the site's values.
 */
export function formatRowForClipboard(row: EyeRowState, settings: LensSettings): string {
  const personal = isPersonalConstant(settings.lens);
  return [
    `${row.side}:`,
    `  Measured K1: ${row.k1 || "?"} D`,
    `  Measured K2: ${row.k2 || "?"} D`,
    `  Axial Length: ${row.axialLength || "?"} mm`,
    `  Optical ACD: ${row.acd || "?"} mm`,
    row.lensThickness ? `  Lens Thickness: ${row.lensThickness} mm` : null,
    row.wtw ? `  WTW: ${row.wtw} mm` : null,
    `  Lens: ${settings.lens}`,
    `  IOL Optic: ${IOL_MODEL}`,
    personal ? `  A Constant: ${settings.aConstant}` : null,
    personal ? `  Lens Factor: ${settings.lensFactor}` : null,
    `  Refraction (target): ${row.targetRefraction || "?"} D`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
