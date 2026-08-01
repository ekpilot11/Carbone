import { parseDecimal } from "./numeric";
import type { BiometryReading, EyeSide } from "./types";

const NUM = "[\\d]+[.,][\\d]+";
/** "OE" is Portuguese for the left eye; OCR sometimes reads it on bilingual printouts. */
const SIDE_MARKER = /Sex\s*:\s*\w+\s*(OD|OS|OE)/gi;

function firstMatch(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  return match ? parseDecimal(match[1]) : undefined;
}

/**
 * Parses OCR text from an A-scan/biometry printout such as:
 *
 *   Sex:Male OD Age:25
 *   ...
 *   AVGAXL= 22.98mm
 *   STDDEV =0.03mm
 *   ACD =2.79mm
 *   LENS =4.71mm
 *   VITR =15.49mm
 *
 * into per-eye axial length / ACD / lens thickness / vitreous depth.
 * A printout normally contains one such block per eye. The label regexes
 * tolerate common OCR confusions: V read as U ("AUGAXL"), "=" read as ":",
 * and a cut-off "mm" suffix. The "=" (or ":") is required so the summary
 * lines can't be confused with the measurement table's column headers.
 */
export function parseBiometryText(text: string): BiometryReading[] {
  const markers = [...text.matchAll(SIDE_MARKER)];
  const readings: BiometryReading[] = [];

  markers.forEach((marker, i) => {
    const side: EyeSide = marker[1].toUpperCase() === "OD" ? "OD" : "OS";
    const start = marker.index ?? 0;
    const end = markers[i + 1]?.index ?? text.length;
    const block = text.slice(start, end);

    const axialLength = firstMatch(block, new RegExp(`A[UV]GAXL\\s*[=:]\\s*(${NUM})`, "i"));
    const acd = firstMatch(block, new RegExp(`\\bACD\\s*[=:]\\s*(${NUM})`, "i"));
    const lensThickness = firstMatch(block, new RegExp(`\\bLENS\\s*[=:]\\s*(${NUM})`, "i"));
    const vitreousDepth = firstMatch(block, new RegExp(`\\bVITR\\s*[=:]\\s*(${NUM})`, "i"));

    if (axialLength === undefined || acd === undefined) return;

    readings.push({ side, axialLength, acd, lensThickness, vitreousDepth });
  });

  return readings;
}
