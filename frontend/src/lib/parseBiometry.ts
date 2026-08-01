import { inRange, normalizeOcrNumbers, RANGES } from "./ocrText";
import { parseDecimal } from "./numeric";
import type { BiometryReading, EyeSide } from "./types";

/**
 * The axial-length summary label. OCR renders the "V" inconsistently —
 * "AVGAXL", "AUGAXL" and "AVUGAXL" have all been observed on the same
 * printout under different image preprocessing — so the letters between
 * "A" and "GAXL" are matched loosely.
 */
const AVGAXL_LABEL = /A[VU]{1,2}GAXL/gi;
const AVGAXL_VALUE = /A[VU]{1,2}GAXL\s*[=:]?\s*(\d+\.\d+)/i;

/** Summary lines that follow the axial length, e.g. "ACD =2.79mm". */
const ACD_LINE = /\bACD\s*[=:]\s*(\d+\.\d+)/i;
const LENS_LINE = /\bLENS\s*[=:]\s*(\d+\.\d+)/i;
const VITR_LINE = /\b[VU]ITR\s*[=:]\s*(\d+\.\d+)/i;

/**
 * The averages row of the measurement table: "Avg 02.79 04.71 15.49 22.98"
 * (ACD, LENS, VITR, AL). Used as a fallback when the big summary lines
 * are unreadable, and as the only source of ACD if that line is corrupted.
 */
const AVG_ROW = /\bA[vu]g\b[^\n]*/i;

/**
 * Eye marker, from the "Sex:Male OD Age:25" header. This line sits in the
 * smallest print on the page and frequently fails to OCR at all
 * ("Sex Mg |", "eX 1a | 0"); when it does survive, "OD" often comes
 * through as "ob"/"0b". Matched loosely, and treated as optional — see
 * parseBiometryText for the print-order fallback.
 */
const EYE_MARKER = /\b[O0]\s*([DB]|[SE])\b/gi;

function firstMatch(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  return match ? parseDecimal(match[1]) : undefined;
}

function markerSide(text: string): EyeSide | undefined {
  const found = [...text.matchAll(EYE_MARKER)].map((m) =>
    /[DB]/i.test(m[1]) ? ("OD" as const) : ("OS" as const),
  );
  const distinct = [...new Set(found)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

/**
 * Pulls ACD / LENS / VITR / AL out of the averages row when the summary
 * lines are unusable. The row's four numbers are in a fixed column order.
 */
function fromAvgRow(block: string): Partial<BiometryReading> {
  const row = block.match(AVG_ROW)?.[0];
  if (!row) return {};
  const values = [...row.matchAll(/\d+\.\d+/g)].map((m) => Number.parseFloat(m[0]));
  if (values.length < 4) return {};
  const [acd, lensThickness, vitreousDepth, axialLength] = values;
  return {
    acd: inRange(acd, RANGES.acd) ? acd : undefined,
    lensThickness: inRange(lensThickness, RANGES.lensThickness) ? lensThickness : undefined,
    vitreousDepth: inRange(vitreousDepth, RANGES.vitreousDepth) ? vitreousDepth : undefined,
    axialLength: inRange(axialLength, RANGES.axialLength) ? axialLength : undefined,
  };
}

/**
 * Parses an A-scan/biometry printout into per-eye readings. The printout
 * carries one block per eye, each ending in a summary:
 *
 *   AVGAXL= 22.98mm
 *   ACD =2.79mm
 *   LENS =4.71mm
 *   VITR =15.49mm
 *
 * Blocks are anchored on the axial-length line rather than the eye header,
 * because that header is the least legible text on the page. Each reading
 * reports whether its eye came from a marker or was assumed from print
 * order (the device prints OD first, then OS) so the UI can flag the
 * assumption for the clinician to verify.
 */
export function parseBiometryText(rawText: string): BiometryReading[] {
  const text = normalizeOcrNumbers(rawText);
  // Anchor on the label alone, not on "label = number": when OCR destroys
  // the digits the block must still be found so the averages row can
  // supply them. If the label itself is lost, the averages row anchors.
  const anchors: { index: number; length: number }[] = [...text.matchAll(AVGAXL_LABEL)].map((m) => ({
    index: m.index ?? 0,
    length: m[0].length,
  }));
  const readings: BiometryReading[] = [];
  if (anchors.length === 0) {
    const row = text.match(AVG_ROW);
    if (row?.index === undefined) return [];
    anchors.push({ index: row.index, length: row[0].length });
  }

  anchors.forEach((anchor, i) => {
    const anchorIndex = anchor.index;
    const previousEnd = i === 0 ? 0 : anchors[i - 1].index + anchors[i - 1].length;
    const nextStart = anchors[i + 1]?.index ?? text.length;

    // The header (with the eye marker) precedes the summary; the ACD/LENS
    // /VITR lines follow it.
    const header = text.slice(previousEnd, anchorIndex);
    const summary = text.slice(anchorIndex, nextStart);
    const whole = text.slice(previousEnd, nextStart);

    const fallback = fromAvgRow(whole);
    const parsedAl = firstMatch(summary, AVGAXL_VALUE);
    const axialLength = inRange(parsedAl, RANGES.axialLength) ? parsedAl : fallback.axialLength;

    const parsedAcd = firstMatch(summary, ACD_LINE);
    const acd = inRange(parsedAcd, RANGES.acd) ? parsedAcd : fallback.acd;

    if (axialLength === undefined || acd === undefined) return;

    const parsedLens = firstMatch(summary, LENS_LINE);
    const parsedVitr = firstMatch(summary, VITR_LINE);

    readings.push({
      side: markerSide(header) ?? (readings.length === 0 ? "OD" : "OS"),
      sideSource: markerSide(header) ? "marker" : "order",
      axialLength,
      acd,
      lensThickness: inRange(parsedLens, RANGES.lensThickness) ? parsedLens : fallback.lensThickness,
      vitreousDepth: inRange(parsedVitr, RANGES.vitreousDepth)
        ? parsedVitr
        : fallback.vitreousDepth,
    });
  });

  // Two blocks that both fell back to print order are OD then OS.
  if (readings.length === 2 && readings.every((r) => r.sideSource === "order")) {
    readings[0].side = "OD";
    readings[1].side = "OS";
  }

  return readings;
}
