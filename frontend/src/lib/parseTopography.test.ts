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
  it("extracts steep/flat K and radius for both eyes", () => {
    const [od, os] = parseTopographyText(SAMPLE);

    expect(od).toEqual({
      side: "OD",
      steepK: 45.06,
      flatK: 44.16,
      steepRadius: 7.49,
      flatRadius: 7.64,
      cylinder: 0.9,
    });

    expect(os).toEqual({
      side: "OS",
      steepK: 44.01,
      flatK: 43.04,
      steepRadius: 7.67,
      flatRadius: 7.84,
      cylinder: 0.97,
    });
  });

  it("falls back to steepK - flatK when the dk line is missing", () => {
    const [od] = parseTopographyText(`<R> Sim K's\n45.06( 7.49)\n44.16( 7.64)\n`);
    expect(od.cylinder).toBeCloseTo(0.9, 2);
  });

  it("returns an empty array for unrecognized text", () => {
    expect(parseTopographyText("not a keratometry printout")).toEqual([]);
  });

  it("tolerates comma decimals from noisy OCR", () => {
    const [od] = parseTopographyText(`<R> Sim K's\n45,06( 7,49)\n44,16( 7,64)\ndk 0,90( 0,15)\n`);
    expect(od.steepK).toBe(45.06);
    expect(od.steepRadius).toBe(7.49);
  });
});
