import { describe, expect, it } from "vitest";
import { A_CONSTANT, IOL_MODEL, LENS_FACTOR } from "./constants";
import { emptyRow, isRowComplete, isRowEmpty, planCalculation, toEyeInput } from "./eyeRow";

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
      targetRefraction: "-0.5",
    };
    expect(toEyeInput(row)).toEqual({
      side: "OS",
      keratometry: { k1: 43.04, k2: 44.01 },
      biometry: { axialLength: 22.65, acd: 2.59, lensThickness: 4.71 },
      manual: { targetRefraction: -0.5 },
      iol: { iolModel: IOL_MODEL, aConstant: A_CONSTANT, lensFactor: LENS_FACTOR },
    });
  });

  it("swaps hand-entered K values so K1 is always the lower one", () => {
    const row = {
      ...emptyRow("OD"),
      k1: "45.06",
      k2: "44.16",
      axialLength: "22.98",
      acd: "2.79",
      targetRefraction: "0",
    };
    const input = toEyeInput(row);
    expect(input.keratometry).toEqual({ k1: 44.16, k2: 45.06 });
  });

  it("treats a fresh row as empty despite the default refraction of 0", () => {
    expect(isRowEmpty(emptyRow("OD"))).toBe(true);
    expect(isRowEmpty({ ...emptyRow("OD"), k1: "44.16" })).toBe(false);
  });
});

describe("planCalculation", () => {
  it("plans both eyes when both are complete", () => {
    expect(planCalculation(COMPLETE_OD, COMPLETE_OS)).toEqual({ ok: true, sides: ["OD", "OS"] });
  });

  it("plans a single eye when the other is empty", () => {
    expect(planCalculation(COMPLETE_OD, emptyRow("OS"))).toEqual({ ok: true, sides: ["OD"] });
    expect(planCalculation(emptyRow("OD"), COMPLETE_OS)).toEqual({ ok: true, sides: ["OS"] });
  });

  it("refuses when no eye is filled", () => {
    const plan = planCalculation(emptyRow("OD"), emptyRow("OS"));
    expect(plan.ok).toBe(false);
  });

  it("refuses a partially filled eye instead of silently dropping it", () => {
    const partialOs = { ...emptyRow("OS"), axialLength: "22.65" };
    const plan = planCalculation(COMPLETE_OD, partialOs);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("OS");
  });
});
