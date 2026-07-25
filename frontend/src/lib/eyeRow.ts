import type { BiometryReading, EyeInput, EyeSide, KeratometryReading } from "./types";

export interface EyeRowState {
  side: EyeSide;
  steepK: string;
  flatK: string;
  axialLength: string;
  acd: string;
  lensThickness: string;
  iolModel: string;
  iolConstant: string;
  targetRefraction: string;
}

export function emptyRow(side: EyeSide): EyeRowState {
  return {
    side,
    steepK: "",
    flatK: "",
    axialLength: "",
    acd: "",
    lensThickness: "",
    iolModel: "",
    iolConstant: "",
    targetRefraction: "",
  };
}

export function applyKeratometry(row: EyeRowState, reading: KeratometryReading): EyeRowState {
  return {
    ...row,
    steepK: reading.steepK.toFixed(2),
    flatK: reading.flatK.toFixed(2),
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
  return [
    row.steepK,
    row.flatK,
    row.axialLength,
    row.acd,
    row.iolModel,
    row.iolConstant,
    row.targetRefraction,
  ].every((value) => value.trim() !== "");
}

export function toEyeInput(row: EyeRowState): EyeInput {
  return {
    side: row.side,
    keratometry: { steepK: Number(row.steepK), flatK: Number(row.flatK) },
    biometry: {
      axialLength: Number(row.axialLength),
      acd: Number(row.acd),
      lensThickness: row.lensThickness.trim() === "" ? undefined : Number(row.lensThickness),
    },
    manual: {
      iolModel: row.iolModel,
      iolConstant: Number(row.iolConstant),
      targetRefraction: Number(row.targetRefraction),
    },
  };
}

export function formatRowForClipboard(row: EyeRowState): string {
  return [
    `${row.side}:`,
    `  Steep K: ${row.steepK || "?"} D`,
    `  Flat K: ${row.flatK || "?"} D`,
    `  Axial Length: ${row.axialLength || "?"} mm`,
    `  ACD: ${row.acd || "?"} mm`,
    row.lensThickness ? `  Lens Thickness: ${row.lensThickness} mm` : null,
    `  IOL Model: ${row.iolModel || "?"}`,
    `  IOL Constant: ${row.iolConstant || "?"}`,
    `  Target Refraction: ${row.targetRefraction || "?"} D`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
