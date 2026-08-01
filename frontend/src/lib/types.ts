export type EyeSide = "OD" | "OS";

/**
 * The printout's two K readings carry no K1/K2 identification, so the
 * calculator's convention is applied: K1 is always the lower of the two
 * values, K2 the higher, regardless of print order.
 */
export interface KeratometryReading {
  side: EyeSide;
  /** Measured K1 — always the lower corneal power, in diopters. */
  k1: number;
  /** Measured K2 — always the higher corneal power, in diopters. */
  k2: number;
  /** Corneal radius corresponding to K1, in mm — only on printouts that include radii. */
  r1?: number;
  /** Corneal radius corresponding to K2, in mm — only on printouts that include radii. */
  r2?: number;
  /** Corneal astigmatism (K2 - K1), in diopters, as printed by the device. */
  cylinder: number;
}

export interface BiometryReading {
  side: EyeSide;
  /**
   * Whether the eye was identified from a printed marker, or assumed from
   * print order because the marker was unreadable — the UI warns on the
   * latter so a swapped OD/OS can't slip into a surgical calculation.
   */
  sideSource: "marker" | "order";
  /** Axial length, in mm. */
  axialLength: number;
  /** Anterior chamber depth, in mm. */
  acd: number;
  /** Lens thickness, in mm, when available. */
  lensThickness?: number;
  /** Vitreous depth, in mm, when available. */
  vitreousDepth?: number;
}

/** The only field a clinician must still supply by hand; not present on any scanned printout. */
export interface ManualEyeInput {
  /** Desired postoperative spherical equivalent, in diopters. */
  targetRefraction: number;
}

/** IOL fields fixed for this practice — see lib/constants.ts. Sent with every request. */
export interface FixedIolInput {
  iolModel: string;
  aConstant: number;
  lensFactor: number;
}

export interface EyeInput {
  side: EyeSide;
  keratometry: Pick<KeratometryReading, "k1" | "k2">;
  biometry: Pick<BiometryReading, "axialLength" | "acd" | "lensThickness">;
  manual: ManualEyeInput;
  iol: FixedIolInput;
}
