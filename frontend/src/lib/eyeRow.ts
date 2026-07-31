import { A_CONSTANT, IOL_MODEL, LENS_FACTOR } from "./constants";
import type { BiometryReading, EyeInput, EyeSide, KeratometryReading } from "./types";

export interface EyeRowState {
  side: EyeSide;
  /** Measured K1 — by convention always the lower of the two K values. */
  k1: string;
  /** Measured K2 — by convention always the higher of the two K values. */
  k2: string;
  axialLength: string;
  acd: string;
  lensThickness: string;
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
    targetRefraction: "",
  };
}

export function applyKeratometry(row: EyeRowState, reading: KeratometryReading): EyeRowState {
  return {
    ...row,
    k1: reading.k1.toFixed(2),
    k2: reading.k2.toFixed(2),
  };
}

export function applyBiometry(row: EyeRowState, reading: BiometryReading): EyeRowState {
  return {
    ...row,
    axialLength: reading.axialLength.toFixed(2),
    acd: reading.acd.toFixed(2),
    lensThickness: reading.lensThickness?.toFixed(2) ?? row.lensThickness,
  };
}

export function isRowComplete(row: EyeRowState): boolean {
  return [row.k1, row.k2, row.axialLength, row.acd, row.targetRefraction].every(
    (value) => value.trim() !== "",
  );
}

/**
 * Applies the K1-is-lower convention even to hand-edited values: if the
 * clinician typed them the other way round, they're swapped rather than
 * sent through mislabeled.
 */
export function toEyeInput(row: EyeRowState): EyeInput {
  const kValues = [Number(row.k1), Number(row.k2)];
  const k1 = Math.min(...kValues);
  const k2 = Math.max(...kValues);
  return {
    side: row.side,
    keratometry: { k1, k2 },
    biometry: {
      axialLength: Number(row.axialLength),
      acd: Number(row.acd),
      lensThickness: row.lensThickness.trim() === "" ? undefined : Number(row.lensThickness),
    },
    manual: { targetRefraction: Number(row.targetRefraction) },
    iol: { iolModel: IOL_MODEL, aConstant: A_CONSTANT, lensFactor: LENS_FACTOR },
  };
}

export function formatRowForClipboard(row: EyeRowState): string {
  return [
    `${row.side}:`,
    `  Measured K1: ${row.k1 || "?"} D`,
    `  Measured K2: ${row.k2 || "?"} D`,
    `  Axial Length: ${row.axialLength || "?"} mm`,
    `  Optical ACD: ${row.acd || "?"} mm`,
    row.lensThickness ? `  Lens Thickness: ${row.lensThickness} mm` : null,
    `  IOL Optic: ${IOL_MODEL}`,
    `  A Constant: ${A_CONSTANT}`,
    `  Lens Factor: ${LENS_FACTOR}`,
    `  Refraction (target): ${row.targetRefraction || "?"} D`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
