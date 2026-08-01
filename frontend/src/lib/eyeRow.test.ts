import { describe, expect, it } from "vitest";
import { A_CONSTANT, IOL_MODEL, LENS_FACTOR } from "./constants";
import { PERSONAL_CONSTANT } from "./lenses";
import {
  applyBiometry,
  emptyRow,
  formatRowForClipboard,
  isRowComplete,
  isRowEmpty,
  planCalculation,
  toEyeInput,
} from "./eyeRow";

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
    expect(toEyeInput(row, PERSONAL_CONSTANT)).toEqual({
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

  it("swaps hand-entered K values so K1 is always the lower one", () => {
    const row = {
      ...emptyRow("OD"),
      k1: "45.06",
      k2: "44.16",
      axialLength: "22.98",
      acd: "2.79",
      targetRefraction: "0",
    };
    const input = toEyeInput(row, PERSONAL_CONSTANT);
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
    const personal = formatRowForClipboard(row, PERSONAL_CONSTANT);
    expect(personal).toContain(`A Constant: ${A_CONSTANT}`);
    expect(personal).toContain("WTW: 12.10 mm");

    const named = formatRowForClipboard(row, "Alcon SN60WF");
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
    if (!plan.ok) expect(plan.reason).toBe("partialOs");
  });
});
