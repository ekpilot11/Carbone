import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  consultationsFor,
  deletePatient,
  exportAll,
  findByName,
  findByProntuario,
  listPatients,
  matchPatient,
  nameKey,
  openDatabase,
  prontuarioKey,
  saveConsultation,
  saveExam,
} from "./db.js";

/** A real file per test, not :memory: — WAL and migrations only matter on disk. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lens-db-"));
  openDatabase(path.join(dir, "test.db"));
});

afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

const FORM = { dilatacaoPupilar: "insuficiente", dm2: true };

describe("normalising what people write by hand", () => {
  it("treats accents, case and spacing as the same name", () => {
    expect(nameKey("José Maria  da Silva")).toBe("JOSE MARIA DA SILVA");
    expect(nameKey("JOSE MARIA DA SILVA")).toBe(nameKey("josé maria da silva"));
  });

  it("ignores punctuation a transcription might add or drop", () => {
    expect(nameKey("D'ÁVILA, ANA-MARIA")).toBe("D AVILA ANA MARIA");
  });

  it("reads a prontuário through the dots and dashes it gets written with", () => {
    expect(prontuarioKey(" 123.456-7 ")).toBe("1234567");
    expect(prontuarioKey("1234567")).toBe(prontuarioKey("123 456 7"));
  });
});

describe("storing a consultation", () => {
  it("creates the patient and keeps the form", () => {
    const patient = saveConsultation({
      prontuario: "1234567",
      name: "Ana Souza",
      ageYears: 71,
      form: FORM,
    });
    expect(patient.prontuario).toBe("1234567");
    expect(patient.ageYears).toBe(71);
    expect(consultationsFor(patient.id)[0].form).toEqual(FORM);
  });

  /**
   * The prontuário is assigned once, at a patient's first attendance, so a
   * second form bearing it is the same person returning. Creating a second
   * record would split their history in half.
   */
  it("adds a second consultation to the same patient, not a second patient", () => {
    const first = saveConsultation({ prontuario: "1234567", name: "Ana Souza", form: FORM });
    const second = saveConsultation({
      prontuario: "123.456-7",
      name: "Ana Souza",
      form: { dilatacaoPupilar: "boa" },
    });

    expect(second.id).toBe(first.id);
    expect(listPatients()).toHaveLength(1);
    expect(consultationsFor(first.id)).toHaveLength(2);
  });

  it("keeps an age already on file when a later form omits it", () => {
    saveConsultation({ prontuario: "1234567", name: "Ana Souza", ageYears: 71, form: FORM });
    saveConsultation({ prontuario: "1234567", name: "Ana Souza", form: FORM });
    expect(findByProntuario("1234567")?.ageYears).toBe(71);
  });
});

describe("finding the right patient", () => {
  beforeEach(() => {
    saveConsultation({ prontuario: "1111111", name: "JOSE PEREIRA DA SILVA", form: FORM });
    saveConsultation({ prontuario: "2222222", name: "Jose Pereira da Silva", form: FORM });
    saveConsultation({ prontuario: "3333333", name: "Ana Souza", form: FORM });
  });

  /**
   * The case the clinic's own notes record: "mais de 10 prontuários com nome
   * idêntico". The number is what separates them.
   */
  it("separates two patients who share a name", () => {
    const both = findByName("José Pereira da Silva");
    expect(both).toHaveLength(2);
    expect(both.map((p) => p.prontuario).sort()).toEqual(["1111111", "2222222"]);

    const one = matchPatient({ prontuario: "2222222", name: "Jose Pereira da Silva" });
    expect(one.kind).toBe("match");
    expect(one.kind === "match" && one.patient.prontuario).toBe("2222222");
  });

  /**
   * The dangerous case. One misread digit is all it takes to land on a real
   * patient who isn't this one, and merging there would attach this
   * patient's biometry to someone else's consultation. It is reported, never
   * resolved.
   */
  it("refuses a number whose stored name disagrees with the scanned one", () => {
    const result = matchPatient({ prontuario: "3333333", name: "Jose Pereira da Silva" });
    expect(result.kind).toBe("nameMismatch");
    if (result.kind === "nameMismatch") {
      expect(result.patient.name).toBe("Ana Souza");
      expect(result.scannedName).toBe("Jose Pereira da Silva");
    }
  });

  it("falls back to the name when the number couldn't be read", () => {
    const result = matchPatient({ name: "Ana Souza" });
    expect(result.kind).toBe("byNameOnly");
    expect(result.kind === "byNameOnly" && result.candidates).toHaveLength(1);
  });

  it("says nothing matched rather than guessing", () => {
    expect(matchPatient({ prontuario: "9999999", name: "Ninguem" }).kind).toBe("none");
    expect(matchPatient({}).kind).toBe("none");
  });

  it("accepts a match on the number alone when no name was read", () => {
    expect(matchPatient({ prontuario: "1111111" }).kind).toBe("match");
  });
});

describe("the database on disk", () => {
  it("survives being closed and reopened, which is what a restart is", () => {
    const file = path.join(dir, "restart.db");
    openDatabase(file);
    const patient = saveConsultation({ prontuario: "1234567", name: "Ana Souza", form: FORM });
    saveExam({ patientId: patient.id, exam: { od: { k1: 43.23 } } });
    closeDatabase();

    openDatabase(file);
    expect(listPatients()).toHaveLength(1);
    expect(consultationsFor(patient.id)[0].form).toEqual(FORM);
  });

  it("takes a patient's consultations with them when they are deleted", () => {
    const patient = saveConsultation({ prontuario: "1234567", name: "Ana Souza", form: FORM });
    deletePatient(patient.id);
    expect(listPatients()).toHaveLength(0);
    expect(consultationsFor(patient.id)).toHaveLength(0);
  });

  it("exports everything as one document, for the backup that doesn't exist yet", () => {
    const patient = saveConsultation({ prontuario: "1234567", name: "Ana Souza", form: FORM });
    const dump = exportAll() as {
      patients: { prontuario: string; consultations: unknown[] }[];
    };
    expect(dump.patients).toHaveLength(1);
    expect(dump.patients[0].prontuario).toBe("1234567");
    expect(dump.patients[0].consultations).toHaveLength(1);
    expect(patient.id).toBeGreaterThan(0);
  });
});
