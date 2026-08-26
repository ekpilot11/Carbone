import { useEffect, useState } from "react";
import { FormReview } from "../components/FormReview";
import {
  deletePatient,
  fetchPatient,
  fetchPatients,
  updateConsultation,
  type StoredConsultation,
  type StoredExam,
  type StoredPatient,
} from "../lib/api";
import { consultationForRecord, formatRecordDate } from "../lib/consultation";
import { formatCpf } from "../lib/cpf";
import type { Lang, Strings } from "../lib/i18n";
import {
  buildMedicalRecordPdf,
  medicalRecordFileName,
  type MedicalRecordInput,
} from "../lib/medicalRecord";
import { downloadPdf } from "../lib/pdf";
import { copyRecords, copyRecordSource } from "../lib/recordText";
import { emptyRow } from "../lib/eyeRow";
import type { EyeSide } from "../lib/types";

/**
 * The database, visible from inside the app.
 *
 * Until now everything stored here was write-only: forms went in, exams
 * went in, and the only way to see any of it again was to download the
 * whole database as JSON. This is the other half — the list of who is on
 * file, and everything held about one of them.
 *
 * **The photographs are not here, and never were.** Only the values read
 * from them are stored, deliberately; the page says so rather than leaving
 * someone hunting for an image that was never kept.
 */
interface PatientsPageProps {
  t: Strings;
  lang: Lang;
}

interface PatientDetail {
  patient: StoredPatient;
  consultations: StoredConsultation[];
  exams: StoredExam[];
}

/** Name plus whichever identifier the patient actually has on file. */
function identityOf(patient: StoredPatient, t: Strings): string {
  if (patient.cpf) return t.matchIdentityCpf(formatCpf(patient.cpf));
  if (patient.dateOfBirth) return t.matchIdentityBirth(formatRecordDate(patient.dateOfBirth));
  return t.matchIdentityNameOnly;
}

/** Uppercase, accents stripped — so "José" is found by typing "jose". */
function searchKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function PatientsPage({ t, lang }: PatientsPageProps) {
  const [patients, setPatients] = useState<StoredPatient[]>([]);
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshList();
  }, []);

  async function refreshList() {
    setBusy(true);
    setError(null);
    try {
      setPatients(await fetchPatients());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.patientsLoadFailed);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: number) {
    setBusy(true);
    setError(null);
    try {
      setDetail(await fetchPatient(id));
      setOpenId(id);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.patientsLoadFailed);
    } finally {
      setBusy(false);
    }
  }

  if (openId !== null && detail) {
    return (
      <PatientDetailView
        t={t}
        lang={lang}
        detail={detail}
        onBack={() => {
          setOpenId(null);
          setDetail(null);
          void refreshList();
        }}
        onChanged={(next) => setDetail(next)}
      />
    );
  }

  const wanted = searchKey(filter.trim());
  const shown = patients.filter(
    (patient) =>
      wanted === "" ||
      searchKey(patient.name).includes(wanted) ||
      (patient.cpf ?? "").includes(wanted.replace(/\D/g, "")),
  );

  return (
    <section className="page-intro">
      <h2>{t.patientsTitle}</h2>
      <p className="hint">{t.patientsHint}</p>

      <label className="field patients-filter">
        <span>{t.patientsFilter}</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t.patientsFilterPlaceholder}
          autoComplete="off"
        />
      </label>

      {error && <p className="scan-message">{error}</p>}
      {busy && <p className="hint">{t.patientsLoading}</p>}

      {!busy && patients.length === 0 && (
        <p className="hint">{t.patientsEmpty}</p>
      )}
      {!busy && patients.length > 0 && shown.length === 0 && (
        <p className="hint">{t.patientsNoneMatch}</p>
      )}

      <ul className="patient-list">
        {shown.map((patient) => (
          <li key={patient.id}>
            <button type="button" onClick={() => void open(patient.id)}>
              <span className="patient-name">{patient.name}</span>
              <span className="patient-id">{identityOf(patient, t)}</span>
            </button>
          </li>
        ))}
      </ul>

      {shown.length > 0 && <p className="hint">{t.patientsCount(shown.length)}</p>}
    </section>
  );
}

/**
 * Everything held about one patient, and the three things that can be done
 * with it: read the record, correct a consultation, remove the patient.
 */
function PatientDetailView({
  t,
  lang,
  detail,
  onBack,
  onChanged,
}: {
  t: Strings;
  lang: Lang;
  detail: PatientDetail;
  onBack: () => void;
  onChanged: (next: PatientDetail) => void;
}) {
  const { patient, consultations, exams } = detail;
  const [editing, setEditing] = useState<StoredConsultation | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The record this patient's stored halves add up to — the same document
   * the biometry page produces on the day, rebuilt from what was kept.
   *
   * One record per exam, because an exam is what a record is *of*; the
   * consultation attached is the most recent one at that point.
   */
  function recordFor(exam: StoredExam): MedicalRecordInput | null {
    const values = exam.exam ?? {};
    const eyes = values.eyes ?? [];
    if (eyes.length === 0) return null;
    const consultation = consultations[0];
    return {
      patientName: patient.name,
      recordedAt: new Date(exam.measuredOn ?? exam.createdAt),
      lang,
      kIndex: values.kIndex,
      lens: values.lens ?? { name: "" },
      eyes: eyes.map((eye) => ({
        side: eye.side as EyeSide,
        measurements: { ...emptyRow(eye.side as EyeSide), ...eye.measurements },
        recommended: eye.recommended,
        // Older exams were stored without the table; the record simply
        // prints without the predicted-refraction line, which
        // closestToPlano already handles by returning -1.
        rows: eye.rows ?? [],
      })),
      consultation: consultation
        ? consultationForRecord(
            consultation.form,
            lang,
            consultation.seenOn ?? consultation.createdAt.slice(0, 10),
          )
        : undefined,
    };
  }

  async function saveCorrection(form: unknown, consultationId: number) {
    const updated = await updateConsultation(patient.id, consultationId, {
      seenOn: consultations.find((c) => c.id === consultationId)?.seenOn,
      prontuario: consultations.find((c) => c.id === consultationId)?.prontuario,
      form,
    });
    onChanged({ ...detail, consultations: updated });
    setEditing(null);
  }

  async function remove() {
    setError(null);
    try {
      await deletePatient(patient.id);
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.patientsDeleteFailed);
    }
  }

  if (editing) {
    return (
      <FormReview
        t={t}
        scan={{ form: editing.form, unread: [] }}
        editing
        onCancel={() => setEditing(null)}
        onSaveForm={(form) => saveCorrection(form, editing.id)}
        onSaved={() => setEditing(null)}
      />
    );
  }

  return (
    <section className="page-intro">
      <button type="button" className="secondary" onClick={onBack}>
        {t.patientsBack}
      </button>

      <h2>{patient.name}</h2>
      <p className="hint">{identityOf(patient, t)}</p>
      {patient.ageYears !== undefined && (
        <p className="hint">{t.patientsAge(patient.ageYears)}</p>
      )}

      {error && <p className="scan-message">{error}</p>}

      <h3>{t.patientsConsultations(consultations.length)}</h3>
      {consultations.length === 0 && <p className="hint">{t.patientsNoConsultations}</p>}
      {consultations.map((consultation) => {
        const summary = consultationForRecord(
          consultation.form,
          lang,
          consultation.seenOn ?? consultation.createdAt.slice(0, 10),
        );
        return (
          <div className="record-card" key={consultation.id}>
            <p className="record-card-head">
              <strong>
                {formatRecordDate(consultation.seenOn ?? consultation.createdAt.slice(0, 10))}
              </strong>
              {consultation.prontuario ? ` · ${t.patientsProntuario(consultation.prontuario)}` : ""}
            </p>
            <ul className="match-findings">
              {summary.preOp.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
              {summary.retina && (
                <li>
                  {t.recordRetina} {summary.retina.finding}
                  {summary.retina.note ? ` ${summary.retina.note}` : ""}
                </li>
              )}
              {summary.preOp.length === 0 && !summary.retina && (
                <li className="hint">{t.matchNothingRecorded}</li>
              )}
            </ul>
            <button type="button" className="secondary" onClick={() => setEditing(consultation)}>
              {t.patientsCorrect}
            </button>
          </div>
        );
      })}

      <h3>{t.patientsExams(exams.length)}</h3>
      {exams.length === 0 && <p className="hint">{t.patientsNoExams}</p>}
      {exams.map((exam) => {
        const record = recordFor(exam);
        return (
          <div className="record-card" key={exam.id}>
            <p className="record-card-head">
              <strong>
                {formatRecordDate(exam.measuredOn ?? exam.createdAt.slice(0, 10))}
              </strong>
            </p>
            <ul className="match-findings">
              {(exam.exam?.eyes ?? []).map((eye) => {
                const m = eye.measurements ?? {};
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
            {record && (
              <div className="record-buttons">
                <button type="button" onClick={() => void copyRecords([record])}>
                  {t.recordCopy}
                </button>
                <button type="button" onClick={() => void copyRecordSource([record])}>
                  {t.recordCopySource}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    downloadPdf(buildMedicalRecordPdf(record), medicalRecordFileName(record))
                  }
                >
                  {t.recordDownload}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Said here rather than left to be discovered: the photographs were
          never stored, so there is no image to hand back. */}
      <p className="hint">{t.patientsNoPhotos}</p>

      <details className="danger-zone">
        <summary>{t.patientsDeleteTitle}</summary>
        <p className="warning-box">{t.patientsDeleteWarning(patient.name)}</p>
        <label className="field">
          <span>{t.patientsDeleteConfirmLabel}</span>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="danger"
          disabled={searchKey(confirmName.trim()) !== searchKey(patient.name) || deleting}
          onClick={() => {
            setDeleting(true);
            void remove();
          }}
        >
          {deleting ? t.patientsDeleting : t.patientsDelete}
        </button>
      </details>
    </section>
  );
}
