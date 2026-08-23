import { describe, expect, it } from "vitest";
import {
  consultationForRecord,
  consultationIsEmpty,
  formatRecordDate,
} from "./consultation";

/**
 * These guard the one rule that matters when a stored form becomes part of a
 * document a surgeon reads: **only what was ticked appears.** An unanswered
 * box has to produce nothing, because "not recorded" coming out as "normal"
 * is an assertion nobody made.
 */

const FULL = {
  anamnese: { cirurgiaOcularPrevia: "Sim", usoOculos: "Sim" },
  comorbidades: { dm2: "Sim", has: "Não", glaucoma: "Não", tansulosina: "Sim" },
  biomicroscopia: {
    cornea: "Alterada",
    camaraAnterior: "Formada",
    ifis: "Suspeita",
    dilatacaoPupilar: "Insuficiente",
  },
  catarata: { nuclear: "Grau III", subcapsularPosterior: "Presente" },
  fundoscopia: { mapeamentoRetina: "Opacidade de meios" },
};

describe("what the record says the examiner found", () => {
  it("carries the findings that change how the surgery goes", () => {
    const { preOp } = consultationForRecord(FULL, "pt");
    expect(preOp).toContain("DILATAÇÃO PUPILAR INSUFICIENTE");
    expect(preOp).toContain("SUSPEITA DE IFIS");
    expect(preOp).toContain("EM USO DE TANSULOSINA / ALFABLOQUEADOR");
    expect(preOp).toContain("CATARATA NUCLEAR GRAU III");
    expect(preOp).toContain("CATARATA SUBCAPSULAR POSTERIOR");
    expect(preOp).toContain("CIRURGIA OCULAR PRÉVIA");
    expect(preOp).toContain("DM2");
    expect(preOp).toContain("SEGMENTO ANTERIOR: CÓRNEA ALTERADA");
  });

  /**
   * The three the surgeon plans around come first — a list that buries
   * "dilatação insuficiente" under "DM2" is a list nobody reads to the end.
   */
  it("puts dilation, IFIS and tamsulosin at the top", () => {
    const { preOp } = consultationForRecord(FULL, "pt");
    expect(preOp.slice(0, 3)).toEqual([
      "DILATAÇÃO PUPILAR INSUFICIENTE",
      "SUSPEITA DE IFIS",
      "EM USO DE TANSULOSINA / ALFABLOQUEADOR",
    ]);
  });

  it("says nothing about what was answered 'Não'", () => {
    const { preOp } = consultationForRecord(FULL, "pt");
    expect(preOp).not.toContain("HAS");
    expect(preOp).not.toContain("GLAUCOMA");
    // A normal anterior chamber is not a finding.
    expect(preOp.some((line) => line.includes("CÂMARA ANTERIOR"))).toBe(false);
    // Nor is "Ausente" for a form of cataract that wasn't there.
    expect(preOp.some((line) => line.includes("AUSENTE"))).toBe(false);
  });

  it("says nothing at all about a form where nothing was ticked", () => {
    const consultation = consultationForRecord({}, "pt");
    expect(consultation.preOp).toEqual([]);
    expect(consultation.retina).toBeUndefined();
    expect(consultationIsEmpty(consultation)).toBe(true);
  });

  it("works in English too", () => {
    const { preOp } = consultationForRecord(FULL, "en");
    expect(preOp).toContain("INSUFFICIENT PUPIL DILATION");
    expect(preOp).toContain("TAKING TAMSULOSIN / ALPHA-BLOCKER");
    expect(preOp).toContain("NUCLEAR CATARACT GRAU III");
  });
});

describe("the fundoscopy finding", () => {
  /**
   * The reason this whole feature exists. Without the consultation the
   * record prints "MEIOS TRANSPARENTES" for every patient — the exact
   * opposite of what this examiner wrote.
   */
  it("reports media opacity as media opacity", () => {
    const { retina } = consultationForRecord(FULL, "pt");
    expect(retina?.finding).toBe("OPACIDADE DE MEIOS.");
  });

  it("reports an unremarkable mapping as recorded", () => {
    const { retina } = consultationForRecord(
      { fundoscopia: { mapeamentoRetina: "Sem alterações" } },
      "pt",
    );
    expect(retina?.finding).toBe("SEM ALTERAÇÕES.");
  });

  it("carries what was written beside it", () => {
    const { retina } = consultationForRecord(
      { fundoscopia: { mapeamentoRetina: "Sem alterações", outroAchado: "drusas maculares" } },
      "pt",
    );
    expect(retina?.note).toBe("drusas maculares");
  });

  /** Someone bothered to write it, even though the box above stayed blank. */
  it("keeps a written finding when the box itself was left blank", () => {
    const { retina } = consultationForRecord(
      { fundoscopia: { outroAchado: "escavação aumentada OD" } },
      "pt",
    );
    expect(retina?.finding).toBe("escavação aumentada OD");
  });

  /** The failure to avoid: an unticked box becoming a normal fundus. */
  it("reports nothing when the fundoscopy box was never answered", () => {
    expect(consultationForRecord({ comorbidades: { dm2: "Sim" } }, "pt").retina).toBeUndefined();
  });

  it("passes an unrecognised option through rather than dropping it", () => {
    const { retina } = consultationForRecord(
      { fundoscopia: { mapeamentoRetina: "Descolamento" } },
      "pt",
    );
    expect(retina?.finding).toBe("Descolamento");
  });
});

describe("dates in a record", () => {
  it("writes them the way they are read here", () => {
    expect(formatRecordDate("1954-03-12")).toBe("12/03/1954");
    expect(formatRecordDate("ontem")).toBe("ontem");
  });
});
