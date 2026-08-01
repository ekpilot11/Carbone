import type { IolTableRow } from "./api";
import type { EyeRowState } from "./eyeRow";
import { A4_HEIGHT, A4_WIDTH, buildPdf, type PdfDocument, type PdfRule, type PdfText } from "./pdf";
import type { EyeSide } from "./types";

/**
 * Lays out the printable record: what was measured for each eye and what
 * the Barrett Universal II calculator returned for it.
 *
 * The patient's name is typed by the clinician here and never comes from
 * the photograph — the scan deliberately refuses to read identifiers. The
 * whole document is assembled and saved in the browser, so nothing in it
 * is transmitted anywhere.
 */

export interface MedicalRecordEye {
  side: EyeSide;
  measurements: EyeRowState;
  /** The calculator's "Recommended IOL" power for this eye, when it reported one. */
  recommended?: string;
  rows: IolTableRow[];
}

export interface MedicalRecordInput {
  patientName: string;
  recordedAt: Date;
  lens: { name: string; lensFactor?: string; aConstant?: string };
  eyes: MedicalRecordEye[];
}

const MARGIN = 56;
const LINE = 15;
const MISSING = "-";

const EYE_TITLES: Record<EyeSide, string> = {
  OD: "OD - Right eye",
  OS: "OS - Left eye",
};

function value(raw: string, unit: string): string {
  const trimmed = raw.trim();
  return trimmed === "" ? MISSING : `${trimmed} ${unit}`;
}

function formatDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The row landing closest to plano — the same one the on-screen table
 * highlights. Returns -1 when no refraction parses, so a malformed table
 * simply prints unmarked rather than marking an arbitrary row.
 */
export function closestToPlano(rows: IolTableRow[]): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const distance = Math.abs(Number.parseFloat(row.refraction));
    if (Number.isFinite(distance) && distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

export function buildMedicalRecordDocument(input: MedicalRecordInput): PdfDocument {
  const texts: PdfText[] = [];
  const rules: PdfRule[] = [];
  const right = A4_WIDTH - MARGIN;
  let y = 64;

  const write = (text: string, x: number, options: { size?: number; bold?: boolean } = {}) => {
    texts.push({ text, x, y, size: options.size, bold: options.bold });
  };

  write("IOL Calculation Record", MARGIN, { size: 18, bold: true });
  y += 18;
  write("Barrett Universal II formula - calc.apacrs.org", MARGIN, { size: 9 });
  y += 10;
  rules.push({ x1: MARGIN, x2: right, y });

  y += 24;
  const labelled = (label: string, text: string) => {
    write(label, MARGIN, { size: 10, bold: true });
    write(text, MARGIN + 90, { size: 10 });
    y += LINE;
  };
  labelled("Patient", input.patientName.trim() || MISSING);
  labelled("Date", formatDate(input.recordedAt));
  const constants = [
    input.lens.lensFactor ? `Lens Factor ${input.lens.lensFactor}` : null,
    input.lens.aConstant ? `A Constant ${input.lens.aConstant}` : null,
  ].filter((part): part is string => part !== null);
  labelled("Lens", constants.length > 0 ? `${input.lens.name} (${constants.join(", ")})` : input.lens.name);

  for (const eye of input.eyes) {
    y += 16;
    write(EYE_TITLES[eye.side], MARGIN, { size: 13, bold: true });
    y += 6;
    rules.push({ x1: MARGIN, x2: right, y, gray: 0.6 });
    y += 20;

    const m = eye.measurements;
    // Two columns of measurements, in the order the calculator asks for them.
    const pairs: Array<[string, string]> = [
      ["Axial Length", value(m.axialLength, "mm")],
      ["Measured K1", value(m.k1, "D")],
      ["Optical ACD", value(m.acd, "mm")],
      ["Measured K2", value(m.k2, "D")],
      ["Lens Thickness", value(m.lensThickness, "mm")],
      ["WTW", value(m.wtw, "mm")],
      ["Target Refraction", value(m.targetRefraction, "D")],
    ];
    for (let i = 0; i < pairs.length; i += 2) {
      const columns = [pairs[i], pairs[i + 1]].filter((pair): pair is [string, string] => Boolean(pair));
      columns.forEach(([label, text], column) => {
        const x = MARGIN + column * 250;
        texts.push({ text: `${label}:`, x, y, size: 10 });
        texts.push({ text, x: x + 110, y, size: 10, bold: true });
      });
      y += LINE;
    }

    y += 10;
    write(
      eye.recommended
        ? `Recommended IOL: ${eye.recommended} D`
        : "Recommended IOL: not reported by the calculator",
      MARGIN,
      { size: 11, bold: true },
    );
    y += 20;

    if (eye.rows.length > 0) {
      const columns = [MARGIN, MARGIN + 100, MARGIN + 200, MARGIN + 300];
      ["IOL Power", "Optic", "Refraction", ""].forEach((heading, index) => {
        texts.push({ text: heading, x: columns[index], y, size: 9, bold: true });
      });
      y += 5;
      rules.push({ x1: MARGIN, x2: right, y, gray: 0.6 });
      y += 13;

      const best = closestToPlano(eye.rows);
      eye.rows.forEach((row, index) => {
        const highlight = index === best;
        [row.power, row.optic, row.refraction, highlight ? "closest to 0" : ""].forEach((cell, column) => {
          texts.push({ text: cell, x: columns[column], y, size: 10, bold: highlight });
        });
        y += LINE;
      });
    } else {
      write("No IOL power options were returned for this eye.", MARGIN, { size: 10 });
      y += LINE;
    }
  }

  const footerY = A4_HEIGHT - 56;
  rules.push({ x1: MARGIN, x2: right, y: footerY - 24, gray: 0.6 });
  texts.push({
    text: "Values read from the exam printouts and confirmed by the clinician before calculation.",
    x: MARGIN,
    y: footerY - 10,
    size: 8,
  });
  texts.push({
    text: "Computed with the Barrett Universal II calculator. Verify before surgical planning.",
    x: MARGIN,
    y: footerY,
    size: 8,
  });

  return { title: `IOL Calculation Record - ${input.patientName.trim() || "unnamed"}`, texts, rules };
}

export function buildMedicalRecordPdf(input: MedicalRecordInput): Uint8Array {
  return buildPdf(buildMedicalRecordDocument(input));
}

export function medicalRecordFileName(input: MedicalRecordInput): string {
  const name = input.patientName
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const date = input.recordedAt.toISOString().slice(0, 10);
  return `iol-record-${name || "patient"}-${date}.pdf`;
}
