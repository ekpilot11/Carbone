import type { EyeInput } from "./types";

export interface CalculateRequest {
  od: EyeInput;
  os: EyeInput;
}

export interface CalculateResponse {
  /** Best-effort scrape of the calculator's results panel; not split per eye (see backend README). */
  resultsText: string;
  /** Set when the automation could not confirm it read the page it expected (see backend README). */
  warning?: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

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
