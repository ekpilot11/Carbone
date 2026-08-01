import { K_INDEX_OPTIONS } from "./constants.js";
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
  if (e.biometry?.wtw !== undefined && !isFiniteNumber(e.biometry.wtw)) {
    return `${side}: biometry.wtw must be a number when present`;
  }
  if (!isFiniteNumber(e.manual?.targetRefraction)) return `${side}: manual.targetRefraction must be a number`;
  if (typeof e.iol?.iolModel !== "string" || e.iol.iolModel.trim() === "") {
    return `${side}: iol.iolModel must be a non-empty string`;
  }
  if (e.iol?.lens !== undefined && (typeof e.iol.lens !== "string" || e.iol.lens.trim() === "")) {
    return `${side}: iol.lens must be a non-empty string when present`;
  }
  // The bands the calculator prints beside its own fields; outside them the
  // site would reject the value anyway, so the run is refused up front.
  if (!isFiniteNumber(e.iol?.aConstant)) return `${side}: iol.aConstant must be a number`;
  if (e.iol.aConstant < 112 || e.iol.aConstant > 125) {
    return `${side}: iol.aConstant must be between 112 and 125`;
  }
  if (!isFiniteNumber(e.iol?.lensFactor)) return `${side}: iol.lensFactor must be a number`;
  if (e.iol.lensFactor < -2 || e.iol.lensFactor > 5) {
    return `${side}: iol.lensFactor must be between -2 and 5`;
  }

  return null;
}

export function validateCalculateRequest(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "Request body must be a JSON object";
  const req = body as Partial<CalculateRequest>;
  if (req.od === undefined && req.os === undefined) {
    return "Request must include at least one eye (od or os)";
  }
  if (
    req.kIndex !== undefined &&
    !(K_INDEX_OPTIONS as readonly string[]).includes(req.kIndex)
  ) {
    return `kIndex must be one of: ${K_INDEX_OPTIONS.join(", ")}`;
  }

  const perEye =
    (req.od !== undefined ? validateEye(req.od, "OD") : null) ??
    (req.os !== undefined ? validateEye(req.os, "OS") : null);
  if (perEye) return perEye;

  // The lens dropdown and its constants are form-wide on the calculator, so
  // two eyes asking for different lenses cannot both be honoured — better to
  // refuse than to silently calculate one of them with the other's lens.
  if (req.od && req.os) {
    const same =
      req.od.iol.lens === req.os.iol.lens &&
      req.od.iol.aConstant === req.os.iol.aConstant &&
      req.od.iol.lensFactor === req.os.iol.lensFactor;
    if (!same) {
      return "Both eyes must use the same lens and constants — the calculator applies one selection to the whole form";
    }
  }
  return null;
}
