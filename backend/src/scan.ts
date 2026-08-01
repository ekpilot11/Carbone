import Anthropic from "@anthropic-ai/sdk";
import { inRange, RANGES } from "./ranges.js";

/**
 * Reads clinical values off a photographed printout using a vision model.
 *
 * The in-browser OCR this replaced could not cope with photographs of
 * thermal-printed strips — it has no notion of what the document is, so a
 * faded "45.06" became "920.06" with equal confidence. A vision model reads
 * the page in context and is far more accurate.
 *
 * The tradeoff, and the reason this is opt-in: the photo leaves the
 * clinician's machine. The prompt asks for clinical numbers only and
 * forbids returning any patient identifier, but the image itself is still
 * transmitted — see the privacy sections of the READMEs.
 */

export type ScanKind = "topography" | "biometry";

export interface KeratometryScan {
  side: "OD" | "OS";
  k1: number;
  k2: number;
}

export interface BiometryScan {
  side: "OD" | "OS";
  axialLength: number;
  acd: number;
}

export interface ScanResponse {
  readings: (KeratometryScan | BiometryScan)[];
  /** Set when the model read the page but some values failed the plausibility check. */
  warning?: string;
}

/** Anthropic's vision limit is 2576px on the long edge; larger images are downscaled server-side anyway. */
const MODEL = process.env.SCAN_MODEL ?? "claude-opus-5";
const MAX_TOKENS = 4096;

const TOPOGRAPHY_PROMPT = `This is a photograph of a keratometer / corneal topography printout.

Read the simulated keratometry (Sim K's) values for each eye.

Rules:
- "<R>" marks the right eye (report as OD); "<L>" marks the left eye (report as OS).
  A printout may also label eyes as OD/OS or OE directly — OE means the left eye (OS).
- The two corneal power values printed directly below an eye's marker are that
  eye's K readings, in dioptres (typically 35-50 D).
- Report the LOWER of the two as k1 and the HIGHER as k2, always.
- Ignore the corneal radii in parentheses (typically 7-9, in mm), the "dk"
  difference line, and any axis column (whole numbers up to 180).
- Include an eye only if you can read both of its K values confidently. Omit
  any eye you cannot read — never guess or interpolate a digit.

Report only these numbers. Do not report the patient's name, ID, date of
birth, or any other identifying information, even if it is visible.`;

const BIOMETRY_PROMPT = `This is a photograph of an ophthalmic A-scan biometry printout.

Read the axial length and anterior chamber depth for each eye.

Rules:
- "AVGAXL" is the axial length, in mm (typically 20-26). The label may be
  printed or read as AVGAXL, AUGAXL, or AVUGAXL — they are the same field.
- "ACD" on its own summary line is the anterior chamber depth, in mm
  (typically 2-4). Do not use the "ACD" column header of the measurement
  table above it.
- Each eye has its own block. The eye is identified in the header line
  "Sex:<sex> <eye> Age:<age>" — that <eye> is OD or OS. If that header is not
  legible, use print order: the FIRST block is the right eye (OD) and the
  second is the left eye (OS); this device always prints the right eye first.
- Include an eye only if you can read both its axial length and its ACD
  confidently. Omit any eye you cannot read — never guess or interpolate a digit.

Report only these numbers. Do not report the patient's name, ID, date of
birth, or any other identifying information, even if it is visible.`;

const TOPOGRAPHY_SCHEMA = {
  type: "object",
  properties: {
    readings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["OD", "OS"] },
          k1: { type: "number", description: "Lower corneal power, dioptres" },
          k2: { type: "number", description: "Higher corneal power, dioptres" },
        },
        required: ["side", "k1", "k2"],
        additionalProperties: false,
      },
    },
  },
  required: ["readings"],
  additionalProperties: false,
} as const;

const BIOMETRY_SCHEMA = {
  type: "object",
  properties: {
    readings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["OD", "OS"] },
          axialLength: { type: "number", description: "Axial length, mm" },
          acd: { type: "number", description: "Anterior chamber depth, mm" },
        },
        required: ["side", "axialLength", "acd"],
        additionalProperties: false,
      },
    },
  },
  required: ["readings"],
  additionalProperties: false,
} as const;

export function visionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Keeps the first reading per eye and drops anything physiologically impossible. */
function validate(kind: ScanKind, raw: unknown): { readings: ScanResponse["readings"]; dropped: number } {
  const items = Array.isArray((raw as { readings?: unknown })?.readings)
    ? ((raw as { readings: unknown[] }).readings)
    : [];
  const readings: ScanResponse["readings"] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const item of items) {
    const entry = item as Record<string, unknown>;
    const side = entry.side === "OD" || entry.side === "OS" ? entry.side : undefined;
    if (!side || seen.has(side)) {
      dropped++;
      continue;
    }

    if (kind === "topography") {
      const a = entry.k1;
      const b = entry.k2;
      if (!inRange(a, RANGES.keratometry) || !inRange(b, RANGES.keratometry)) {
        dropped++;
        continue;
      }
      // The convention is enforced here too, not merely requested in the prompt.
      readings.push({ side, k1: Math.min(a, b), k2: Math.max(a, b) });
    } else {
      const axialLength = entry.axialLength;
      const acd = entry.acd;
      if (!inRange(axialLength, RANGES.axialLength) || !inRange(acd, RANGES.acd)) {
        dropped++;
        continue;
      }
      readings.push({ side, axialLength, acd });
    }
    seen.add(side);
  }

  return { readings, dropped };
}

export async function scanImage(
  kind: ScanKind,
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<ScanResponse> {
  const client = new Anthropic();

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Claude Opus 5's safety classifiers can decline a request; a fallback
    // model serves it instead of the call simply failing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      format: {
        type: "json_schema",
        schema: kind === "topography" ? TOPOGRAPHY_SCHEMA : BIOMETRY_SCHEMA,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: kind === "topography" ? TOPOGRAPHY_PROMPT : BIOMETRY_PROMPT },
        ],
      },
    ],
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The vision model declined to read this image. Enter the values by hand, or retake the photo showing only the printout.",
    );
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("The vision model returned no readable result.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new Error("The vision model's response could not be parsed.");
  }

  const { readings, dropped } = validate(kind, parsed);
  return {
    readings,
    warning:
      dropped > 0
        ? `${dropped} reading(s) were discarded for falling outside the physiologic range — enter those values by hand.`
        : undefined,
  };
}
