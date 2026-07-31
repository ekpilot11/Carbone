import { parseDecimal } from "./numeric";
import type { EyeSide, KeratometryReading } from "./types";

const NUM = "[\\d]+[.,][\\d]+";
const EYE_BLOCK = new RegExp(`<([RL])>\\s*S[il]m\\s*K'?s([\\s\\S]*?)(?=<[RL]>|$)`, "gi");
const K_PAIR = new RegExp(`(${NUM})\\s*\\(\\s*(${NUM})\\s*\\)`, "g");
const DK_LINE = new RegExp(`dk\\s*(${NUM})`, "i");

/**
 * Parses OCR text from an autokeratometer/topographer strip such as:
 *
 *   <R> Sim K's
 *   45.06( 7.49)
 *   44.16( 7.64)
 *   dk 0.90( 0.15)
 *   <L> Sim K's
 *   44.01( 7.67)
 *   43.04( 7.84)
 *   dk 0.97( 0.17)
 *
 * into per-eye K1/K2 readings. The strip prints the two K values without
 * identifying which is K1 — by the calculator's convention, K1 is always
 * the lower of the two, whatever order they were printed in.
 */
export function parseTopographyText(text: string): KeratometryReading[] {
  const readings: KeratometryReading[] = [];

  for (const blockMatch of text.matchAll(EYE_BLOCK)) {
    const side: EyeSide = blockMatch[1].toUpperCase() === "R" ? "OD" : "OS";
    const blockText = blockMatch[2];

    const pairs = [...blockText.matchAll(K_PAIR)].slice(0, 2);
    if (pairs.length < 2) continue;

    const [first, second] = pairs.map((m) => ({
      k: parseDecimal(m[1]),
      r: parseDecimal(m[2]),
    }));

    const lower = first.k <= second.k ? first : second;
    const higher = first.k <= second.k ? second : first;

    const dkMatch = blockText.match(DK_LINE);
    const cylinder = dkMatch ? parseDecimal(dkMatch[1]) : higher.k - lower.k;

    readings.push({
      side,
      k1: lower.k,
      k2: higher.k,
      r1: lower.r,
      r2: higher.r,
      cylinder,
    });
  }

  return readings;
}
