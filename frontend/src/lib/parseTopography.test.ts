import { describe, expect, it } from "vitest";
import { TOPO_V1, TOPO_V2, TOPO_V3 } from "./ocrFixtures";
import { parseTopographyText } from "./parseTopography";

const CLEAN = `
<R> Sim K's
45.06( 7.49)
44.16( 7.64)
dk 0.90( 0.15)
<L> Sim K's
44.01( 7.67)
43.04( 7.84)
dk 0.97( 0.17)
`;

/**
 * The clinic's stated rules for reading this strip:
 *   1. "<R>" marks the right eye (OD), "<L>" the left eye (OS).
 *   2. The two values directly below a marker are that eye's K readings.
 *   3. The lower of the two is always K1.
 * The values below are the ones printed on the reference photo.
 */
describe("parseTopographyText, the strip's documented rules", () => {
  const [od, os] = parseTopographyText(CLEAN);

  it("rule 1: <R> is the right eye and <L> is the left eye", () => {
    expect(od.side).toBe("OD");
    expect(os.side).toBe("OS");
  });

  it("rule 2: the two values below each marker are that eye's K readings", () => {
    expect([od.k1, od.k2].sort()).toEqual([44.16, 45.06]);
    expect([os.k1, os.k2].sort()).toEqual([43.04, 44.01]);
  });

  it("rule 3: the lower value is always K1", () => {
    expect(od.k1).toBeLessThan(od.k2);
    expect(os.k1).toBeLessThan(os.k2);
    expect(od.k1).toBe(44.16);
    expect(os.k1).toBe(43.04);
  });

  it("the radii and dk printed alongside are not mistaken for K values", () => {
    for (const reading of [od, os]) {
      expect([reading.k1, reading.k2]).not.toContain(7.49);
      expect([reading.k1, reading.k2]).not.toContain(0.9);
    }
  });
});

describe("parseTopographyText, clean text", () => {
  it("extracts K1/K2 for both eyes, K1 always the lower value", () => {
    const [od, os] = parseTopographyText(CLEAN);
    expect(od).toEqual({ side: "OD", k1: 44.16, k2: 45.06, cylinder: 0.9 });
    expect(os).toEqual({ side: "OS", k1: 43.04, k2: 44.01, cylinder: 0.97 });
  });

  it("assigns K1 the lower value even when the higher is printed first", () => {
    const higherFirst = parseTopographyText(`<R> Sim K's\n45.06( 7.49)\n44.16( 7.64)\n`);
    const lowerFirst = parseTopographyText(`<R> Sim K's\n44.16( 7.64)\n45.06( 7.49)\n`);
    for (const [od] of [higherFirst, lowerFirst]) {
      expect(od.k1).toBe(44.16);
      expect(od.k2).toBe(45.06);
    }
  });

  it("ignores the corneal radii and dk value that share the block", () => {
    const [od] = parseTopographyText(CLEAN);
    expect(od.k1).toBe(44.16);
    expect(od.k2).toBe(45.06);
  });

  it("returns an empty array for unrecognized text", () => {
    expect(parseTopographyText("not a keratometry printout")).toEqual([]);
  });
});

describe("parseTopographyText, real OCR output", () => {
  it("reads OD from a plain-upscale scan, despite a missing bracket and a split decimal", () => {
    const readings = parseTopographyText(TOPO_V1);
    const od = readings.find((r) => r.side === "OD");
    expect(od).toEqual({ side: "OD", k1: 44.16, k2: 45.06, cylinder: 0.9 });
  });

  it("reads OD from a contrast-stretched scan where digits are spaced apart", () => {
    const readings = parseTopographyText(TOPO_V2);
    const od = readings.find((r) => r.side === "OD");
    expect(od).toEqual({ side: "OD", k1: 44.16, k2: 45.06, cylinder: 0.9 });
  });

  it("reads OS from a thresholded scan", () => {
    const readings = parseTopographyText(TOPO_V3);
    const os = readings.find((r) => r.side === "OS");
    expect(os).toEqual({ side: "OS", k1: 43.04, k2: 44.01, cylinder: 0.97 });
  });

  it("drops an eye whose digits were destroyed rather than guessing", () => {
    // "920.06" is a corrupted 45.06 and falls outside keratometry range,
    // leaving OD with a single usable value.
    const od = parseTopographyText(TOPO_V3).find((r) => r.side === "OD");
    expect(od).toBeUndefined();
  });

  it("never emits a value outside keratometry range", () => {
    for (const fixture of [TOPO_V1, TOPO_V2, TOPO_V3]) {
      for (const reading of parseTopographyText(fixture)) {
        expect(reading.k1).toBeGreaterThanOrEqual(30);
        expect(reading.k2).toBeLessThanOrEqual(60);
      }
    }
  });
});

describe("parseTopographyText, labeled K1/K2 charts", () => {
  it("parses labeled values laid out in OD/OE columns", () => {
    const text = "OD    OE\nK1 43.93   K1 45.07\nK2 46.44   K2 45.85\n";
    const [od, os] = parseTopographyText(text);
    expect(od).toEqual({ side: "OD", k1: 43.93, k2: 46.44, cylinder: 2.51 });
    expect(os).toEqual({ side: "OS", k1: 45.07, k2: 45.85, cylinder: 0.78 });
  });

  it("parses labeled values in stacked OD then OE sections", () => {
    const text = "OD\nK1 43.93\nK2 46.44\nOE\nK1 45.07\nK2 45.85\n";
    const [od, os] = parseTopographyText(text);
    expect(od.k1).toBe(43.93);
    expect(os.k2).toBe(45.85);
  });

  it("refuses a single labeled pair when no eye is named", () => {
    expect(parseTopographyText("K1 43.93\nK2 46.44\n")).toEqual([]);
  });
});
