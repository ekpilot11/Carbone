import Anthropic from "@anthropic-ai/sdk";
import { readableErrors } from "./modelErrors.js";
import { inRange, RANGES } from "./ranges.js";

/**
 * Reads every clinical value the Barrett calculator needs off a single
 * photograph — keratometry and biometry together, both eyes.
 *
 * One photo rather than one per document: the clinic photographs the
 * keratometer strip and the A-scan printout side by side, and a vision
 * model reads a page in context rather than needing each format isolated.
 * A photo carrying only one of the two still works — the missing half
 * simply comes back empty.
 *
 * The tradeoff, and the reason this is opt-in: the photo leaves the
 * clinician's machine — see the privacy sections of the READMEs. The
 * prompt asks for the clinical numbers plus the patient's name (which
 * heads the clinic's own PDF record, and is never sent on to the
 * calculator); every other identifier — ID, CPF, date of birth, address,
 * phone — is explicitly excluded.
 */

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
  keratometry: KeratometryScan[];
  biometry: BiometryScan[];
  /**
   * The patient's name, when it is printed legibly on the page. Requested
   * so the PDF record can be headed automatically; it is never sent to the
   * calculator, and nothing else identifying is read (see PROMPT).
   */
  patientName?: string;
  /** Set when the model read the page but some values failed the plausibility check. */
  warning?: string;
}

const MODEL = process.env.SCAN_MODEL ?? "claude-opus-5";
const MAX_TOKENS = 4096;

const PROMPT = `This photograph shows ophthalmology exam printouts. It may contain a
keratometry/topography strip, an A-scan biometry printout, or both — often
side by side, and possibly alongside unrelated paperwork.

Extract the patient's name and two sets of measurements.

KERATOMETRY (from the "Sim K's" strip, if present):
- "<R>" marks the right eye (report as OD); "<L>" marks the left eye (report
  as OS). A printout may instead label eyes OD/OS or OE directly — OE means
  the left eye (OS).
- The two corneal power values printed directly below an eye's marker are
  that eye's K readings, in dioptres (typically 35-50 D).
- Report the LOWER of the two as k1 and the HIGHER as k2, always. The two
  values are often very close (e.g. 43.22 and 43.23) — read each digit
  carefully rather than assuming they are equal.
- Ignore the corneal radii in parentheses (typically 7-9, in mm), the "dk"
  difference line, and the "Ax" axis column (whole numbers up to 180).

BIOMETRY (from the A-scan printout, if present):
- "AVGAXL" is the axial length, in mm (typically 20-26). The label may be
  printed or read as AVGAXL, AUGAXL, or AVUGAXL — they are the same field.
- "ACD" on its own summary line is the anterior chamber depth, in mm
  (typically 1.5-4). Do not use the "ACD" column header of the measurement
  table above it, and do not use the LENS or VITR lines.
- Each eye has its own block, identified by the header line
  "Sex:<sex> <eye> Age:<age>" — that <eye> is OD or OS. If that header is
  not legible, use print order: the FIRST block is the right eye (OD) and
  the second is the left eye (OS); this device always prints the right eye
  first.

For both sets: include an eye only if you can read its values confidently.
Omit any eye or any section you cannot read — never guess or interpolate a
digit. If the photo contains only one of the two document types, return an
empty array for the other.

PATIENT NAME:
- If a patient name is printed on the page and you can read it clearly,
  report it as patientName, exactly as printed. It heads the clinic's own
  record for this exam.
- If no name is printed, or it is not clearly legible, return null. Never
  guess at a name or complete a partially readable one.
- Report the name only. Do not report the patient's ID or record number,
  CPF, date of birth, address, phone number, or any other identifying
  detail, even if it is visible in the photograph.`;

const SCHEMA = {
  type: "object",
  properties: {
    keratometry: {
      type: "array",
      description: "One entry per eye read from the Sim K's strip; empty if absent.",
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
    biometry: {
      type: "array",
      description: "One entry per eye read from the A-scan printout; empty if absent.",
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
    patientName: {
      type: ["string", "null"],
      description: "The patient's name as printed on the page, or null if absent or unclear.",
    },
  },
  required: ["keratometry", "biometry", "patientName"],
  additionalProperties: false,
} as const;

export function visionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * Accepts a plain, human-length name and nothing else: control characters
 * are stripped, whitespace collapsed, and anything implausibly long is
 * dropped rather than pasted into the record.
 */
function cleanPatientName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" || cleaned.length > 120 ? undefined : cleaned;
}

/** Keeps the first reading per eye and drops anything physiologically impossible. */
function validate(raw: unknown): ScanResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const keratometry: KeratometryScan[] = [];
  const biometry: BiometryScan[] = [];
  const seenK = new Set<string>();
  const seenB = new Set<string>();
  let dropped = 0;

  for (const entry of asArray(source.keratometry)) {
    const side = entry.side === "OD" || entry.side === "OS" ? entry.side : undefined;
    const a = entry.k1;
    const b = entry.k2;
    if (!side || seenK.has(side) || !inRange(a, RANGES.keratometry) || !inRange(b, RANGES.keratometry)) {
      dropped++;
      continue;
    }
    // The K1-is-lower convention is enforced here, not merely requested.
    keratometry.push({ side, k1: Math.min(a, b), k2: Math.max(a, b) });
    seenK.add(side);
  }

  for (const entry of asArray(source.biometry)) {
    const side = entry.side === "OD" || entry.side === "OS" ? entry.side : undefined;
    const axialLength = entry.axialLength;
    const acd = entry.acd;
    if (
      !side ||
      seenB.has(side) ||
      !inRange(axialLength, RANGES.axialLength) ||
      !inRange(acd, RANGES.acd)
    ) {
      dropped++;
      continue;
    }
    biometry.push({ side, axialLength, acd });
    seenB.add(side);
  }

  return {
    keratometry,
    biometry,
    patientName: cleanPatientName(source.patientName),
    warning:
      dropped > 0
        ? `${dropped} reading(s) were discarded for falling outside the physiologic range — enter those values by hand.`
        : undefined,
  };
}

export async function scanImage(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<ScanResponse> {
  const client = new Anthropic();

  // Low effort and streaming, for the same reason as the form scan: reading
  // printed digits is perception, not deliberation, and this model thinks at
  // high effort unless told otherwise. See scanForm.ts for the full note.
  const response = await readableErrors(() =>
    client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Claude Opus 5's safety classifiers can decline a request; a fallback
        // model serves it instead of the call simply failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { format: { type: "json_schema", schema: SCHEMA }, effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      } as Parameters<typeof client.beta.messages.stream>[0])
      .finalMessage(),
  );

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The vision model declined to read this image. Enter the values by hand, or retake the photo showing only the printouts.",
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

  return validate(parsed);
}
