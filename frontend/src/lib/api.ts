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
