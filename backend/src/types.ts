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
    /** The calculator's "Optional:" block — sent only when known. */
    lensThickness?: number;
    wtw?: number;
  };
  manual: {
    targetRefraction: number;
  };
  iol: {
    iolModel: string;
    /**
     * The calculator's lens dropdown, by its exact option text. Absent (or
     * "Personal Constant") means this practice's own constants below are
     * used; any other lens makes the calculator supply its own constants
     * and the values below are ignored.
     */
    lens?: string;
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
  /**
   * What the calculator actually had selected when Calculate was clicked,
   * read back off the page — for a named lens these constants come from the
   * site, not from us, so this is the only record of what was used.
   */
  lens?: { name: string; lensFactor?: string; aConstant?: string };
  warning?: string;
}
