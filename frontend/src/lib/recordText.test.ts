import { describe, expect, it } from "vitest";
import { emptyRow } from "./eyeRow";
import type { MedicalRecordInput } from "./medicalRecord";
import { recordsToSource, recordToHtml, recordToText } from "./recordText";

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
  it("follows the hospital's own note layout, one value per line", () => {
    const lines = recordToText(RECORD).split("\n");
    expect(lines).toContain("BIOMETRIA:");
    expect(lines).toContain("OD");
    expect(lines).toContain("AXL: 23.09 mm");
    expect(lines).toContain("ACD: 4.20 mm");
    expect(lines).toContain("TOPOGRAFIA:");
    expect(lines).toContain("OD:");
    expect(lines).toContain("K1: 43.23");
    expect(lines).toContain("K2: 43.34");
    expect(lines).toContain("CALCULO DA LENTE:");
    // The failure this replaces: labels bunched together, values after them.
    expect(recordToText(RECORD)).not.toContain("AXL: ACD:");
  });

  it("labels the left eye OE in Portuguese and OS in English", () => {
    const both: MedicalRecordInput = {
      ...RECORD,
      eyes: [RECORD.eyes[0], { ...RECORD.eyes[0], side: "OS" }],
    };
    expect(recordToText(both)).toContain("OE");
    expect(recordToText({ ...both, lang: "en" })).toContain("OS");
  });

  it("names the eye on every recommended power", () => {
    const text = recordToText(RECORD);
    expect(text).toContain("OD - LIO recomendada: 23.00 D (refração prevista -0.10 D)");
  });

  it("omits values that were never measured rather than printing blanks", () => {
    const text = recordToText(RECORD);
    expect(text).not.toContain("WTW");
    expect(text).not.toContain("LENS:");
  });

  it("records which lens and index produced the powers", () => {
    const text = recordToText(RECORD);
    expect(text).toContain("Lente: Personal Constant (Lens Factor 1.57, Constante A 118.4)");
    expect(text).toContain("Índice K: 1.3375");
  });
});

describe("record as source code", () => {
  it("uses the editor's own markup: sized spans, bold headings, blank paragraphs", () => {
    const html = recordToHtml(RECORD);
    expect(html).toContain('<p><strong><span style="font-size:16px;">BIOMETRIA:</span></strong></p>');
    expect(html).toContain('<p><span style="font-size:16px;">AXL: 23.09 mm</span></p>');
    expect(html).toContain("<p>&nbsp;</p>");
    // The power itself is the one thing set larger.
    expect(html).toContain('<span style="font-size:20px;">23.00 D</span>');
    // The prediction stays at body size beside it.
    expect(html).toContain('<span style="font-size:16px;"> (refração prevista -0.10 D)</span>');
    expect(html).not.toMatch(/class=|<table|<div/);
  });

  it("escapes markup in a patient's name", () => {
    const html = recordToHtml({ ...RECORD, patientName: "Ana <b>Souza</b>" });
    expect(html).not.toContain("<b>Souza</b>");
  });

  it("separates patients when a whole batch is copied", () => {
    const source = recordsToSource([RECORD, RECORD]);
    expect(source.match(/BIOMETRIA:/g)).toHaveLength(2);
  });
});
