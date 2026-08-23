import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ageFromBirth,
  birthKey,
  closeDatabase,
  consultationsFor,
  deletePatient,
  exportAll,
  findByCpf,
  findByName,
  listPatients,
  matchPatient,
  nameKey,
  NameMismatchError,
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

const FORM = { dilatacaoPupilar: "Insuficiente", dm2: "Sim" };

const ANA = "111.444.777-35";
const JOSE = "123.456.789-09";
const CARLOS = "529.982.247-25";

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

  it("reads a date of birth written either way round", () => {
    expect(birthKey("12/03/1954")).toBe("1954-03-12");
    expect(birthKey("1954-03-12")).toBe("1954-03-12");
    expect(birthKey("2/3/1954")).toBe("1954-03-02");
    // Unparseable is kept as written rather than dropped; it matches itself.
    expect(birthKey("março de 1954")).toBe("março de 1954");
  });

  it("works out an age from a date of birth", () => {
    expect(ageFromBirth("12/03/1954", new Date("2026-08-23T12:00:00Z"))).toBe(72);
    // The day before the birthday is still the previous year of life.
    expect(ageFromBirth("12/03/1954", new Date("2026-03-11T12:00:00Z"))).toBe(71);
    expect(ageFromBirth("não sei")).toBeUndefined();
  });
});

describe("storing a consultation", () => {
  it("creates the patient and keeps the form", () => {
    const patient = saveConsultation({
      cpf: ANA,
      name: "Ana Souza",
      dateOfBirth: "12/03/1954",
      ageYears: 71,
      prontuario: "123.456-7",
      form: FORM,
    });
    expect(patient.cpf).toBe("11144477735");
    expect(patient.dateOfBirth).toBe("1954-03-12");
    expect(patient.ageYears).toBe(71);

    const [stored] = consultationsFor(patient.id);
    expect(stored.form).toEqual(FORM);
    // Recorded on the visit, not on the person.
    expect(stored.prontuario).toBe("1234567");
  });

  /**
   * The case the old design got wrong. The clinic says the same patient can
   * be issued a different prontuário on a later visit — so a returning
   * patient's second form looks like a new person unless the CPF is what
   * decides.
   */
  it("adds to the same patient when the CPF matches and the prontuário doesn't", () => {
    const first = saveConsultation({
      cpf: ANA,
      name: "Ana Souza",
      prontuario: "1234567",
      form: FORM,
    });
    const second = saveConsultation({
      cpf: "11144477735",
      name: "Ana Souza",
      prontuario: "9999999",
      form: { dilatacaoPupilar: "Boa" },
    });

    expect(second.id).toBe(first.id);
    expect(listPatients()).toHaveLength(1);

    const visits = consultationsFor(first.id);
    expect(visits).toHaveLength(2);
    expect(visits.map((v) => v.prontuario).sort()).toEqual(["1234567", "9999999"]);
  });

  it("keeps an age already on file when a later form omits it", () => {
    saveConsultation({ cpf: ANA, name: "Ana Souza", ageYears: 71, form: FORM });
    saveConsultation({ cpf: ANA, name: "Ana Souza", form: FORM });
    expect(findByCpf(ANA)?.ageYears).toBe(71);
  });

  it("works the age out from the date of birth when the age box is blank", () => {
    const patient = saveConsultation({
      cpf: ANA,
      name: "Ana Souza",
      dateOfBirth: "12/03/1954",
      form: FORM,
    });
    expect(patient.ageYears).toBe(ageFromBirth("1954-03-12"));
  });

  /**
   * An invalid CPF is the clinic's decision to make, not this app's: the
   * paper is sometimes wrong, and a patient who cannot be recorded is a
   * patient back on paper. It is stored, and said out loud elsewhere.
   */
  it("stores a CPF that fails its check digits", () => {
    const patient = saveConsultation({ cpf: "111.447.477-35", name: "Ana Souza", form: FORM });
    expect(patient.cpf).toBe("11144747735");
  });

  it("stores a patient who has no CPF at all", () => {
    const patient = saveConsultation({
      name: "Ana Souza",
      dateOfBirth: "12/03/1954",
      form: FORM,
    });
    expect(patient.cpf).toBeUndefined();
    expect(patient.dateOfBirth).toBe("1954-03-12");
  });

  it("adds to the same CPF-less patient on the strength of name and birthday", () => {
    const first = saveConsultation({ name: "Ana Souza", dateOfBirth: "12/03/1954", form: FORM });
    const second = saveConsultation({ name: "ANA SOUZA", dateOfBirth: "1954-03-12", form: FORM });
    expect(second.id).toBe(first.id);
    expect(consultationsFor(first.id)).toHaveLength(2);
  });

  /** The CPF arriving later attaches to the patient already on file. */
  it("fills in a CPF for a patient first stored without one", () => {
    const first = saveConsultation({ name: "Ana Souza", dateOfBirth: "12/03/1954", form: FORM });
    const second = saveConsultation({
      cpf: ANA,
      name: "Ana Souza",
      dateOfBirth: "12/03/1954",
      form: FORM,
    });
    expect(second.id).toBe(first.id);
    expect(findByCpf(ANA)?.id).toBe(first.id);
  });

  /**
   * The dangerous case, at the moment it would do damage. One misread digit
   * is all it takes to land on a real patient who isn't this one, and filing
   * the consultation there attaches this patient's biometry to someone
   * else's history.
   */
  it("refuses to file under a CPF stored against a different name", () => {
    saveConsultation({ cpf: ANA, name: "Ana Souza", form: FORM });
    expect(() => saveConsultation({ cpf: ANA, name: "Jose Pereira", form: FORM })).toThrow(
      NameMismatchError,
    );
    expect(consultationsFor(findByCpf(ANA)!.id)).toHaveLength(1);
  });

  it("lets a clinician overrule that once they have seen both names", () => {
    const first = saveConsultation({ cpf: ANA, name: "Ana Souza", form: FORM });
    const second = saveConsultation({
      cpf: ANA,
      name: "Ana Souza Lima",
      form: FORM,
      confirmMerge: true,
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Ana Souza Lima");
  });
});

describe("finding the right patient", () => {
  beforeEach(() => {
    saveConsultation({ cpf: JOSE, name: "JOSE PEREIRA DA SILVA", dateOfBirth: "01/02/1950", form: FORM });
    saveConsultation({ cpf: CARLOS, name: "Jose Pereira da Silva", dateOfBirth: "03/04/1961", form: FORM });
    saveConsultation({ cpf: ANA, name: "Ana Souza", form: FORM });
  });

  /**
   * The case the clinic's own notes record: "mais de 10 prontuários com nome
   * idêntico". The CPF is what separates them.
   */
  it("separates two patients who share a name", () => {
    const both = findByName("José Pereira da Silva");
    expect(both).toHaveLength(2);
    expect(both.map((p) => p.cpf).sort()).toEqual(["12345678909", "52998224725"]);

    const one = matchPatient({ cpf: CARLOS, name: "Jose Pereira da Silva" });
    expect(one.kind).toBe("match");
    expect(one.kind === "match" && one.by).toBe("cpf");
    expect(one.kind === "match" && one.patient.cpf).toBe("52998224725");
  });

  /** Name and date of birth settle it on their own — the clinic's own call. */
  it("matches on name and date of birth when there is no CPF to go on", () => {
    const result = matchPatient({ name: "jose pereira da silva", dateOfBirth: "1961-04-03" });
    expect(result.kind).toBe("match");
    expect(result.kind === "match" && result.by).toBe("nameAndBirth");
    expect(result.kind === "match" && result.patient.cpf).toBe("52998224725");
  });

  it("offers candidates when the name alone is all there is", () => {
    const result = matchPatient({ name: "Jose Pereira da Silva" });
    expect(result.kind).toBe("byNameOnly");
    expect(result.kind === "byNameOnly" && result.candidates).toHaveLength(2);
  });

  /**
   * The dangerous case. Reported, never resolved: the caller has to show
   * both names to a person.
   */
  it("refuses a CPF whose stored name disagrees with the scanned one", () => {
    const result = matchPatient({ cpf: ANA, name: "Jose Pereira da Silva" });
    expect(result.kind).toBe("nameMismatch");
    if (result.kind === "nameMismatch") {
      expect(result.patient.name).toBe("Ana Souza");
      expect(result.scannedName).toBe("Jose Pereira da Silva");
    }
  });

  it("says nothing matched rather than guessing", () => {
    expect(matchPatient({ cpf: "987.654.321-00", name: "Ninguem" }).kind).toBe("none");
    expect(matchPatient({}).kind).toBe("none");
    // The prontuário is not an identity here, whatever is passed alongside.
    expect(matchPatient({ name: "Ninguem", dateOfBirth: "01/01/1900" }).kind).toBe("none");
  });

  it("accepts a match on the CPF alone when no name was read", () => {
    expect(matchPatient({ cpf: JOSE }).kind).toBe("match");
  });

  it("does not pick one of two patients sharing a name and a birthday", () => {
    saveConsultation({
      cpf: "390.533.447-05",
      name: "Maria Lima",
      dateOfBirth: "05/05/1955",
      form: FORM,
    });
    saveConsultation({
      cpf: "168.995.291-14",
      name: "Maria Lima",
      dateOfBirth: "05/05/1955",
      form: FORM,
    });
    const result = matchPatient({ name: "Maria Lima", dateOfBirth: "05/05/1955" });
    expect(result.kind).toBe("byNameOnly");
    expect(result.kind === "byNameOnly" && result.candidates).toHaveLength(2);
  });

  /**
   * Namesakes born on the same day exist, and the number is what tells them
   * apart. A stored patient carrying a different CPF is not this patient,
   * however well the rest lines up.
   */
  it("does not match a namesake whose CPF is a different number", () => {
    saveConsultation({
      cpf: "390.533.447-05",
      name: "Maria Lima",
      dateOfBirth: "05/05/1955",
      form: FORM,
    });
    const other = saveConsultation({
      cpf: "168.995.291-14",
      name: "Maria Lima",
      dateOfBirth: "05/05/1955",
      form: FORM,
    });
    expect(findByName("Maria Lima")).toHaveLength(2);
    expect(other.cpf).toBe("16899529114");

    const result = matchPatient({
      cpf: "168.995.291-14",
      name: "Maria Lima",
      dateOfBirth: "05/05/1955",
    });
    expect(result.kind === "match" && result.patient.id).toBe(other.id);
  });
});

describe("the database on disk", () => {
  it("survives being closed and reopened, which is what a restart is", () => {
    const file = path.join(dir, "restart.db");
    openDatabase(file);
    const patient = saveConsultation({ cpf: ANA, name: "Ana Souza", form: FORM });
    saveExam({ patientId: patient.id, exam: { od: { k1: 43.23 } } });
    closeDatabase();

    openDatabase(file);
    expect(listPatients()).toHaveLength(1);
    expect(consultationsFor(patient.id)[0].form).toEqual(FORM);
  });

  it("takes a patient's consultations with them when they are deleted", () => {
    const patient = saveConsultation({ cpf: ANA, name: "Ana Souza", form: FORM });
    deletePatient(patient.id);
    expect(listPatients()).toHaveLength(0);
    expect(consultationsFor(patient.id)).toHaveLength(0);
  });

  it("exports everything as one document, for the backup that doesn't exist yet", () => {
    saveConsultation({ cpf: ANA, name: "Ana Souza", prontuario: "1234567", form: FORM });
    const dump = exportAll() as {
      patients: { cpf: string; cpfValid: boolean; consultations: { prontuario?: string }[] }[];
    };
    expect(dump.patients).toHaveLength(1);
    expect(dump.patients[0].cpf).toBe("11144477735");
    expect(dump.patients[0].cpfValid).toBe(true);
    expect(dump.patients[0].consultations[0].prontuario).toBe("1234567");
  });
});

/**
 * Migrating a database written by the prontuário-keyed version.
 *
 * The rebuild has to drop `patients`, which has two tables pointing at it
 * with `ON DELETE CASCADE`. With foreign keys armed that would take every
 * consultation and exam with it, silently and with no error to notice. This
 * is the test that would catch it, and it runs on a real file because that
 * is where the cascade would actually happen.
 */
describe("upgrading a database from the prontuário design", () => {
  function writeV1(file: string): void {
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (1);

      CREATE TABLE patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prontuario TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        age_years INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX patients_name_key ON patients(name_key);

      CREATE TABLE consultations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        seen_on TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX consultations_patient ON consultations(patient_id);

      CREATE TABLE exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        measured_on TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX exams_patient ON exams(patient_id);

      INSERT INTO patients VALUES (7, '1234567', 'Ana Souza', 'ANA SOUZA', 71, '2026-01-01', '2026-01-02');
      INSERT INTO consultations (patient_id, seen_on, data, created_at)
        VALUES (7, '2026-01-01', '{"dm2":"Sim"}', '2026-01-01'),
               (7, '2026-02-01', '{"dm2":"Não"}', '2026-02-01');
      INSERT INTO exams (patient_id, measured_on, data, created_at)
        VALUES (7, '2026-02-01', '{"od":{"k1":43.2}}', '2026-02-01');
    `);
    old.close();
  }

  it("keeps every consultation and exam through the table rebuild", () => {
    const file = path.join(dir, "v1.db");
    closeDatabase();
    writeV1(file);
    openDatabase(file);

    const patients = listPatients();
    expect(patients).toHaveLength(1);
    expect(patients[0].id).toBe(7);
    expect(patients[0].name).toBe("Ana Souza");
    expect(patients[0].ageYears).toBe(71);
    expect(patients[0].cpf).toBeUndefined();

    const visits = consultationsFor(7);
    expect(visits).toHaveLength(2);
    // The prontuário came down off the patient onto each visit.
    expect(visits.every((v) => v.prontuario === "1234567")).toBe(true);
  });

  it("leaves the exams attached to the patient they belong to", () => {
    const file = path.join(dir, "v1-exams.db");
    closeDatabase();
    writeV1(file);
    const conn = openDatabase(file);
    const exams = conn.prepare("SELECT * FROM exams WHERE patient_id = 7").all();
    expect(exams).toHaveLength(1);
  });

  it("can then store a returning patient under a CPF", () => {
    const file = path.join(dir, "v1-then.db");
    closeDatabase();
    writeV1(file);
    openDatabase(file);

    const patient = saveConsultation({
      cpf: ANA,
      name: "Ana Souza",
      dateOfBirth: "12/03/1954",
      prontuario: "9999999",
      form: FORM,
    });
    // A migrated patient has no date of birth, so there is nothing for the
    // second key to match on: this is a new identity, and the old rows keep
    // their history rather than being merged into it on the name alone.
    expect(patient.cpf).toBe("11144477735");
    expect(listPatients()).toHaveLength(2);
  });
});
