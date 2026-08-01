import { parseDecimal } from "./numeric";
import type { EyeSide, KeratometryReading } from "./types";

const NUM = "[\\d]+[.,][\\d]+";

/**
 * Keratometer strip blocks like "<R> Sim K's". OCR often mangles the
 * angle brackets and letters, so the markers are matched loosely:
 * "<R>", "(R)", "R>" and "Slm"/"S1m" for "Sim" all count.
 */
const EYE_BLOCK =
  /[<(]?\s*([RL])\s*[>)]?\s*S[il1]m\s*K['’`]?s([\s\S]*?)(?=[<(]?\s*[RL]\s*[>)]?\s*S[il1]m\s*K|$)/gi;
const K_PAIR = new RegExp(`(${NUM})\\s*\\(\\s*(${NUM})\\s*\\)`, "g");
const DK_LINE = new RegExp(`dk\\s*(${NUM})`, "i");

/** Explicitly labeled values: "K1 43.93", "K2: 46.44". */
const K_LABELED = new RegExp(`K\\s*([12])\\s*[:=]?\\s*(${NUM})`, "gi");
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
 * Parses OCR text from an autokeratometer/topographer strip such as:
 *
 *   <R> Sim K's
 *   45.06( 7.49)
 *   44.16( 7.64)
 *   dk 0.90( 0.15)
 *
 * The strip prints the two K values without identifying which is K1 — by
 * the calculator's convention, K1 is always the lower of the two.
 */
function parseSimKStrip(text: string): KeratometryReading[] {
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
    const cylinder = dkMatch ? parseDecimal(dkMatch[1]) : Number((higher.k - lower.k).toFixed(2));

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
    (match[1] === "1" ? k1s : k2s).push(parseDecimal(match[2]));
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

export function parseTopographyText(text: string): KeratometryReading[] {
  const fromStrip = parseSimKStrip(text);
  if (fromStrip.length > 0) return fromStrip;
  return parseLabeledK(text);
}
