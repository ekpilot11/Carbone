export type EyeSide = "OD" | "OS";

export interface KeratometryReading {
  side: EyeSide;
  /** Steeper corneal power, in diopters. */
  steepK: number;
  /** Flatter corneal power, in diopters. */
  flatK: number;
  /** Corneal radius corresponding to steepK, in mm. */
  steepRadius: number;
  /** Corneal radius corresponding to flatK, in mm. */
  flatRadius: number;
  /** Corneal astigmatism (steepK - flatK), in diopters, as printed by the device. */
  cylinder: number;
}

export interface BiometryReading {
  side: EyeSide;
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
  keratometry: Pick<KeratometryReading, "steepK" | "flatK">;
  biometry: Pick<BiometryReading, "axialLength" | "acd" | "lensThickness">;
  manual: ManualEyeInput;
  iol: FixedIolInput;
}
