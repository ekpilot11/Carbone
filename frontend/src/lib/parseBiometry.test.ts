import { describe, expect, it } from "vitest";
import { parseBiometryText } from "./parseBiometry";

const SAMPLE = `
Hospital:
EXAM: 07/23/2026 21:57
Name:
ID:
Sex:Male OD Age:25
Cataract   10MH2   CONT
m/s 1532  1629  1532
    ACD   LENS  VITR   AL
00.00 00.00 00.00 00.00
S.D. 00.15 00.16 00.03 00.03
Avg  02.79 04.71 15.49 22.98
AVGAXL= 22.98mm
STDDEV =0.03mm
ACD =2.79mm
LENS =4.71mm
VITR =15.49mm
TVEL1..........1532 M/S
TVEL2..........1629 M/S
TVEL3..........1532 M/S
GAIN...............77

Hospital:
EXAM: 07/23/2026 21:57
Name:
ID:
Sex:Male OS Age:25
Cataract   10MH2   CONT
m/s 1532  1629  1532
    ACD   LENS  VITR   AL
00.00 00.00 00.00 00.00
S.D. 00.06 00.01 00.03 00.06
Avg  02.59 04.71 15.35 22.65
AVGAXL= 22.65mm
STDDEV =0.06mm
ACD =2.59mm
LENS =4.71mm
VITR =15.35mm
TVEL1..........1532 M/S
`;

describe("parseBiometryText", () => {
  it("extracts axial length, ACD, lens thickness and vitreous depth per eye", () => {
    const [od, os] = parseBiometryText(SAMPLE);

    expect(od).toEqual({
      side: "OD",
      axialLength: 22.98,
      acd: 2.79,
      lensThickness: 4.71,
      vitreousDepth: 15.49,
    });

    expect(os).toEqual({
      side: "OS",
      axialLength: 22.65,
      acd: 2.59,
      lensThickness: 4.71,
      vitreousDepth: 15.35,
    });
  });

  it("does not confuse the ACD column header with the ACD= summary line", () => {
    const [od] = parseBiometryText(SAMPLE);
    expect(od.acd).toBe(2.79);
  });

  it("skips a block that never printed AVGAXL/ACD", () => {
    const noSummary = "Sex:Male OD Age:25\nCataract 10MH2 CONT\n";
    expect(parseBiometryText(noSummary)).toEqual([]);
  });

  it("returns an empty array for unrecognized text", () => {
    expect(parseBiometryText("not a biometry printout")).toEqual([]);
  });

  it("tolerates OCR confusions: V read as U, = read as :, missing mm suffix", () => {
    const noisy = "Sex:Male OD Age:68\nAUGAXL: 22.22\nACD :2.77mm\nLENS =4.45mm\nVITR =15.00mm\n";
    const [od] = parseBiometryText(noisy);
    expect(od.side).toBe("OD");
    expect(od.axialLength).toBe(22.22);
    expect(od.acd).toBe(2.77);
  });
});
