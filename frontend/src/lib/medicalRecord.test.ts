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
    expect(text).toContain("No IOL power options were returned for this eye.");
  });

  it("marks the option closest to plano, matching the on-screen table", () => {
    expect(closestToPlano(RECORD.eyes[0].rows)).toBe(2);
    expect(textOf(RECORD)).toContain("closest to 0");
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
