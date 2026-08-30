import type { StoredConsultation, StoredExam, StoredPatient } from "./api";
import { formatRecordDate } from "./consultation";

/**
 * The theatre list: a day, and one short block per patient.
 *
 * Not the same document as the medical record. That one is the long text
 * pasted into the hospital system, one patient at a time. This is what the
 * clinic writes when planning a day's operating — four or five lines each,
 * several patients to a page, read at a glance:
 *
 *     26/08/2026
 *
 *     ADEMA BEGA, 77 ANOS
 *     OLHO DIREITO
 *     LIO 24  23.5 (3 PÇS)   ACD 2.06
 *     APP: IAM PRÉVIO
 *     N1/2+, HIALOSE ASTEROIDE OD
 *
 * Everything here comes from what somebody already confirmed on the review
 * screen. Nothing is inferred at print time, and a line with nothing to say
 * is left out rather than printed empty — which is why one block is four
 * lines and the next is five.
 */

/**
 * The three-piece lens is always half a dioptre below the calculated power.
 *
 * A standing rule of this clinic, not a derivation: every patient gets the
 * option, and it is the official calculator's own recommendation minus
 * 0.5 D. It is arithmetic on a surgical figure, so it happens only when
 * there is a real number to work from — an unreadable or absent power
 * prints neither value rather than an invented one.
 */
export const THREE_PIECE_OFFSET = 0.5;

/** "23.00" → "23", "23.50" → "23.5". The clinic writes neither trailing zeros nor units. */
function trimPower(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function threePiecePower(recommended: string | undefined): string | undefined {
  if (recommended === undefined) return undefined;
  const power = Number.parseFloat(recommended.replace(",", "."));
  if (!Number.isFinite(power)) return undefined;
  return trimPower(power - THREE_PIECE_OFFSET);
}

function primaryPower(recommended: string | undefined): string | undefined {
  if (recommended === undefined) return undefined;
  const power = Number.parseFloat(recommended.replace(",", "."));
  return Number.isFinite(power) ? trimPower(power) : undefined;
}

type FormValues = Record<string, Record<string, unknown>>;

function answer(form: FormValues, section: string, key: string): string | undefined {
  const value = form[section]?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Which eye, spelled out as the clinic writes it on the list. */
const EYE_WORDS: Record<string, string> = {
  OD: "OLHO DIREITO",
  OE: "OLHO ESQUERDO",
  AO: "AMBOS OS OLHOS",
};

/**
 * The comorbidities line.
 *
 * The coded boxes that were ticked *Sim*, then whatever was written beside
 * OUTRAS. The free text goes on verbatim — it is where IAM prévio,
 * hipotireoidismo and tabagismo are recorded, and the clinic's own
 * abbreviations are the point of it.
 */
function personalHistory(form: FormValues): string | undefined {
  const coded: [string, string][] = [
    ["has", "HAS"],
    ["dm2", "DM2"],
    ["glaucoma", "GLAUCOMA"],
    ["tansulosina", "TANSULOSINA"],
  ];
  const parts = coded
    .filter(([key]) => answer(form, "comorbidades", key) === "Sim")
    .map(([, label]) => label);

  const written = answer(form, "comorbidades", "outrasComorbidadesDetalhe");
  if (written) parts.push(written);

  return parts.length > 0 ? `APP: ${parts.join(" // ")}` : undefined;
}

/**
 * The findings line: how the cataract was graded, plus anything written on
 * the OUTRO ACHADO line.
 *
 * The Ficha grades in Roman numerals ("Grau III"); the list is written in
 * the clinic's shorthand ("N3"). Anything the coded fields cannot express —
 * a half grade, a "+" — arrives as free text and is printed as written.
 */
function findings(form: FormValues): string | undefined {
  const parts: string[] = [];
  const grade = (value: string | undefined) =>
    value?.replace(/^Grau\s+/i, "").replace(/IV/i, "4").replace(/III/i, "3")
      .replace(/II/i, "2").replace(/I/i, "1");

  const nuclear = grade(answer(form, "catarata", "nuclear"));
  if (nuclear) parts.push(`N${nuclear}`);
  const cortical = answer(form, "catarata", "cortical");
  if (cortical) parts.push(`C ${cortical.toUpperCase()}`);
  if (answer(form, "catarata", "subcapsularPosterior") === "Presente") parts.push("SCP");
  const other = answer(form, "catarata", "outrasFormas");
  if (other) parts.push(other.toUpperCase());

  const written = answer(form, "fundoscopia", "outroAchado");
  if (written) parts.push(written);

  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** The acuity line, when the form recorded any. */
function acuity(form: FormValues): string | undefined {
  const eye = (side: "od" | "oe") => {
    const values = (form.avPio?.[side] ?? {}) as Record<string, unknown>;
    const cc = typeof values.cc === "string" ? values.cc.trim() : "";
    const sc = typeof values.sc === "string" ? values.sc.trim() : "";
    return { corrected: cc !== "" ? cc : undefined, uncorrected: sc !== "" ? sc : undefined };
  };
  const od = eye("od");
  const oe = eye("oe");
  // With correction is the number that matters when it is there; the list
  // says which of the two it is, as the clinic does.
  const withCorrection = od.corrected ?? oe.corrected;
  if (withCorrection !== undefined) {
    const pair = [od.corrected, oe.corrected].filter(Boolean).join("//");
    return `AVCC: ${pair}`;
  }
  const pair = [od.uncorrected, oe.uncorrected].filter(Boolean).join("/");
  return pair === "" ? undefined : `AV: ${pair}`;
}

export interface SurgicalListEntry {
  patient: StoredPatient;
  consultation?: StoredConsultation;
  exam?: StoredExam;
}

/** One patient's block, as the lines it actually has. */
export function patientBlock(entry: SurgicalListEntry): string {
  const form = (entry.consultation?.form ?? {}) as FormValues;
  const lines: string[] = [];

  const age = entry.patient.ageYears;
  lines.push(age === undefined ? entry.patient.name : `${entry.patient.name}, ${age} ANOS`);

  const side = answer(form, "anamnese", "olhoAcometido");
  if (side && EYE_WORDS[side]) lines.push(EYE_WORDS[side]);

  // The measurements line: the power, its three-piece option, and the ACD.
  const eyes = entry.exam?.exam?.eyes ?? [];
  const measured = eyes
    .map((eye) => {
      const primary = primaryPower(eye.recommended);
      if (primary === undefined) return undefined;
      const threePiece = threePiecePower(eye.recommended);
      const acd = eye.measurements?.acd?.trim();
      const parts = [
        `LIO ${primary}`,
        threePiece === undefined ? undefined : `${threePiece} (3 PÇS)`,
        acd ? `ACD ${acd}` : undefined,
      ].filter(Boolean);
      // Only name the eye when both are on the list; a single eye is
      // already named by the line above.
      return eyes.length > 1 ? `${eye.side}: ${parts.join("  ")}` : parts.join("  ");
    })
    .filter((line): line is string => line !== undefined);
  lines.push(...measured);

  const av = acuity(form);
  if (av) lines.push(av);

  const app = personalHistory(form);
  if (app) lines.push(app);

  const found = findings(form);
  if (found) lines.push(found);

  return lines.join("\n");
}

/**
 * A day's list: the date, then the blocks, blank line between.
 *
 * The order is the order they were picked — the person building the list is
 * deciding the running order as they go.
 */
export function surgicalList(day: string, entries: SurgicalListEntry[]): string {
  const header = formatRecordDate(day);
  return [header, "", entries.map(patientBlock).join("\n\n")].join("\n").trimEnd();
}
