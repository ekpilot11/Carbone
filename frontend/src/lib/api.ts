import type { EyeInput, EyeSide } from "./types";

/** At least one eye must be present; a single eye calculates that side only. */
export interface CalculateRequest {
  od?: EyeInput;
  os?: EyeInput;
  /** The calculator's keratometric index radio, form-wide: "1.3375" or "1.332". */
  kIndex?: string;
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
  /** The keratometric index the form had selected when Calculate was clicked. */
  kIndex?: string;
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

/**
 * A Cloudflare check waiting for a human, on the machine running the
 * automation. When the app is on a server, that machine is not the one in
 * front of you — so the check comes here instead: a picture of the real
 * browser window, and your clicks sent back to it. Nothing is answered
 * automatically; this only carries a person's hand to where the window is.
 */
export interface ChallengeStatus {
  id: string;
  ageSeconds: number;
  width: number;
  height: number;
}

export async function fetchChallenge(): Promise<ChallengeStatus | null> {
  const res = await fetch(`${API_BASE}/api/challenge`);
  if (!res.ok) return null;
  const body = (await res.json()) as { challenge?: ChallengeStatus | null };
  return body.challenge ?? null;
}

/** `nonce` defeats caching — the window changes as the person interacts with it. */
export function challengeFrameUrl(id: string, nonce: number): string {
  return `${API_BASE}/api/challenge/${id}/frame.jpg?n=${nonce}`;
}

export async function sendChallengeInput(
  id: string,
  input: { x: number; y: number } | { text: string },
): Promise<void> {
  await fetch(`${API_BASE}/api/challenge/${id}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Parks a day's work on the server under a short code, so it can be picked
 * up on the other machine. The server keeps it in memory only, for the
 * working day, and forgets it the moment it is collected.
 */
export async function parkHandoff(payload: unknown): Promise<{ code: string; expiresAt: number }> {
  const res = await fetch(`${API_BASE}/api/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Couldn't save the work (${res.status}).`);
  }
  return res.json();
}

export async function collectHandoff(code: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/handoff/${encodeURIComponent(code.trim())}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Couldn't open that code (${res.status}).`);
  }
  const body = (await res.json()) as { payload?: unknown };
  return body.payload;
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
