import { STRINGS } from "./i18n";
import { closestToPlano, type MedicalRecordInput } from "./medicalRecord";

/**
 * The record as text, for pasting into a hospital system.
 *
 * A PDF is a page layout, not a document: pasting one into a rich-text box
 * linearises the columns and the labels arrive separated from their values.
 * So the same record is offered as plain lines — one value per line, in
 * reading order — and as minimal HTML, which is what an editor like
 * CKEditor keeps the line breaks from. Both go on the clipboard at once and
 * the editor takes whichever it prefers.
 */

const MISSING = "-";

function line(label: string, value: string, unit: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : `${label}: ${trimmed} ${unit}`.trimEnd();
}

interface RecordLines {
  title: string;
  header: string[];
  eyes: { title: string; values: string[]; recommendation: string }[];
  footer: string;
}

/** The one shape both the plain-text and HTML renderings are built from. */
function recordLines(input: MedicalRecordInput): RecordLines {
  const t = STRINGS[input.lang];
  const pad = (n: number) => n.toString().padStart(2, "0");
  const d = input.recordedAt;

  const constants = [
    input.lens.lensFactor ? t.pdfLensFactor(input.lens.lensFactor) : null,
    input.lens.aConstant ? t.pdfAConstant(input.lens.aConstant) : null,
  ].filter((part): part is string => part !== null);

  const header = [
    `${t.pdfPatient}: ${input.patientName.trim() || MISSING}`,
    `${t.pdfDate}: ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    `${t.pdfLens}: ${input.lens.name}${constants.length > 0 ? ` (${constants.join(", ")})` : ""}`,
    input.kIndex ? `${t.pdfKIndex}: ${input.kIndex}` : null,
  ].filter((part): part is string => part !== null);

  const eyes = input.eyes.map((eye) => {
    const m = eye.measurements;
    const values = [
      line(t.pdfAxialLength, m.axialLength, "mm"),
      line(t.pdfK1, m.k1, "D"),
      line(t.pdfK2, m.k2, "D"),
      line(t.pdfAcd, m.acd, "mm"),
      line(t.pdfLensThickness, m.lensThickness, "mm"),
      line(t.pdfWtw, m.wtw, "mm"),
      line(t.pdfTargetRefraction, m.targetRefraction, "D"),
    ].filter((value): value is string => value !== null);

    const best = closestToPlano(eye.rows);
    const bestRow = best >= 0 ? eye.rows[best] : undefined;
    const power = eye.recommended ?? bestRow?.power;
    const refraction =
      bestRow && (eye.recommended === undefined || eye.recommended === bestRow.power)
        ? bestRow.refraction
        : undefined;

    return {
      title: eye.side === "OD" ? t.pdfEyeOd : t.pdfEyeOs,
      values,
      recommendation:
        power === undefined
          ? t.pdfNoRecommendation
          : refraction === undefined
            ? t.pdfRecommended(power)
            : `${t.pdfRecommended(power)} (${t.pdfPredicted(refraction)})`,
    };
  });

  return { title: t.pdfTitle, header, eyes, footer: t.pdfFooterFormula };
}

export function recordToText(input: MedicalRecordInput): string {
  const { title, header, eyes, footer } = recordLines(input);
  const blocks = [
    [title, ...header].join("\n"),
    ...eyes.map((eye) => [eye.title, ...eye.values, eye.recommendation].join("\n")),
    footer,
  ];
  return blocks.join("\n\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Deliberately plain markup — paragraphs, line breaks and bold, no styles.
 * Hospital editors strip or mangle anything fancier, and the point is that
 * the values land under the right labels.
 */
export function recordToHtml(input: MedicalRecordInput): string {
  const { title, header, eyes, footer } = recordLines(input);
  const paragraph = (lines: string[]) => `<p>${lines.map(escapeHtml).join("<br>")}</p>`;

  return [
    `<p><strong>${escapeHtml(title)}</strong><br>${header.map(escapeHtml).join("<br>")}</p>`,
    ...eyes.map((eye) =>
      [
        `<p><strong>${escapeHtml(eye.title)}</strong><br>`,
        eye.values.map(escapeHtml).join("<br>"),
        `<br><strong>${escapeHtml(eye.recommendation)}</strong></p>`,
      ].join(""),
    ),
    paragraph([footer]),
  ].join("");
}

/**
 * Puts the record on the clipboard as both HTML and plain text, so a
 * rich-text box keeps the line breaks and a plain one still gets readable
 * lines. Falls back to plain text where the richer API isn't available
 * (older browsers, or a page not served over HTTPS).
 */
export async function copyRecords(records: MedicalRecordInput[]): Promise<void> {
  const text = records.map(recordToText).join("\n\n\n");
  const html = records.map(recordToHtml).join("<p>&nbsp;</p>");

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Fall through: some browsers refuse ClipboardItem outside a gesture.
    }
  }
  await navigator.clipboard.writeText(text);
}
