import { describe, expect, it } from "vitest";
import { parseTopographyText } from "./parseTopography";

const SAMPLE = `
<R> Sim K's
45.06( 7.49)
44.16( 7.64)
dk 0.90( 0.15)
<L> Sim K's
44.01( 7.67)
43.04( 7.84)
dk 0.97( 0.17)
`;

describe("parseTopographyText", () => {
  it("extracts K1/K2 and radii for both eyes, K1 always the lower value", () => {
    const [od, os] = parseTopographyText(SAMPLE);

    expect(od).toEqual({
      side: "OD",
      k1: 44.16,
      k2: 45.06,
      r1: 7.64,
      r2: 7.49,
      cylinder: 0.9,
    });

    expect(os).toEqual({
      side: "OS",
      k1: 43.04,
      k2: 44.01,
      r1: 7.84,
      r2: 7.67,
      cylinder: 0.97,
    });
  });

  it("assigns K1 the lower value even when the strip prints the higher one first", () => {
    const higherFirst = parseTopographyText(`<R> Sim K's\n45.06( 7.49)\n44.16( 7.64)\n`);
    const lowerFirst = parseTopographyText(`<R> Sim K's\n44.16( 7.64)\n45.06( 7.49)\n`);
    for (const [od] of [higherFirst, lowerFirst]) {
      expect(od.k1).toBe(44.16);
      expect(od.k2).toBe(45.06);
    }
  });

  it("falls back to k2 - k1 when the dk line is missing", () => {
    const [od] = parseTopographyText(`<R> Sim K's\n45.06( 7.49)\n44.16( 7.64)\n`);
    expect(od.cylinder).toBeCloseTo(0.9, 2);
  });

  it("returns an empty array for unrecognized text", () => {
    expect(parseTopographyText("not a keratometry printout")).toEqual([]);
  });

  it("tolerates comma decimals from noisy OCR", () => {
    const [od] = parseTopographyText(`<R> Sim K's\n45,06( 7,49)\n44,16( 7,64)\ndk 0,90( 0,15)\n`);
    expect(od.k2).toBe(45.06);
    expect(od.r2).toBe(7.49);
  });

  it("tolerates OCR-mangled eye markers like 'R> Slm Ks'", () => {
    const [od] = parseTopographyText(`R> Slm Ks\n45.06( 7.49)\n44.16( 7.64)\n`);
    expect(od.side).toBe("OD");
    expect(od.k1).toBe(44.16);
  });

  it("parses labeled K1/K2 values laid out in OD/OE columns", () => {
    const text = "OD    OE\nK1 43.93   K1 45.07\nK2 46.44   K2 45.85\n";
    const [od, os] = parseTopographyText(text);
    expect(od).toEqual({ side: "OD", k1: 43.93, k2: 46.44, cylinder: 2.51 });
    expect(os).toEqual({ side: "OS", k1: 45.07, k2: 45.85, cylinder: 0.78 });
  });

  it("parses labeled K1/K2 values in stacked OD then OE sections", () => {
    const text = "OD\nK1 43.93\nK2 46.44\nOE\nK1 45.07\nK2 45.85\n";
    const [od, os] = parseTopographyText(text);
    expect(od.side).toBe("OD");
    expect(od.k1).toBe(43.93);
    expect(os.side).toBe("OS");
    expect(os.k2).toBe(45.85);
  });

  it("orders labeled K values so K1 is the lower even if written the other way", () => {
    const text = "OD\nK1 46.44\nK2 43.93\n";
    const [od] = parseTopographyText(text);
    expect(od).toEqual({ side: "OD", k1: 43.93, k2: 46.44, cylinder: 2.51 });
  });

  it("refuses a single labeled pair when no eye is named", () => {
    expect(parseTopographyText("K1 43.93\nK2 46.44\n")).toEqual([]);
  });
});
