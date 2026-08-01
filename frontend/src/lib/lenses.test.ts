import { describe, expect, it } from "vitest";
import { A_CONSTANT, LENS_FACTOR } from "./constants";
import {
  BUNDLED_LENS_OPTIONS,
  isPersonalConstant,
  LENS_CONSTANTS,
  lensConstants,
  PERSONAL_CONSTANT,
} from "./lenses";

describe("lens constants", () => {
  it("finds a lens's constants regardless of spacing or case", () => {
    expect(lensConstants("Alcon SN6ATx")).toEqual({ lensFactor: 2.02, aConstant: 119.26 });
    expect(lensConstants("  alcon   sn6atx ")).toEqual({ lensFactor: 2.02, aConstant: 119.26 });
  });

  it("reports a lens it doesn't know rather than guessing constants", () => {
    expect(lensConstants("Some Lens That Isn't Listed")).toBeUndefined();
  });

  it("recognises the personal-constant option", () => {
    expect(isPersonalConstant(PERSONAL_CONSTANT)).toBe(true);
    expect(isPersonalConstant("personal constant")).toBe(true);
    expect(isPersonalConstant("Alcon SN6ATx")).toBe(false);
  });
});

describe("the transcribed constants table", () => {
  it("covers every lens the dropdown offers", () => {
    const missing = BUNDLED_LENS_OPTIONS.filter(
      (lens) => !isPersonalConstant(lens) && lensConstants(lens) === undefined,
    );
    expect(missing).toEqual([]);
  });

  /**
   * The calculator's own pairs sit on one line: A = 118.4 + (LF - 1.57) x
   * 1.9195 — the practice's 1.57/118.4 included. A mistyped digit falls off
   * that line, which makes this a real check on the transcription rather
   * than a restatement of it.
   */
  it("has every pair on the calculator's own lens-factor/A-constant line", () => {
    const offLine = Object.entries(LENS_CONSTANTS).filter(([, { lensFactor, aConstant }]) => {
      const expected = A_CONSTANT + (lensFactor - LENS_FACTOR) * 1.9195;
      return Math.abs(expected - aConstant) > 0.02;
    });
    expect(offLine).toEqual([]);
  });
});
