/**
 * The Ficha de Triagem, as data.
 *
 * One list, used three ways: the extraction schema is built from it, the
 * review screen renders from it, and the statistics know which fields can be
 * counted. Adding a field to the paper form means adding it here once.
 *
 * Everything is optional. A blank on the paper and a word nobody can read
 * come back the same way — absent — and the review screen is what turns
 * that into a decision. Guessing would be worse: this is handwriting, and
 * a confidently wrong "SIM" in a comorbidity is not an improvement on a gap.
 */

/** A field whose answers are a fixed set, and which statistics can count. */
export interface CodedField {
  key: string;
  /** As printed on the form, so the review screen matches the paper. */
  label: string;
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

const YES_NO = ["sim", "nao"] as const;

export const FORM_SECTIONS: FormSection[] = [
  {
    key: "identificacao",
    title: "Identificação",
    coded: [],
    text: [
      { key: "paciente", label: "Paciente", kind: "text" },
      // The key everything else hangs off — see db.ts.
      { key: "prontuario", label: "Prontuário", kind: "text" },
      { key: "idade", label: "Idade (anos)", kind: "number" },
      { key: "data", label: "Data", kind: "text" },
    ],
  },
  {
    key: "anamnese",
    title: "Anamnese",
    coded: [
      { key: "olhoAcometido", label: "Olho acometido", options: ["OD", "OE", "AO"] },
      {
        key: "dorFotofobiaHiperemia",
        label: "Dor / fotofobia / hiperemia",
        options: YES_NO,
        detailFor: "sim",
      },
      { key: "usoOculos", label: "Uso de óculos atual", options: YES_NO },
      {
        key: "cirurgiaOcularPrevia",
        label: "Cirurgia ocular prévia",
        options: YES_NO,
        detailFor: "sim",
      },
    ],
    text: [
      { key: "queixaPrincipal", label: "Queixa principal", kind: "text" },
      { key: "tempoEvolucao", label: "Tempo de evolução", kind: "text" },
    ],
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
    ],
    text: [
      { key: "usoColirios", label: "Uso de colírios", kind: "text" },
      { key: "outras", label: "Outras", kind: "text" },
    ],
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
    key: "refracao",
    title: "Refração",
    coded: [],
    text: [],
    perEye: [
      { key: "esf", label: "Esf", kind: "text" },
      { key: "cil", label: "Cil", kind: "text" },
      { key: "eixo", label: "Eixo", kind: "number" },
    ],
  },
  {
    key: "biomicroscopia",
    title: "Biomicroscopia (segmento anterior)",
    coded: [
      {
        key: "palpebrasCilios",
        label: "Pálpebras / cílios",
        options: ["normal", "alterado"],
        detailFor: "alterado",
      },
      {
        key: "conjuntivaEsclera",
        label: "Conjuntiva / esclera",
        options: ["normal", "alterado"],
        detailFor: "alterado",
      },
      {
        key: "cornea",
        label: "Córnea",
        options: ["transparente", "alterada"],
        detailFor: "alterada",
      },
      {
        key: "camaraAnterior",
        label: "Câmara anterior",
        options: ["formada", "alterada"],
        detailFor: "alterada",
      },
      {
        key: "ifis",
        label: "Síndrome da íris flácida (IFIS)",
        options: ["ausente", "suspeita", "presente"],
      },
      {
        key: "dilatacaoPupilar",
        label: "Dilatação pupilar",
        options: ["boa", "regular", "insuficiente"],
      },
      {
        key: "cristalino",
        label: "Cristalino",
        options: ["transparente", "catarata"],
        detailFor: "catarata",
      },
    ],
    text: [{ key: "outrosAchados", label: "Outros achados", kind: "text" }],
  },
  {
    key: "fundoscopia",
    title: "Fundoscopia",
    coded: [
      {
        key: "mapeamentoRetina",
        label: "Mapeamento de retina",
        options: ["sem alteracoes", "alteracoes"],
        detailFor: "alteracoes",
      },
    ],
    text: [],
  },
  {
    key: "hipoteseDiagnostica",
    title: "Hipótese diagnóstica",
    coded: [{ key: "olhoAcometido", label: "Olho acometido", options: ["OD", "OE", "AO"] }],
    text: [{ key: "texto", label: "Hipótese", kind: "text" }],
  },
];

/** The detail line that a ticked option opens, e.g. `cornea` → `corneaDetalhe`. */
export function detailKey(key: string): string {
  return `${key}Detalhe`;
}

/** Every coded field, flattened — what the statistics can group by. */
export function codedFields(): { section: string; field: CodedField }[] {
  return FORM_SECTIONS.flatMap((section) =>
    section.coded.map((field) => ({ section: section.key, field })),
  );
}
