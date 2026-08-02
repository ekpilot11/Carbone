import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { BatchPanel } from "./components/BatchPanel";
import { CameraCapture } from "./components/CameraCapture";
import {
  calculateBarrett,
  fetchLensOptions,
  scanPhoto,
  ScanUnavailableError,
  type CalculateResponse,
  type IolTableRow,
} from "./lib/api";
import { prepareImage } from "./lib/imagePrep";
import {
  applyBiometry,
  applyKeratometry,
  emptyRow,
  formatRowForClipboard,
  isRowEmpty,
  missingFields,
  planCalculation,
  toEyeInput,
  type EyeRowState,
  type LensSettings,
} from "./lib/eyeRow";
import {
  A_CONSTANT,
  CONSTANT_RANGES,
  constantInRange,
  DEFAULT_K_INDEX,
  IOL_MODEL,
  K_INDEX_OPTIONS,
  LENS_FACTOR,
  type KIndex,
} from "./lib/constants";
import {
  initialLanguage,
  LANGUAGES,
  LANGUAGE_LABELS,
  rememberLanguage,
  STRINGS,
  type Lang,
  type Strings,
} from "./lib/i18n";
import {
  BUNDLED_LENS_OPTIONS,
  isPersonalConstant,
  lensConstants,
  PERSONAL_CONSTANT,
} from "./lib/lenses";
import {
  buildMedicalRecordPdf,
  medicalRecordFileName,
  type MedicalRecordInput,
} from "./lib/medicalRecord";
import { downloadPdf } from "./lib/pdf";
import { copyRecords, copyRecordSource, recordsToSource } from "./lib/recordText";
import { parseBiometryText } from "./lib/parseBiometry";
import { parseTopographyText } from "./lib/parseTopography";
import { recognizeVariants } from "./lib/ocr";
import type { BiometryReading, EyeSide, KeratometryReading } from "./lib/types";

const CALCULATOR_URL = "https://calc.apacrs.org/barrett_universal2105/";

/** Where this tab remembers the calculator's lens list (an empty list = "asking failed"). */
const LENS_CACHE_KEY = "barrett.lensOptions";

function readCachedLensOptions(): string[] | null {
  try {
    const raw = sessionStorage.getItem(LENS_CACHE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function App() {
  const [lang, setLang] = useState<Lang>(initialLanguage);
  const t = STRINGS[lang];
  const [rows, setRows] = useState<Record<EyeSide, EyeRowState>>({
    OD: emptyRow("OD"),
    OS: emptyRow("OS"),
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [failedOcrText, setFailedOcrText] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<CalculateResponse | null>(null);
  // What was actually sent for the displayed result. The record has to
  // report the values that produced it, not whatever the form holds now.
  const [submitted, setSubmitted] = useState<{
    rows: Record<EyeSide, EyeRowState>;
    sides: EyeSide[];
    settings: LensSettings;
    kIndex: KIndex;
  } | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recordCopied, setRecordCopied] = useState<"rich" | "source" | null>(null);
  // The lens dropdown and its two constants. They start on this practice's
  // own values, are typed in (never read from a photo), and are replaced by
  // a lens's own constants the moment one is picked from the dropdown.
  const [lens, setLens] = useState<string>(PERSONAL_CONSTANT);
  const [constants, setConstants] = useState({
    lensFactor: String(LENS_FACTOR),
    aConstant: String(A_CONSTANT),
  });
  const [lensOptions, setLensOptions] = useState<readonly string[]>(BUNDLED_LENS_OPTIONS);
  // The calculator's own K-index radio. It governs how the site reads the K
  // values, so it is sent with every run and recorded on the PDF.
  const [kIndex, setKIndex] = useState<KIndex>(DEFAULT_K_INDEX);
  const settings: LensSettings = { lens, ...constants };
  // Filled from the photo when the name is legible, and editable either
  // way. It heads the PDF record and is never sent to the calculator.
  const [patientName, setPatientName] = useState("");
  // A day's photos, one patient each. Set by picking several files at once.
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null);
  // Fundus findings for the record's retina block. Pre-filled with the
  // practice's normal-exam wording, but it is the clinician's assertion —
  // nothing here examined a retina.
  const [retina, setRetina] = useState<Record<EyeSide, string>>({
    OD: STRINGS[initialLanguage()].recordRetinaDefault,
    OS: STRINGS[initialLanguage()].recordRetinaDefault,
  });

  const eyeTitles = useMemo<Record<EyeSide, string>>(
    () => ({ OD: t.eyeOd, OS: t.eyeOs }),
    [t],
  );

  /**
   * Picking a lens shows that lens's constants (the calculator will apply
   * its own copies); going back to "Personal Constant" restores this
   * practice's. A lens whose constants aren't stored here blanks the boxes
   * rather than leaving the previous lens's numbers on screen.
   */
  function changeLens(next: string) {
    setLens(next);
    if (isPersonalConstant(next)) {
      setConstants({ lensFactor: String(LENS_FACTOR), aConstant: String(A_CONSTANT) });
      return;
    }
    const known = lensConstants(next);
    setConstants({
      lensFactor: known ? String(known.lensFactor) : "",
      aConstant: known ? String(known.aConstant) : "",
    });
  }

  function changeLanguage(next: Lang) {
    setLang(next);
    rememberLanguage(next);
    // Messages already on screen were composed in the old language and
    // can't be re-rendered; clearing beats leaving a stale mixed page.
    setScanMessage(null);
    setCalcError(null);
  }

  // The site's own dropdown is the authority on lens names; the bundled list
  // is a transcription that stands in when the site can't be reached.
  // Answering costs the backend a browser launch, so the outcome — list or
  // failure — is remembered for the tab rather than retried on every load.
  useEffect(() => {
    let cancelled = false;
    const applyLensOptions = (options: string[]) => {
      setLensOptions(options);
      setLens((current) => (options.includes(current) ? current : (options[0] ?? current)));
    };

    const cached = readCachedLensOptions();
    if (cached) {
      if (cached.length > 0) applyLensOptions(cached);
      return;
    }

    fetchLensOptions()
      .then((options) => {
        if (cancelled || options.length === 0) return;
        sessionStorage.setItem(LENS_CACHE_KEY, JSON.stringify(options));
        applyLensOptions(options);
      })
      .catch(() => {
        if (!cancelled) sessionStorage.setItem(LENS_CACHE_KEY, "[]");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Reads a photo with the server-side vision model, which handles
   * photographed thermal printouts far better than in-browser OCR. If the
   * server has no model configured, falls back to the on-device reader.
   */
  async function readPhoto(blob: Blob): Promise<{
    keratometry: Map<EyeSide, KeratometryReading>;
    biometry: Map<EyeSide, BiometryReading>;
    patientName?: string;
    bestText: string;
    warning?: string;
    usedFallback: boolean;
  }> {
    const keratometry = new Map<EyeSide, KeratometryReading>();
    const biometry = new Map<EyeSide, BiometryReading>();

    try {
      const { base64, mediaType } = await prepareImage(blob);
      const result = await scanPhoto(base64, mediaType);
      for (const k of result.keratometry) {
        keratometry.set(k.side, {
          side: k.side,
          k1: k.k1,
          k2: k.k2,
          cylinder: Number((k.k2 - k.k1).toFixed(2)),
        });
      }
      for (const b of result.biometry) {
        biometry.set(b.side, {
          side: b.side,
          sideSource: "marker",
          axialLength: b.axialLength,
          acd: b.acd,
        });
      }
      return {
        keratometry,
        biometry,
        patientName: result.patientName,
        bestText: "",
        warning: result.warning,
        usedFallback: false,
      };
    } catch (err) {
      if (!(err instanceof ScanUnavailableError)) throw err;
    }

    // On-device fallback: each image treatment reads different parts of a
    // faded printout, so keep the first good reading per eye and stop once
    // all four eye/format combinations are covered. It reads clinical
    // numbers only — the patient's name stays for the clinician to type.
    let bestText = "";
    for await (const text of recognizeVariants(blob)) {
      if (text.trim().length > bestText.trim().length) bestText = text;
      for (const reading of parseTopographyText(text)) {
        if (!keratometry.has(reading.side)) keratometry.set(reading.side, reading);
      }
      for (const reading of parseBiometryText(text)) {
        if (!biometry.has(reading.side)) biometry.set(reading.side, reading);
      }
      if (keratometry.size === 2 && biometry.size === 2) break;
    }
    return { keratometry, biometry, bestText, usedFallback: true };
  }

  async function handleScan(blob: Blob) {
    setScanMessage(null);
    setFailedOcrText(null);
    setPreview(URL.createObjectURL(blob));
    setScanBusy(true);
    try {
      const {
        keratometry,
        biometry,
        patientName: scannedName,
        bestText,
        warning,
        usedFallback,
      } = await readPhoto(blob);

      // Falling back is a much weaker reader, so say so rather than letting
      // a degraded scan look like a normal one.
      const fallbackNote = usedFallback ? t.scanFallbackNote : null;

      if (keratometry.size === 0 && biometry.size === 0) {
        setScanMessage(fallbackNote ? `${fallbackNote} ${t.scanNothing}` : t.scanNothing);
        setFailedOcrText(bestText.trim() || t.scanNothingReadable);
        return;
      }

      setRows((prev) => {
        const next = { ...prev };
        for (const reading of keratometry.values()) {
          next[reading.side] = applyKeratometry(next[reading.side], reading);
        }
        for (const reading of biometry.values()) {
          next[reading.side] = applyBiometry(next[reading.side], reading);
        }
        return next;
      });
      // Never overwrite a name already typed: the clinician's spelling wins
      // over the model's reading of a faint printout.
      if (scannedName) setPatientName((current) => (current.trim() === "" ? scannedName : current));

      const notes: string[] = [];
      if (fallbackNote) notes.push(fallbackNote);
      if (warning) notes.push(warning);
      // Each measurement type is reported separately: a photo can easily
      // catch the whole A-scan strip but clip the keratometry, and the
      // clinician needs to know exactly which fields are still theirs to fill.
      const missingK = (["OD", "OS"] as const).filter((side) => !keratometry.has(side));
      const missingB = (["OD", "OS"] as const).filter((side) => !biometry.has(side));
      if (missingK.length === 2) {
        notes.push(t.scanNoK);
      } else if (missingK.length === 1) {
        notes.push(t.scanOneK(missingK[0] === "OD" ? "OS" : "OD", missingK[0]));
      }
      if (missingB.length === 2) {
        notes.push(t.scanNoBiometry);
      } else if (missingB.length === 1) {
        notes.push(t.scanOneBiometry(missingB[0] === "OD" ? "OS" : "OD", missingB[0]));
      }
      // The printout always lists the right eye first, so print order is
      // reliable for a two-block scan and needs no warning. A lone block
      // with an illegible header is the ambiguous case: it could be either
      // eye, and a swap here would reach a surgical calculation.
      const loneUnlabeledEye =
        biometry.size === 1 && [...biometry.values()][0].sideSource === "order";
      if (loneUnlabeledEye) notes.push(t.scanUnlabeledEye);
      if (!scannedName && !usedFallback) notes.push(t.scanNoName);
      setScanMessage(notes.length > 0 ? notes.join(" ") : null);
      if (notes.length > 0 && bestText.trim()) setFailedOcrText(bestText.trim());
    } catch (err) {
      setScanMessage(
        err instanceof Error ? t.scanFailedSuffix(err.message) : t.scanFailedGeneric,
      );
    } finally {
      setScanBusy(false);
    }
  }

  function updateField(side: EyeSide, field: keyof EyeRowState, value: string) {
    setRows((prev) => ({ ...prev, [side]: { ...prev[side], [field]: value } }));
  }

  function clearEye(side: EyeSide) {
    setRows((prev) => ({ ...prev, [side]: emptyRow(side) }));
  }

  const plan = planCalculation(rows.OD, rows.OS);
  // A named lens brings its own constants, so only a personal-constant run
  // needs the two boxes to hold usable numbers.
  const usingPersonalConstant = isPersonalConstant(lens);
  const constantsProblem = !usingPersonalConstant
    ? null
    : !constantInRange(constants.lensFactor, CONSTANT_RANGES.lensFactor)
      ? t.planBadLensFactor(CONSTANT_RANGES.lensFactor.min, CONSTANT_RANGES.lensFactor.max)
      : !constantInRange(constants.aConstant, CONSTANT_RANGES.aConstant)
        ? t.planBadAConstant(CONSTANT_RANGES.aConstant.min, CONSTANT_RANGES.aConstant.max)
        : null;
  // Names the values an eye is short of, so "left out" is never a mystery.
  const fieldLabels: Record<ReturnType<typeof missingFields>[number], string> = {
    axialLength: t.fieldAxialLength,
    k1: t.fieldK1,
    k2: t.fieldK2,
    acd: t.fieldAcd,
    targetRefraction: t.fieldRefraction,
  };
  const missingFor = (side: EyeSide) =>
    missingFields(rows[side]).map((field) => fieldLabels[field]).join(", ");
  const skippedNotes = plan.skipped.map((side) =>
    t.planSkipped(side === "OD" ? t.eyeOd : t.eyeOs, missingFor(side)),
  );
  const planProblem = !plan.ok
    ? plan.reason === "nothingComplete"
      ? skippedNotes.join(" ")
      : t.planEmpty
    : constantsProblem;
  const canCalculate = plan.ok && constantsProblem === null;

  async function handleCalculate() {
    if (!plan.ok || constantsProblem !== null) return;
    setCalcError(null);
    setResult(null);
    setSubmitted(null);
    setCalculating(true);
    // A named lens is sent with the practice's constants attached but
    // unused: the backend selects the lens and lets the site fill them.
    const sent: LensSettings = usingPersonalConstant
      ? settings
      : { lens, lensFactor: String(LENS_FACTOR), aConstant: String(A_CONSTANT) };
    try {
      const response = await calculateBarrett({
        od: plan.sides.includes("OD") ? toEyeInput(rows.OD, sent) : undefined,
        os: plan.sides.includes("OS") ? toEyeInput(rows.OS, sent) : undefined,
        kIndex,
      });
      setResult(response);
      setSubmitted({ rows, sides: plan.sides, settings: sent, kIndex });
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : t.calcFailed);
    } finally {
      setCalculating(false);
    }
  }

  /**
   * Builds the record from what was actually calculated: the eyes that were
   * sent, and the constants the calculator reported back (for a named lens
   * those are the site's, not ours). Everything happens in the browser —
   * the file is written straight to the clinician's downloads.
   */
  /** The record the download and the copy button both work from. */
  function buildRecord(): MedicalRecordInput | null {
    if (!result || !submitted) return null;
    const usedPersonalConstant = isPersonalConstant(submitted.settings.lens);
    const record: MedicalRecordInput = {
      patientName,
      recordedAt: new Date(),
      lang,
      retina,
      kIndex: result.kIndex ?? submitted.kIndex,
      lens: {
        name: result.lens?.name ?? submitted.settings.lens,
        lensFactor:
          result.lens?.lensFactor ??
          (usedPersonalConstant ? submitted.settings.lensFactor : undefined),
        aConstant:
          result.lens?.aConstant ??
          (usedPersonalConstant ? submitted.settings.aConstant : undefined),
      },
      eyes: submitted.sides.map((side) => ({
        side,
        measurements: submitted.rows[side],
        recommended: side === "OD" ? result.recommended?.od : result.recommended?.os,
        rows: (side === "OD" ? result.tables?.od : result.tables?.os) ?? [],
      })),
    };
    return record;
  }

  function handleDownloadRecord() {
    const record = buildRecord();
    if (record) downloadPdf(buildMedicalRecordPdf(record), medicalRecordFileName(record));
  }

  async function handleCopyRecord(asSource: boolean) {
    const record = buildRecord();
    if (!record) return;
    await (asSource ? copyRecordSource([record]) : copyRecords([record]));
    setRecordCopied(asSource ? "source" : "rich");
    setTimeout(() => setRecordCopied(null), 3000);
  }

  // Kept on screen as well as on the clipboard: some browsers block
  // clipboard writes, and selecting it by hand always works.
  const record = result && submitted ? buildRecord() : null;
  const sourceForCopy = record ? recordsToSource([record]) : "";

  async function handleCopy() {
    const sections: string[] = [];
    if (!isRowEmpty(rows.OD)) {
      sections.push("OD (right eye)", formatRowForClipboard(rows.OD, settings), "");
    }
    if (!isRowEmpty(rows.OS)) sections.push("OS (left eye)", formatRowForClipboard(rows.OS, settings));
    if (sections.length > 0) sections.push("", `${t.kIndexLabel}: ${kIndex}`);
    const text = sections.join("\n").trim() || t.noValuesToCopy;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>{t.title}</h1>
          <div className="lang-switch" role="group" aria-label="Language">
            {LANGUAGES.map((option) => (
              <button
                key={option}
                type="button"
                className={option === lang ? "active" : undefined}
                aria-pressed={option === lang}
                onClick={() => changeLanguage(option)}
              >
                {LANGUAGE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
        <p className="disclaimer">
          {t.disclaimerIntro}
          <strong>{t.disclaimerVerify}</strong>
          {t.disclaimerPhotoBefore}
          <strong>{t.disclaimerPhotoStrong}</strong>
          {t.disclaimerPhotoAfter}
        </p>
      </header>

      <section className="scans">
        <CameraCapture
          t={t}
          onCapture={handleScan}
          onCaptureMany={(files) => {
            setBatchFiles(files);
            setResult(null);
            setSubmitted(null);
            setScanMessage(null);
          }}
          previewUrl={batchFiles ? null : preview}
          busy={scanBusy}
        />
      </section>

      {scanMessage && <p className="scan-message">{scanMessage}</p>}
      {failedOcrText && (
        <details className="raw-details">
          <summary>{t.scanShowRaw}</summary>
          <pre>{failedOcrText}</pre>
        </details>
      )}

      <section className="review">
        <h2>{t.reviewTitle}</h2>
        {!batchFiles && <p className="hint">{t.reviewHint}</p>}
        <div className="lens-row">
          <label className="field lens-field">
            <span>{t.lensLabel}</span>
            <select value={lens} onChange={(e) => changeLens(e.target.value)}>
              {lensOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field constant-field">
            <span>{t.fieldLensFactor}</span>
            <input
              type="number"
              step="0.01"
              value={constants.lensFactor}
              readOnly={!usingPersonalConstant}
              onChange={(e) => setConstants((c) => ({ ...c, lensFactor: e.target.value }))}
            />
          </label>
          <label className="field constant-field">
            <span>{t.fieldAConstant}</span>
            <input
              type="number"
              step="0.01"
              value={constants.aConstant}
              readOnly={!usingPersonalConstant}
              onChange={(e) => setConstants((c) => ({ ...c, aConstant: e.target.value }))}
            />
          </label>
          <div className="field k-index-field">
            <span>{t.kIndexLabel}</span>
            <div className="k-index-options">
              {K_INDEX_OPTIONS.map((option) => (
                <label key={option} className="k-index-option">
                  <input
                    type="radio"
                    name="kIndex"
                    value={option}
                    checked={kIndex === option}
                    onChange={() => setKIndex(option)}
                  />
                  {option}
                </label>
              ))}
            </div>
          </div>
        </div>
        <p className="hint">{t.kIndexHint(DEFAULT_K_INDEX)}</p>
        <p className="fixed-iol-note">
          {usingPersonalConstant
            ? t.lensPersonalNote(IOL_MODEL)
            : lensConstants(lens)
              ? t.lensNamedNote(lens)
              : `${t.lensNamedNote(lens)} ${t.lensConstantsUnknown(lens)}`}
        </p>
        {!batchFiles && (
          <div className="eye-forms">
            <EyeForm
              t={t}
              row={rows.OD}
              title={eyeTitles.OD}
              onChange={updateField}
              onClear={clearEye}
            />
            <EyeForm
              t={t}
              row={rows.OS}
              title={eyeTitles.OS}
              onChange={updateField}
              onClear={clearEye}
            />
          </div>
        )}
      </section>

      {batchFiles && (
        <BatchPanel
          t={t}
          lang={lang}
          files={batchFiles}
          settings={settings}
          kIndex={kIndex}
          onClose={() => setBatchFiles(null)}
        />
      )}

      {!batchFiles && (
      <section className="actions">
        <button type="button" onClick={handleCalculate} disabled={!canCalculate || calculating}>
          {calculating
            ? t.calculating
            : plan.ok && plan.sides.length === 1
              ? t.calculateOne(plan.sides[0])
              : t.calculate}
        </button>
        <button type="button" onClick={handleCopy} className="secondary">
          {copied ? t.copied : t.copyValues}
        </button>
        <a href={CALCULATOR_URL} target="_blank" rel="noopener noreferrer" className="secondary link-btn">
          {t.openCalculator}
        </a>
        {planProblem && <p className="hint">{planProblem}</p>}
        {plan.ok && skippedNotes.length > 0 && (
          <p className="scan-message">{skippedNotes.join(" ")}</p>
        )}
        {calculating && <p className="hint">{t.cloudflareHint}</p>}
      </section>
      )}

      {!batchFiles && calcError && (
        <section className="error-box">
          <p>{calcError}</p>
          <p className="hint">{t.calcErrorHint}</p>
        </section>
      )}

      {!batchFiles && result && (
        <section className="results">
          <h2>{t.resultsTitle}</h2>
          {result.warning && <p className="scan-message">{result.warning}</p>}
          {(result.recommended?.od || result.recommended?.os) && (
            <div className="recommended-row">
              {result.recommended?.od && (
                <div className="recommended-card">
                  <span className="recommended-label">{t.recommendedFor("OD")}</span>
                  <span className="recommended-value">{result.recommended.od} D</span>
                </div>
              )}
              {result.recommended?.os && (
                <div className="recommended-card">
                  <span className="recommended-label">{t.recommendedFor("OS")}</span>
                  <span className="recommended-value">{result.recommended.os} D</span>
                </div>
              )}
            </div>
          )}
          {result.tables ? (
            <>
              <div className="result-tables">
                {result.tables.od.length > 0 && (
                  <EyeResultTable t={t} title={eyeTitles.OD} rows={result.tables.od} />
                )}
                {result.tables.os.length > 0 && (
                  <EyeResultTable t={t} title={eyeTitles.OS} rows={result.tables.os} />
                )}
              </div>
              <details className="raw-details">
                <summary>{t.rawText}</summary>
                <pre>{result.resultsText}</pre>
              </details>
            </>
          ) : (
            <div className="result-card">
              <pre>{result.resultsText}</pre>
            </div>
          )}
          {result.lens && (
            <p className="hint">
              {t.lensUsed(
                result.lens.name,
                [
                  result.lens.lensFactor ? ` — ${t.pdfLensFactor(result.lens.lensFactor)}` : "",
                  result.lens.aConstant ? `, ${t.pdfAConstant(result.lens.aConstant)}` : "",
                ].join(""),
              )}
            </p>
          )}
          {result.kIndex && (
            <p className="hint">
              {t.kIndexLabel}: <strong>{result.kIndex}</strong>
            </p>
          )}
          <p className="hint">{t.verifyAgainst}</p>

          <div className="record-box">
            <h3>{t.recordTitle}</h3>
            <p className="hint">{t.recordHint}</p>
            <label className="field">
              <span>{t.recordName}</span>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder={t.recordNamePlaceholder}
                autoComplete="off"
              />
            </label>
            <div className="retina-fields">
              <span className="retina-title">{t.recordRetinaLabel}</span>
              {(["OD", "OS"] as const).map((side) => (
                <label className="field" key={side}>
                  <span>{side === "OD" ? "OD" : lang === "pt" ? "OE" : "OS"}</span>
                  <input
                    type="text"
                    value={retina[side]}
                    onChange={(e) => setRetina((prev) => ({ ...prev, [side]: e.target.value }))}
                    autoComplete="off"
                  />
                </label>
              ))}
              <p className="hint">{t.recordRetinaHint}</p>
            </div>
            <div className="record-buttons">
              <button type="button" onClick={() => handleCopyRecord(false)}>
                {recordCopied === "rich" ? t.recordCopied : t.recordCopy}
              </button>
              <button type="button" onClick={() => handleCopyRecord(true)}>
                {recordCopied === "source" ? t.recordSourceCopied : t.recordCopySource}
              </button>
              <button type="button" className="secondary" onClick={handleDownloadRecord}>
                {t.recordDownload}
              </button>
            </div>
            <p className="hint">{t.recordSourceHint}</p>
            <details className="raw-details record-source">
              <summary>{t.recordShowSource}</summary>
              <textarea readOnly rows={12} value={sourceForCopy} />
            </details>
          </div>
        </section>
      )}
    </div>
  );
}

interface EyeResultTableProps {
  t: Strings;
  title: string;
  rows: IolTableRow[];
}

function EyeResultTable({ t, title, rows }: EyeResultTableProps) {
  // Highlight the option that lands closest to plano (refraction 0) —
  // normally the middle row of the 7 the calculator returns.
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  rows.forEach((row, i) => {
    const distance = Math.abs(Number.parseFloat(row.refraction));
    if (Number.isFinite(distance) && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  });

  return (
    <div className="result-table-card">
      <h3>{title}</h3>
      <table className="iol-table">
        <thead>
          <tr>
            <th>{t.colPower}</th>
            <th>{t.colOptic}</th>
            <th>{t.colRefraction}</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.power}-${i}`} className={i === bestIndex ? "best-row" : undefined}>
              <td>{row.power}</td>
              <td>{row.optic}</td>
              <td>{row.refraction}</td>
              <td className="best-cell">{i === bestIndex ? t.closestToZero : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface EyeFormProps {
  t: Strings;
  row: EyeRowState;
  title: string;
  onChange: (side: EyeSide, field: keyof EyeRowState, value: string) => void;
  onClear: (side: EyeSide) => void;
}

function EyeForm({ t, row, title, onChange, onClear }: EyeFormProps) {
  const field = (key: keyof EyeRowState, label: string, unit: string) => (
    <label className="field">
      <span>
        {label} {unit && `(${unit})`}
      </span>
      <input
        type="number"
        step="0.01"
        value={row[key]}
        onChange={(e) => onChange(row.side, key, e.target.value)}
      />
    </label>
  );

  return (
    <fieldset className="eye-form">
      <legend>{title}</legend>
      <button
        type="button"
        className="clear-eye"
        onClick={() => onClear(row.side)}
        disabled={isRowEmpty(row)}
      >
        {t.clearEye(row.side)}
      </button>
      <div className="field-group">
        {field("axialLength", t.fieldAxialLength, "mm")}
        {field("k1", t.fieldK1, "D")}
        {field("k2", t.fieldK2, "D")}
        {field("acd", t.fieldAcd, "mm")}
        {field("targetRefraction", t.fieldRefraction, "D")}
      </div>
      {/* Laid out as the official calculator does: the two values it treats
          as optional sit in their own block below the measurements. */}
      <div className="field-group optional-group">
        <p className="group-title">{t.optionalHeading}</p>
        {field("lensThickness", t.fieldLensThickness, "mm")}
        {field("wtw", t.fieldWtw, "mm")}
      </div>
    </fieldset>
  );
}

export default App;
