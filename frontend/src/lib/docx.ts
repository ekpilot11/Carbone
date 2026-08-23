import type { FormSectionSpec } from "./api";
import { readCentralDirectory, readEntry } from "./zip.js";

/**
 * Reading a *Ficha de Diagnóstico* that was filled in Word rather than on
 * paper.
 *
 * A `.docx` is a ZIP of XML, so this reads one with the same reader the
 * spreadsheet import uses — and that has a consequence worth stating
 * plainly: **a Word form never leaves the machine.** No photograph, no
 * upload, no vision model. What is typed into the document is read exactly,
 * because it is text, not a picture of text.
 *
 * What it cannot read is a mark drawn by hand. The clinic marks these boxes
 * both ways: some people change `☐` to `☒` or click a checkbox control —
 * which lands in the text and is read perfectly — and some draw an X over
 * the box with a stylus, which lives in a drawing layer the text knows
 * nothing about. Those fields come back in `unread`, which the review
 * screen already shows as *not read* rather than as an answer. That
 * distinction is the whole point: a box this cannot see must never look
 * like a box nobody ticked.
 */

export interface DocxFormResult {
  form: Record<string, Record<string, unknown>>;
  unread: string[];
  /** True when the document carried no marks at all — see readFormDocx. */
  noMarksFound: boolean;
}

/** Paragraph and cell boundaries, as the XML expresses them. */
const PARAGRAPH_END = /<\/w:p>/g;
const CELL_END = /<\/w:tc>/g;
const ROW_END = /<\/w:tr>/g;

const PARA = "\u0001";
const CELL = "\u0002";
const ROW = "\u0003";

function textOf(xml: string): string {
  return xml
    .replace(PARAGRAPH_END, PARA)
    .replace(CELL_END, CELL)
    .replace(ROW_END, ROW)
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Uppercase, accents stripped, punctuation and spacing normalised. */
function key(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * A box that has been marked, however the person marked it.
 *
 * `☐` is the empty box the template prints. Everything here is a way of
 * saying "this one" — the checked glyph a Word checkbox control produces,
 * the ones people type by hand, and a bare X or ✓ written in front of the
 * option.
 */
const MARKED = /[☒☑⊠✅✔✓]|\[\s*[xX]\s*\]|\(\s*[xX]\s*\)/;
const EMPTY_BOX = /[☐□◻]/;
/** Any box, marked or not — what the option list is split on. */
const BOX = /[☒☑⊠☐□◻]|\[\s*[xX ]?\s*\]|\(\s*[xX ]?\s*\)/;

/**
 * The label the Word template prints for each field.
 *
 * Not derived from `formFields.ts` labels, because they are two different
 * things: that file names the field for a clinician reading a screen
 * ("Idade (anos)"), and this names it as the paper prints it ("IDADE:").
 * Longest match wins, so "OUTRAS FORMAS" is never mistaken for "OUTRAS".
 */
const LABELS: { printed: string; section: string; field: string }[] = [
  { printed: "NOME COMPLETO", section: "identificacao", field: "paciente" },
  { printed: "PRONTUARIO", section: "identificacao", field: "prontuario" },
  { printed: "DATA DE NASCIMENTO", section: "identificacao", field: "dataNascimento" },
  { printed: "IDADE", section: "identificacao", field: "idade" },
  { printed: "CPF", section: "identificacao", field: "cpf" },

  { printed: "OLHO ACOMETIDO", section: "anamnese", field: "olhoAcometido" },
  { printed: "USO DE OCULOS ATUAL", section: "anamnese", field: "usoOculos" },
  { printed: "CIRURGIA OCULAR PREVIA", section: "anamnese", field: "cirurgiaOcularPrevia" },

  { printed: "DM2", section: "comorbidades", field: "dm2" },
  { printed: "HAS", section: "comorbidades", field: "has" },
  { printed: "GLAUCOMA", section: "comorbidades", field: "glaucoma" },
  { printed: "TANSULOSINA ALFABLOQ", section: "comorbidades", field: "tansulosina" },
  { printed: "OUTRAS FORMAS", section: "catarata", field: "outrasFormas" },
  { printed: "OUTRAS", section: "comorbidades", field: "outrasComorbidades" },

  { printed: "PALPEBRAS CILIOS", section: "biomicroscopia", field: "palpebrasCilios" },
  { printed: "CONJUNTIVA ESCLERA", section: "biomicroscopia", field: "conjuntivaEsclera" },
  { printed: "CORNEA", section: "biomicroscopia", field: "cornea" },
  { printed: "CAMARA ANTERIOR", section: "biomicroscopia", field: "camaraAnterior" },
  { printed: "SINDROME DA IRIS FLACIDA IFIS", section: "biomicroscopia", field: "ifis" },
  { printed: "DILATACAO PUPILAR", section: "biomicroscopia", field: "dilatacaoPupilar" },

  { printed: "NUCLEAR", section: "catarata", field: "nuclear" },
  { printed: "CORTICAL", section: "catarata", field: "cortical" },
  { printed: "SUBCAPSULAR POSTERIOR", section: "catarata", field: "subcapsularPosterior" },

  { printed: "MAPEAMENTO DE RETINA", section: "fundoscopia", field: "mapeamentoRetina" },
  { printed: "OUTRO ACHADO", section: "fundoscopia", field: "outroAchado" },
].sort((a, b) => b.printed.length - a.printed.length);

/** The label this paragraph announces, if it announces one. */
function labelIn(paragraph: string): (typeof LABELS)[number] | undefined {
  const colon = paragraph.indexOf(":");
  if (colon < 0) return undefined;
  // A cell may open with a section heading before the label, so the label is
  // matched against the tail of what precedes the colon.
  const before = key(paragraph.slice(0, colon));
  return LABELS.find((entry) => before === entry.printed || before.endsWith(` ${entry.printed}`));
}

/** Strips the blank rule the template prints, and the printed unit after it. */
function cleanTyped(value: string): string {
  return value
    .replace(/_+/g, " ")
    .replace(/\b(ANOS|MMHG|mmHg)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Which option was marked, if exactly one was.
 *
 * Two marks, or a mark that can't be tied to one option, returns nothing —
 * the same rule the vision model is given, for the same reason: a guess
 * between two ticked boxes is worse than an admitted gap.
 */
function markedOption(text: string, options: readonly string[]): string | undefined {
  // The options are printed as "☐ SIM      ☐ NÃO", so splitting before each
  // box gives one segment per option, each opening with its own box.
  const segments = text.split(new RegExp(`(?=${BOX.source})`));
  const chosen = new Set<string>();

  for (const segment of segments) {
    if (!MARKED.test(segment.slice(0, 3))) continue;
    const words = key(segment.replace(MARKED, " ").replace(EMPTY_BOX, " "));
    for (const option of options) {
      const wanted = key(option);
      if (words === wanted || words.startsWith(`${wanted} `)) chosen.add(option);
    }
  }

  // Two boxes marked is a question for a person, not a coin toss.
  return chosen.size === 1 ? [...chosen][0] : undefined;
}

/** The AV/PIO grid: a row per eye, read by its own first cell. */
function readEyeTable(rows: string[]): Record<string, Record<string, string>> {
  const eyes: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    const cells = row.split(CELL).map((cell) => cell.split(PARA).join(" ").trim());
    const side = key(cells[0] ?? "");
    const eye = side === "OD" ? "od" : side === "OE" || side === "OS" ? "oe" : undefined;
    if (!eye) continue;
    const values: Record<string, string> = {};
    const [, sc, cc, pio] = cells;
    for (const [field, raw] of [
      ["sc", sc],
      ["cc", cc],
      ["pio", pio],
    ] as const) {
      const value = cleanTyped(raw ?? "");
      if (value !== "") values[field] = value;
    }
    eyes[eye] = values;
  }
  return eyes;
}

/**
 * Reads a filled form out of a Word file.
 *
 * `sections` comes from the server's own field list, so the options this
 * matches against are the same strings the vision model is offered and the
 * statistics group by — there is one spelling of "Sim" in this app, and it
 * is not written here.
 */
export async function readFormDocx(
  file: File,
  sections: FormSectionSpec[],
): Promise<DocxFormResult> {
  const data = new DataView(await file.arrayBuffer());
  const entries = readCentralDirectory(data);
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (!document) throw new Error("That file isn't a Word document.");

  const raw = textOf(await readEntry(data, document));
  const rows = raw.split(ROW);

  // Cell by cell, and only then paragraph by paragraph. A field owns the rest
  // of the box it is printed in and nothing beyond it — otherwise a value
  // runs on into whatever the template prints next, and the CPF comes back
  // as "735.347.498-04 Anamnese".
  const cells = raw
    .split(new RegExp(`[${CELL}${ROW}]`))
    .map((cell) =>
      cell
        .split(PARA)
        .map((part) => part.trim())
        .filter((part) => part !== ""),
    )
    .filter((cell) => cell.length > 0);

  const byKey = new Map<string, FormSectionSpec["coded"][number]>(
    sections.flatMap((section) => [
      ...section.coded.map((field) => [`${section.key}.${field.key}`, field] as const),
      ...section.text.map((field) => [`${section.key}.${field.key}`, field] as const),
    ]),
  );

  const form: Record<string, Record<string, unknown>> = {};
  const unread: string[] = [];
  const seen = new Set<string>();
  let marksFound = 0;

  for (const paragraphs of cells) {
    for (let i = 0; i < paragraphs.length; i++) {
      const entry = labelIn(paragraphs[i]);
      if (!entry) continue;
      const path = `${entry.section}.${entry.field}`;
      if (seen.has(path)) continue;
      seen.add(path);

      // The value is the rest of the label's own paragraph, plus the
      // paragraphs under it — an option list often wraps onto its own line —
      // stopping at the next label or the end of the cell.
      let body = paragraphs[i].slice(paragraphs[i].indexOf(":") + 1);
      for (let j = i + 1; j < paragraphs.length && !labelIn(paragraphs[j]); j++) {
        body += ` ${paragraphs[j]}`;
      }

      const spec = byKey.get(path);
      if (!spec) continue;

      const target = (form[entry.section] ??= {});
      if (spec.options && spec.options.length > 0) {
        const chosen = markedOption(body, spec.options);
        if (chosen) {
          target[entry.field] = chosen;
          marksFound++;
        } else {
          unread.push(path);
        }
      } else {
        const typed = cleanTyped(body);
        if (typed === "") unread.push(path);
        else target[entry.field] = typed;
      }
    }
  }

  // Anything the template does not print a label for, or that this walk
  // never reached, is still a field the review screen must show as unread
  // rather than silently blank.
  for (const [path] of byKey) {
    if (!seen.has(path)) unread.push(path);
  }

  const eyes = readEyeTable(rows);
  for (const section of sections) {
    if (!section.perEye) continue;
    const target = (form[section.key] ??= {});
    for (const eye of ["od", "oe"] as const) {
      const values = eyes[eye] ?? {};
      target[eye] = values;
      for (const field of section.perEye) {
        if (values[field.key] === undefined) unread.push(`${section.key}.${eye}.${field.key}`);
      }
    }
  }

  return { form, unread, noMarksFound: marksFound === 0 };
}

/** Whether this is a file `readFormDocx` should be handed. */
export function isWordFile(file: File): boolean {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(file.name)
  );
}
