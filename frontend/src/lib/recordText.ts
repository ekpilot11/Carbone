import { STRINGS, type Lang } from "./i18n";
import { closestToPlano, type MedicalRecordInput } from "./medicalRecord";

/**
 * The record written the way the hospital system's own notes are written —
 * copied from the source code of a record the clinician had formatted by
 * hand: BIOMETRIA / TOPOGRAFIA / CALCULO DA LENTE, each eye labelled, one
 * value per line, blank paragraphs between blocks, 16px body text and the
 * recommended power at 20px.
 *
 * A PDF is a page layout, not a document — pasting one linearises its
 * columns and the values land away from their labels. So the record is
 * rebuilt as text here, in two forms: this markup, for a normal paste or
 * for the editor's "Código-Fonte" view (where no paste filter can touch
 * it), and a plain-lines version for anywhere that takes only text.
 */

/** The editor zeroes paragraph margins, so gaps are real (empty) paragraphs. */
const SPACER = "<p>&nbsp;</p>";
const BODY_PX = 16;
const POWER_PX = 20;

interface Block {
  heading?: string;
  /** "" is a deliberate blank line inside the block. */
  lines: string[];
  /** The recommendation block: bold, with the power itself enlarged. */
  emphasis?: boolean;
}

function present(raw: string): boolean {
  return raw.trim() !== "";
}

/** Portuguese records label the left eye OE, not OS. */
function eyeLabel(lang: Lang, side: "OD" | "OS"): string {
  return side === "OD" ? "OD" : lang === "pt" ? "OE" : "OS";
}

/** The recommended power, split so the number can be set larger than its label. */
function recommendation(
  input: MedicalRecordInput,
  eye: MedicalRecordInput["eyes"][number],
): { label: string; power?: string; note?: string } {
  const t = STRINGS[input.lang];
  const best = closestToPlano(eye.rows);
  const bestRow = best >= 0 ? eye.rows[best] : undefined;
  const power = eye.recommended ?? bestRow?.power;
  const side = eyeLabel(input.lang, eye.side);

  if (power === undefined) return { label: `${side} - ${t.pdfNoRecommendation}` };
  const refraction =
    bestRow && (eye.recommended === undefined || eye.recommended === bestRow.power)
      ? bestRow.refraction
      : undefined;
  return {
    label: `${side} - ${t.recordLensLine}:`,
    power: `${power} D`,
    // Kept at body size: the power is what should catch the eye, not the
    // prediction that comes with it.
    note: refraction === undefined ? undefined : ` (${t.pdfPredicted(refraction)})`,
  };
}

function recordBlocks(input: MedicalRecordInput): Block[] {
  const t = STRINGS[input.lang];
  const blocks: Block[] = [{ lines: [t.recordOpeningLine] }];

  const biometry: string[] = [];
  for (const eye of input.eyes) {
    const m = eye.measurements;
    const lines = [
      present(m.axialLength) ? `AXL: ${m.axialLength.trim()} mm` : null,
      present(m.acd) ? `ACD: ${m.acd.trim()} mm` : null,
      present(m.lensThickness) ? `LENS: ${m.lensThickness.trim()} mm` : null,
      present(m.wtw) ? `WTW: ${m.wtw.trim()} mm` : null,
    ].filter((line): line is string => line !== null);
    if (lines.length > 0) biometry.push(eyeLabel(input.lang, eye.side), "", ...lines, "");
  }
  if (biometry.length > 0) {
    blocks.push({ heading: t.recordBiometry, lines: biometry.slice(0, -1) });
  }

  const topography: string[] = [];
  for (const eye of input.eyes) {
    const m = eye.measurements;
    const lines = [
      present(m.k1) ? `K1: ${m.k1.trim()}` : null,
      present(m.k2) ? `K2: ${m.k2.trim()}` : null,
    ].filter((line): line is string => line !== null);
    if (lines.length > 0) topography.push(`${eyeLabel(input.lang, eye.side)}:`, "", ...lines, "");
  }
  if (topography.length > 0) {
    blocks.push({ heading: t.recordTopography, lines: topography.slice(0, -1) });
  }

  // Each power carries its eye: two bare numbers in a row would be ambiguous
  // in a record that outlives the person who wrote it.
  blocks.push({
    heading: t.recordLensCalculation,
    lines: input.eyes.map((eye) => {
      const { label, power, note } = recommendation(input, eye);
      return power === undefined ? label : `${label} ${power}${note ?? ""}`;
    }),
    emphasis: true,
  });

  const constants = [
    input.lens.lensFactor ? t.pdfLensFactor(input.lens.lensFactor) : null,
    input.lens.aConstant ? t.pdfAConstant(input.lens.aConstant) : null,
  ].filter((part): part is string => part !== null);
  blocks.push({
    lines: [
      `${t.pdfLens}: ${input.lens.name}${constants.length > 0 ? ` (${constants.join(", ")})` : ""}` +
        (input.kIndex ? ` | ${t.pdfKIndex}: ${input.kIndex}` : ""),
      t.pdfFooterFormula,
    ],
  });

  return blocks;
}

/** Plain lines, for a box that takes no formatting at all. */
export function recordToText(input: MedicalRecordInput): string {
  return recordBlocks(input)
    .map((block) =>
      [block.heading, block.heading ? "" : null, ...block.lines]
        .filter((line): line is string => line !== null)
        .join("\n"),
    )
    .join("\n\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sized(text: string, px: number): string {
  return `<span style="font-size:${px}px;">${escapeHtml(text)}</span>`;
}

/**
 * The markup itself. No classes, no tables, no colours — only what the
 * editor's own source view already contains, so a paste can't be reduced to
 * anything it doesn't already accept.
 */
export function recordToHtml(input: MedicalRecordInput): string {
  const parts: string[] = [];

  for (const block of recordBlocks(input)) {
    if (parts.length > 0) parts.push(SPACER);
    if (block.heading) {
      parts.push(`<p><strong>${sized(block.heading, BODY_PX)}</strong></p>`, SPACER);
    }

    if (block.emphasis) {
      // Label at body size, the power itself enlarged — the one number a
      // reader should find without looking for it.
      for (const eye of input.eyes) {
        const { label, power, note } = recommendation(input, eye);
        parts.push(
          power === undefined
            ? `<p><strong>${sized(label, BODY_PX)}</strong></p>`
            : `<p><strong>${sized(`${label} `, BODY_PX)}${sized(power, POWER_PX)}` +
              `${note ? sized(note, BODY_PX) : ""}</strong></p>`,
        );
      }
      continue;
    }

    for (const line of block.lines) {
      parts.push(line === "" ? SPACER : `<p>${sized(line, BODY_PX)}</p>`);
    }
  }

  return parts.join("\n");
}

export function recordsToSource(records: MedicalRecordInput[]): string {
  return records.map(recordToHtml).join(`\n${SPACER}\n${SPACER}\n`);
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
    records.map(recordToHtml).join(`\n${SPACER}\n${SPACER}\n`),
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
