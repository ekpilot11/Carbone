import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { cpfDigits, isValidCpf } from "./cpf.js";

/**
 * The patient database.
 *
 * Everything else in this app is deliberately stateless — photos are read
 * and discarded, handoffs live in memory for a day, nothing reaches disk.
 * This is the exception, and it exists for one reason: the clinic's workflow
 * spans two visits. The consultation happens on one day and the biometry on
 * another, and until now the two halves never met.
 *
 * One SQLite file, so that a backup is a file copy and a restore is copying
 * it back. `node:sqlite` is built into Node, so this adds no dependency —
 * the same trade the PDF writer and the spreadsheet reader make.
 *
 * **No photographs are stored**, only the values read from them.
 *
 * ## Who a patient is
 *
 * The **CPF**, checked against the name. Not the prontuário: the clinic says
 * the same patient can be given a different prontuário on a later visit, so
 * it identifies a *visit*, not a person — it is stored on the consultation
 * and never matched on.
 *
 * When there is no CPF, or it could not be read, **name together with date
 * of birth** identifies the patient. That is the clinic's own judgement and
 * it is treated as a full second key, not a degraded one. A name on its own
 * is not a key — it returns candidates for a person to choose between.
 */

/** Where the file lives. The container sets this to its own volume. */
const DB_PATH = process.env.LENS_DB ?? path.resolve("data/lens.db");

let db: DatabaseSync | null = null;
let dbPath: string | null = null;

/**
 * Normalises a name for matching: uppercase, accents stripped, punctuation
 * dropped, runs of whitespace collapsed.
 *
 * "José Maria  da Silva" and "JOSE MARIA DA SILVA" are the same person
 * written twice, and a clinic list contains both. On its own this only ever
 * *finds* candidates, or notices that a CPF's stored name disagrees with a
 * scanned one; paired with a date of birth it decides a match.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One spelling for a date of birth, so that "12/03/1954" and "1954-03-12"
 * are the same day.
 *
 * The form prints it as ____/____/________, so day-first is what gets
 * written; ISO is what a date input sends. Anything else is kept as typed
 * and compared as typed — a date nobody can parse is still better stored
 * than dropped, and it will simply only match itself.
 */
export function birthKey(value: string): string {
  const trimmed = value.trim();
  const dmy = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(trimmed);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return trimmed;
}

/**
 * Prontuários are written by hand and read from a photo, so they arrive with
 * stray spaces, dots and dashes. Storing them needs one spelling — though
 * nothing is ever looked up by one.
 */
export function prontuarioKey(prontuario: string): string {
  return prontuario.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Whole years between a normalised date of birth and a given day. */
export function ageFromBirth(dateOfBirth: string, on = new Date()): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthKey(dateOfBirth));
  if (!parts) return undefined;
  const [, year, month, day] = parts.map(Number) as unknown as number[];
  let age = on.getFullYear() - year;
  const beforeBirthday =
    on.getMonth() + 1 < month || (on.getMonth() + 1 === month && on.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE patients (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     prontuario    TEXT NOT NULL UNIQUE,
     name          TEXT NOT NULL,
     name_key      TEXT NOT NULL,
     age_years     INTEGER,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   );
   CREATE INDEX patients_name_key ON patients(name_key);

   CREATE TABLE consultations (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     seen_on       TEXT,
     data          TEXT NOT NULL,
     created_at    TEXT NOT NULL
   );
   CREATE INDEX consultations_patient ON consultations(patient_id);

   CREATE TABLE exams (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     measured_on   TEXT,
     data          TEXT NOT NULL,
     created_at    TEXT NOT NULL
   );
   CREATE INDEX exams_patient ON exams(patient_id);`,

  // Identity moves from the prontuário to the CPF. The prontuário goes down
  // onto the consultation, where it belongs — it describes a visit, and the
  // same patient can be issued a different one next time.
  //
  // Dropping a table with children means the whole rebuild has to run with
  // foreign keys OFF, or `DROP TABLE patients` takes every consultation and
  // exam with it. openDatabase() applies migrations before turning them on.
  `ALTER TABLE consultations ADD COLUMN prontuario TEXT;

   UPDATE consultations
      SET prontuario = (SELECT p.prontuario FROM patients p WHERE p.id = consultations.patient_id);

   CREATE TABLE patients_v2 (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     cpf           TEXT UNIQUE,
     name          TEXT NOT NULL,
     name_key      TEXT NOT NULL,
     date_of_birth TEXT,
     age_years     INTEGER,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   );

   INSERT INTO patients_v2 (id, cpf, name, name_key, date_of_birth, age_years, created_at, updated_at)
     SELECT id, NULL, name, name_key, NULL, age_years, created_at, updated_at FROM patients;

   DROP TABLE patients;
   ALTER TABLE patients_v2 RENAME TO patients;

   CREATE INDEX patients_name_key ON patients(name_key);
   CREATE INDEX patients_name_birth ON patients(name_key, date_of_birth);`,
];

/**
 * Opens the database, creating it and applying any missing migrations.
 *
 * WAL mode because the one failure a restart cannot undo is a power cut in
 * the middle of a write; WAL plus a clean close on shutdown makes that very
 * unlikely.
 *
 * Foreign keys are switched on *after* the migrations, not before. A
 * migration that rebuilds a parent table has to drop it, and with cascades
 * armed that quietly deletes every child row — the data would be gone, with
 * no error anywhere. Once the schema is current they go on, so deleting a
 * patient still takes their consultations and exams with it.
 */
export function openDatabase(file: string = DB_PATH): DatabaseSync {
  // Re-open when asked for a different file. In the app that never happens
  // — the path is fixed — but it lets each test have its own database
  // instead of sharing one and interfering with the next.
  if (db && dbPath === file) return db;
  if (db) closeDatabase();

  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const opened = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA foreign_keys = OFF");

  opened.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = opened.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;
  let version = row?.version ?? 0;
  if (row === undefined) opened.prepare("INSERT INTO schema_version VALUES (0)").run();

  for (let i = version; i < MIGRATIONS.length; i++) {
    opened.exec(MIGRATIONS[i]);
    version = i + 1;
  }
  opened.prepare("UPDATE schema_version SET version = ?").run(version);

  opened.exec("PRAGMA foreign_keys = ON");

  db = opened;
  dbPath = file;
  return db;
}

/**
 * The connection already in use.
 *
 * Deliberately not `openDatabase()`: that one *chooses* a file, and calling
 * it with the default from inside a query would silently abandon whichever
 * database the caller had opened — which is exactly what happened, and made
 * every test quietly share one file.
 */
function connection(): DatabaseSync {
  return db ?? openDatabase();
}

/** Lets the server hand the file back on shutdown, so WAL is checkpointed. */
export function closeDatabase(): void {
  const open = db;
  db = null;
  dbPath = null;
  try {
    open?.close();
  } catch {
    // Already closed, or never opened. Nothing useful to do on the way out.
  }
}

export interface PatientRecord {
  id: number;
  /** Digits only, as stored. Formatting is the screen's business. */
  cpf?: string;
  name: string;
  dateOfBirth?: string;
  ageYears?: number;
  createdAt: string;
  updatedAt: string;
}

function toPatient(row: Record<string, unknown>): PatientRecord {
  return {
    id: row.id as number,
    cpf: (row.cpf as string | null) ?? undefined,
    name: row.name as string,
    dateOfBirth: (row.date_of_birth as string | null) ?? undefined,
    ageYears: (row.age_years as number | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function findByCpf(cpf: string): PatientRecord | null {
  const digits = cpfDigits(cpf);
  if (digits === "") return null;
  const row = connection().prepare("SELECT * FROM patients WHERE cpf = ?").get(digits) as
    | Record<string, unknown>
    | undefined;
  return row ? toPatient(row) : null;
}

/** Everyone with that name — candidates, never an answer on their own. */
export function findByName(name: string): PatientRecord[] {
  const rows = connection()
    .prepare("SELECT * FROM patients WHERE name_key = ? ORDER BY updated_at DESC")
    .all(nameKey(name)) as Record<string, unknown>[];
  return rows.map(toPatient);
}

/** The second key: a name and a date of birth together. */
export function findByNameAndBirth(name: string, dateOfBirth: string): PatientRecord[] {
  const rows = connection()
    .prepare(
      "SELECT * FROM patients WHERE name_key = ? AND date_of_birth = ? ORDER BY updated_at DESC",
    )
    .all(nameKey(name), birthKey(dateOfBirth)) as Record<string, unknown>[];
  return rows.map(toPatient);
}

/**
 * Drops candidates that are demonstrably somebody else.
 *
 * A stored patient carrying a *different* CPF is not this patient, however
 * well the name and the birthday line up — namesakes born on the same day
 * exist, and the number is the thing that tells them apart. Candidates with
 * no CPF on file stay: they may well be this person, first recorded before
 * their number was read.
 */
function notContradictedByCpf(candidates: PatientRecord[], cpf: string): PatientRecord[] {
  if (cpf === "") return candidates;
  return candidates.filter((candidate) => !candidate.cpf || candidate.cpf === cpf);
}

/**
 * What a scanned identity means.
 *
 * Deliberately not a boolean, and deliberately says *how* it matched. A CPF
 * that matches a stored patient whose name does not is the most dangerous
 * thing this feature can encounter — one misread digit away from attaching
 * this patient's biometry to someone else's consultation — so it gets its
 * own answer, and the caller has to show it to a person rather than resolve
 * it.
 */
export type MatchResult =
  | { kind: "none" }
  | { kind: "match"; patient: PatientRecord; by: "cpf" | "nameAndBirth" }
  | { kind: "nameMismatch"; patient: PatientRecord; scannedName: string }
  | { kind: "byNameOnly"; candidates: PatientRecord[] };

export interface PatientIdentity {
  cpf?: string;
  name?: string;
  dateOfBirth?: string;
}

export function matchPatient(input: PatientIdentity): MatchResult {
  const cpf = input.cpf?.trim();
  const name = input.name?.trim();
  const dateOfBirth = input.dateOfBirth?.trim();

  if (cpf) {
    const patient = findByCpf(cpf);
    if (patient) {
      if (name && nameKey(patient.name) !== nameKey(name)) {
        return { kind: "nameMismatch", patient, scannedName: name };
      }
      return { kind: "match", patient, by: "cpf" };
    }
  }

  if (name && dateOfBirth) {
    const candidates = notContradictedByCpf(
      findByNameAndBirth(name, dateOfBirth),
      cpf ? cpfDigits(cpf) : "",
    );
    if (candidates.length === 1) {
      return { kind: "match", patient: candidates[0], by: "nameAndBirth" };
    }
    if (candidates.length > 1) return { kind: "byNameOnly", candidates };
  }

  if (name) {
    const candidates = findByName(name);
    if (candidates.length > 0) return { kind: "byNameOnly", candidates };
  }

  return { kind: "none" };
}

/**
 * Refusing to merge two people on the strength of a number.
 *
 * Thrown when the CPF belongs to a stored patient under a different name.
 * The caller shows both names and lets a clinician decide; only an explicit
 * `confirmMerge` gets past this.
 */
export class NameMismatchError extends Error {
  constructor(
    readonly patient: PatientRecord,
    readonly scannedName: string,
  ) {
    super(
      `This CPF is already stored under "${patient.name}", not "${scannedName}". ` +
        "Check the CPF and the name before saving.",
    );
    this.name = "NameMismatchError";
  }
}

export interface ConsultationInput extends PatientIdentity {
  name: string;
  ageYears?: number;
  /** Recorded on the visit. Never used to find anyone — see the file header. */
  prontuario?: string;
  seenOn?: string;
  form: unknown;
  /** Save even though the CPF's stored name disagrees with this one. */
  confirmMerge?: boolean;
}

/**
 * Saves a consultation, creating the patient or adding to the one this
 * identity already belongs to.
 *
 * A second form bearing the same CPF is the same person returning — even
 * when the prontuário differs, which is the case the earlier design got
 * wrong. The name and date of birth are refreshed from the newer form:
 * people marry, and an earlier reading of the handwriting may simply have
 * been worse.
 */
export function saveConsultation(input: ConsultationInput): PatientRecord {
  const conn = connection();
  const now = new Date().toISOString();
  const cpf = input.cpf ? cpfDigits(input.cpf) : "";
  const dob = input.dateOfBirth ? birthKey(input.dateOfBirth) : "";
  const age = input.ageYears ?? (dob ? ageFromBirth(dob) : undefined);

  let existing = cpf ? findByCpf(cpf) : null;
  if (existing && nameKey(existing.name) !== nameKey(input.name) && !input.confirmMerge) {
    throw new NameMismatchError(existing, input.name);
  }
  if (!existing && dob) {
    const candidates = notContradictedByCpf(findByNameAndBirth(input.name, dob), cpf);
    // Only when it is unambiguous. Two stored patients with one name and one
    // birthday is a question for a person, not a row to pick.
    if (candidates.length === 1) existing = candidates[0];
  }

  if (existing) {
    conn
      .prepare(
        `UPDATE patients SET
           cpf = COALESCE(?, cpf),
           name = ?,
           name_key = ?,
           date_of_birth = COALESCE(?, date_of_birth),
           age_years = COALESCE(?, age_years),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(cpf || null, input.name, nameKey(input.name), dob || null, age ?? null, now, existing.id);
  } else {
    conn
      .prepare(
        `INSERT INTO patients (cpf, name, name_key, date_of_birth, age_years, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(cpf || null, input.name, nameKey(input.name), dob || null, age ?? null, now, now);
  }

  const patient = (
    existing
      ? conn.prepare("SELECT * FROM patients WHERE id = ?").get(existing.id)
      : conn.prepare("SELECT * FROM patients WHERE id = last_insert_rowid()").get()
  ) as Record<string, unknown>;

  conn
    .prepare(
      `INSERT INTO consultations (patient_id, seen_on, prontuario, data, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      patient.id as number,
      input.seenOn ?? null,
      input.prontuario ? prontuarioKey(input.prontuario) : null,
      JSON.stringify(input.form),
      now,
    );

  return toPatient(patient);
}

export function saveExam(input: { patientId: number; measuredOn?: string; exam: unknown }): void {
  connection()
    .prepare(`INSERT INTO exams (patient_id, measured_on, data, created_at) VALUES (?, ?, ?, ?)`)
    .run(
      input.patientId,
      input.measuredOn ?? null,
      JSON.stringify(input.exam),
      new Date().toISOString(),
    );
}

export interface StoredConsultation {
  id: number;
  seenOn?: string;
  prontuario?: string;
  form: unknown;
  createdAt: string;
}

export function consultationsFor(patientId: number): StoredConsultation[] {
  const rows = connection()
    .prepare("SELECT * FROM consultations WHERE patient_id = ? ORDER BY created_at DESC")
    .all(patientId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    seenOn: (row.seen_on as string | null) ?? undefined,
    prontuario: (row.prontuario as string | null) ?? undefined,
    form: JSON.parse(row.data as string),
    createdAt: row.created_at as string,
  }));
}

export function listPatients(): PatientRecord[] {
  const rows = connection()
    .prepare("SELECT * FROM patients ORDER BY updated_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(toPatient);
}

export function deletePatient(id: number): void {
  connection().prepare("DELETE FROM patients WHERE id = ?").run(id);
}

/**
 * Everything, as one JSON document.
 *
 * The backup story until something better exists: a button that hands the
 * whole database over as a file. Most of the ways this data can be lost —
 * `docker compose down -v`, a Docker Desktop reset, the PC dying — are
 * undone by having taken one of these recently.
 */
export function exportAll(): unknown {
  const patients = listPatients();
  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    patients: patients.map((patient) => ({
      ...patient,
      cpfValid: patient.cpf ? isValidCpf(patient.cpf) : undefined,
      consultations: consultationsFor(patient.id),
    })),
  };
}
