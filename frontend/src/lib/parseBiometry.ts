import { parseDecimal } from "./numeric";
import type { BiometryReading, EyeSide } from "./types";

const NUM = "[\\d]+[.,][\\d]+";
const SIDE_MARKER = /Sex\s*:\s*\w+\s*(OD|OS)/gi;

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
 * A printout normally contains one such block per eye (OD and OS).
 */
export function parseBiometryText(text: string): BiometryReading[] {
  const markers = [...text.matchAll(SIDE_MARKER)];
  const readings: BiometryReading[] = [];

  markers.forEach((marker, i) => {
    const side = marker[1].toUpperCase() as EyeSide;
    const start = marker.index ?? 0;
    const end = markers[i + 1]?.index ?? text.length;
    const block = text.slice(start, end);

    const axialLength = firstMatch(block, new RegExp(`AVGAXL\\s*=\\s*(${NUM})\\s*mm`, "i"));
    const acd = firstMatch(block, new RegExp(`\\bACD\\s*=\\s*(${NUM})\\s*mm`, "i"));
    const lensThickness = firstMatch(block, new RegExp(`\\bLENS\\s*=\\s*(${NUM})\\s*mm`, "i"));
    const vitreousDepth = firstMatch(block, new RegExp(`\\bVITR\\s*=\\s*(${NUM})\\s*mm`, "i"));

    if (axialLength === undefined || acd === undefined) return;

    readings.push({ side, axialLength, acd, lensThickness, vitreousDepth });
  });

  return readings;
}
