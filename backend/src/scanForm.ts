import Anthropic from "@anthropic-ai/sdk";
import { canonicalOption, codedFields, detailKey, FORM_SECTIONS } from "./formFields.js";
import { readableErrors } from "./modelErrors.js";

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
 * - **Absent beats guessed.** Every field is optional, and the model can
 *   decline any of them. A confidently wrong "SIM" against a comorbidity is
 *   worse than a gap, because a gap is visible.
 * - **A blank is not a gap.** The paper being empty here and this app being
 *   unable to read here are different facts, and only the second is worth
 *   flagging. Conflating them put a *not read* tag on most of a normal
 *   form, which is the same as tagging none of it.
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
   * Fields with something written that could not be made out, as
   * `section.field` (or `section.eye.field`) keys — so the review screen can
   * point at the field itself rather than parse a sentence back into one.
   *
   * A field the paper left *blank* is not in here. That is an answer, not a
   * gap, and flagging both put a tag on most of a normal form.
   */
  unread: string[];
  /**
   * Fields where more than one box is ticked.
   *
   * Kept apart from {@link unread} because the remedy is different and the
   * clinician should be told which one they are facing: an unreadable field
   * needs the paper looked at again, whereas two ticks is a contradiction on
   * the form itself that only a person can settle. Both stop the value being
   * stored; only this one is a question about what the examiner meant.
   */
  ambiguous: string[];
}

const MODEL = process.env.SCAN_MODEL ?? "claude-opus-5";
const MAX_TOKENS = 4096;

/**
 * "Nothing here" as a value, not as a type.
 *
 * Every field on this form is optional, and the obvious way to say so is to
 * make each one nullable. The API refuses that twice over. First it will
 * not take a union `type` beside an `enum`:
 *
 *     Invalid schema: Enum value 'OD' does not match declared type
 *     '['string', 'null']'
 *
 * Rewriting those as `anyOf` walked straight into the second refusal:
 *
 *     Schemas contains too many parameters with union types (31 parameters
 *     with type arrays or anyOf) … limit: 16 parameters with unions
 *
 * 31 is every optional field on the paper, counted exactly — nested per-eye
 * fields included. No arrangement of unions fits under 16 while the form
 * has 31 optional fields, so the unions have to go entirely: every field is
 * a plain string, and "nothing here" is a **value**.
 *
 * Two values, in fact, and keeping them apart is the whole point. A single
 * `null` conflated *the paper is blank here* with *I cannot read this*, and
 * the first real form made the cost obvious: most fields on a normal form
 * are blank, so every one of them arrived flagged and the flag stopped
 * meaning anything. {@link BLANK} and {@link UNREADABLE} are those two
 * facts, and only the second is a gap worth a clinician's attention.
 */
const BLANK = "";

/**
 * "There is something here and I cannot make it out" — which is a different
 * fact from "there is nothing here", and the one worth interrupting a
 * clinician for.
 *
 * The review screen has always drawn that distinction: a blank box renders
 * as an empty field, an unreadable one carries a *not read* tag. It could
 * not honour it while the model had only one way to say nothing, so every
 * blank on the paper arrived tagged — and on a real form most fields are
 * blank, which turned the tag into wallpaper and destroyed its meaning.
 *
 * A single question mark, because no answer on this form is ever "?".
 */
const UNREADABLE = "?";

/**
 * "More than one box is ticked on this line."
 *
 * A contradiction on the paper rather than a failure of reading, and the
 * clinician is the only one who can settle it — so it is never resolved by
 * picking the first, the boldest or the most likely. It reaches the review
 * screen as its own question: *two options are marked here, which is right?*
 */
const MULTIPLE = "2+";

function codedField(options: readonly string[], label: string) {
  return {
    type: "string",
    enum: [...options, BLANK, UNREADABLE, MULTIPLE],
    description:
      `${label} — which option is ticked. Empty string if no box is marked. ` +
      `"${MULTIPLE}" if more than one box is marked. ` +
      `"${UNREADABLE}" if a box is marked but you cannot tell which.`,
  };
}

function textField(description: string) {
  return { type: "string", description };
}

/** How the model answered one field, once the kinds of nothing are apart. */
type Answer =
  | { kind: "blank" }
  | { kind: "unreadable" }
  | { kind: "multiple" }
  | { kind: "value"; text: string };

/**
 * Reads one field out of the model's answer.
 *
 * A field the model *left out altogether* counts as unreadable, not blank.
 * The schema requires every one of them, so an absent key means a malformed
 * answer — and the safe reading of "we never heard about this field" is
 * that nobody knows what the paper says there, not that the paper is empty.
 */
function readAnswer(source: Record<string, unknown>, key: string, limit = 400): Answer {
  if (!(key in source)) return { kind: "unreadable" };
  const text = cleanText(source[key], limit);
  if (text === undefined) return { kind: "blank" };
  if (text === UNREADABLE) return { kind: "unreadable" };
  if (text === MULTIPLE) return { kind: "multiple" };
  return { kind: "value", text };
}

function buildSchema() {
  const properties: Record<string, unknown> = {};

  for (const section of FORM_SECTIONS) {
    const fields: Record<string, unknown> = {};

    for (const field of section.text) {
      fields[field.key] = textField(
        `${field.label}. Empty string if the line is blank; "${UNREADABLE}" if something is written there that you cannot read.`,
      );
    }

    for (const field of section.coded) {
      fields[field.key] = codedField(field.options, field.label);
      if (field.detailFor) {
        fields[detailKey(field.key)] = textField(
          `What is written beside "${field.detailFor}" for ${field.label}. Empty string if blank; "${UNREADABLE}" if unreadable.`,
        );
      }
    }

    if (section.perEye) {
      for (const eye of ["od", "oe"] as const) {
        const perEye: Record<string, unknown> = {};
        for (const field of section.perEye) {
          perEye[field.key] = textField(
            `${field.label} for ${eye.toUpperCase()}, as written. Empty string if blank; "${UNREADABLE}" if unreadable.`,
          );
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

TWO KINDS OF NOTHING — KEEP THEM APART
- Return an empty string ("") when the field is genuinely blank: nothing
  written on the line, no box marked. Most fields on a normal form are
  blank, and an empty string is the ordinary, expected answer.
- Return "?" only when there IS something there and you cannot make it out:
  handwriting you cannot decipher, a mark you cannot attribute to one box,
  a number smudged or cut off by the edge of the photo.
- The difference matters. An empty string says "the resident left this
  blank"; "?" says "this app does not know what the paper says here", and a
  person is asked to go and look. Marking a blank field "?" buries the
  fields that genuinely need checking.

MISSING BEATS GUESSED
- Never infer a value from context, from what is typical, or from other
  fields. A field being clinically likely is not evidence that it was
  written.
- Every field on this form is optional. Never invent an answer to fill one.

TICKED OPTIONS
- Options appear as empty checkboxes: "☐ OD   ☐ OE   ☐ AO". A box may be
  ticked, crossed, filled, or circled; the written word may be underlined or
  ringed instead of any box being marked. Any of these count as chosen.
- No box marked on that line: empty string.
- More than one box marked on the same line: "2+". This happens on real
  forms and it is not your job to resolve it — never pick one of them.
- A single mark you cannot attribute to any one box: "?".
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
  correct, complete or invent digits. If a CPF is written but any digit of
  it is unclear, return "?" — never a partial or guessed number. This is
  what a patient is found by later, and a wrong digit attaches their exam
  to somebody else.
- DATA DE NASCIMENTO is printed as ____/____/________; return it as written.
- IDADE is a number of years.
- PRONTUÁRIO is the hospital record number. It may contain dots or dashes;
  return it as written.

CATARACT CLASSIFICATION
- The four lines (nuclear, cortical, subcapsular posterior, outras formas)
  are independent. Only one may be marked, or several, or none. Return an
  empty string for each line that carries no mark — a blank line means that
  form of cataract was not recorded, not that it is absent.

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
 * Sorts the model's answer into three outcomes: a value, a blank, or a
 * question for a person.
 *
 * The kinds of nothing are kept apart here, because they mean different
 * things to whoever checks the form:
 *
 * - **blank** — the resident left it empty. An answer. Stored as nothing,
 *   shown as nothing, never flagged. Flagging blanks put a tag on most of a
 *   normal form and left the real ones invisible in the crowd.
 * - **unreadable** — something is written and this app cannot make it out.
 *   Go and look at the paper.
 * - **more than one box ticked** — the paper contradicts itself, and only
 *   the examiner can say which mark was meant. Never resolved by picking.
 *
 * A coded answer that isn't one of its own options is dropped and flagged
 * too: statistics group by these, and one stray spelling becomes a category
 * of its own that nobody notices.
 *
 * Exported for the tests: this is where those distinctions actually live.
 */
export function validate(parsed: unknown): FormScanResponse {
  const input = (parsed ?? {}) as Record<string, Record<string, unknown>>;
  const form: Record<string, Record<string, unknown>> = {};
  const unread: string[] = [];
  const ambiguous: string[] = [];

  for (const section of FORM_SECTIONS) {
    const from = input[section.key] ?? {};
    const to: Record<string, unknown> = {};

    for (const field of section.text) {
      const answer = readAnswer(from, field.key);
      if (answer.kind === "value") to[field.key] = answer.text;
      else if (answer.kind === "unreadable") unread.push(`${section.key}.${field.key}`);
    }

    for (const field of section.coded) {
      const answer = readAnswer(from, field.key, 40);
      if (answer.kind === "blank") {
        // No box marked. That is what the paper says, and it is not a gap.
      } else if (answer.kind === "multiple") {
        ambiguous.push(`${section.key}.${field.key}`);
      } else if (answer.kind === "unreadable") {
        unread.push(`${section.key}.${field.key}`);
      } else {
        const option = canonicalOption(field, answer.text);
        if (option !== undefined) to[field.key] = option;
        else unread.push(`${section.key}.${field.key}`);
      }
      if (field.detailFor) {
        const detail = readAnswer(from, detailKey(field.key));
        if (detail.kind === "value") to[detailKey(field.key)] = detail.text;
      }
    }

    if (section.perEye) {
      for (const eye of ["od", "oe"] as const) {
        const eyeIn = (from[eye] ?? {}) as Record<string, unknown>;
        const eyeOut: Record<string, unknown> = {};
        for (const field of section.perEye) {
          const answer = readAnswer(eyeIn, field.key, 40);
          if (answer.kind === "value") eyeOut[field.key] = answer.text;
          else if (answer.kind === "unreadable") {
            unread.push(`${section.key}.${eye}.${field.key}`);
          }
        }
        to[eye] = eyeOut;
      }
    }

    form[section.key] = to;
  }

  return { form, unread, ambiguous };
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
  const response = await readableErrors(() =>
    client.beta.messages
      .stream({
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
      } as Parameters<typeof client.beta.messages.stream>[0])
      .finalMessage(),
  );

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
