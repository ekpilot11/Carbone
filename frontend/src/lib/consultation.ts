import type { StoredPatient } from "./api";
import { STRINGS, type Lang } from "./i18n";

/**
 * A stored consultation, read back as a record should say it.
 *
 * The review screen shows the form as the form: every field, answered or
 * not. A record is a different document — it is read as a list of
 * observations by someone who was not there, so two rules govern everything
 * below:
 *
 * - **Only what was actually ticked appears.** An unanswered box produces
 *   no line at all. "Not recorded" must never come out looking like
 *   "normal", which is the failure that would matter here.
 * - **Only positives appear.** A record listing "DM2: no, HAS: no,
 *   glaucoma: no" buries the one line that changes how the surgery goes,
 *   and it is not how the clinic writes.
 */

export interface RecordConsultation {
  /** The visit this came from, as stored (ISO) — for "from the consultation of…". */
  seenOn?: string;
  /**
   * What the fundoscopy box recorded, and anything written beside it.
   *
   * Absent when the box was left blank, which is what stops the record
   * asserting a normal fundus nobody examined.
   */
  retina?: { finding: string; note?: string };
  /** Findings that change how the surgery goes. Positives only, already worded. */
  preOp: string[];
}

type FormDocument = Record<string, Record<string, unknown> | undefined>;

/** The stored value of one coded field, or undefined if it was never answered. */
function answer(form: FormDocument, section: string, key: string): string | undefined {
  const value = form[section]?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isYes(form: FormDocument, section: string, key: string): boolean {
  return answer(form, section, key) === "Sim";
}

export function consultationForRecord(
  form: unknown,
  lang: Lang,
  seenOn?: string,
): RecordConsultation {
  const t = STRINGS[lang];
  const document = (form ?? {}) as FormDocument;
  const preOp: string[] = [];

  // Dilation and IFIS first: they are the two the surgeon plans around, and
  // the reason tamsulosina is asked about on the paper at all.
  const dilation = answer(document, "biomicroscopia", "dilatacaoPupilar");
  if (dilation === "Insuficiente" || dilation === "Regular") {
    preOp.push(t.recordFlagDilation(dilation));
  }
  const ifis = answer(document, "biomicroscopia", "ifis");
  if (ifis === "Presente" || ifis === "Suspeita") preOp.push(t.recordFlagIfis(ifis));
  if (isYes(document, "comorbidades", "tansulosina")) preOp.push(t.recordFlagTansulosin);

  // Anterior segment, only where something was found to be abnormal.
  for (const [key, abnormal] of [
    ["palpebrasCilios", "Alterado"],
    ["conjuntivaEsclera", "Alterado"],
    ["cornea", "Alterada"],
    ["camaraAnterior", "Alterada"],
  ] as const) {
    if (answer(document, "biomicroscopia", key) === abnormal) {
      const label = ANTERIOR_LABELS[lang][key];
      preOp.push(t.recordFlagAnteriorSegment(label));
    }
  }

  const nuclear = answer(document, "catarata", "nuclear");
  if (nuclear) preOp.push(t.recordFlagCataractNuclear(nuclear));
  const cortical = answer(document, "catarata", "cortical");
  if (cortical) preOp.push(t.recordFlagCataractCortical(cortical));
  if (answer(document, "catarata", "subcapsularPosterior") === "Presente") {
    preOp.push(t.recordFlagCataractSubcapsular);
  }
  const otherCataract = answer(document, "catarata", "outrasFormas");
  if (otherCataract) preOp.push(t.recordFlagCataractOther(otherCataract));

  if (isYes(document, "anamnese", "cirurgiaOcularPrevia")) preOp.push(t.recordFlagPreviousSurgery);
  if (isYes(document, "comorbidades", "dm2")) preOp.push(t.recordFlagDm2);
  if (isYes(document, "comorbidades", "has")) preOp.push(t.recordFlagHas);
  if (isYes(document, "comorbidades", "glaucoma")) preOp.push(t.recordFlagGlaucoma);

  const mapping = answer(document, "fundoscopia", "mapeamentoRetina");
  const note = answer(document, "fundoscopia", "outroAchado");
  // A written finding is worth carrying even when the box above it was left
  // blank — someone bothered to write it.
  const retina =
    mapping !== undefined
      ? { finding: t.recordRetinaFinding[mapping] ?? mapping, note }
      : note !== undefined
        ? { finding: note }
        : undefined;

  return { seenOn, retina, preOp };
}

/**
 * The anterior-segment lines name the structure, not the form's own label —
 * "CÓRNEA" reads in a record where "Córnea: alterada" does not.
 */
const ANTERIOR_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    palpebrasCilios: "EYELIDS / LASHES ALTERED",
    conjuntivaEsclera: "CONJUNCTIVA / SCLERA ALTERED",
    cornea: "CORNEA ALTERED",
    camaraAnterior: "ANTERIOR CHAMBER ALTERED",
  },
  pt: {
    palpebrasCilios: "PÁLPEBRAS / CÍLIOS ALTERADOS",
    conjuntivaEsclera: "CONJUNTIVA / ESCLERA ALTERADAS",
    cornea: "CÓRNEA ALTERADA",
    camaraAnterior: "CÂMARA ANTERIOR ALTERADA",
  },
};

/**
 * A consultation a clinician has confirmed belongs to the exam in hand.
 *
 * Kept here rather than beside the screen that produces it, so that a batch
 * row can hold one without `lib/` importing from `components/`.
 */
export interface AttachedConsultation {
  patient: StoredPatient;
  consultation: RecordConsultation;
}

/** Nothing was recorded that a record would print. */
export function consultationIsEmpty(consultation: RecordConsultation): boolean {
  return consultation.preOp.length === 0 && consultation.retina === undefined;
}

/** "1954-03-12" → "12/03/1954", for a record read by people. */
export function formatRecordDate(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : iso.trim();
}
