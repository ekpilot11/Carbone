import { A_CONSTANT, IOL_MODEL, LENS_FACTOR } from "./constants";
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

/** Why a calculation can't run, as a key the UI turns into the current language. */
export type PlanProblem = "partialOd" | "partialOs" | "empty";

export type CalculationPlan = { ok: true; sides: EyeSide[] } | { ok: false; reason: PlanProblem };

/**
 * The calculator accepts a single eye, so each eye must be either fully
 * filled in or fully empty — a half-filled eye is treated as a mistake
 * rather than silently dropped.
 */
export function planCalculation(od: EyeRowState, os: EyeRowState): CalculationPlan {
  const partial = (row: EyeRowState) => !isRowEmpty(row) && !isRowComplete(row);
  if (partial(od)) return { ok: false, reason: "partialOd" };
  if (partial(os)) return { ok: false, reason: "partialOs" };

  const sides: EyeSide[] = [];
  if (isRowComplete(od)) sides.push("OD");
  if (isRowComplete(os)) sides.push("OS");
  if (sides.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, sides };
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

/**
 * Applies the K1-is-lower convention even to hand-edited values: if the
 * clinician typed them the other way round, they're swapped rather than
 * sent through mislabeled.
 */
export function toEyeInput(row: EyeRowState, lens: string): EyeInput {
  const kValues = [Number(row.k1), Number(row.k2)];
  const k1 = Math.min(...kValues);
  const k2 = Math.max(...kValues);
  return {
    side: row.side,
    keratometry: { k1, k2 },
    biometry: {
      axialLength: Number(row.axialLength),
      acd: Number(row.acd),
      lensThickness: optionalNumber(row.lensThickness),
      wtw: optionalNumber(row.wtw),
    },
    manual: { targetRefraction: Number(row.targetRefraction) },
    // The constants ride along for a personal-constant run; for a named lens
    // the calculator supplies its own and these are ignored.
    iol: { iolModel: IOL_MODEL, lens, aConstant: A_CONSTANT, lensFactor: LENS_FACTOR },
  };
}

/**
 * The manual-entry fallback. A named lens carries the calculator's own
 * constants, so this practice's personal constants are listed only when
 * they actually apply — copying them under a named lens would invite
 * typing them over the site's values.
 */
export function formatRowForClipboard(row: EyeRowState, lens: string): string {
  const personal = isPersonalConstant(lens);
  return [
    `${row.side}:`,
    `  Measured K1: ${row.k1 || "?"} D`,
    `  Measured K2: ${row.k2 || "?"} D`,
    `  Axial Length: ${row.axialLength || "?"} mm`,
    `  Optical ACD: ${row.acd || "?"} mm`,
    row.lensThickness ? `  Lens Thickness: ${row.lensThickness} mm` : null,
    row.wtw ? `  WTW: ${row.wtw} mm` : null,
    `  Lens: ${lens}`,
    `  IOL Optic: ${IOL_MODEL}`,
    personal ? `  A Constant: ${A_CONSTANT}` : null,
    personal ? `  Lens Factor: ${LENS_FACTOR}` : null,
    `  Refraction (target): ${row.targetRefraction || "?"} D`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
