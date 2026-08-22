import Anthropic from "@anthropic-ai/sdk";
import { codedFields, detailKey, FORM_SECTIONS } from "./formFields.js";

/**
 * Reads the clinic's *Ficha de Triagem* off a photograph of the paper form.
 *
 * This is the one scan in the app that reads **handwriting**. Everything
 * else here reads printed thermal output, where a misread is unusual; a
 * resident's biro on a photocopied form, with boxes ticked in whatever way
 * came to hand, is a different problem. Two consequences run through this
 * file:
 *
 * - **Absent beats guessed.** Every field is optional. A blank on the paper
 *   and a word nobody can read come back the same way — missing — and the
 *   review screen turns that into a decision a person makes. A confidently
 *   wrong "SIM" against a comorbidity is worse than a gap, because a gap is
 *   visible.
 * - **The prompt is a first guess.** No filled-in form existed when this was
 *   written, so how residents actually tick a box, and whether they write
 *   "20/40" or "0,5" for acuity, is unknown. Expect to correct the notes
 *   below against the first real forms; the field list lives in
 *   formFields.ts so that correcting it is one edit.
 *
 * Unlike the biometry scan, this one **does read the record number** — the
 * prontuário is what a consultation is later matched to an exam by. That is
 * a deliberate change to what this app reads off a page; see the privacy
 * sections of the READMEs.
 */

export interface FormScanResponse {
  /** Section key → field key → value, exactly as the schema below. */
  form: Record<string, unknown>;
  /** Fields the model could not read, so the review screen can point at them. */
  unread: string[];
}

const MODEL = process.env.SCAN_MODEL ?? "claude-opus-5";
const MAX_TOKENS = 4096;

function buildSchema() {
  const properties: Record<string, unknown> = {};

  for (const section of FORM_SECTIONS) {
    const fields: Record<string, unknown> = {};

    for (const field of section.text) {
      fields[field.key] = {
        type: ["string", "null"],
        description: `${field.label}. Null if blank or illegible.`,
      };
    }

    for (const field of section.coded) {
      fields[field.key] = {
        type: ["string", "null"],
        enum: [...field.options, null],
        description: `${field.label} — which option is ticked. Null if none is, or if it can't be told.`,
      };
      if (field.detailFor) {
        fields[detailKey(field.key)] = {
          type: ["string", "null"],
          description: `What is written beside "${field.detailFor}" for ${field.label}. Null if blank.`,
        };
      }
    }

    if (section.perEye) {
      for (const eye of ["od", "oe"] as const) {
        const perEye: Record<string, unknown> = {};
        for (const field of section.perEye) {
          perEye[field.key] = {
            type: ["string", "null"],
            description: `${field.label} for ${eye.toUpperCase()}, as written. Null if blank.`,
          };
        }
        fields[eye] = {
          type: "object",
          properties: perEye,
          required: section.perEye.map((f) => f.key),
          additionalProperties: false,
        };
      }
    }

    const required = [
      ...section.text.map((f) => f.key),
      ...section.coded.flatMap((f) => (f.detailFor ? [f.key, detailKey(f.key)] : [f.key])),
      ...(section.perEye ? ["od", "oe"] : []),
    ];

    properties[section.key] = {
      type: "object",
      properties: fields,
      required,
      additionalProperties: false,
    };
  }

  return {
    type: "object",
    properties,
    required: FORM_SECTIONS.map((s) => s.key),
    additionalProperties: false,
  };
}

const SCHEMA = buildSchema();

const PROMPT = `This photograph shows a filled-in Brazilian ophthalmology triage form,
"FICHA DE TRIAGEM — PRIMEIRA CONSULTA OFTALMOLÓGICA". It is a printed form
completed by hand.

Read what is actually written on the paper. Follow these rules exactly:

MISSING BEATS GUESSED
- Return null for anything blank, crossed out, or that you cannot read with
  confidence. Never infer a value from context, from what is typical, or
  from other fields.
- A field being clinically likely is not evidence that it was written.

TICKED OPTIONS
- Options appear as "( ) OD   ( ) OE   ( ) AO" and similar. A box may be
  ticked, crossed, filled, or circled; the written word may be underlined or
  ringed instead of any box being marked. Any of these count as chosen.
- If two options are marked, or a mark is ambiguous between them, return
  null rather than picking one.
- Where an option opens a line beside it ("SIM: ______", "ALTERADO: ______"),
  return that option and put what is written on the line in the matching
  detail field.

VALUES AS WRITTEN
- Keep visual acuity exactly as written — "20/40", "0,5", "CD", "MM", "PL"
  and "SL" all occur; do not convert between notations.
- Keep refraction signs: "-2,00", "+1,50". Keep decimal commas as written.
- Numbers with units (PIO in mmHg, axis in degrees) come back as the number
  only.

IDENTIFICATION
- PACIENTE is the patient's full name.
- PRONTUÁRIO is the hospital record number, usually in the upper right. It
  may contain dots or dashes; return it as written.
- IDADE is a number of years.
- DATA is the consultation date as written.

Return only what the schema asks for.`;

export function formScanConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Cleans one value: control characters out, whitespace collapsed, absurd
 * lengths dropped. The same treatment the biometry scan gives a name — a
 * page can carry anything, and none of it belongs in a record unexamined.
 */
function cleanText(raw: unknown, limit = 400): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" || cleaned.length > limit ? undefined : cleaned;
}

/**
 * Keeps only values the schema allows, and records what came back empty.
 *
 * A coded field that isn't one of its own options is dropped rather than
 * stored: statistics group by these, and one stray spelling becomes a
 * category of its own that nobody notices.
 */
function validate(parsed: unknown): FormScanResponse {
  const input = (parsed ?? {}) as Record<string, Record<string, unknown>>;
  const form: Record<string, Record<string, unknown>> = {};
  const unread: string[] = [];

  for (const section of FORM_SECTIONS) {
    const from = input[section.key] ?? {};
    const to: Record<string, unknown> = {};

    for (const field of section.text) {
      const value = cleanText(from[field.key]);
      if (value === undefined) unread.push(`${section.title}: ${field.label}`);
      else to[field.key] = value;
    }

    for (const field of section.coded) {
      const value = cleanText(from[field.key], 40)?.toLowerCase();
      if (value !== undefined && (field.options as readonly string[]).includes(value)) {
        to[field.key] = value;
      } else {
        unread.push(`${section.title}: ${field.label}`);
      }
      if (field.detailFor) {
        const detail = cleanText(from[detailKey(field.key)]);
        if (detail !== undefined) to[detailKey(field.key)] = detail;
      }
    }

    if (section.perEye) {
      for (const eye of ["od", "oe"] as const) {
        const eyeIn = (from[eye] ?? {}) as Record<string, unknown>;
        const eyeOut: Record<string, unknown> = {};
        for (const field of section.perEye) {
          const value = cleanText(eyeIn[field.key], 40);
          if (value === undefined) {
            unread.push(`${section.title} ${eye.toUpperCase()}: ${field.label}`);
          } else eyeOut[field.key] = value;
        }
        to[eye] = eyeOut;
      }
    }

    form[section.key] = to;
  }

  return { form, unread };
}

export async function scanForm(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<FormScanResponse> {
  const client = new Anthropic();

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The vision model declined to read this image. Enter the form by hand, or retake the photo showing only the form.",
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

/** Exported for the tests, which check the schema matches the field list. */
export const FORM_SCHEMA = SCHEMA;
export { codedFields };
