// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFormDocx } from "./docx";
import type { FormSectionSpec } from "./api";

/**
 * A Word form is read here, in the browser, and never leaves the machine —
 * so unlike the photo path, this one can be tested properly. The document
 * below mirrors the clinic's real template: label and value in one table
 * cell, options printed as "☐ SIM      ☐ NÃO", and the AV/PIO grid as a row
 * per eye.
 *
 * The fixture is built rather than committed, the same choice xlsx.test.ts
 * makes, and its ZIP entries are stored uncompressed — which the reader
 * supports and which keeps this free of a compression library.
 */
function zip(files: { name: string; content: string }[]): File {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);

    local.push(new Uint8Array(header.buffer), name, data);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new File([...local, ...central, new Uint8Array(end.buffer)] as BlobPart[], "ficha.docx");
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (...paragraphs: string[]) => `<w:tc>${paragraphs.join("")}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;

/** The form as Word stores it, with whatever was filled in. */
function ficha(filled: Partial<Record<string, string>> = {}): File {
  const v = (key: string, blank: string) => filled[key] ?? blank;
  const box = (field: string, option: string) =>
    filled[field] === option ? `☒ ${option}` : `☐ ${option}`;

  return zip([
    {
      name: "word/document.xml",
      content:
        `<?xml version="1.0"?><w:document><w:body><w:tbl>` +
        row(
          cell(p("Dados Cadastrais"), p("NOME COMPLETO:"), v("paciente", p("______"))),
          cell(p("PRONTUÁRIO:"), v("prontuario", p("______"))),
          cell(p("DATA DE NASCIMENTO:"), v("dataNascimento", p("____/____/____"))),
          cell(p("IDADE:"), v("idade", p("______ ANOS"))),
          cell(p("CPF:"), v("cpf", p("______"))),
        ) +
        row(
          cell(p("Anamnese"), p("OLHO ACOMETIDO:"), p(
            `${box("olhoAcometido", "OD")}      ${box("olhoAcometido", "OE")}      ${box("olhoAcometido", "AO")}`,
          )),
          cell(p("USO DE ÓCULOS ATUAL:"), p(
            `${box("usoOculos", "NÃO")}      ${box("usoOculos", "SIM")}`,
          )),
          cell(p("CIRURGIA OCULAR PRÉVIA:"), p(
            `${box("cirurgiaOcularPrevia", "NÃO")}      ${box("cirurgiaOcularPrevia", "SIM")}`,
          )),
        ) +
        row(
          cell(p("Comorbidades e Antecedentes"), p("DM2:"), p(
            `${box("dm2", "SIM")}      ${box("dm2", "NÃO")}`,
          )),
          cell(p("TANSULOSINA/ALFABLOQ.:"), p(
            `${box("tansulosina", "SIM")}      ${box("tansulosina", "NÃO")}`,
          )),
        ) +
        row(cell(p("OLHO")), cell(p("SC")), cell(p("CC")), cell(p("PIO"))) +
        row(
          cell(p("OD")),
          cell(v("odSc", p("_______"))),
          cell(v("odCc", p("_______"))),
          cell(`${v("odPio", p("_______"))}${p(" mmHg")}`),
        ) +
        row(
          cell(p("OE")),
          cell(v("oeSc", p("_______"))),
          cell(v("oeCc", p("_______"))),
          cell(`${v("oePio", p("_______"))}${p(" mmHg")}`),
        ) +
        row(
          cell(p("Biomicroscopia"), p("SÍNDROME DA ÍRIS FLÁCIDA (IFIS):"), p(
            `${box("ifis", "AUSENTE")}      ${box("ifis", "SUSPEITA")}      ${box("ifis", "PRESENTE")}`,
          )),
          cell(p("DILATAÇÃO PUPILAR:"), p(
            `${box("dilatacaoPupilar", "BOA")}      ${box("dilatacaoPupilar", "REGULAR")}      ${box("dilatacaoPupilar", "INSUFICIENTE")}`,
          )),
        ) +
        row(
          cell(p("Classificação da Catarata"), p("NUCLEAR:"), p(
            `${box("nuclear", "GRAU I")}      ${box("nuclear", "GRAU II")}      ${box("nuclear", "GRAU III")}      ${box("nuclear", "GRAU IV")}`,
          )),
          cell(p("OUTRAS FORMAS:"), p(
            `${box("outrasFormas", "POLAR")}      ${box("outrasFormas", "TRAUMÁTICA")}      ${box("outrasFormas", "SECUNDÁRIA")}`,
          )),
        ) +
        row(
          cell(p("Fundoscopia"), p("MAPEAMENTO DE RETINA:"), p(
            `${box("mapeamentoRetina", "SEM ALTERAÇÕES")}      ${box("mapeamentoRetina", "OPACIDADE DE MEIOS")}`,
          )),
        ) +
        `</w:tbl></w:body></w:document>`,
    },
  ]);
}

const YES_NO = ["Sim", "Não"];
const SECTIONS = [
  {
    key: "identificacao",
    title: "Dados cadastrais",
    coded: [],
    text: ["paciente", "prontuario", "dataNascimento", "idade", "cpf"].map((key) => ({
      key,
      label: key,
    })),
  },
  {
    key: "anamnese",
    title: "Anamnese",
    text: [],
    coded: [
      { key: "olhoAcometido", label: "", options: ["OD", "OE", "AO"] },
      { key: "usoOculos", label: "", options: YES_NO },
      { key: "cirurgiaOcularPrevia", label: "", options: YES_NO },
    ],
  },
  {
    key: "comorbidades",
    title: "Comorbidades",
    text: [],
    coded: [
      { key: "dm2", label: "", options: YES_NO },
      { key: "tansulosina", label: "", options: YES_NO },
    ],
  },
  {
    key: "avPio",
    title: "AV / PIO",
    text: [],
    coded: [],
    perEye: [
      { key: "sc", label: "SC" },
      { key: "cc", label: "CC" },
      { key: "pio", label: "PIO" },
    ],
  },
  {
    key: "biomicroscopia",
    title: "Biomicroscopia",
    text: [],
    coded: [
      { key: "ifis", label: "", options: ["Ausente", "Suspeita", "Presente"] },
      { key: "dilatacaoPupilar", label: "", options: ["Boa", "Regular", "Insuficiente"] },
    ],
  },
  {
    key: "catarata",
    title: "Catarata",
    text: [],
    coded: [
      { key: "nuclear", label: "", options: ["Grau I", "Grau II", "Grau III", "Grau IV"] },
      { key: "outrasFormas", label: "", options: ["Polar", "Traumática", "Secundária"] },
    ],
  },
  {
    key: "fundoscopia",
    title: "Fundoscopia",
    text: [],
    coded: [
      {
        key: "mapeamentoRetina",
        label: "",
        options: ["Sem alterações", "Opacidade de meios"],
      },
    ],
  },
] as unknown as FormSectionSpec[];

const FILLED = {
  paciente: "<w:p><w:r><w:t>DJALMA SANTOS FERNANDES LEME</w:t></w:r></w:p>",
  prontuario: "<w:p><w:r><w:t>196752</w:t></w:r></w:p>",
  dataNascimento: "<w:p><w:r><w:t>08/12/1954</w:t></w:r></w:p>",
  cpf: "<w:p><w:r><w:t>735.347.498-04</w:t></w:r></w:p>",
  odSc: "<w:p><w:r><w:t>20/80</w:t></w:r></w:p>",
  odPio: "<w:p><w:r><w:t>14</w:t></w:r></w:p>",
  oeSc: "<w:p><w:r><w:t>20/100</w:t></w:r></w:p>",
  oePio: "<w:p><w:r><w:t>14</w:t></w:r></w:p>",
  olhoAcometido: "AO",
  usoOculos: "NÃO",
  cirurgiaOcularPrevia: "NÃO",
  dm2: "SIM",
  tansulosina: "NÃO",
  ifis: "AUSENTE",
  dilatacaoPupilar: "BOA",
  nuclear: "GRAU III",
  mapeamentoRetina: "SEM ALTERAÇÕES",
};

describe("reading a form filled in Word", () => {
  it("reads the typed values exactly — this is text, not a photograph", async () => {
    const { form } = await readFormDocx(ficha(FILLED), SECTIONS);
    expect(form.identificacao).toMatchObject({
      paciente: "DJALMA SANTOS FERNANDES LEME",
      prontuario: "196752",
      dataNascimento: "08/12/1954",
      cpf: "735.347.498-04",
    });
  });

  it("reads a ticked box as the option the app stores", async () => {
    const { form } = await readFormDocx(ficha(FILLED), SECTIONS);
    // The paper prints "SIM" and "NÃO"; the app stores "Sim" and "Não".
    expect(form.comorbidades).toEqual({ dm2: "Sim", tansulosina: "Não" });
    expect(form.anamnese.olhoAcometido).toBe("AO");
    expect(form.biomicroscopia).toEqual({ ifis: "Ausente", dilatacaoPupilar: "Boa" });
    expect(form.catarata.nuclear).toBe("Grau III");
    expect(form.fundoscopia.mapeamentoRetina).toBe("Sem alterações");
  });

  it("reads the acuity grid a row per eye", async () => {
    const { form } = await readFormDocx(ficha(FILLED), SECTIONS);
    expect(form.avPio.od).toEqual({ sc: "20/80", pio: "14" });
    expect(form.avPio.oe).toEqual({ sc: "20/100", pio: "14" });
  });

  /**
   * The distinction the whole review screen is built around. A box this
   * cannot see must never come out looking like a box nobody ticked.
   */
  it("reports what it could not read rather than answering for it", async () => {
    const { form, unread } = await readFormDocx(ficha(FILLED), SECTIONS);
    // Blank on this form, and correctly absent from the answers.
    expect(unread).toContain("identificacao.idade");
    expect(unread).toContain("catarata.outrasFormas");
    expect(unread).toContain("avPio.od.cc");
    expect(form.identificacao.idade).toBeUndefined();
    expect(form.catarata.outrasFormas).toBeUndefined();
  });

  /**
   * A form marked with a stylus has its ticks in a drawing layer, which the
   * text knows nothing about — so it looks exactly like a blank form here.
   * Saying so is what lets the screen suggest a photo or a PDF instead.
   */
  it("says when a document carried no marks at all", async () => {
    const blank = await readFormDocx(ficha(), SECTIONS);
    expect(blank.noMarksFound).toBe(true);
    expect(blank.form.comorbidades ?? {}).toEqual({});
    expect(blank.unread).toContain("comorbidades.dm2");

    const marked = await readFormDocx(ficha(FILLED), SECTIONS);
    expect(marked.noMarksFound).toBe(false);
  });

  /** Two boxes ticked is a question for a person, not a coin toss. */
  it("refuses to choose when two boxes are marked", async () => {
    const file = zip([
      {
        name: "word/document.xml",
        content:
          `<?xml version="1.0"?><w:document><w:body><w:tbl>` +
          row(cell(p("DM2:"), p("☒ SIM      ☒ NÃO"))) +
          `</w:tbl></w:body></w:document>`,
      },
    ]);
    const { form, unread } = await readFormDocx(file, SECTIONS);
    expect(form.comorbidades?.dm2).toBeUndefined();
    expect(unread).toContain("comorbidades.dm2");
  });

  it("refuses a file that isn't a Word document", async () => {
    await expect(
      readFormDocx(zip([{ name: "xl/workbook.xml", content: "<x/>" }]), SECTIONS),
    ).rejects.toThrow(/Word document/);
  });
});
