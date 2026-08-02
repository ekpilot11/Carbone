import { describe, expect, it } from "vitest";
import { emptyRow } from "./eyeRow";
import type { MedicalRecordInput } from "./medicalRecord";
import { recordToHtml, recordToText } from "./recordText";

const RECORD: MedicalRecordInput = {
  patientName: "Carlos Alberto <Bombonato>",
  recordedAt: new Date("2026-08-01T13:45:00Z"),
  lang: "pt",
  kIndex: "1.3375",
  lens: { name: "Personal Constant", lensFactor: "1.57", aConstant: "118.4" },
  eyes: [
    {
      side: "OD",
      measurements: {
        ...emptyRow("OD"),
        k1: "43.23",
        k2: "43.34",
        axialLength: "23.09",
        acd: "4.20",
        targetRefraction: "0",
      },
      recommended: "23.00",
      rows: [
        { power: "23.50", optic: "Biconvex", refraction: "-0.45" },
        { power: "23.00", optic: "Biconvex", refraction: "-0.10" },
      ],
    },
  ],
};

describe("record as pasteable text", () => {
  it("puts every value on its own line, under its own label", () => {
    const lines = recordToText(RECORD).split("\n");
    expect(lines).toContain("Comprimento axial: 23.09 mm");
    expect(lines).toContain("K1 medido: 43.23 D");
    expect(lines).toContain("ACD óptica: 4.20 mm");
    expect(lines).toContain("LIO recomendada: 23.00 D (refração prevista -0.10 D)");
    // The failure this replaces: labels bunched together, values after them.
    expect(recordToText(RECORD)).not.toContain("Comprimento axial: ACD óptica:");
  });

  it("omits values that were never measured rather than printing blanks", () => {
    const text = recordToText(RECORD);
    expect(text).not.toContain("WTW");
    expect(text).not.toContain("Espessura do cristalino");
  });

  it("carries the patient, lens, constants and K index", () => {
    const text = recordToText(RECORD);
    expect(text).toContain("Paciente: Carlos Alberto <Bombonato>");
    expect(text).toContain("Lente: Personal Constant (Lens Factor 1.57, Constante A 118.4)");
    expect(text).toContain("Índice K: 1.3375");
    expect(text).toContain("01/08/2026");
  });

  it("follows the app's language", () => {
    const text = recordToText({ ...RECORD, lang: "en" });
    expect(text).toContain("Axial Length: 23.09 mm");
    expect(text).toContain("Recommended IOL: 23.00 D (predicted refraction -0.10 D)");
  });
});

describe("record as HTML", () => {
  it("uses line breaks a rich-text editor keeps", () => {
    const html = recordToHtml(RECORD);
    expect(html).toContain("Comprimento axial: 23.09 mm<br>");
    expect(html).toContain("<strong>OD - Olho direito</strong>");
    expect(html).not.toMatch(/style=|class=/);
  });

  it("escapes markup in a patient's name", () => {
    const html = recordToHtml(RECORD);
    expect(html).toContain("Carlos Alberto &lt;Bombonato&gt;");
    expect(html).not.toContain("<Bombonato>");
  });
});
