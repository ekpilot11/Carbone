import Anthropic from "@anthropic-ai/sdk";
import { canonicalOption, codedFields, detailKey, FORM_SECTIONS } from "./formFields.js";

/**
 * Reads the clinic's *Ficha de Diagnóstico — Catarata* off a photograph of
 * the paper form.
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
 * Unlike the biometry scan, this one **reads the patient's identity**: name,
 * CPF, date of birth and prontuário, because a consultation is worthless if
 * it cannot be matched to the exam that follows it weeks later. The CPF is a
 * national identity number, not a local hospital reference — a deliberate
 * and significant change to what this app reads off a page, and one the
 * privacy sections of both READMEs spell out.
 */

export interface FormScanResponse {
  /** Section key → field key → value, exactly as the schema below. */
  form: Record<string, unknown>;
  /**
   * Which fields came back empty, as `section.field` (or `section.eye.field`)
   * keys — so the review screen can point at the field itself rather than
   * parse a sentence back into one.
   */
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

const PROMPT = `This photograph shows a filled-in Brazilian ophthalmology form,
"FICHA DE DIAGNÓSTICO — CATARATA". It is a printed form completed by hand.

Read what is actually written on the paper. Follow these rules exactly:

MISSING BEATS GUESSED
- Return null for anything blank, crossed out, or that you cannot read with
  confidence. Never infer a value from context, from what is typical, or
  from other fields.
- A field being clinically likely is not evidence that it was written.

TICKED OPTIONS
- Options appear as empty checkboxes: "☐ OD   ☐ OE   ☐ AO". A box may be
  ticked, crossed, filled, or circled; the written word may be underlined or
  ringed instead of any box being marked. Any of these count as chosen.
- If two options are marked, or a mark is ambiguous between them, return
  null rather than picking one.
- Return the option exactly as it appears in the schema's list for that
  field, whatever case it is printed in on the paper.

VALUES AS WRITTEN
- Keep visual acuity exactly as written — "20/40", "0,5", "CD", "MM", "PL"
  and "SL" all occur; do not convert between notations.
- Keep decimal commas as written.
- Numbers with units (PIO in mmHg) come back as the number only.

IDENTIFICATION
- NOME COMPLETO is the patient's full name.
- CPF is the Brazilian tax identity number, eleven digits, often written
  "123.456.789-09". Return every digit you can see, as written; do not
  correct, complete or invent digits, and return null rather than guessing
  one that is unclear.
- DATA DE NASCIMENTO is printed as ____/____/________; return it as written.
- IDADE is a number of years.
- PRONTUÁRIO is the hospital record number. It may contain dots or dashes;
  return it as written.

CATARACT CLASSIFICATION
- The four lines (nuclear, cortical, subcapsular posterior, outras formas)
  are independent. Only one may be marked, or several, or none. Return null
  for each line that carries no mark — a blank line means that form of
  cataract was not recorded, not that it is absent.

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
      if (value === undefined) unread.push(`${section.key}.${field.key}`);
      else to[field.key] = value;
    }

    for (const field of section.coded) {
      const raw = cleanText(from[field.key], 40);
      const option = raw === undefined ? undefined : canonicalOption(field, raw);
      if (option !== undefined) to[field.key] = option;
      else unread.push(`${section.key}.${field.key}`);
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
          if (value === undefined) unread.push(`${section.key}.${eye}.${field.key}`);
          else eyeOut[field.key] = value;
        }
        to[eye] = eyeOut;
      }
    }

    form[section.key] = to;
  }

  return { form, unread };
}

/**
 * What the form arrived as.
 *
 * A photograph of the paper is the ordinary case — that is how the clinic
 * fills these in. A PDF happens when the form was filled or annotated on a
 * screen, and it reads better than a photograph of that screen would: the
 * model sees the page itself, typed text and drawn marks alike.
 *
 * Word files never reach here at all. A `.docx` is read in the browser
 * (`frontend/src/lib/docx.ts`), exactly and without leaving the machine.
 */
export type FormMediaType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

function sourceBlock(data: string, mediaType: FormMediaType) {
  return mediaType === "application/pdf"
    ? // The document block goes before the text block, per the API contract.
      { type: "document", source: { type: "base64", media_type: mediaType, data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

export async function scanForm(
  imageBase64: string,
  mediaType: FormMediaType,
): Promise<FormScanResponse> {
  const client = new Anthropic();

  /**
   * Two settings here are about *latency*, not quality, and both were
   * learned the hard way — a real form came back as a Cloudflare 502
   * because the read outlasted the tunnel's patience.
   *
   * - `effort: "low"`. Opus 5 thinks by default, at high effort. Deciding
   *   which checkbox carries an X is perception, not deliberation, and the
   *   schema already constrains every answer to the form's own options.
   *   Thinking stays adaptive rather than disabled: turning it off on this
   *   model has its own failure modes, and low effort is the cheaper fix.
   * - Streaming. The result is identical, but a long read can no longer
   *   trip the SDK's own HTTP timeout on the way.
   */
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: { type: "json_schema", schema: SCHEMA }, effort: "low" },
    messages: [
      {
        role: "user",
        content: [sourceBlock(imageBase64, mediaType), { type: "text", text: PROMPT }],
      },
    ],
  } as Parameters<typeof client.beta.messages.stream>[0]);
  const response = await stream.finalMessage();

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
