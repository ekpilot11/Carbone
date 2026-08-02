import type { IolTableRow } from "./api";
import type { EyeRowState } from "./eyeRow";
import { STRINGS, type Lang, type Strings } from "./i18n";
import {
  A4_HEIGHT,
  A4_WIDTH,
  buildPdf,
  buildPdfPages,
  type PdfDocument,
  type PdfRule,
  type PdfText,
} from "./pdf";
import type { EyeSide } from "./types";

/**
 * Lays out the printable record: what was measured for each eye, and the
 * one IOL power the calculator recommends for it — the full table of
 * alternatives is on screen, but the record carries the decision.
 *
 * The document is assembled and saved in the browser, so nothing in it —
 * the patient's name included — is transmitted anywhere.
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
  /** The keratometric index the calculation ran with; it changes every power. */
  kIndex?: string;
  eyes: MedicalRecordEye[];
  /**
   * Fundus findings per eye, for the record's MAPEAMENTO RETINA block.
   * Typed by the clinician — this app never examines a retina, so it never
   * fills these in on its own.
   */
  retina?: Partial<Record<EyeSide, string>>;
  /** The record follows the language the app is being used in. */
  lang: Lang;
}

const MARGIN = 56;
const LINE = 15;
const MISSING = "-";

function eyeTitle(t: Strings, side: EyeSide): string {
  return side === "OD" ? t.pdfEyeOd : t.pdfEyeOs;
}

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
  const t = STRINGS[input.lang];
  const texts: PdfText[] = [];
  const rules: PdfRule[] = [];
  const right = A4_WIDTH - MARGIN;
  let y = 64;

  const write = (text: string, x: number, options: { size?: number; bold?: boolean } = {}) => {
    texts.push({ text, x, y, size: options.size, bold: options.bold });
  };

  write(t.pdfTitle, MARGIN, { size: 18, bold: true });
  y += 18;
  write(t.pdfSubtitle, MARGIN, { size: 9 });
  y += 10;
  rules.push({ x1: MARGIN, x2: right, y });

  y += 24;
  const labelled = (label: string, text: string) => {
    write(label, MARGIN, { size: 10, bold: true });
    write(text, MARGIN + 90, { size: 10 });
    y += LINE;
  };
  labelled(t.pdfPatient, input.patientName.trim() || MISSING);
  labelled(t.pdfDate, formatDate(input.recordedAt));
  const constants = [
    input.lens.lensFactor ? t.pdfLensFactor(input.lens.lensFactor) : null,
    input.lens.aConstant ? t.pdfAConstant(input.lens.aConstant) : null,
  ].filter((part): part is string => part !== null);
  labelled(
    t.pdfLens,
    constants.length > 0 ? `${input.lens.name} (${constants.join(", ")})` : input.lens.name,
  );
  if (input.kIndex) labelled(t.pdfKIndex, input.kIndex);

  for (const eye of input.eyes) {
    y += 16;
    write(eyeTitle(t, eye.side), MARGIN, { size: 13, bold: true });
    y += 6;
    rules.push({ x1: MARGIN, x2: right, y, gray: 0.6 });
    y += 20;

    const m = eye.measurements;
    // Two columns of measurements, in the order the calculator asks for them.
    const pairs: Array<[string, string]> = [
      [t.pdfAxialLength, value(m.axialLength, "mm")],
      [t.pdfK1, value(m.k1, "D")],
      [t.pdfAcd, value(m.acd, "mm")],
      [t.pdfK2, value(m.k2, "D")],
      [t.pdfLensThickness, value(m.lensThickness, "mm")],
      [t.pdfWtw, value(m.wtw, "mm")],
      [t.pdfTargetRefraction, value(m.targetRefraction, "D")],
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

    // Only the recommendation is recorded — the other six powers are
    // alternatives the clinician has already looked at on screen.
    y += 12;
    const best = closestToPlano(eye.rows);
    const bestRow = best >= 0 ? eye.rows[best] : undefined;
    // The calculator's own summary wins when it reported one; the predicted
    // refraction is only attached when it demonstrably belongs to that power.
    const power = eye.recommended ?? bestRow?.power;
    const refraction =
      bestRow && (eye.recommended === undefined || eye.recommended === bestRow.power)
        ? bestRow.refraction
        : undefined;
    write(
      power === undefined
        ? t.pdfNoRecommendation
        : refraction === undefined
          ? t.pdfRecommended(power)
          : `${t.pdfRecommended(power)}  (${t.pdfPredicted(refraction)})`,
      MARGIN,
      { size: 12, bold: true },
    );
    y += LINE;
  }

  const footerY = A4_HEIGHT - 56;
  rules.push({ x1: MARGIN, x2: right, y: footerY - 24, gray: 0.6 });
  texts.push({ text: t.pdfFooterValues, x: MARGIN, y: footerY - 10, size: 8 });
  texts.push({ text: t.pdfFooterFormula, x: MARGIN, y: footerY, size: 8 });

  return { title: `${t.pdfTitle} - ${input.patientName.trim() || t.pdfUnnamed}`, texts, rules };
}

export function buildMedicalRecordPdf(input: MedicalRecordInput): Uint8Array {
  return buildPdf(buildMedicalRecordDocument(input));
}

/**
 * A day's batch as one file, a page per patient, in the order they were
 * uploaded — thirty separate downloads would be unusable.
 */
export function buildCombinedRecordPdf(inputs: MedicalRecordInput[]): Uint8Array {
  const t = STRINGS[inputs[0]?.lang ?? "en"];
  return buildPdfPages(t.pdfTitle, inputs.map(buildMedicalRecordDocument));
}

export function combinedRecordFileName(inputs: MedicalRecordInput[]): string {
  const date = (inputs[0]?.recordedAt ?? new Date()).toISOString().slice(0, 10);
  return `iol-records-${date}-${inputs.length}-patients.pdf`;
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
