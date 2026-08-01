import { describe, expect, it } from "vitest";
import { BIO_BOTH_EYES, BIO_REAL_BOTH_EYES, BIO_V1, BIO_V2, BIO_V3 } from "./ocrFixtures";
import { parseBiometryText } from "./parseBiometry";

const CLEAN = `
Sex:Male OD Age:25
Avg  02.79 04.71 15.49 22.98
AVGAXL= 22.98mm
STDDEV =0.03mm
ACD =2.79mm
LENS =4.71mm
VITR =15.49mm

Sex:Male OS Age:25
Avg  02.59 04.71 15.35 22.65
AVGAXL= 22.65mm
STDDEV =0.06mm
ACD =2.59mm
LENS =4.71mm
VITR =15.35mm
`;

/**
 * The clinic's stated rules for reading this printout:
 *   1. "AVGAXL" is the axial length and "ACD" the anterior chamber depth.
 *   2. The right eye is always printed first, the left eye second.
 *   3. The eye can be confirmed from the "Sex:Male OD Age:25" header,
 *      between the patient's sex and age.
 * The values below are the ones printed on the reference photo.
 */
describe("parseBiometryText, the printout's documented rules", () => {
  const readings = parseBiometryText(BIO_REAL_BOTH_EYES);

  it("rule 1: reads AVGAXL as axial length and ACD as anterior chamber depth", () => {
    expect(readings.map((r) => [r.axialLength, r.acd])).toEqual([
      [22.98, 2.79],
      [22.65, 2.59],
    ]);
  });

  it("rule 2: the first block is the right eye and the second the left", () => {
    expect(readings.map((r) => r.side)).toEqual(["OD", "OS"]);
  });

  it("rule 3: confirms the eye from the header when it survives OCR", () => {
    // OD's "Sex:Male 0D Age:25" is legible here; OS's header is not, so it
    // falls to print order — and the two agree.
    expect(readings[0].sideSource).toBe("marker");
    expect(readings[1].sideSource).toBe("order");
  });

  it("keeps each eye's values together rather than mixing the two blocks", () => {
    const [od, os] = readings;
    expect(od).toMatchObject({ side: "OD", axialLength: 22.98, acd: 2.79 });
    expect(os).toMatchObject({ side: "OS", axialLength: 22.65, acd: 2.59 });
  });
});

describe("parseBiometryText, clean text", () => {
  it("extracts axial length, ACD, lens thickness and vitreous depth per eye", () => {
    const [od, os] = parseBiometryText(CLEAN);
    expect(od).toMatchObject({
      side: "OD",
      axialLength: 22.98,
      acd: 2.79,
      lensThickness: 4.71,
      vitreousDepth: 15.49,
    });
    expect(os).toMatchObject({
      side: "OS",
      axialLength: 22.65,
      acd: 2.59,
      lensThickness: 4.71,
      vitreousDepth: 15.35,
    });
  });

  it("does not confuse the table's ACD column header with the ACD= summary", () => {
    const [od] = parseBiometryText(CLEAN);
    expect(od.acd).toBe(2.79);
  });

  it("returns an empty array for unrecognized text", () => {
    expect(parseBiometryText("not a biometry printout")).toEqual([]);
  });

  it("skips a block with no usable axial length", () => {
    expect(parseBiometryText("Sex:Male OD Age:25\nCataract 10MHZ CONT\n")).toEqual([]);
  });
});

describe("parseBiometryText, real OCR output", () => {
  it.each([
    ["plain upscale, label reads AVGAXL", BIO_V1],
    ["contrast-stretched, label reads AVUGAXL", BIO_V2],
    ["thresholded, label reads AUGAXL", BIO_V3],
  ])("reads the measurements from a %s scan", (_label, fixture) => {
    const [reading] = parseBiometryText(fixture);
    expect(reading.axialLength).toBe(22.98);
    expect(reading.acd).toBe(2.79);
    expect(reading.lensThickness).toBe(4.71);
  });

  it("recovers the axial length from '22 .98', split by OCR whitespace", () => {
    expect(parseBiometryText(BIO_V1)[0].axialLength).toBe(22.98);
  });

  it("falls back to print order when the eye header is unreadable", () => {
    const readings = parseBiometryText(BIO_BOTH_EYES);
    expect(readings.map((r) => [r.side, r.sideSource, r.axialLength])).toEqual([
      ["OD", "order", 22.98],
      ["OS", "order", 22.65],
    ]);
  });

  it("prefers a legible eye marker over print order", () => {
    // "ob" is how OCR renders OD on this printout.
    const [reading] = parseBiometryText(BIO_V2);
    expect(reading.side).toBe("OD");
    expect(reading.sideSource).toBe("marker");
  });

  it("recovers measurements from the averages row when summary lines are lost", () => {
    const summaryLost = "Sex Male M\nAvg 02.79 04.71 15.49 22.98\nAVGAXL= 2X .98mn\nACD =X.79mn";
    const [reading] = parseBiometryText(summaryLost);
    expect(reading.axialLength).toBe(22.98);
    expect(reading.acd).toBe(2.79);
  });

  it("never emits values outside physiologic range", () => {
    for (const fixture of [BIO_V1, BIO_V2, BIO_V3, BIO_BOTH_EYES]) {
      for (const r of parseBiometryText(fixture)) {
        expect(r.axialLength).toBeGreaterThanOrEqual(12);
        expect(r.axialLength).toBeLessThanOrEqual(38);
        expect(r.acd).toBeGreaterThan(0);
        expect(r.acd).toBeLessThanOrEqual(6);
      }
    }
  });
});
