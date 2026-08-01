import { decimalsIn, inRange, normalizeOcrNumbers, RANGES } from "./ocrText";
import { parseDecimal } from "./numeric";
import type { EyeSide, KeratometryReading } from "./types";

/**
 * Keratometer strip blocks like "<R> Sim K's". Real OCR mangles this
 * badly — observed variants include "<R> Sim K's", "<R> g§ im K'g",
 * "<R> Sim Kk", "R> Slm Ks" — so only the bracketed R/L and a following
 * K-ish token are required.
 */
const EYE_BLOCK = /[<(]\s*([RL])\s*[>)][^\n]*?K[^\n]*\n([\s\S]*?)(?=[<(]\s*[RL]\s*[>)]|$)/gi;

/** Explicitly labeled values: "K1 43.93", "K2: 46.44". */
const K_LABELED = /K\s*([12])\s*[:=]?\s*(\d+\.\d+)/gi;
/** Eye column/section headers; "OE" is Portuguese for the left eye. */
const SIDE_TOKEN = /\b(OD|OE|OS)\b/g;

function toSide(token: string): EyeSide {
  return token.toUpperCase() === "OD" ? "OD" : "OS";
}

function buildReading(side: EyeSide, a: number, b: number): KeratometryReading {
  const k1 = Math.min(a, b);
  const k2 = Math.max(a, b);
  return { side, k1, k2, cylinder: Number((k2 - k1).toFixed(2)) };
}

/**
 * Parses the autokeratometer strip:
 *
 *   <R> Sim K's
 *   45.06( 7.49)
 *   44.16( 7.64)
 *   dk 0.90( 0.15)
 *
 * The parenthesised corneal radii and the "dk" line are frequently
 * corrupted by OCR (stray "¢", missing brackets, split digits), so rather
 * than matching that punctuation this takes every number in the block and
 * keeps only those in keratometry range — radii (~7-9) and dk (<10) fall
 * out automatically. The strip never says which value is K1, so the
 * calculator's convention applies: K1 is the lower of the two.
 */
function parseSimKStrip(text: string): KeratometryReading[] {
  const readings: KeratometryReading[] = [];

  for (const blockMatch of text.matchAll(EYE_BLOCK)) {
    const side: EyeSide = blockMatch[1].toUpperCase() === "R" ? "OD" : "OS";
    const kValues = decimalsIn(blockMatch[2]).filter((n) => inRange(n, RANGES.keratometry));
    if (kValues.length < 2) continue;
    readings.push(buildReading(side, kValues[0], kValues[1]));
  }

  return readings;
}

/**
 * Parses explicitly labeled K values, as written on a chart in OD/OE
 * columns or sections:
 *
 *   OD          OE
 *   K1 43.93    K1 45.07
 *   K2 46.44    K2 45.85
 *
 * Works for both column layouts (two K1s on one line) and stacked
 * sections (OD's block before OE's), because in both cases OD's values
 * precede OE's in reading order; a header line naming both eyes can
 * override that order. A single labeled pair is accepted only when the
 * text names exactly one eye, since a side can't be guessed.
 */
function parseLabeledK(text: string): KeratometryReading[] {
  const k1s: number[] = [];
  const k2s: number[] = [];
  for (const match of text.matchAll(K_LABELED)) {
    const value = parseDecimal(match[2]);
    if (!inRange(value, RANGES.keratometry)) continue;
    (match[1] === "1" ? k1s : k2s).push(value);
  }

  let order: [EyeSide, EyeSide] = ["OD", "OS"];
  for (const line of text.split("\n")) {
    const sides = [...line.matchAll(SIDE_TOKEN)].map((m) => toSide(m[1]));
    const distinct = [...new Set(sides)];
    if (distinct.length >= 2) {
      order = [distinct[0], distinct[1]];
      break;
    }
  }

  if (k1s.length === 2 && k2s.length === 2) {
    return [buildReading(order[0], k1s[0], k2s[0]), buildReading(order[1], k1s[1], k2s[1])];
  }

  if (k1s.length === 1 && k2s.length === 1) {
    const sides = [...text.matchAll(SIDE_TOKEN)].map((m) => toSide(m[1]));
    const distinct = [...new Set(sides)];
    if (distinct.length === 1) {
      return [buildReading(distinct[0], k1s[0], k2s[0])];
    }
  }

  return [];
}

export function parseTopographyText(rawText: string): KeratometryReading[] {
  const text = normalizeOcrNumbers(rawText);
  const fromStrip = parseSimKStrip(text);
  if (fromStrip.length > 0) return fromStrip;
  return parseLabeledK(text);
}
