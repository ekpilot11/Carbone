import { useState } from "react";
import {
  fetchPatient,
  lookupPatient,
  saveExam,
  savePatient,
  type PatientMatch,
  type StoredConsultation,
  type StoredPatient,
} from "../lib/api";
import {
  consultationForRecord,
  consultationIsEmpty,
  formatRecordDate,
  type AttachedConsultation,
  type RecordConsultation,
} from "../lib/consultation";
import { formatCpf } from "../lib/cpf";
import type { Lang, Strings } from "../lib/i18n";
import type { MedicalRecordInput } from "../lib/medicalRecord";

/**
 * Joining the two visits: the consultation photographed weeks ago, and the
 * biometry measured today.
 *
 * This is the most dangerous screen in the app. Attaching one patient's
 * consultation to another's measurements produces a confident, complete,
 * wrong record — worse than the two halves sitting apart, because it reads
 * as though someone checked. So:
 *
 * - **Nothing attaches on its own**, including when the CPF matches exactly.
 *   The stored consultation is shown beside the measurements and a person
 *   presses the button.
 * - **A CPF whose stored name disagrees is refused,** not resolved. Both
 *   names go on screen and the search stops there.
 * - **A name alone offers candidates,** never a pick. Names are shared.
 */

interface ConsultationMatchProps {
  t: Strings;
  lang: Lang;
  /** The name on the record, used as the second key beside a date of birth. */
  patientName: string;
  /** What was measured, for the side-by-side and for storing against the patient. */
  record: MedicalRecordInput;
  attached: AttachedConsultation | null;
  onAttach: (attached: AttachedConsultation | null) => void;
  /** Set where no CPF can exist — a spreadsheet import — so the screen says so. */
  nameOnly?: boolean;
}

export type { AttachedConsultation };

type Stage =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "result"; match: PatientMatch }
  | { kind: "chosen"; patient: StoredPatient; consultation: RecordConsultation | null }
  | { kind: "error"; message: string };

export function ConsultationMatch({
  t,
  lang,
  patientName,
  record,
  attached,
  onAttach,
  nameOnly,
}: ConsultationMatchProps) {
  const [cpf, setCpf] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [examNote, setExamNote] = useState<string | null>(null);

  async function search() {
    setStage({ kind: "searching" });
    try {
      const match = await lookupPatient({
        cpf: cpf.trim() || undefined,
        name: patientName.trim() || undefined,
        dateOfBirth: dateOfBirth.trim() || undefined,
      });
      // A settled match still goes through the confirm step below: the
      // stored consultation has to be looked at before it is joined to
      // measurements taken from a different sheet of paper.
      if (match.kind === "match") await choose(match.patient);
      else setStage({ kind: "result", match });
    } catch (err) {
      setStage({ kind: "error", message: err instanceof Error ? err.message : t.formSaveFailed });
    }
  }

  async function choose(patient: StoredPatient) {
    setStage({ kind: "searching" });
    try {
      const { consultations } = await fetchPatient(patient.id);
      const latest: StoredConsultation | undefined = consultations[0];
      setStage({
        kind: "chosen",
        patient,
        consultation: latest
          ? consultationForRecord(latest.form, lang, latest.seenOn ?? latest.createdAt.slice(0, 10))
          : null,
      });
    } catch (err) {
      setStage({ kind: "error", message: err instanceof Error ? err.message : t.formSaveFailed });
    }
  }

  async function confirm(patient: StoredPatient, consultation: RecordConsultation | null) {
    onAttach(consultation ? { patient, consultation } : null);
    setStage({ kind: "idle" });
    // Storing the exam is the other half of "one complete record". It is
    // deliberately not fatal: the record on screen is already correct, and
    // saying the save failed beats losing the attachment over it.
    try {
      await saveExam(patient.id, {
        measuredOn: record.recordedAt.toISOString().slice(0, 10),
        exam: examPayload(record),
      });
      setExamNote(t.matchExamSaved);
    } catch {
      setExamNote(t.matchExamFailed);
    }
  }

  /**
   * A patient who was never photographed at their first visit still has an
   * exam worth keeping. Storing it creates the patient from what is on
   * screen, so the form — whenever it is photographed — attaches to this
   * same person rather than making a second copy of them.
   */
  async function storeNew() {
    setStage({ kind: "searching" });
    try {
      // No form: this registers the patient, it does not invent a visit
      // where nothing was found.
      const { patient } = await savePatient({
        cpf: cpf.trim() || undefined,
        name: patientName.trim(),
        dateOfBirth: dateOfBirth.trim() || undefined,
      });
      await saveExam(patient.id, {
        measuredOn: record.recordedAt.toISOString().slice(0, 10),
        exam: examPayload(record),
      });
      setExamNote(t.matchStoredNew(patient.name));
      setStage({ kind: "idle" });
    } catch (err) {
      setStage({ kind: "error", message: err instanceof Error ? err.message : t.formSaveFailed });
    }
  }

  if (attached) {
    return (
      <div className="match-box">
        <p className="hint">{t.matchAttached(attached.patient.name)}</p>
        <ConsultationSummary t={t} consultation={attached.consultation} />
        {examNote && <p className="hint">{examNote}</p>}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            onAttach(null);
            setExamNote(null);
          }}
        >
          {t.matchDetach}
        </button>
      </div>
    );
  }

  const canSearch = (cpf.trim() !== "" || dateOfBirth.trim() !== "") && stage.kind !== "searching";

  return (
    <div className="match-box">
      <h4>{t.matchTitle}</h4>
      <p className="hint">{t.matchHint}</p>
      {nameOnly && <p className="hint">{t.matchNoCpfInList}</p>}

      <div className="match-fields">
        {!nameOnly && (
          <label className="field">
            <span>{t.matchCpfLabel}</span>
            <input
              type="text"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
          </label>
        )}
        <label className="field">
          <span>{t.matchDobLabel}</span>
          <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
        </label>
        <button type="button" onClick={() => void search()} disabled={!canSearch}>
          {stage.kind === "searching" ? t.matchSearching : t.matchSearch}
        </button>
      </div>
      {!canSearch && stage.kind === "idle" && <p className="hint">{t.matchNoKey}</p>}

      {stage.kind === "error" && <p className="scan-message">{stage.message}</p>}
      {examNote && <p className="hint">{examNote}</p>}

      {/* Nothing stored under this identity. The record is unaffected — but
          the exam is worth keeping, so that when the form is photographed
          later it lands on the same patient instead of a second copy. */}
      {stage.kind === "result" && stage.match.kind === "none" && (
        <>
          <p className="hint">{t.matchNone}</p>
          {patientName.trim() !== "" && (
            <button type="button" className="secondary" onClick={() => void storeNew()}>
              {t.matchStoreNew}
            </button>
          )}
        </>
      )}

      {stage.kind === "result" && stage.match.kind === "nameMismatch" && (
        <p className="warning-box">
          {t.matchMismatch(stage.match.patient.name, patientName)}
        </p>
      )}

      {stage.kind === "result" && stage.match.kind === "byNameOnly" && (
        <div>
          <p className="hint">{t.matchCandidates(stage.match.candidates.length)}</p>
          <ul className="match-candidates">
            {stage.match.candidates.map((candidate) => (
              <li key={candidate.id}>
                <button type="button" className="secondary" onClick={() => void choose(candidate)}>
                  {candidate.name}
                  {candidate.dateOfBirth ? ` · ${formatRecordDate(candidate.dateOfBirth)}` : ""}
                  {candidate.cpf ? ` · ${formatCpf(candidate.cpf)}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stage.kind === "chosen" && (
        <div>
          {stage.consultation === null ? (
            <p className="hint">{t.matchNoConsultation}</p>
          ) : (
            <>
              <div className="match-columns">
                <div>
                  <h5>{t.matchStoredSide}</h5>
                  <p className="hint">{stage.patient.name}</p>
                  <ConsultationSummary t={t} consultation={stage.consultation} />
                </div>
                <div>
                  <h5>{t.matchMeasuredSide}</h5>
                  <p className="hint">{patientName || "—"}</p>
                  <MeasurementSummary record={record} />
                </div>
              </div>
              <button type="button" onClick={() => void confirm(stage.patient, stage.consultation)}>
                {t.matchConfirm}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConsultationSummary({ t, consultation }: { t: Strings; consultation: RecordConsultation }) {
  if (consultationIsEmpty(consultation)) return <p className="hint">{t.matchNothingRecorded}</p>;
  return (
    <>
      {consultation.seenOn && (
        <p className="hint">{t.recordConsultationOn(formatRecordDate(consultation.seenOn))}</p>
      )}
      <ul className="match-findings">
        {consultation.preOp.map((finding) => (
          <li key={finding}>{finding}</li>
        ))}
        {consultation.retina && (
          <li>
            {t.recordRetina} {consultation.retina.finding}
            {consultation.retina.note ? ` ${consultation.retina.note}` : ""}
          </li>
        )}
      </ul>
    </>
  );
}

/** Enough of the exam to tell one patient's eyes from another's at a glance. */
function MeasurementSummary({ record }: { record: MedicalRecordInput }) {
  return (
    <ul className="match-findings">
      {record.eyes.map((eye) => {
        const m = eye.measurements;
        const values = [
          m.axialLength && `AXL ${m.axialLength}`,
          m.k1 && `K1 ${m.k1}`,
          m.k2 && `K2 ${m.k2}`,
          m.acd && `ACD ${m.acd}`,
        ].filter(Boolean);
        return (
          <li key={eye.side}>
            <strong>{eye.side}</strong> {values.join(" · ")}
            {eye.recommended ? ` → ${eye.recommended} D` : ""}
          </li>
        );
      })}
    </ul>
  );
}

/** What gets stored: the measurements and the decision, never the photograph. */
function examPayload(record: MedicalRecordInput) {
  return {
    lens: record.lens,
    kIndex: record.kIndex,
    eyes: record.eyes.map((eye) => ({
      side: eye.side,
      measurements: eye.measurements,
      recommended: eye.recommended,
    })),
  };
}
