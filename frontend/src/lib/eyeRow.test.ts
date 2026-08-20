import { describe, expect, it } from "vitest";
import { A_CONSTANT, IOL_MODEL, LENS_FACTOR } from "./constants";
import { PERSONAL_CONSTANT } from "./lenses";
import {
  applyBiometry,
  emptyRow,
  formatRowForClipboard,
  isRowComplete,
  isRowEmpty,
  isRowUsable,
  kOrderSuspect,
  missingFields,
  planCalculation,
  toEyeInput,
  type LensSettings,
} from "./eyeRow";

/** The form's starting point: personal constant, this practice's values. */
const PERSONAL: LensSettings = {
  lens: PERSONAL_CONSTANT,
  lensFactor: String(LENS_FACTOR),
  aConstant: String(A_CONSTANT),
};

const COMPLETE_OD = {
  ...emptyRow("OD"),
  k1: "44.16",
  k2: "45.06",
  axialLength: "22.98",
  acd: "2.79",
  targetRefraction: "0",
};

const COMPLETE_OS = {
  ...emptyRow("OS"),
  k1: "43.04",
  k2: "44.01",
  axialLength: "22.65",
  acd: "2.59",
  targetRefraction: "0",
};

describe("eyeRow helpers", () => {
  it("an empty row is never complete", () => {
    expect(isRowComplete(emptyRow("OD"))).toBe(false);
  });

  it("defaults the refraction target to an explicit 0", () => {
    expect(emptyRow("OD").targetRefraction).toBe("0");
  });

  it("a row with every field filled in is complete, target refraction of 0 included", () => {
    const row = {
      ...emptyRow("OD"),
      k1: "44.16",
      k2: "45.06",
      axialLength: "22.98",
      acd: "2.79",
      targetRefraction: "0",
    };
    expect(isRowComplete(row)).toBe(true);
  });

  it("converts a filled row into a numeric EyeInput, with the fixed IOL constants attached", () => {
    const row = {
      ...emptyRow("OS"),
      k1: "43.04",
      k2: "44.01",
      axialLength: "22.65",
      acd: "2.59",
      lensThickness: "4.71",
      wtw: "11.80",
      targetRefraction: "-0.5",
    };
    expect(toEyeInput(row, PERSONAL)).toEqual({
      side: "OS",
      keratometry: { k1: 43.04, k2: 44.01 },
      biometry: { axialLength: 22.65, acd: 2.59, lensThickness: 4.71, wtw: 11.8 },
      manual: { targetRefraction: -0.5 },
      iol: {
        iolModel: IOL_MODEL,
        lens: PERSONAL_CONSTANT,
        aConstant: A_CONSTANT,
        lensFactor: LENS_FACTOR,
      },
    });
  });

  it("sends the constants exactly as typed in the form", () => {
    const typed: LensSettings = { lens: PERSONAL_CONSTANT, lensFactor: "2.10", aConstant: "119.20" };
    expect(toEyeInput(COMPLETE_OD, typed).iol).toEqual({
      iolModel: IOL_MODEL,
      lens: PERSONAL_CONSTANT,
      lensFactor: 2.1,
      aConstant: 119.2,
    });
  });

  /**
   * The reverse of what this used to do. Swapping a labelled pair hides a
   * transcription error behind a plausible-looking result; such an eye is
   * refused upstream instead, and anything reaching here has been checked.
   */
  it("sends K values exactly as they stand, without reordering them", () => {
    const row = {
      ...emptyRow("OD"),
      k1: "44.16",
      k2: "45.06",
      axialLength: "22.98",
      acd: "2.79",
      targetRefraction: "0",
    };
    const input = toEyeInput(row, PERSONAL);
    expect(input.keratometry).toEqual({ k1: 44.16, k2: 45.06 });
  });

  it("fills axial length and ACD from a scan without touching the manual-only fields", () => {
    const scanned = applyBiometry(emptyRow("OD"), {
      side: "OD",
      sideSource: "marker",
      axialLength: 22.98,
      acd: 2.79,
      lensThickness: 4.71,
    });
    expect(scanned.axialLength).toBe("22.98");
    expect(scanned.acd).toBe("2.79");
    expect(scanned.lensThickness).toBe("");
  });

  it("keeps a hand-entered lens thickness when a scan is applied over it", () => {
    const typed = { ...emptyRow("OD"), lensThickness: "4.50" };
    const scanned = applyBiometry(typed, {
      side: "OD",
      sideSource: "marker",
      axialLength: 22.98,
      acd: 2.79,
      lensThickness: 4.71,
    });
    expect(scanned.lensThickness).toBe("4.50");
  });

  it("counts a row holding only optional values as non-empty", () => {
    expect(isRowEmpty({ ...emptyRow("OD"), wtw: "12.10" })).toBe(false);
  });

  it("lists this practice's constants for a personal constant, but not for a named lens", () => {
    const row = { ...COMPLETE_OD, wtw: "12.10" };
    const personal = formatRowForClipboard(row, PERSONAL);
    expect(personal).toContain(`A Constant: ${A_CONSTANT}`);
    expect(personal).toContain("WTW: 12.10 mm");

    const named = formatRowForClipboard(row, { ...PERSONAL, lens: "Alcon SN60WF" });
    expect(named).toContain("Lens: Alcon SN60WF");
    expect(named).not.toContain("A Constant");
    expect(named).not.toContain("Lens Factor");
  });

  it("treats a fresh row as empty despite the default refraction of 0", () => {
    expect(isRowEmpty(emptyRow("OD"))).toBe(true);
    expect(isRowEmpty({ ...emptyRow("OD"), k1: "44.16" })).toBe(false);
  });
});

describe("planCalculation", () => {
  it("plans both eyes when both are complete", () => {
    expect(planCalculation(COMPLETE_OD, COMPLETE_OS)).toEqual({
      ok: true,
      sides: ["OD", "OS"],
      skipped: [],
      suspect: [],
    });
  });

  it("plans a single eye when the other is empty", () => {
    expect(planCalculation(COMPLETE_OD, emptyRow("OS"))).toEqual({
      ok: true,
      sides: ["OD"],
      skipped: [],
      suspect: [],
    });
  });

  it("refuses when no eye is filled", () => {
    const plan = planCalculation(emptyRow("OD"), emptyRow("OS"));
    expect(plan).toEqual({ ok: false, reason: "empty", skipped: [], suspect: [] });
  });

  /**
   * The case a photo of a two-eye topography strip and a one-eye A-scan
   * produces: K values for both, biometry for one. The half-read eye has to
   * stay out of the request — the calculator rejects an incomplete eye — but
   * the other one must still calculate.
   */
  it("leaves a half-read eye out and calculates the other", () => {
    const halfOd = { ...emptyRow("OD"), k1: "37.73", k2: "42.70" };
    const plan = planCalculation(halfOd, COMPLETE_OS);
    expect(plan).toEqual({ ok: true, sides: ["OS"], skipped: ["OD"], suspect: [] });
  });

  it("names exactly what a half-read eye is missing", () => {
    const halfOd = { ...emptyRow("OD"), k1: "37.73", k2: "42.70" };
    expect(missingFields(halfOd)).toEqual(["axialLength", "acd"]);
    expect(missingFields(COMPLETE_OD)).toEqual([]);
  });

  it("refuses, naming the gap, when neither eye is complete", () => {
    const plan = planCalculation({ ...emptyRow("OD"), k1: "42.70" }, emptyRow("OS"));
    expect(plan).toEqual({ ok: false, reason: "nothingComplete", skipped: ["OD"], suspect: [] });
  });
});

/**
 * A labelled K pair in the wrong order is a transcription error, not a
 * cornea. Nothing in the numbers says which of the two is wrong — or whether
 * they came from different eyes — so the eye waits for a person rather than
 * being reordered into something that calculates cleanly.
 */
describe("K1 above K2", () => {
  const reversed = { ...COMPLETE_OD, k1: "45.06", k2: "44.16" };

  it("is flagged, and only when K1 is strictly the larger", () => {
    expect(kOrderSuspect(reversed)).toBe(true);
    expect(kOrderSuspect(COMPLETE_OD)).toBe(false);
    // A spherical cornea is real; equal values are not an error.
    expect(kOrderSuspect({ ...COMPLETE_OD, k1: "44.16", k2: "44.16" })).toBe(false);
  });

  it("is not flagged while the pair is still being typed", () => {
    expect(kOrderSuspect({ ...emptyRow("OD"), k1: "45.06" })).toBe(false);
    expect(kOrderSuspect({ ...emptyRow("OD"), k2: "44.16" })).toBe(false);
  });

  it("makes an otherwise complete eye unusable", () => {
    expect(isRowComplete(reversed)).toBe(true);
    expect(isRowUsable(reversed)).toBe(false);
  });

  it("keeps that eye out of the calculation and names it", () => {
    const plan = planCalculation(reversed, COMPLETE_OS);
    expect(plan).toEqual({ ok: true, sides: ["OS"], skipped: [], suspect: ["OD"] });
  });

  it("stops the calculation entirely when it is the only eye", () => {
    const plan = planCalculation(reversed, emptyRow("OS"));
    expect(plan.ok).toBe(false);
    expect(plan.suspect).toEqual(["OD"]);
    // Not "empty": there are values, and they are wrong.
    expect(plan.ok === false && plan.reason).toBe("nothingComplete");
  });
});
