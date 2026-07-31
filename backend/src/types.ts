export type EyeSide = "OD" | "OS";

export interface EyeInput {
  side: EyeSide;
  /** K1 must be the lower of the two K values, K2 the higher (calculator convention). */
  keratometry: {
    k1: number;
    k2: number;
  };
  biometry: {
    axialLength: number;
    acd: number;
    lensThickness?: number;
  };
  manual: {
    targetRefraction: number;
  };
  /** Fixed for this practice — see constants.ts. Validated but not chosen per request. */
  iol: {
    iolModel: string;
    aConstant: number;
    lensFactor: number;
  };
}

export interface CalculateRequest {
  od: EyeInput;
  os: EyeInput;
}

export interface CalculateResponse {
  /** Best-effort scrape of the calculator's results panel; not split per eye (see README). */
  resultsText: string;
  warning?: string;
}
