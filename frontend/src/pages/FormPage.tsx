import { useState } from "react";
import { FormReview } from "../components/FormReview";
import {
  fetchFormFields,
  scanFormPhoto,
  ScanUnavailableError,
  databaseExportUrl,
  type FormScanResult,
} from "../lib/api";
import { isWordFile, readFormDocx } from "../lib/docx";
import { fileToBase64, prepareImage } from "../lib/imagePrep";
import type { Strings } from "../lib/i18n";

/**
 * The day-one work: a *Ficha de Diagnóstico* photographed at the
 * consultation, checked, and stored so the biometry can find it weeks later.
 *
 * It used to be a file input wedged between the biometry camera and the
 * spreadsheet import, which meant a resident with a form in their hand had
 * to scroll past an IOL calculator to reach it. On its own page it is the
 * only thing being asked for.
 */
interface FormPageProps {
  t: Strings;
}

export function FormPage({ t }: FormPageProps) {
  const [scan, setScan] = useState<FormScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Reads a consultation form, however it arrived.
   *
   * The three formats are genuinely different, not three routes to the same
   * place, and the difference matters enough to be visible on screen:
   *
   * - **A photograph** is the ordinary case, and goes to the vision model.
   * - **A PDF** goes to the model too, but as the page itself rather than a
   *   photograph of a screen — it reads typed text and drawn marks alike.
   * - **A Word file never leaves this machine.** It is read here, exactly,
   *   because it is text. What it cannot see is a mark drawn with a stylus,
   *   and when a document turns out to carry no marks at all that is worth
   *   saying rather than presenting an empty form as a reading.
   */
  async function importForm(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      if (isWordFile(file)) {
        const sections = await fetchFormFields();
        const { form, unread, noMarksFound } = await readFormDocx(file, sections);
        setScan({ form, unread });
        if (noMarksFound) setMessage(t.formWordNoMarks);
        return;
      }
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        setScan(await scanFormPhoto(await fileToBase64(file), "application/pdf"));
        return;
      }
      const { base64, mediaType } = await prepareImage(file);
      setScan(await scanFormPhoto(base64, mediaType));
    } catch (err) {
      setMessage(
        err instanceof ScanUnavailableError
          ? t.batchScanUnavailable
          : err instanceof Error
            ? err.message
            : t.scanFailedGeneric,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!scan && (
        <section className="page-intro">
          <h2>{t.formPageTitle}</h2>
          <p className="hint">{t.formPageHint}</p>

          <div className="list-import">
            <label htmlFor="form-file">{t.formImportLabel}</label>
            <input
              id="form-file"
              type="file"
              // A photo of the paper is the ordinary case, but the form also
              // circulates as a PDF and as the Word file it was made in —
              // and a picker that only offers photos is a picker that says
              // those don't work.
              accept="image/*,application/pdf,.pdf,.docx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importForm(file);
              }}
            />
            {/* Said where the decision is made, not only in the README: this
                is the one feature that reads a patient's identity and keeps
                it. */}
            <p className="hint">{t.formStorageNote}</p>
            {busy && <p className="hint">{t.formReading}</p>}
            {message && <p className="scan-message">{message}</p>}
          </div>

          <p className="hint">
            <a href={databaseExportUrl()} download>
              {t.databaseExport}
            </a>
          </p>
        </section>
      )}

      {scan && (
        <FormReview
          t={t}
          scan={scan}
          onCancel={() => setScan(null)}
          onSaved={(patient, how) => {
            setScan(null);
            setMessage(t.formSaved(patient.name, how));
          }}
        />
      )}
    </>
  );
}
