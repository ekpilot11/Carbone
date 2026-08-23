import { describe, expect, it } from "vitest";
import { consultationForRecord } from "./consultation";
import { emptyRow } from "./eyeRow";
import type { MedicalRecordInput } from "./medicalRecord";
import { recordsToSource, recordToHtml, recordToText } from "./recordText";

const RECORD: MedicalRecordInput = {
  patientName: "Carlos Alberto <Bombonato>",
  recordedAt: new Date("2026-08-01T13:45:00Z"),
  lang: "pt",
  kIndex: "1.3375",
  lens: { name: "Personal Constant", lensFactor: "1.57", aConstant: "118.4" },
  eyes: [
    {
      side: "OD",
      measurements: {
        ...emptyRow("OD"),
        k1: "43.23",
        k2: "43.34",
        axialLength: "23.09",
        acd: "4.20",
        targetRefraction: "0",
      },
      recommended: "23.00",
      rows: [
        { power: "23.50", optic: "Biconvex", refraction: "-0.45" },
        { power: "23.00", optic: "Biconvex", refraction: "-0.10" },
      ],
    },
  ],
};

describe("record as pasteable text", () => {
  it("follows the hospital's own note layout, one value per line", () => {
    const lines = recordToText(RECORD).split("\n");
    expect(lines).toContain("BIOMETRIA:");
    expect(lines).toContain("OD");
    expect(lines).toContain("AXL: 23.09 mm");
    expect(lines).toContain("ACD: 4.20 mm");
    expect(lines).toContain("TOPOGRAFIA:");
    expect(lines).toContain("OD:");
    expect(lines).toContain("K1: 43.23");
    expect(lines).toContain("K2: 43.34");
    expect(lines).toContain("CALCULO DA LENTE:");
    // The failure this replaces: labels bunched together, values after them.
    expect(recordToText(RECORD)).not.toContain("AXL: ACD:");
  });

  it("labels the left eye OE in Portuguese and OS in English", () => {
    const both: MedicalRecordInput = {
      ...RECORD,
      eyes: [RECORD.eyes[0], { ...RECORD.eyes[0], side: "OS" }],
    };
    expect(recordToText(both)).toContain("OE");
    expect(recordToText({ ...both, lang: "en" })).toContain("OS");
  });

  it("names the eye on every recommended power, and nothing else on that line", () => {
    const text = recordToText(RECORD);
    expect(text).toContain("OD - LIO recomendada: 23.00 D");
    expect(text).not.toContain("refração prevista");
  });

  /**
   * The retina block is the practice's standard wording, both eyes, every
   * time — a starting point they edit in the hospital system, which is why
   * the app doesn't ask for it.
   */
  it("opens the retina section with the practice's standard wording", () => {
    const text = recordToText(RECORD);
    expect(text).toContain("MAPEAMENTO RETINA:");
    expect(text).toContain("OD: MEIOS TRANSPARENTES ; RETINA APLICADA 360 ; NERVO CORADO");
    expect(text).toContain("OE: MEIOS TRANSPARENTES ; RETINA APLICADA 360 ; NERVO CORADO");
  });

  it("omits values that were never measured rather than printing blanks", () => {
    const text = recordToText(RECORD);
    expect(text).not.toContain("WTW");
    expect(text).not.toContain("LENS:");
  });

  it("ends at the lens calculation — no trailing provenance block", () => {
    const text = recordToText(RECORD);
    expect(text).not.toContain("Lens Factor");
    expect(text).not.toContain("Índice K");
    expect(text.trimEnd().endsWith("D")).toBe(true);
  });
});

/**
 * The record once the exam has been matched to the consultation the patient
 * had weeks earlier — the whole point of storing the form.
 */
describe("record with a consultation attached", () => {
  const MATCHED: MedicalRecordInput = {
    ...RECORD,
    consultation: {
      seenOn: "2026-07-04",
      retina: { finding: "OPACIDADE DE MEIOS." },
      preOp: ["DILATAÇÃO PUPILAR INSUFICIENTE", "SUSPEITA DE IFIS"],
    },
  };

  /**
   * The correction this feature exists to make. Unmatched, the record states
   * "MEIOS TRANSPARENTES" for every patient — the exact opposite of what
   * this examiner wrote on the paper.
   */
  it("reports the fundus the examiner recorded, not the standard wording", () => {
    const text = recordToText(MATCHED);
    expect(text).toContain("MAPEAMENTO RETINA:");
    expect(text).toContain("OPACIDADE DE MEIOS.");
    expect(text).not.toContain("MEIOS TRANSPARENTES");
    // And not per eye: one recorded finding, not the same line twice.
    expect(text.match(/OPACIDADE DE MEIOS/g)).toHaveLength(1);
  });

  it("puts the pre-operative findings above the measurements", () => {
    const text = recordToText(MATCHED);
    expect(text).toContain("ACHADOS PRÉ-OPERATÓRIOS:");
    expect(text).toContain("DILATAÇÃO PUPILAR INSUFICIENTE");
    expect(text.indexOf("ACHADOS PRÉ-OPERATÓRIOS:")).toBeLessThan(text.indexOf("BIOMETRIA:"));
  });

  it("says which consultation the findings came from", () => {
    expect(recordToText(MATCHED)).toContain("Da consulta de 04/07/2026.");
  });

  it("carries a written finding alongside the ticked one", () => {
    const text = recordToText({
      ...MATCHED,
      consultation: {
        ...MATCHED.consultation!,
        retina: { finding: "SEM ALTERAÇÕES.", note: "drusas maculares" },
      },
    });
    expect(text).toContain("SEM ALTERAÇÕES. drusas maculares");
  });

  /**
   * A consultation where nothing relevant was ticked must leave the record
   * exactly as it was — an empty heading asserts that someone looked and
   * found nothing.
   */
  it("prints no pre-operative block when the form recorded nothing", () => {
    const text = recordToText({ ...RECORD, consultation: { preOp: [] } });
    expect(text).not.toContain("ACHADOS PRÉ-OPERATÓRIOS");
    // ...and the fundus falls back to the template, which is honest here.
    expect(text).toContain("MEIOS TRANSPARENTES");
  });

  /**
   * The regression that matters: every record produced without a stored
   * consultation — which is every record until one is attached — must be
   * byte-for-byte what it was before this feature existed.
   */
  it("leaves an unmatched record untouched", () => {
    expect(recordToText({ ...RECORD, consultation: undefined })).toBe(recordToText(RECORD));
    expect(recordToHtml({ ...RECORD, consultation: undefined })).toBe(recordToHtml(RECORD));
  });

  /**
   * The whole path, from the JSON a consultation is actually stored as to
   * the text a clinician pastes into the hospital system. The form below is
   * exactly what `GET /api/patients/:id` returns for a saved Ficha de
   * Diagnóstico.
   */
  it("carries a stored form through to the pasted record", () => {
    const stored = {
      identificacao: { paciente: "Ana Souza" },
      comorbidades: { dm2: "Sim", has: "Não", tansulosina: "Sim" },
      biomicroscopia: {
        ifis: "Suspeita",
        dilatacaoPupilar: "Insuficiente",
        camaraAnterior: "Formada",
      },
      catarata: { nuclear: "Grau III" },
      fundoscopia: { mapeamentoRetina: "Opacidade de meios" },
    };
    const text = recordToText({
      ...RECORD,
      consultation: consultationForRecord(stored, "pt", "2026-07-04"),
    });

    expect(text).toContain("DILATAÇÃO PUPILAR INSUFICIENTE");
    expect(text).toContain("EM USO DE TANSULOSINA / ALFABLOQUEADOR");
    expect(text).toContain("CATARATA NUCLEAR GRAU III");
    expect(text).toContain("OPACIDADE DE MEIOS.");
    expect(text).toContain("Da consulta de 04/07/2026.");
    // The two that must not appear: a "Não" answer, and a normal finding.
    expect(text).not.toContain("HAS");
    expect(text).not.toContain("CÂMARA ANTERIOR");
    // And the measurements are untouched by any of it.
    expect(text).toContain("AXL: 23.09 mm");
    expect(text).toContain("OD - LIO recomendada: 23.00 D");
  });

  it("renders the block as the editor's own markup", () => {
    const html = recordToHtml(MATCHED);
    expect(html).toContain(
      '<p><strong><span style="font-size:16px;">ACHADOS PRÉ-OPERATÓRIOS:</span></strong></p>',
    );
    expect(html).toContain('<p><span style="font-size:16px;">SUSPEITA DE IFIS</span></p>');
    expect(html).toContain("<p>OPACIDADE DE MEIOS.</p>");
    expect(html).not.toMatch(/class=|<table|<div/);
  });
});

describe("record as source code", () => {
  it("uses the editor's own markup: sized spans, bold headings, blank paragraphs", () => {
    const html = recordToHtml(RECORD);
    expect(html).toContain('<p><strong><span style="font-size:16px;">BIOMETRIA:</span></strong></p>');
    expect(html).toContain('<p><span style="font-size:16px;">AXL: 23.09 mm</span></p>');
    expect(html).toContain("<p>&nbsp;</p>");
    // The power itself is the one thing set larger.
    expect(html).toContain('<span style="font-size:20px;">23.00 D</span>');
    // The retina heading is plain and its eye label bold, as the clinic writes it.
    expect(html).toContain("<p>MAPEAMENTO RETINA:</p>");
    expect(html).toContain("<p><strong>OD:&nbsp;</strong>MEIOS TRANSPARENTES ; RETINA APLICADA 360 ;");
    expect(html).not.toMatch(/class=|<table|<div/);
  });

  it("escapes markup in a patient's name", () => {
    const html = recordToHtml({ ...RECORD, patientName: "Ana <b>Souza</b>" });
    expect(html).not.toContain("<b>Souza</b>");
  });

  it("separates patients when a whole batch is copied", () => {
    const source = recordsToSource([RECORD, RECORD]);
    expect(source.match(/BIOMETRIA:/g)).toHaveLength(2);
  });
});
