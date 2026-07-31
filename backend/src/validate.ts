import type { CalculateRequest, EyeInput, EyeSide } from "./types.js";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateEye(eye: unknown, side: EyeSide): string | null {
  if (typeof eye !== "object" || eye === null) return `${side}: missing`;
  const e = eye as Partial<EyeInput>;

  if (e.side !== side) return `${side}: side mismatch`;
  if (!isFiniteNumber(e.keratometry?.steepK)) return `${side}: keratometry.steepK must be a number`;
  if (!isFiniteNumber(e.keratometry?.flatK)) return `${side}: keratometry.flatK must be a number`;
  if (!isFiniteNumber(e.biometry?.axialLength)) return `${side}: biometry.axialLength must be a number`;
  if (!isFiniteNumber(e.biometry?.acd)) return `${side}: biometry.acd must be a number`;
  if (
    e.biometry?.lensThickness !== undefined &&
    !isFiniteNumber(e.biometry.lensThickness)
  ) {
    return `${side}: biometry.lensThickness must be a number when present`;
  }
  if (!isFiniteNumber(e.manual?.targetRefraction)) return `${side}: manual.targetRefraction must be a number`;
  if (typeof e.iol?.iolModel !== "string" || e.iol.iolModel.trim() === "") {
    return `${side}: iol.iolModel must be a non-empty string`;
  }
  if (!isFiniteNumber(e.iol?.aConstant)) return `${side}: iol.aConstant must be a number`;
  if (!isFiniteNumber(e.iol?.lensFactor)) return `${side}: iol.lensFactor must be a number`;

  return null;
}

export function validateCalculateRequest(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "Request body must be a JSON object";
  const req = body as Partial<CalculateRequest>;
  return validateEye(req.od, "OD") ?? validateEye(req.os, "OS");
}
