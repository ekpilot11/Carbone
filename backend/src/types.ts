export type EyeSide = "OD" | "OS";

export interface EyeInput {
  side: EyeSide;
  keratometry: {
    steepK: number;
    flatK: number;
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
