/**
 * The *Ficha de Diagnóstico — Catarata*, as data.
 *
 * One list, used three ways: the extraction schema is built from it, the
 * review screen renders from it, and the statistics know which fields can be
 * counted. Adding a field to the paper form means adding it here once.
 *
 * Everything is optional. A blank on the paper and a word nobody can read
 * come back the same way — absent — and the review screen is what turns
 * that into a decision. Guessing would be worse: this is handwriting, and
 * a confidently wrong "Sim" in a comorbidity is not an improvement on a gap.
 *
 * **Retired fields are not deleted.** The clinic replaced its earlier *Ficha
 * de Triagem* with this one, and consultations already stored hold fields the
 * new paper no longer has. Those keys move to {@link RETIRED_FIELDS}: out of
 * the extraction schema and out of a new form's review, but still named and
 * labelled, so a stored record can be displayed in full rather than quietly
 * losing half of itself.
 */

/** A field whose answers are a fixed set, and which statistics can count. */
export interface CodedField {
  key: string;
  /** As printed on the form, so the review screen matches the paper. */
  label: string;
  /**
   * The answers, written as they should be stored and displayed. Matching is
   * case- and accent-insensitive, so "SIM", "sim" and "Sim" all land on the
   * one spelling here — statistics group by these strings, and one stray
   * variant becomes a category of its own that nobody notices.
   */
  options: readonly string[];
  /** Set when ticking one option opens a "qual?" line beside it. */
  detailFor?: string;
}

export interface TextField {
  key: string;
  label: string;
  /** Numbers are kept as written: "20/40", "0,5" and "conta dedos" all occur. */
  kind: "text" | "number";
}

export interface FormSection {
  key: string;
  title: string;
  coded: CodedField[];
  text: TextField[];
  /** Sections the form lays out as a row per eye. */
  perEye?: TextField[];
}

const YES_NO = ["Sim", "Não"] as const;

export const FORM_SECTIONS: FormSection[] = [
  {
    key: "identificacao",
    title: "Dados cadastrais",
    coded: [],
    text: [
      { key: "paciente", label: "Nome completo", kind: "text" },
      // Recorded, but never used to identify anyone: the clinic says the same
      // patient can carry different prontuários on different visits. Identity
      // is the CPF, checked against the name — see db.ts.
      { key: "prontuario", label: "Prontuário", kind: "text" },
      { key: "dataNascimento", label: "Data de nascimento", kind: "text" },
      { key: "idade", label: "Idade (anos)", kind: "number" },
      // The key everything else hangs off. Carries check digits, which is
      // what makes it usable at all when it has been read off handwriting.
      { key: "cpf", label: "CPF", kind: "text" },
    ],
  },
  {
    key: "anamnese",
    title: "Anamnese",
    coded: [
      { key: "olhoAcometido", label: "Olho acometido", options: ["OD", "OE", "AO"] },
      { key: "usoOculos", label: "Uso de óculos atual", options: YES_NO },
      { key: "cirurgiaOcularPrevia", label: "Cirurgia ocular prévia", options: YES_NO },
    ],
    text: [],
  },
  {
    key: "comorbidades",
    title: "Comorbidades e antecedentes",
    coded: [
      { key: "dm2", label: "DM2", options: YES_NO },
      { key: "has", label: "HAS", options: YES_NO },
      { key: "glaucoma", label: "Glaucoma", options: YES_NO },
      // The IFIS risk factor, and the reason it is on the form at all.
      { key: "tansulosina", label: "Tansulosina / alfabloqueador", options: YES_NO },
      // The only free-text line in this section, and the one that carries
      // everything the coded fields have no box for — IAM prévio,
      // hipotireoidismo, tabagismo. The clinic writes it beside the tick,
      // so it is read and printed verbatim, and never counted: a sentence
      // written by hand is not a category.
      { key: "outrasComorbidades", label: "Outras", options: YES_NO, detailFor: "Sim" },
    ],
    text: [],
  },
  {
    key: "avPio",
    title: "Acuidade visual / PIO",
    coded: [],
    text: [],
    perEye: [
      { key: "sc", label: "SC", kind: "text" },
      { key: "cc", label: "CC", kind: "text" },
      { key: "pio", label: "PIO (mmHg)", kind: "number" },
    ],
  },
  {
    key: "biomicroscopia",
    title: "Biomicroscopia",
    coded: [
      { key: "palpebrasCilios", label: "Pálpebras / cílios", options: ["Normal", "Alterado"] },
      { key: "conjuntivaEsclera", label: "Conjuntiva / esclera", options: ["Normal", "Alterado"] },
      { key: "cornea", label: "Córnea", options: ["Transparente", "Alterada"] },
      { key: "camaraAnterior", label: "Câmara anterior", options: ["Formada", "Alterada"] },
      {
        key: "ifis",
        label: "Síndrome da íris flácida (IFIS)",
        options: ["Ausente", "Suspeita", "Presente"],
      },
      {
        key: "dilatacaoPupilar",
        label: "Dilatação pupilar",
        options: ["Boa", "Regular", "Insuficiente"],
      },
    ],
    text: [],
  },
  {
    key: "catarata",
    title: "Classificação da catarata",
    coded: [
      { key: "nuclear", label: "Nuclear", options: ["Grau I", "Grau II", "Grau III", "Grau IV"] },
      { key: "cortical", label: "Cortical", options: ["Leve", "Moderada", "Avançada"] },
      {
        key: "subcapsularPosterior",
        label: "Subcapsular posterior",
        options: ["Presente", "Ausente"],
      },
      {
        key: "outrasFormas",
        label: "Outras formas",
        options: ["Polar", "Traumática", "Secundária"],
      },
    ],
    text: [],
  },
  {
    key: "fundoscopia",
    title: "Fundoscopia",
    coded: [
      {
        key: "mapeamentoRetina",
        label: "Mapeamento de retina",
        options: ["Sem alterações", "Opacidade de meios"],
      },
    ],
    text: [{ key: "outroAchado", label: "Outro achado", kind: "text" }],
  },
];

/**
 * Fields the older *Ficha de Triagem* had and this one does not.
 *
 * Not part of the schema and not shown when reviewing a fresh scan — the
 * paper no longer asks them, so there is nothing to read. They exist so that
 * a consultation stored under the old form can still be displayed with its
 * labels intact, rather than as a row of bare JSON keys or not at all.
 */
export interface RetiredField {
  /** The section it was stored under, whether or not that section survives. */
  section: string;
  key: string;
  label: string;
}

export const RETIRED_FIELDS: RetiredField[] = [
  { section: "identificacao", key: "data", label: "Data (formulário anterior)" },

  { section: "anamnese", key: "queixaPrincipal", label: "Queixa principal" },
  { section: "anamnese", key: "tempoEvolucao", label: "Tempo de evolução" },
  { section: "anamnese", key: "dorFotofobiaHiperemia", label: "Dor / fotofobia / hiperemia" },
  { section: "anamnese", key: "dorFotofobiaHiperemiaDetalhe", label: "Dor / fotofobia — qual" },
  { section: "anamnese", key: "cirurgiaOcularPreviaDetalhe", label: "Cirurgia ocular prévia — qual" },

  { section: "comorbidades", key: "usoColirios", label: "Uso de colírios" },
  { section: "comorbidades", key: "outras", label: "Outras (texto)" },

  { section: "refracao", key: "od", label: "Refração OD" },
  { section: "refracao", key: "oe", label: "Refração OE" },

  { section: "biomicroscopia", key: "palpebrasCiliosDetalhe", label: "Pálpebras / cílios — qual" },
  { section: "biomicroscopia", key: "conjuntivaEscleraDetalhe", label: "Conjuntiva / esclera — qual" },
  { section: "biomicroscopia", key: "corneaDetalhe", label: "Córnea — qual" },
  { section: "biomicroscopia", key: "camaraAnteriorDetalhe", label: "Câmara anterior — qual" },
  { section: "biomicroscopia", key: "cristalino", label: "Cristalino" },
  { section: "biomicroscopia", key: "cristalinoDetalhe", label: "Cristalino — grau / tipo" },
  { section: "biomicroscopia", key: "outrosAchados", label: "Outros achados" },

  { section: "fundoscopia", key: "mapeamentoRetinaDetalhe", label: "Mapeamento de retina — alterações" },

  { section: "hipoteseDiagnostica", key: "texto", label: "Hipótese diagnóstica" },
  { section: "hipoteseDiagnostica", key: "olhoAcometido", label: "Hipótese — olho acometido" },
];

/** The detail line that a ticked option opens, e.g. `cornea` → `corneaDetalhe`. */
export function detailKey(key: string): string {
  return `${key}Detalhe`;
}

/**
 * One spelling for comparing an answer, so that "SIM", "Sim" and "sim" — or
 * "Sem alteracoes" and "Sem alterações" — all reach the same option. What
 * gets *stored* is always the option as written in the list above.
 */
export function optionKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The option this value means, or undefined if it isn't one of them. */
export function canonicalOption(field: CodedField, value: string): string | undefined {
  const wanted = optionKey(value);
  return field.options.find((option) => optionKey(option) === wanted);
}

/** Every coded field, flattened — what the statistics can group by. */
export function codedFields(): { section: string; field: CodedField }[] {
  return FORM_SECTIONS.flatMap((section) =>
    section.coded.map((field) => ({ section: section.key, field })),
  );
}
