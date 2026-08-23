import { describe, expect, it } from "vitest";
import { emptyRow } from "./eyeRow";
import {
  buildMedicalRecordDocument,
  buildMedicalRecordPdf,
  closestToPlano,
  medicalRecordFileName,
  type MedicalRecordInput,
} from "./medicalRecord";
import { buildPdf } from "./pdf";

const OD = {
  ...emptyRow("OD"),
  k1: "44.16",
  k2: "45.06",
  axialLength: "22.98",
  acd: "2.79",
  lensThickness: "4.71",
  wtw: "11.80",
};

const RECORD: MedicalRecordInput = {
  patientName: "Ana Conceição",
  recordedAt: new Date("2026-08-01T13:45:00Z"),
  lang: "en",
  lens: { name: "Personal Constant", lensFactor: "1.57", aConstant: "118.4" },
  eyes: [
    {
      side: "OD",
      measurements: OD,
      recommended: "21.50",
      rows: [
        { power: "23.00", optic: "23.00", refraction: "-0.75" },
        { power: "22.00", optic: "22.00", refraction: "-0.25" },
        { power: "21.00", optic: "21.00", refraction: "0.10" },
      ],
    },
    { side: "OS", measurements: { ...emptyRow("OS"), k1: "43.04", k2: "44.01" }, rows: [] },
  ],
};

/** The record is only useful if every clinical value it claims to carry is on the page. */
function textOf(input: MedicalRecordInput): string {
  return buildMedicalRecordDocument(input)
    .texts.map((item) => item.text)
    .join("\n");
}

describe("medical record layout", () => {
  it("carries the patient, the lens, and every measurement for each eye", () => {
    const text = textOf(RECORD);
    expect(text).toContain("Ana Conceição");
    expect(text).toContain("Personal Constant (Lens Factor 1.57, A Constant 118.4)");
    expect(text).toContain("OD - Right eye");
    expect(text).toContain("OS - Left eye");
    for (const value of ["44.16 D", "45.06 D", "22.98 mm", "2.79 mm", "4.71 mm", "11.80 mm"]) {
      expect(text).toContain(value);
    }
  });

  it("states the recommended IOL power per eye, and says so when there wasn't one", () => {
    const text = textOf(RECORD);
    expect(text).toContain("Recommended IOL: 21.50 D");
    expect(text).toContain("Recommended IOL: not reported by the calculator");
  });

  /**
   * The consultation, on the same page as the power. That is the point of
   * joining the two visits: the surgeon reads what the examiner found
   * without going to look for a sheet of paper in another room.
   */
  it("prints the consultation's findings above the measurements", () => {
    const text = textOf({
      ...RECORD,
      consultation: {
        seenOn: "2026-07-04",
        retina: { finding: "MEDIA OPACITY." },
        preOp: ["INSUFFICIENT PUPIL DILATION", "TAKING TAMSULOSIN / ALPHA-BLOCKER"],
      },
    });
    expect(text).toContain("PRE-OPERATIVE FINDINGS:");
    expect(text).toContain("• INSUFFICIENT PUPIL DILATION");
    expect(text).toContain("From the consultation of 04/07/2026.");
    expect(text).toContain("RETINAL MAPPING: MEDIA OPACITY.");
    expect(text.indexOf("PRE-OPERATIVE FINDINGS:")).toBeLessThan(text.indexOf("44.16 D"));
  });

  it("prints no such block for a record with no consultation attached", () => {
    expect(textOf(RECORD)).not.toContain("PRE-OPERATIVE FINDINGS");
    expect(textOf({ ...RECORD, consultation: { preOp: [] } })).not.toContain(
      "PRE-OPERATIVE FINDINGS",
    );
  });

  it("records only the recommendation, not the other IOL powers", () => {
    const text = textOf(RECORD);
    expect(text).not.toContain("23.00");
    expect(text).not.toContain("-0.75");
  });

  it("attaches the predicted refraction of the row closest to plano", () => {
    expect(closestToPlano(RECORD.eyes[0].rows)).toBe(2);
    const table = RECORD.eyes[0].rows;
    const text = textOf({
      ...RECORD,
      eyes: [{ side: "OD", measurements: OD, recommended: table[2].power, rows: table }],
    });
    expect(text).toContain("Recommended IOL: 21.00 D  (predicted refraction 0.10 D)");
  });

  it("omits the predicted refraction when it belongs to a different power", () => {
    // The calculator's own recommendation wins; pairing it with another
    // row's refraction would state a prediction that was never made.
    const text = textOf(RECORD);
    expect(text).toContain("Recommended IOL: 21.50 D");
    expect(text).not.toContain("predicted refraction");
  });

  it("falls back to the closest-to-plano row when no recommendation was reported", () => {
    const text = textOf({
      ...RECORD,
      eyes: [{ side: "OD", measurements: OD, rows: RECORD.eyes[0].rows }],
    });
    expect(text).toContain("Recommended IOL: 21.00 D  (predicted refraction 0.10 D)");
  });

  it("writes the record in Portuguese when the app is in Portuguese", () => {
    const text = textOf({ ...RECORD, lang: "pt" });
    expect(text).toContain("Prontuário de Cálculo de LIO");
    expect(text).toContain("Paciente");
    expect(text).toContain("LIO recomendada: 21.50 D");
    expect(text).toContain("Comprimento axial");
  });

  it("marks nothing when no refraction parses", () => {
    expect(closestToPlano([{ power: "23.00", optic: "23.00", refraction: "n/a" }])).toBe(-1);
  });

  it("writes a missing value as a dash rather than an empty gap", () => {
    const text = textOf({ ...RECORD, patientName: "  " });
    // OS carries no axial length in the fixture.
    expect(text).toContain("-");
  });

  it("builds a filename from the name and date, without accents or spaces", () => {
    expect(medicalRecordFileName(RECORD)).toBe("iol-record-ana-conceicao-2026-08-01.pdf");
    expect(medicalRecordFileName({ ...RECORD, patientName: "" })).toBe(
      "iol-record-patient-2026-08-01.pdf",
    );
  });
});

/** Reads the byte offset each xref entry claims, to check they really point at their objects. */
function xrefOffsets(bytes: Uint8Array): number[] {
  const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const start = Number(text.slice(text.lastIndexOf("startxref")).split("\n")[1]);
  const table = text.slice(start).split("\n").slice(2);
  return table
    .filter((line) => line.endsWith(" 00000 n "))
    .map((line) => Number(line.slice(0, 10)));
}

describe("pdf writer", () => {
  it("produces a parseable PDF whose xref offsets land on their objects", () => {
    const bytes = buildMedicalRecordPdf(RECORD);
    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);

    const offsets = xrefOffsets(bytes);
    expect(offsets).toHaveLength(7);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + 8)).toContain(`${index + 1} 0 obj`);
    });
  });

  it("escapes parentheses and backslashes so they cannot break the content stream", () => {
    const bytes = buildPdf({ title: "t", texts: [{ text: "K1 (steep) \\ K2", x: 10, y: 10 }] });
    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    expect(text).toContain("(K1 \\(steep\\) \\\\ K2) Tj");
  });

  it("declares a stream length in bytes and replaces what WinAnsi cannot encode", () => {
    // "ç" is one byte in WinAnsi; the emoji is two JS characters and becomes
    // a single "?" byte — so a character count here would be wrong twice over.
    const bytes = buildPdf({ title: "t", texts: [{ text: "Conceição 👁", x: 10, y: 10 }] });
    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    const declared = Number(/\/Length (\d+)/.exec(text)?.[1]);
    const stream = text.slice(text.indexOf("stream\n") + 7, text.indexOf("\nendstream"));
    expect(declared).toBe(stream.length);
    expect(stream).toContain("(Conceição ?) Tj");
  });
});
