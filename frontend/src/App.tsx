import { useState } from "react";
import "./App.css";
import { CameraCapture } from "./components/CameraCapture";
import {
  calculateBarrett,
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
  planCalculation,
  toEyeInput,
  type EyeRowState,
} from "./lib/eyeRow";
import { A_CONSTANT, IOL_MODEL, LENS_FACTOR } from "./lib/constants";
import { parseBiometryText } from "./lib/parseBiometry";
import { parseTopographyText } from "./lib/parseTopography";
import { recognizeVariants } from "./lib/ocr";
import type { BiometryReading, EyeSide, KeratometryReading } from "./lib/types";

const CALCULATOR_URL = "https://calc.apacrs.org/barrett_universal2105/";

function App() {
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
  const [calcError, setCalcError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Reads a photo with the server-side vision model, which handles
   * photographed thermal printouts far better than in-browser OCR. If the
   * server has no model configured, falls back to the on-device reader.
   */
  async function readPhoto(blob: Blob): Promise<{
    keratometry: Map<EyeSide, KeratometryReading>;
    biometry: Map<EyeSide, BiometryReading>;
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
      return { keratometry, biometry, bestText: "", warning: result.warning, usedFallback: false };
    } catch (err) {
      if (!(err instanceof ScanUnavailableError)) throw err;
    }

    // On-device fallback: each image treatment reads different parts of a
    // faded printout, so keep the first good reading per eye and stop once
    // all four eye/format combinations are covered.
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
      const { keratometry, biometry, bestText, warning, usedFallback } = await readPhoto(blob);

      // Falling back is a much weaker reader, so say so rather than letting
      // a degraded scan look like a normal one.
      const fallbackNote = usedFallback
        ? "Read on this device — the server has no vision model configured (ANTHROPIC_API_KEY), so accuracy is much lower. Check every value."
        : null;

      if (keratometry.size === 0 && biometry.size === 0) {
        const advice =
          "Couldn't read any values from that photo. Make sure the printouts are flat, well-lit, and large enough in the frame that the digits are legible — then retake, or type the values in below.";
        setScanMessage(fallbackNote ? `${fallbackNote} ${advice}` : advice);
        setFailedOcrText(bestText.trim() || "(nothing readable)");
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

      const notes: string[] = [];
      if (fallbackNote) notes.push(fallbackNote);
      if (warning) notes.push(warning);
      // Each measurement type is reported separately: a photo can easily
      // catch the whole A-scan strip but clip the keratometry, and the
      // clinician needs to know exactly which fields are still theirs to fill.
      const missingK = (["OD", "OS"] as const).filter((side) => !keratometry.has(side));
      const missingB = (["OD", "OS"] as const).filter((side) => !biometry.has(side));
      if (missingK.length === 2) {
        notes.push("No K values were found — enter K1/K2 for both eyes by hand.");
      } else if (missingK.length === 1) {
        notes.push(`K values were only read for ${missingK[0] === "OD" ? "OS" : "OD"} — enter ${missingK[0]}'s by hand.`);
      }
      if (missingB.length === 2) {
        notes.push("No axial length / ACD values were found — enter them by hand.");
      } else if (missingB.length === 1) {
        notes.push(
          `Axial length / ACD were only read for ${missingB[0] === "OD" ? "OS" : "OD"} — enter ${missingB[0]}'s by hand.`,
        );
      }
      // The printout always lists the right eye first, so print order is
      // reliable for a two-block scan and needs no warning. A lone block
      // with an illegible header is the ambiguous case: it could be either
      // eye, and a swap here would reach a surgical calculation.
      const loneUnlabeledEye =
        biometry.size === 1 && [...biometry.values()][0].sideSource === "order";
      if (loneUnlabeledEye) {
        notes.push(
          "Only one eye was on this scan and its OD/OS label wasn't legible, so it was filed as OD. Check the printout's \"Sex:… OD/OS …\" line and move the values if it's the left eye.",
        );
      }
      setScanMessage(notes.length > 0 ? notes.join(" ") : null);
      if (notes.length > 0 && bestText.trim()) setFailedOcrText(bestText.trim());
    } catch (err) {
      setScanMessage(
        err instanceof Error
          ? `${err.message} You can retake the photo or type the values in below.`
          : "Scanning failed on that photo. You can retake it or type the values in below.",
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

  async function handleCalculate() {
    if (!plan.ok) return;
    setCalcError(null);
    setResult(null);
    setCalculating(true);
    try {
      const response = await calculateBarrett({
        od: plan.sides.includes("OD") ? toEyeInput(rows.OD) : undefined,
        os: plan.sides.includes("OS") ? toEyeInput(rows.OS) : undefined,
      });
      setResult(response);
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : "Calculation failed.");
    } finally {
      setCalculating(false);
    }
  }

  async function handleCopy() {
    const sections: string[] = [];
    if (!isRowEmpty(rows.OD)) sections.push("OD (right eye)", formatRowForClipboard(rows.OD), "");
    if (!isRowEmpty(rows.OS)) sections.push("OS (left eye)", formatRowForClipboard(rows.OS));
    const text = sections.join("\n").trim() || "No values entered yet.";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="app">
      <header>
        <h1>IOL Power Calculator Assistant</h1>
        <p className="disclaimer">
          This tool only helps enter scanned biometry/topography values into the Barrett Universal II
          calculator faster. It does not replace clinical judgment. <strong>Always verify every value —
          especially anything read from a photo — and confirm the final IOL power on the official
          calculator before using it in surgical planning.</strong> Photos are read by a vision model,
          which means <strong>the image is sent off this machine</strong> — frame the shot on the
          measurement block, not the patient's details. Nothing is stored or logged.
        </p>
      </header>

      <section className="scans">
        <CameraCapture
          label="1. Photograph the exam printouts"
          hint="One photo of the keratometry strip and the A-scan printout together — or either one on its own. Keep the paper flat and well-lit, and leave the patient's name and ID out of the frame."
          onCapture={handleScan}
          previewUrl={preview}
          busy={scanBusy}
        />
      </section>

      {scanMessage && <p className="scan-message">{scanMessage}</p>}
      {failedOcrText && (
        <details className="raw-details">
          <summary>Show what the scanner could read</summary>
          <pre>{failedOcrText}</pre>
        </details>
      )}

      <section className="review">
        <h2>3. Review &amp; complete</h2>
        <p className="hint">
          Fields marked <span className="ocr-badge">OCR</span> were read from your photos — double-check
          them. The printout doesn't label which K is which, so K1 is always the lower of the two values
          (swapped automatically if entered the other way round). Refraction target defaults to 0
          (emmetropia) — change it only when the plan differs. To calculate a single eye, fill in only
          that eye — use "Clear" to empty the other one.
        </p>
        <p className="fixed-iol-note">
          IOL: <strong>{IOL_MODEL}</strong> · A-Constant <strong>{A_CONSTANT}</strong> · Lens Factor{" "}
          <strong>{LENS_FACTOR}</strong> — fixed for this practice, sent with every calculation.
        </p>
        <div className="eye-forms">
          <EyeForm row={rows.OD} title="OD (right eye)" onChange={updateField} onClear={clearEye} />
          <EyeForm row={rows.OS} title="OS (left eye)" onChange={updateField} onClear={clearEye} />
        </div>
      </section>

      <section className="actions">
        <button type="button" onClick={handleCalculate} disabled={!plan.ok || calculating}>
          {calculating
            ? "Calculating…"
            : plan.ok && plan.sides.length === 1
              ? `Calculate ${plan.sides[0]} with Barrett Universal II`
              : "Calculate with Barrett Universal II"}
        </button>
        <button type="button" onClick={handleCopy} className="secondary">
          {copied ? "Copied!" : "Copy values"}
        </button>
        <a href={CALCULATOR_URL} target="_blank" rel="noopener noreferrer" className="secondary link-btn">
          Open calculator manually
        </a>
        {!plan.ok && <p className="hint">{plan.reason}</p>}
        {calculating && (
          <p className="hint">
            Usually nothing else is needed. If the calculator site asks for a security check, a
            browser window opens on the computer running the backend — click "Verify you are human"
            there and the calculation continues automatically.
          </p>
        )}
      </section>

      {calcError && (
        <section className="error-box">
          <p>{calcError}</p>
          <p className="hint">
            The automated calculator may be unreachable, or its form may have changed. Use "Copy values" and
            "Open calculator manually" above to enter them yourself.
          </p>
        </section>
      )}

      {result && (
        <section className="results">
          <h2>Results</h2>
          {result.warning && <p className="scan-message">{result.warning}</p>}
          {(result.recommended?.od || result.recommended?.os) && (
            <div className="recommended-row">
              {result.recommended?.od && (
                <div className="recommended-card">
                  <span className="recommended-label">OD — Recommended IOL</span>
                  <span className="recommended-value">{result.recommended.od} D</span>
                </div>
              )}
              {result.recommended?.os && (
                <div className="recommended-card">
                  <span className="recommended-label">OS — Recommended IOL</span>
                  <span className="recommended-value">{result.recommended.os} D</span>
                </div>
              )}
            </div>
          )}
          {result.tables ? (
            <>
              <div className="result-tables">
                {result.tables.od.length > 0 && (
                  <EyeResultTable title="OD (right eye)" rows={result.tables.od} />
                )}
                {result.tables.os.length > 0 && (
                  <EyeResultTable title="OS (left eye)" rows={result.tables.os} />
                )}
              </div>
              <details className="raw-details">
                <summary>Raw calculator text</summary>
                <pre>{result.resultsText}</pre>
              </details>
            </>
          ) : (
            <div className="result-card">
              <pre>{result.resultsText}</pre>
            </div>
          )}
          <p className="hint">
            Verify these figures against{" "}
            <a href={CALCULATOR_URL} target="_blank" rel="noopener noreferrer">
              calc.apacrs.org
            </a>{" "}
            before using them clinically.
          </p>
        </section>
      )}
    </div>
  );
}

interface EyeResultTableProps {
  title: string;
  rows: IolTableRow[];
}

function EyeResultTable({ title, rows }: EyeResultTableProps) {
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
            <th>IOL Power</th>
            <th>Optic</th>
            <th>Refraction</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.power}-${i}`} className={i === bestIndex ? "best-row" : undefined}>
              <td>{row.power}</td>
              <td>{row.optic}</td>
              <td>{row.refraction}</td>
              <td className="best-cell">{i === bestIndex ? "closest to 0" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface EyeFormProps {
  row: EyeRowState;
  title: string;
  onChange: (side: EyeSide, field: keyof EyeRowState, value: string) => void;
  onClear: (side: EyeSide) => void;
}

function EyeForm({ row, title, onChange, onClear }: EyeFormProps) {
  const field = (key: keyof EyeRowState, label: string, unit: string, ocr: boolean) => (
    <label className="field">
      <span>
        {label} {unit && `(${unit})`} {ocr && <span className="ocr-badge">OCR</span>}
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
        Clear {row.side}
      </button>
      {field("axialLength", "Axial Length", "mm", true)}
      {field("k1", "Measured K1", "D", true)}
      {field("k2", "Measured K2", "D", true)}
      {field("acd", "Optical ACD", "mm", true)}
      {field("lensThickness", "Lens Thickness (optional)", "mm", false)}
      {field("targetRefraction", "Refraction (target)", "D", false)}
    </fieldset>
  );
}

export default App;
