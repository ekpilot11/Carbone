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
  warning?: string;
}
