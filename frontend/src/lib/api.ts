import type { EyeInput, EyeSide } from "./types";

/** At least one eye must be present; a single eye calculates that side only. */
export interface CalculateRequest {
  od?: EyeInput;
  os?: EyeInput;
}

export interface IolTableRow {
  power: string;
  optic: string;
  refraction: string;
}

export interface CalculateResponse {
  /** The calculator's results panel text, from "Right Eye (OD)" onward. */
  resultsText: string;
  /** Recommended IOL power per eye, parsed out of resultsText when present. */
  recommended?: { od?: string; os?: string };
  /** The per-eye "IOL Power | Optic | Refraction" tables, when both parsed cleanly. */
  tables?: { od: IolTableRow[]; os: IolTableRow[] };
  /** The lens the calculator actually had selected, with the constants it used. */
  lens?: { name: string; lensFactor?: string; aConstant?: string };
  /** Set when the automation could not confirm it read the page it expected (see backend README). */
  warning?: string;
}

// Defaults to a same-origin relative path so Vite's dev proxy (see
// vite.config.ts) or a same-origin production deployment can route it;
// set VITE_API_BASE_URL to override when frontend and backend are hosted
// on different origins.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface ScannedKeratometry {
  side: EyeSide;
  k1: number;
  k2: number;
}

export interface ScannedBiometry {
  side: EyeSide;
  axialLength: number;
  acd: number;
}

/** One photo yields whichever of the two printouts it happens to contain. */
export interface ScanResponse {
  keratometry: ScannedKeratometry[];
  biometry: ScannedBiometry[];
  /** Read from the photo for the PDF record only; absent when it wasn't legible. */
  patientName?: string;
  warning?: string;
}

/** Raised when the server has no vision model configured, so the caller can fall back to on-device OCR. */
export class ScanUnavailableError extends Error {}

export async function scanPhoto(imageBase64: string, mediaType: string): Promise<ScanResponse> {
  const res = await fetch(`${API_BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mediaType }),
  });

  if (res.status === 503) {
    throw new ScanUnavailableError("Photo scanning is not configured on the server.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Scan failed (${res.status}).`);
  }
  return res.json();
}

/**
 * The lens names the live calculator offers. Best-effort: the caller keeps
 * its bundled list when this fails (the backend has to reach the site to
 * answer, which can be blocked or challenged).
 */
export async function fetchLensOptions(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/lenses`);
  if (!res.ok) throw new Error(`Lens list unavailable (${res.status}).`);
  const body = (await res.json()) as { lenses?: unknown };
  if (!Array.isArray(body.lenses) || body.lenses.some((name) => typeof name !== "string")) {
    throw new Error("Lens list came back in an unexpected shape.");
  }
  return body.lenses as string[];
}

export async function calculateBarrett(payload: CalculateRequest): Promise<CalculateResponse> {
  const res = await fetch(`${API_BASE}/api/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend returned ${res.status}${body ? `: ${body}` : ""}`);
  }

  return res.json();
}
