import type { CalculateRequest, EyeInput, EyeSide } from "./types.js";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateEye(eye: unknown, side: EyeSide): string | null {
  if (typeof eye !== "object" || eye === null) return `${side}: missing`;
  const e = eye as Partial<EyeInput>;

  if (e.side !== side) return `${side}: side mismatch`;
  if (!isFiniteNumber(e.keratometry?.k1)) return `${side}: keratometry.k1 must be a number`;
  if (!isFiniteNumber(e.keratometry?.k2)) return `${side}: keratometry.k2 must be a number`;
  if (e.keratometry.k1 > e.keratometry.k2) {
    return `${side}: keratometry.k1 must be the lower of the two K values`;
  }
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
  if (req.od === undefined && req.os === undefined) {
    return "Request must include at least one eye (od or os)";
  }
  return (
    (req.od !== undefined ? validateEye(req.od, "OD") : null) ??
    (req.os !== undefined ? validateEye(req.os, "OS") : null)
  );
}
