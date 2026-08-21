import { describe, expect, it } from "vitest";
import { A_CONSTANT, aConstantFor, LENS_FACTOR, lensFactorFor } from "./constants";
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

/**
 * The two constant boxes on the calculator are one value in two units: type
 * into either and it recomputes the other. The form mirrors that so what is
 * on screen matches what the site will hold — and only the edited one is
 * ever typed into the site, which derives its partner itself.
 */
describe("the two constants as one value", () => {
  it("derives each from the other the way the calculator's own lenses do", () => {
    for (const [lens, { lensFactor, aConstant }] of Object.entries(LENS_CONSTANTS)) {
      expect(Math.abs(aConstantFor(lensFactor) - aConstant), lens).toBeLessThanOrEqual(0.02);
      expect(Math.abs(lensFactorFor(aConstant) - lensFactor), lens).toBeLessThanOrEqual(0.02);
    }
  });

  it("leaves the practice's own pair exactly where it starts", () => {
    expect(aConstantFor(LENS_FACTOR)).toBe(A_CONSTANT);
    expect(lensFactorFor(A_CONSTANT)).toBe(LENS_FACTOR);
  });

  it("round-trips, so editing one box and back doesn't drift", () => {
    for (const lensFactor of [1.2, 1.57, 1.88, 2.1, 2.44]) {
      expect(lensFactorFor(aConstantFor(lensFactor))).toBeCloseTo(lensFactor, 2);
    }
  });

  /**
   * Rounded to two decimals, as the site displays them — otherwise a
   * derived value would differ from the site's in the last digits and the
   * "the calculator rewrote your constant" warning would cry wolf on every
   * run. (118.4 + 0.31 x 1.9195 is 118.995045, so 1.88 rounds to 119.00 —
   * the lens table's 118.99 is the manufacturer's own figure, which is why
   * the check above allows 0.02 either way.)
   */
  it("rounds to two decimals, as the calculator displays them", () => {
    for (const value of [aConstantFor(1.6), aConstantFor(1.88), lensFactorFor(119.5)]) {
      expect(Math.round(value * 100) / 100).toBe(value);
    }
    expect(aConstantFor(1.6)).toBe(118.46);
    expect(lensFactorFor(119.5)).toBe(2.14);
  });
});
