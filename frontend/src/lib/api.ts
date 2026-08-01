import type { EyeInput } from "./types";

export interface CalculateRequest {
  od: EyeInput;
  os: EyeInput;
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
