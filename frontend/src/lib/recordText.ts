import { STRINGS, type Lang } from "./i18n";
import { closestToPlano, type MedicalRecordInput } from "./medicalRecord";

/**
 * The record written exactly as the hospital system's own notes are —
 * transcribed from the source code of a record the clinician had formatted
 * by hand, down to the sized spans, the bold headings and the empty
 * paragraphs that carry the spacing.
 *
 * A PDF is a page layout, not a document: pasting one linearises its
 * columns and the values land away from their labels. So the record is
 * rebuilt as text here — as that markup, for a normal paste or for the
 * editor's "Código-Fonte" view, and as plain lines for anywhere that takes
 * no formatting at all.
 */

/** The editor zeroes paragraph margins, so gaps are real (empty) paragraphs. */
const SPACER = "<p>&nbsp;</p>";
const BODY_PX = 16;
const POWER_PX = 20;

/** Portuguese records label the left eye OE, not OS. */
function eyeLabel(lang: Lang, side: "OD" | "OS"): string {
  return side === "OD" ? "OD" : lang === "pt" ? "OE" : "OS";
}

function present(raw: string | undefined): raw is string {
  return raw !== undefined && raw.trim() !== "";
}

interface EyeLines {
  label: string;
  lines: string[];
}

interface RecordModel {
  opening: string;
  retinaHeading: string;
  /**
   * The practice's standard fundus wording. It goes in as the starting
   * point for a section the clinician edits in the hospital system itself —
   * this app has no view of a retina and never claims to.
   */
  retina: { label: string; text: string }[];
  biometryHeading: string;
  biometry: EyeLines[];
  topographyHeading: string;
  topography: EyeLines[];
  lensHeading: string;
  lens: { label: string; power?: string }[];
}

function buildModel(input: MedicalRecordInput): RecordModel {
  const t = STRINGS[input.lang];

  const retina = (["OD", "OS"] as const).map((side) => ({
    label: `${eyeLabel(input.lang, side)}:`,
    text: t.recordRetinaDefault,
  }));

  const biometry: EyeLines[] = [];
  const topography: EyeLines[] = [];
  for (const eye of input.eyes) {
    const m = eye.measurements;
    const label = eyeLabel(input.lang, eye.side);

    const biometryLines = [
      present(m.axialLength) ? `AXL: ${m.axialLength.trim()} mm` : null,
      present(m.acd) ? `ACD: ${m.acd.trim()} mm` : null,
      present(m.lensThickness) ? `LENS: ${m.lensThickness.trim()} mm` : null,
      present(m.wtw) ? `WTW: ${m.wtw.trim()} mm` : null,
    ].filter((line): line is string => line !== null);
    if (biometryLines.length > 0) biometry.push({ label, lines: biometryLines });

    const topographyLines = [
      present(m.k1) ? `K1: ${m.k1.trim()}` : null,
      present(m.k2) ? `K2: ${m.k2.trim()}` : null,
    ].filter((line): line is string => line !== null);
    if (topographyLines.length > 0) topography.push({ label: `${label}:`, lines: topographyLines });
  }

  // Each power carries its eye: two bare numbers in a row would be ambiguous
  // in a record that outlives whoever wrote it.
  const lens = input.eyes.map((eye) => {
    const best = closestToPlano(eye.rows);
    const power = eye.recommended ?? (best >= 0 ? eye.rows[best].power : undefined);
    const side = eyeLabel(input.lang, eye.side);
    return power === undefined
      ? { label: `${side} - ${t.pdfNoRecommendation}` }
      : { label: `${side} - ${t.recordLensLine}:`, power: `${power} D` };
  });

  return {
    opening: t.recordOpeningLine,
    retinaHeading: t.recordRetina,
    retina,
    biometryHeading: t.recordBiometry,
    biometry,
    topographyHeading: t.recordTopography,
    topography,
    lensHeading: t.recordLensCalculation,
    lens,
  };
}

/** Plain lines, for a box that takes no formatting at all. */
export function recordToText(input: MedicalRecordInput): string {
  const m = buildModel(input);
  const blocks: string[] = [m.opening];

  if (m.retina.length > 0) {
    blocks.push(
      [m.retinaHeading, "", ...m.retina.map((entry) => `${entry.label} ${entry.text}`)].join("\n"),
    );
  }
  for (const [heading, eyes] of [
    [m.biometryHeading, m.biometry],
    [m.topographyHeading, m.topography],
  ] as const) {
    if (eyes.length === 0) continue;
    blocks.push(
      [heading, "", ...eyes.flatMap((eye) => [eye.label, "", ...eye.lines, ""])].slice(0, -1).join("\n"),
    );
  }
  blocks.push(
    [
      m.lensHeading,
      "",
      ...m.lens.map((entry) => (entry.power ? `${entry.label} ${entry.power}` : entry.label)),
    ].join("\n"),
  );

  return blocks.join("\n\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sized(text: string, px: number): string {
  return `<span style="font-size:${px}px;">${escapeHtml(text)}</span>`;
}

/**
 * The markup itself. No classes, tables or colours — only what the editor's
 * own source view already contains, so nothing in a paste can be reduced to
 * something it doesn't already accept.
 */
export function recordToHtml(input: MedicalRecordInput): string {
  const m = buildModel(input);
  const parts: string[] = [`<p>${sized(m.opening, BODY_PX)}</p>`, SPACER];

  if (m.retina.length > 0) {
    // The clinic writes this heading plain and the eye label bold, inline
    // with its findings — unlike the measurement sections below.
    parts.push(`<p>${escapeHtml(m.retinaHeading)}</p>`, SPACER);
    for (const entry of m.retina) {
      parts.push(
        `<p><strong>${escapeHtml(entry.label)}&nbsp;</strong>${escapeHtml(entry.text)}</p>`,
        SPACER,
      );
    }
    parts.push(SPACER);
  }

  for (const [heading, eyes] of [
    [m.biometryHeading, m.biometry],
    [m.topographyHeading, m.topography],
  ] as const) {
    if (eyes.length === 0) continue;
    parts.push(`<p><strong>${sized(heading, BODY_PX)}</strong></p>`, SPACER);
    for (const eye of eyes) {
      parts.push(`<p>${sized(eye.label, BODY_PX)}</p>`, SPACER);
      for (const line of eye.lines) parts.push(`<p>${sized(line, BODY_PX)}</p>`);
      parts.push(SPACER);
    }
  }

  parts.push(`<p><strong>${sized(m.lensHeading, BODY_PX)}</strong></p>`, SPACER);
  for (const entry of m.lens) {
    // The power is the one number a reader should find without searching.
    parts.push(
      entry.power === undefined
        ? `<p><strong>${sized(entry.label, BODY_PX)}</strong></p>`
        : `<p><strong>${sized(`${entry.label} `, BODY_PX)}${sized(entry.power, POWER_PX)}` +
          `<span style="font-size:${BODY_PX}px;">&nbsp;</span></strong></p>`,
    );
  }
  parts.push(SPACER);

  return parts.join("\n");
}

export function recordsToSource(records: MedicalRecordInput[]): string {
  return records.map(recordToHtml).join(`\n${SPACER}\n`);
}

async function writeClipboard(text: string, html?: string): Promise<void> {
  if (html !== undefined && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
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

/** For a normal paste: rich text where the editor accepts it, lines where it doesn't. */
export async function copyRecords(records: MedicalRecordInput[]): Promise<void> {
  await writeClipboard(
    records.map(recordToText).join("\n\n\n"),
    records.map(recordToHtml).join(`\n${SPACER}\n`),
  );
}

/**
 * For the editor's "Código-Fonte" view: the markup copied as plain text.
 * Nothing filters a paste made there, so the layout arrives exactly as
 * built — the reliable route when a normal paste loses its spacing.
 */
export async function copyRecordSource(records: MedicalRecordInput[]): Promise<void> {
  await writeClipboard(recordsToSource(records));
}
