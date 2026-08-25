import { useEffect, useRef, useState } from "react";
import {
  fetchFormFields,
  lookupPatient,
  NameMismatchError,
  savePatient,
  type FormFieldSpec,
  type FormSectionSpec,
  type PatientMatch,
  type StoredPatient,
} from "../lib/api";
import { formatCpf } from "../lib/cpf";
import type { Strings } from "../lib/i18n";

/**
 * The Ficha de Diagnóstico, after a photograph of it has been read.
 *
 * The residents fill this form by hand and there is no way for them to type
 * into the app, so a photograph is the only way in — which makes this screen
 * the *only* place a misreading can ever be corrected. It is therefore a
 * complete editor of every field, not a confirmation of what was read, and
 * it has to stay usable when the model got half the page wrong.
 *
 * Three distinctions the screen is built around:
 *
 * - **"Blank on the paper" and "couldn't read it" must not look alike.** A
 *   field the model failed on is marked *not read*; an empty field it read
 *   as empty is simply empty. Showing both as blank would quietly turn a
 *   failure into an answer.
 * - **Only the name and one key are required.** A form with gaps is
 *   ordinary, and refusing to store one would send people back to paper —
 *   which is the thing this replaces. The key is the CPF, or a date of birth
 *   when there is no CPF.
 * - **A CPF that doesn't add up is a warning, not a wall.** Its check digits
 *   are what catches a misread digit, so a failure is worth saying loudly;
 *   but the paper itself is sometimes wrong, and a patient who cannot be
 *   recorded is a patient back on paper.
 */

type FormValues = Record<string, Record<string, unknown>>;

interface FormReviewProps {
  t: Strings;
  scan: { form: FormValues; unread: string[]; ambiguous?: string[] };
  onSaved: (patient: StoredPatient, how: string) => void;
  onCancel: () => void;
}

function detailKey(key: string): string {
  return `${key}Detalhe`;
}

/** Today, as a date input wants it. The form has no consultation date on it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function FormReview({ t, scan, onSaved, onCancel }: FormReviewProps) {
  const [sections, setSections] = useState<FormSectionSpec[]>([]);
  const [values, setValues] = useState<FormValues>(scan.form);
  const [unread, setUnread] = useState<Set<string>>(new Set(scan.unread));
  // Fields where the paper has more than one box ticked. Not a reading
  // failure — a contradiction on the form that only the examiner can
  // settle, so it is asked as its own question rather than tagged as unread.
  const [ambiguous, setAmbiguous] = useState<Set<string>>(new Set(scan.ambiguous ?? []));
  const [seenOn, setSeenOn] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<(PatientMatch & { cpfValid?: boolean }) | null>(null);
  const [mismatch, setMismatch] = useState<NameMismatchError | null>(null);
  const lookupTimer = useRef<number | undefined>(undefined);

  // The field list comes from the server, which generates the extraction
  // schema from the same list — so this screen can't drift out of step with
  // what was asked of the model.
  useEffect(() => {
    let cancelled = false;
    fetchFormFields()
      .then((loaded) => {
        if (!cancelled) setSections(loaded);
      })
      .catch(() => {
        if (!cancelled) setError(t.formFieldsUnavailable);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const identity = values.identificacao ?? {};
  const cpf = String(identity.cpf ?? "").trim();
  const patientName = String(identity.paciente ?? "").trim();
  const dateOfBirth = String(identity.dataNascimento ?? "").trim();
  const prontuario = String(identity.prontuario ?? "").trim();

  /**
   * Checks the identity against the database *while the form is still on
   * screen*.
   *
   * A misread digit lands on a real patient who isn't this one, and the
   * cheapest moment to notice is before this becomes a consultation stored
   * under somebody else. The same call reports whether the CPF's check
   * digits add up, so the rule has one implementation, on the server.
   */
  useEffect(() => {
    window.clearTimeout(lookupTimer.current);
    if (cpf === "" && patientName === "") {
      setExisting(null);
      return;
    }
    lookupTimer.current = window.setTimeout(() => {
      void lookupPatient({
        cpf: cpf || undefined,
        name: patientName || undefined,
        dateOfBirth: dateOfBirth || undefined,
      })
        .then(setExisting)
        .catch(() => setExisting(null));
    }, 500);
    return () => window.clearTimeout(lookupTimer.current);
  }, [cpf, patientName, dateOfBirth]);

  function setValue(section: string, key: string, value: unknown) {
    setValues((current) => ({
      ...current,
      [section]: { ...(current[section] ?? {}), [key]: value },
    }));
    // Touching a field is the clinician answering it; it is no longer
    // something the model failed to read.
    setUnread((current) => {
      const next = new Set(current);
      next.delete(`${section}.${key}`);
      return next;
    });
    setAmbiguous((current) => {
      const next = new Set(current);
      next.delete(`${section}.${key}`);
      return next;
    });
    // Any edit to the identity reopens the question of who this is.
    if (section === "identificacao") setMismatch(null);
  }

  function setEyeValue(section: string, eye: string, key: string, value: unknown) {
    setValues((current) => {
      const sectionValues = current[section] ?? {};
      const eyeValues = (sectionValues[eye] as Record<string, unknown>) ?? {};
      return {
        ...current,
        [section]: { ...sectionValues, [eye]: { ...eyeValues, [key]: value } },
      };
    });
    setUnread((current) => {
      const next = new Set(current);
      next.delete(`${section}.${eye}.${key}`);
      return next;
    });
  }

  async function save(confirmMerge = false) {
    setSaving(true);
    setError(null);
    try {
      const ageRaw = identity.idade;
      const age = Number(ageRaw);
      const { patient } = await savePatient({
        cpf: cpf || undefined,
        name: patientName,
        dateOfBirth: dateOfBirth || undefined,
        ageYears: Number.isFinite(age) && String(ageRaw ?? "").trim() !== "" ? age : undefined,
        prontuario: prontuario || undefined,
        seenOn: seenOn || undefined,
        form: values,
        confirmMerge,
      });
      onSaved(patient, patient.cpf ? `CPF ${formatCpf(patient.cpf)}` : patientName);
    } catch (err) {
      // Not an error to report and move past: the clinician sees both names
      // and decides whether this is the same patient.
      if (err instanceof NameMismatchError) setMismatch(err);
      else setError(err instanceof Error ? err.message : t.formSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  const hasKey = cpf !== "" || dateOfBirth !== "";
  const canSave = patientName !== "" && hasKey && !saving;
  const unreadCount = unread.size;
  const ambiguousCount = ambiguous.size;
  const cpfDoubtful = cpf !== "" && existing?.cpfValid === false;

  return (
    <section className="form-review">
      <div className="batch-header">
        <h2>{t.formReviewTitle}</h2>
        <button type="button" className="secondary" onClick={onCancel}>
          {t.formCancel}
        </button>
      </div>

      <p className="warning-box">{t.formHandwritingWarning}</p>
      {unreadCount > 0 && <p className="hint">{t.formUnreadCount(unreadCount)}</p>}
      {ambiguousCount > 0 && <p className="warning-box">{t.formAmbiguousCount(ambiguousCount)}</p>}

      {cpfDoubtful && <p className="warning-box">{t.formCpfInvalid}</p>}

      {existing?.kind === "nameMismatch" && (
        <p className="warning-box">
          {t.formCpfMismatch(formatCpf(cpf), existing.patient.name, patientName)}
        </p>
      )}
      {existing?.kind === "match" && existing.by === "cpf" && (
        <p className="hint">{t.formCpfKnown(existing.patient.name)}</p>
      )}
      {existing?.kind === "match" && existing.by === "nameAndBirth" && (
        <p className="hint">{t.formBirthKnown(existing.patient.name)}</p>
      )}

      <div className="form-row">
        <span className="form-label">{t.formSeenOn}</span>
        <input
          type="date"
          className="form-text"
          value={seenOn}
          onChange={(e) => setSeenOn(e.target.value)}
        />
      </div>

      {sections.map((section) => (
        <fieldset className="form-section" key={section.key}>
          <legend>{section.title}</legend>

          {section.coded.map((field) => (
            <CodedRow
              key={field.key}
              t={t}
              field={field}
              value={values[section.key]?.[field.key]}
              detail={values[section.key]?.[detailKey(field.key)]}
              notRead={unread.has(`${section.key}.${field.key}`)}
              twoTicked={ambiguous.has(`${section.key}.${field.key}`)}
              onChange={(value) => setValue(section.key, field.key, value)}
              onDetail={(value) => setValue(section.key, detailKey(field.key), value)}
            />
          ))}

          {section.text.map((field) => (
            <TextRow
              key={field.key}
              t={t}
              field={field}
              value={values[section.key]?.[field.key]}
              notRead={unread.has(`${section.key}.${field.key}`)}
              flagged={section.key === "identificacao" && field.key === "cpf" && cpfDoubtful}
              onChange={(value) => setValue(section.key, field.key, value)}
            />
          ))}

          {section.perEye && (
            <table className="form-eyes">
              <thead>
                <tr>
                  <th />
                  {section.perEye.map((field) => (
                    <th key={field.key}>{field.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["od", "oe"] as const).map((eye) => (
                  <tr key={eye}>
                    <th scope="row">{eye.toUpperCase()}</th>
                    {section.perEye!.map((field) => {
                      const eyeValues =
                        (values[section.key]?.[eye] as Record<string, unknown>) ?? {};
                      const missing = unread.has(`${section.key}.${eye}.${field.key}`);
                      return (
                        <td key={field.key}>
                          <input
                            type="text"
                            className={missing ? "not-read" : undefined}
                            placeholder={missing ? t.formNotRead : ""}
                            value={String(eyeValues[field.key] ?? "")}
                            onChange={(e) =>
                              setEyeValue(section.key, eye, field.key, e.target.value)
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </fieldset>
      ))}

      {error && <p className="scan-message">{error}</p>}
      {mismatch && (
        <div className="warning-box">
          <p>{t.formCpfMismatch(formatCpf(cpf), mismatch.patient?.name ?? "", patientName)}</p>
          <button type="button" className="secondary" onClick={() => void save(true)}>
            {t.formConfirmMerge}
          </button>
        </div>
      )}
      {!canSave && !saving && <p className="hint">{t.formNeedsIdentity}</p>}

      <div className="batch-actions">
        <button type="button" onClick={() => void save()} disabled={!canSave}>
          {saving ? t.formSaving : t.formSave}
        </button>
      </div>
    </section>
  );
}

function CodedRow({
  t,
  field,
  value,
  detail,
  notRead,
  twoTicked,
  onChange,
  onDetail,
}: {
  t: Strings;
  field: FormFieldSpec;
  value: unknown;
  detail: unknown;
  notRead: boolean;
  /** The paper has more than one box ticked here; only a person can settle it. */
  twoTicked?: boolean;
  onChange: (value: string | undefined) => void;
  onDetail: (value: string) => void;
}) {
  const selected = typeof value === "string" ? value : undefined;
  return (
    <div
      className={`form-row${notRead ? " form-row-unread" : ""}${
        twoTicked ? " form-row-ambiguous" : ""
      }`}
    >
      <span className="form-label">
        {field.label}
        {notRead && <span className="not-read-tag">{t.formNotRead}</span>}
        {twoTicked && <span className="two-ticked-tag">{t.formTwoTicked}</span>}
      </span>
      <span className="form-options">
        {(field.options ?? []).map((option) => (
          <button
            key={option}
            type="button"
            className={`chip${selected === option ? " chip-on" : ""}`}
            // Pressing the chosen option again clears it: the honest answer
            // to "which was ticked?" is sometimes none of them.
            onClick={() => onChange(selected === option ? undefined : option)}
          >
            {option}
          </button>
        ))}
        {field.detailFor && selected === field.detailFor && (
          <input
            type="text"
            className="form-detail"
            placeholder={t.formDetailPlaceholder}
            value={String(detail ?? "")}
            onChange={(e) => onDetail(e.target.value)}
          />
        )}
      </span>
    </div>
  );
}

function TextRow({
  t,
  field,
  value,
  notRead,
  flagged,
  onChange,
}: {
  t: Strings;
  field: FormFieldSpec;
  value: unknown;
  notRead: boolean;
  flagged?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`form-row${notRead ? " form-row-unread" : ""}`}>
      <span className="form-label">
        {field.label}
        {notRead && <span className="not-read-tag">{t.formNotRead}</span>}
      </span>
      <input
        type="text"
        className={`form-text${notRead || flagged ? " not-read" : ""}`}
        placeholder={notRead ? t.formNotRead : ""}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
