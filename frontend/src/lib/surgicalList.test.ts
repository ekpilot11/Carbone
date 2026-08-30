import { describe, expect, it } from "vitest";
import { patientBlock, surgicalList, threePiecePower } from "./surgicalList";
import type { StoredConsultation, StoredExam, StoredPatient } from "./api";

/**
 * Checked against the clinic's own handwritten list — the block for ADEMA
 * BEGA, and the shorter one for JOSE NARCISO MAXIMO that has no APP line
 * because he has no comorbidities recorded.
 */
const patient = (over: Partial<StoredPatient> = {}): StoredPatient => ({
  id: 1,
  name: "ADEMA BEGA",
  ageYears: 77,
  updatedAt: "2026-08-26T10:00:00Z",
  ...over,
});

const consultation = (form: Record<string, unknown>): StoredConsultation => ({
  id: 1,
  form: form as StoredConsultation["form"],
  seenOn: "2026-07-04",
  createdAt: "2026-07-04T10:00:00Z",
});

const exam = (eyes: unknown[]): StoredExam => ({
  id: 1,
  measuredOn: "2026-08-23",
  exam: { eyes } as StoredExam["exam"],
  createdAt: "2026-08-23T10:00:00Z",
});

describe("the three-piece option", () => {
  /**
   * A standing rule of the clinic: always half a dioptre below the
   * calculated power. Every line of their own list agrees — 24→23.5,
   * 18.5→18, 16.5→16, 26→25.5.
   */
  it("is always half a dioptre below the calculated power", () => {
    expect(threePiecePower("24.00")).toBe("23.5");
    expect(threePiecePower("18.50")).toBe("18");
    expect(threePiecePower("16.5")).toBe("16");
    expect(threePiecePower("26")).toBe("25.5");
    expect(threePiecePower("21")).toBe("20.5");
  });

  it("reads a power written with a decimal comma", () => {
    expect(threePiecePower("23,5")).toBe("23");
  });

  /** Arithmetic on a surgical figure only happens on a real number. */
  it("invents nothing when there is no power to work from", () => {
    expect(threePiecePower(undefined)).toBeUndefined();
    expect(threePiecePower("")).toBeUndefined();
    expect(threePiecePower("?")).toBeUndefined();
  });
});

describe("one patient's block", () => {
  it("reads like the clinic's own list", () => {
    const block = patientBlock({
      patient: patient(),
      consultation: consultation({
        anamnese: { olhoAcometido: "OD" },
        comorbidades: { outrasComorbidades: "Sim", outrasComorbidadesDetalhe: "IAM PRÉVIO" },
        catarata: { nuclear: "Grau II" },
        fundoscopia: { outroAchado: "HIALOSE ASTEROIDE OD" },
      }),
      exam: exam([{ side: "OD", measurements: { acd: "2.06" }, recommended: "24.00" }]),
    });

    expect(block).toBe(
      [
        "ADEMA BEGA, 77 ANOS",
        "OLHO DIREITO",
        "LIO 24  23.5 (3 PÇS)  ACD 2.06",
        "APP: IAM PRÉVIO",
        "N2, HIALOSE ASTEROIDE OD",
      ].join("\n"),
    );
  });

  /**
   * The shorter block in their list. A patient with nothing recorded under
   * comorbidities gets no APP line at all, rather than an empty one.
   */
  it("leaves out the lines it has nothing for", () => {
    const block = patientBlock({
      patient: patient({ name: "JOSE NARCISO MAXIMO", ageYears: 76 }),
      consultation: consultation({
        anamnese: { olhoAcometido: "OD" },
        catarata: { nuclear: "Grau II" },
        avPio: { od: { cc: "0,6" }, oe: {} },
      }),
      exam: exam([{ side: "OD", measurements: {}, recommended: "21" }]),
    });

    expect(block).toBe(
      [
        "JOSE NARCISO MAXIMO, 76 ANOS",
        "OLHO DIREITO",
        "LIO 21  20.5 (3 PÇS)",
        "AVCC: 0,6",
        "N2",
      ].join("\n"),
    );
    expect(block).not.toContain("APP:");
    expect(block).not.toContain("ACD");
  });

  it("puts every ticked comorbidity on the APP line, and the written one last", () => {
    const block = patientBlock({
      patient: patient({ name: "EDMILSON CORNIA", ageYears: 63 }),
      consultation: consultation({
        comorbidades: {
          has: "Sim",
          dm2: "Sim",
          glaucoma: "Não",
          outrasComorbidades: "Sim",
          outrasComorbidadesDetalhe: "IAM PRÉVIO",
        },
      }),
    });
    expect(block).toContain("APP: HAS // DM2 // IAM PRÉVIO");
    expect(block).not.toContain("GLAUCOMA");
  });

  /** No exam yet: the block still prints, without a power it does not have. */
  it("prints a patient who has no biometry yet", () => {
    const block = patientBlock({
      patient: patient(),
      consultation: consultation({ anamnese: { olhoAcometido: "AO" } }),
    });
    expect(block).toBe(["ADEMA BEGA, 77 ANOS", "AMBOS OS OLHOS"].join("\n"));
    expect(block).not.toContain("LIO");
  });

  it("names each eye when both are on the same block", () => {
    const block = patientBlock({
      patient: patient(),
      exam: exam([
        { side: "OD", measurements: { acd: "2.06" }, recommended: "24" },
        { side: "OS", measurements: { acd: "2.10" }, recommended: "23" },
      ]),
    });
    expect(block).toContain("OD: LIO 24  23.5 (3 PÇS)  ACD 2.06");
    expect(block).toContain("OS: LIO 23  22.5 (3 PÇS)  ACD 2.10");
  });
});

describe("a day's list", () => {
  it("opens with the date and separates the patients", () => {
    const list = surgicalList("2026-08-26", [
      { patient: patient(), exam: exam([{ side: "OD", measurements: {}, recommended: "24" }]) },
      { patient: patient({ id: 2, name: "EDMILSON CORNIA", ageYears: 63 }) },
    ]);
    expect(list.startsWith("26/08/2026\n\n")).toBe(true);
    expect(list).toContain("ADEMA BEGA, 77 ANOS");
    expect(list).toContain("\n\nEDMILSON CORNIA, 63 ANOS");
  });
});
