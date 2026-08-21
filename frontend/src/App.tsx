import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { BatchPanel } from "./components/BatchPanel";
import { CameraCapture } from "./components/CameraCapture";
import { ChallengeOverlay } from "./components/ChallengeOverlay";
import {
  calculateBarrett,
  collectHandoff,
  convertConstant,
  fetchLensOptions,
  parkHandoff,
  scanPhoto,
  ScanUnavailableError,
  type CalculateResponse,
  type IolTableRow,
} from "./lib/api";
import {
  fromPortableBatch,
  hasWorkToHandOff,
  isPortableBatch,
  itemsFromPatients,
  singlePatientItem,
  toPortableBatch,
  type BatchItem,
} from "./lib/batch";
import { readPatientList } from "./lib/patientList";
import { parseDelimited, readSpreadsheet } from "./lib/xlsx";
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
  CONSTANT_LOOKUP_DELAY_MS,
  CONSTANT_RANGES,
  constantInRange,
  partnerOf,
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
  // Asking the calculator what one constant makes the other, without doing
  // it on every keystroke, and without an old answer landing after a new one.
  const [constantsBusy, setConstantsBusy] = useState(false);
  const conversionTimer = useRef<number | undefined>(undefined);
  const conversionToken = useRef(0);
  // Which constant the clinician actually set; the site derives the other.
  // Starts on the A Constant, because that is the value this practice thinks
  // in — and with a consistent starting pair either choice lands in the same
  // place, so this only decides which number is literally typed.
  const [constantSource, setConstantSource] = useState<"lensFactor" | "aConstant">("aConstant");
  const settings: LensSettings = { lens, ...constants, constantSource };
  // Filled from the photo when the name is legible, and editable either
  // way. It heads the PDF record and is never sent to the calculator.
  const [patientName, setPatientName] = useState("");
  // A day's photos, one patient each. Set by picking several files at once.
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null);
  // A day's work picked up from another device, by code.
  const [handoffCode, setHandoffCode] = useState("");
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [restoredBatch, setRestoredBatch] = useState<BatchItem[] | null>(null);
  const [restoredSettings, setRestoredSettings] = useState<LensSettings | null>(null);
  const [restoredKIndex, setRestoredKIndex] = useState<string | null>(null);
  const [sentHandoff, setSentHandoff] = useState<{ code: string; expiresAt: number } | null>(null);
  // Importing the clinic's cataract list (one patient per pair of rows).
  const [listBusy, setListBusy] = useState(false);
  const [listMessage, setListMessage] = useState<string | null>(null);

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
    setConstantSource("aConstant");
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

  /**
   * Editing one constant asks the calculator what the other becomes.
   *
   * The two boxes are one value in two units, and the conversion belongs to
   * the site. Computing it here from a line fitted through the published
   * lens table was close in the middle of the range and wrong at the edges,
   * so the form showed a Lens Factor the calculator would never produce —
   * which is worse than showing nothing, because it looks authoritative.
   *
   * So the partner is left blank until the site answers, and what appears is
   * the site's own number. The edited box is remembered too: only that one
   * is typed in when the calculation runs.
   */
  function editConstant(field: "lensFactor" | "aConstant", value: string) {
    setConstantSource(field);
    setConstants((current) => ({ ...current, [field]: value, [partnerOf(field)]: "" }));

    const parsed = Number(value);
    const range = CONSTANT_RANGES[field];
    if (value.trim() === "" || !Number.isFinite(parsed) || !constantInRange(value, range)) {
      setConstantsBusy(false);
      return;
    }

    // Debounced: someone typing "119.5" passes through 1, 11, 119… and none
    // of those deserve a page load on someone else's site.
    setConstantsBusy(true);
    const token = ++conversionToken.current;
    window.clearTimeout(conversionTimer.current);
    conversionTimer.current = window.setTimeout(() => {
      void convertConstant(
        field === "aConstant" ? { aConstant: parsed } : { lensFactor: parsed },
      )
        .then((pair) => {
          // A slower answer to an older keystroke must not overwrite a newer one.
          if (token !== conversionToken.current) return;
          const partner = pair[partnerOf(field)];
          if (partner !== undefined) {
            setConstants((current) => ({ ...current, [partnerOf(field)]: partner }));
          }
        })
        .catch(() => {
          // Left blank on purpose: the calculator will fill it in itself,
          // and a guess here is what caused the problem in the first place.
        })
        .finally(() => {
          if (token === conversionToken.current) setConstantsBusy(false);
        });
    }, CONSTANT_LOOKUP_DELAY_MS);
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
   * Corrects the pre-filled pair to whatever the calculator says.
   *
   * The form starts on this practice's A Constant with a Lens Factor beside
   * it, and that partner is only ever as good as whoever wrote it down. One
   * cached question at startup replaces it with the site's own number, so
   * even an untouched form never shows a value the calculator disagrees
   * with. Silent when the site can't be reached: the calculation types the A
   * Constant and lets the site derive the partner anyway, so nothing is
   * riding on the number displayed.
   */
  useEffect(() => {
    let cancelled = false;
    convertConstant({ aConstant: A_CONSTANT })
      .then((pair) => {
        if (cancelled || pair.lensFactor === undefined) return;
        setConstants((current) =>
          current.aConstant === String(A_CONSTANT) && current.lensFactor !== pair.lensFactor
            ? { ...current, lensFactor: pair.lensFactor! }
            : current,
        );
      })
      .catch(() => {});
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
    // The parked copy is a snapshot of the moment it was sent. Once a value
    // changes, leaving its code on screen would invite handing over numbers
    // the clinician has already corrected.
    setSentHandoff(null);
  }

  function clearEye(side: EyeSide) {
    setRows((prev) => ({ ...prev, [side]: emptyRow(side) }));
    setSentHandoff(null);
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
  // An eye whose K1 is above K2 is held back like a half-filled one, but
  // says so in its own words: those values are present and wrong.
  const suspectNotes = plan.suspect.map((side) =>
    t.kOrderWarning(side === "OD" ? t.eyeOd : t.eyeOs, rows[side].k1, rows[side].k2),
  );
  const planProblem = !plan.ok
    ? plan.reason === "nothingComplete"
      ? [...suspectNotes, ...skippedNotes].join(" ")
      : t.planEmpty
    : constantsProblem;
  const canCalculate = plan.ok && constantsProblem === null;

  /**
   * Collects a day's work parked by the other device.
   *
   * What arrives is rows and results, never the photographs — so this opens
   * the batch view with everything already reviewed, ready to calculate or to
   * copy records from. The code works once; the work now lives in this tab.
   */
  async function openHandoff() {
    setHandoffBusy(true);
    setHandoffError(null);
    try {
      const payload = await collectHandoff(handoffCode);
      if (!isPortableBatch(payload)) {
        setHandoffError(t.handoffUnreadable);
        return;
      }
      setRestoredBatch(fromPortableBatch(payload));
      setRestoredSettings(payload.settings);
      setRestoredKIndex(payload.kIndex);
      setBatchFiles(null);
      setHandoffCode("");
    } catch (err) {
      setHandoffError(err instanceof Error ? err.message : t.handoffFailed);
    } finally {
      setHandoffBusy(false);
    }
  }

  /**
   * Reads the clinic's cataract list into the batch view.
   *
   * Nothing is calculated here: the list becomes the same editable rows a
   * day's photographs would, and the clinician reviews them first. An eye
   * the list didn't have all four measurements for is discarded rather than
   * half-imported, and the row says which and why.
   */
  async function importList(file: File) {
    setListBusy(true);
    setListMessage(null);
    try {
      const grid = /\.xlsx$/i.test(file.name)
        ? await readSpreadsheet(file)
        : parseDelimited(await file.text());
      const list = readPatientList(grid);
      if (list.patients.length === 0) {
        setListMessage(t.listNoPatients);
        return;
      }

      setRestoredBatch(
        itemsFromPatients(list.patients, (problem) =>
          problem.kind === "incomplete"
            ? t.listDiscardedEye(problem.side, problem.missing.join(", "))
            : t.listSuspectEye(problem.side, problem.k1, problem.k2),
        ),
      );
      setBatchFiles(null);
      setResult(null);
      setSubmitted(null);
      setListMessage(
        [
          t.listImported(list.patients.length),
          list.suspectEyes > 0 ? t.listSuspectCount(list.suspectEyes) : null,
          list.discardedEyes > 0 ? t.listDiscardedCount(list.discardedEyes) : null,
          list.withoutUsableEye.length > 0
            ? t.listNothingUsable(list.withoutUsableEye.join(", "))
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (err) {
      setListMessage(err instanceof Error ? err.message : t.listFailed);
    } finally {
      setListBusy(false);
    }
  }

  /**
   * Hands this one patient to the other machine — the commonest case of all,
   * since a single exam is photographed on the phone and typed on the
   * hospital PC. It travels as a batch of one and arrives as a single row,
   * carrying the result if there already is one.
   */
  async function sendHandoff() {
    setHandoffError(null);
    try {
      const item = singlePatientItem({
        patientName,
        rows,
        result: result ?? undefined,
        submitted: submitted ?? undefined,
      });
      setSentHandoff(await parkHandoff(toPortableBatch([item], settings, kIndex)));
    } catch (err) {
      setHandoffError(err instanceof Error ? err.message : t.handoffFailed);
    }
  }

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

        {/* The clinic's cataract list, read as a day's work: one patient per
            pair of rows, exactly what one photograph used to be. */}
        {!batchFiles && !restoredBatch && (
          <div className="list-import">
            <label htmlFor="list-file">{t.listImportLabel}</label>
            <input
              id="list-file"
              type="file"
              accept=".xlsx,.csv,.tsv,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importList(file);
              }}
            />
            {listBusy && <p className="hint">{t.listImporting}</p>}
            {listMessage && <p className="scan-message">{listMessage}</p>}
          </div>
        )}

        {/* Picking a day's work up on the other machine. The phone and the
            hospital PC can't reach each other, so the work travels by a code
            typed here. */}
        {!batchFiles && !restoredBatch && (
          <div className="handoff-open">
            <label htmlFor="handoff-code">{t.handoffOpenLabel}</label>
            <div className="handoff-open-row">
              <input
                id="handoff-code"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder={t.handoffCodePlaceholder}
                value={handoffCode}
                onChange={(event) => setHandoffCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void openHandoff();
                }}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => void openHandoff()}
                disabled={handoffBusy || handoffCode.trim() === ""}
              >
                {handoffBusy ? t.handoffOpening : t.handoffOpen}
              </button>
            </div>
            {handoffError && <p className="scan-message">{handoffError}</p>}
          </div>
        )}
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
              onChange={(e) => editConstant("lensFactor", e.target.value)}
            />
          </label>
          <label className="field constant-field">
            <span>{t.fieldAConstant}</span>
            <input
              type="number"
              step="0.01"
              value={constants.aConstant}
              readOnly={!usingPersonalConstant}
              onChange={(e) => editConstant("aConstant", e.target.value)}
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
        {constantsBusy && <p className="hint">{t.constantsAsking}</p>}
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

      {(batchFiles || restoredBatch) && (
        <BatchPanel
          // Remounts when a handoff arrives, so the panel starts from those
          // rows rather than merging them into whatever was on screen.
          key={restoredBatch ? "handoff" : "files"}
          t={t}
          lang={lang}
          files={batchFiles}
          restored={restoredBatch ?? undefined}
          settings={restoredSettings ?? settings}
          kIndex={restoredKIndex ?? kIndex}
          onClose={() => {
            setBatchFiles(null);
            setRestoredBatch(null);
          }}
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
        <button
          type="button"
          className="secondary"
          onClick={() => void sendHandoff()}
          disabled={!hasWorkToHandOff(rows)}
        >
          {t.handoffSend}
        </button>
        {planProblem && <p className="hint">{planProblem}</p>}
        {plan.ok && suspectNotes.length > 0 && (
          <p className="warning-box">{suspectNotes.join(" ")}</p>
        )}
        {plan.ok && skippedNotes.length > 0 && (
          <p className="scan-message">{skippedNotes.join(" ")}</p>
        )}
        {calculating && <p className="hint">{t.cloudflareHint}</p>}
        {sentHandoff && (
          <div className="handoff-code-box">
            <p className="hint">{t.handoffCodeHint(1)}</p>
            <p className="handoff-code">{sentHandoff.code}</p>
            <p className="hint">
              {t.handoffCodeExpiry(new Date(sentHandoff.expiresAt).toLocaleTimeString())}
            </p>
          </div>
        )}
      </section>
      )}

      {!batchFiles && <ChallengeOverlay t={t} active={calculating} />}

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
