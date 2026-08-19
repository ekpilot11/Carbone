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

/** How often the app asks whether a calculation has finished. */
const JOB_POLL_MS = 1500;

/**
 * Long enough for the three minutes a security check is allowed to wait,
 * plus the run itself and some slack.
 */
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs a calculation without holding a connection open while it happens.
 *
 * The automation needs 10–30 seconds normally, and up to three minutes when
 * the calculator's site raises a security check and waits for someone to
 * complete it. A single request held open that long survives on localhost
 * and nowhere else: a tunnel, a proxy or a firewall cuts it, and what comes
 * back is the proxy's error page rather than a result — which is what a
 * Cloudflare tunnel did, returning its own 502 after about a hundred
 * seconds.
 *
 * So the server is asked to *start* a calculation, and then asked every
 * couple of seconds how it went. Every exchange is short, which is the only
 * thing anything in between cares about. The signature is unchanged, so
 * callers neither know nor care.
 */
export async function calculateBarrett(payload: CalculateRequest): Promise<CalculateResponse> {
  const started = await fetch(`${API_BASE}/api/calculate/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!started.ok) {
    const body = await started.text().catch(() => "");
    throw new Error(`Backend returned ${started.status}${body ? `: ${body}` : ""}`);
  }
  const { jobId } = (await started.json()) as { jobId?: string };
  if (!jobId) throw new Error("The server did not start the calculation.");

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));

    const res = await fetch(`${API_BASE}/api/calculate/jobs/${jobId}`);
    if (!res.ok) {
      // A poll that fails is not a failed calculation — a phone changing
      // network, or a tunnel blinking, must not discard a run that is still
      // going. Keep asking until the deadline.
      if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "The server lost track of that calculation.");
      }
      continue;
    }

    const job = (await res.json()) as { status: string; result?: CalculateResponse; error?: string };
    if (job.status === "done" && job.result) return job.result;
    if (job.status === "failed") throw new Error(job.error ?? "The calculation failed.");
  }

  throw new Error(
    "The calculation is taking longer than five minutes. It may still be running on the " +
      "server — check the calculator site, or press Calculate again.",
  );
}
