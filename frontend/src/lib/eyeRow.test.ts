import { describe, expect, it } from "vitest";
import { A_CONSTANT, IOL_MODEL, LENS_FACTOR } from "./constants";
import { emptyRow, isRowComplete, toEyeInput } from "./eyeRow";

describe("eyeRow helpers", () => {
  it("an empty row is never complete", () => {
    expect(isRowComplete(emptyRow("OD"))).toBe(false);
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
});
