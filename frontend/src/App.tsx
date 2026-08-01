import { useState } from "react";
import "./App.css";
import { CameraCapture } from "./components/CameraCapture";
import { calculateBarrett, type CalculateResponse } from "./lib/api";
import {
  applyBiometry,
  applyKeratometry,
  emptyRow,
  formatRowForClipboard,
  isRowComplete,
  toEyeInput,
  type EyeRowState,
} from "./lib/eyeRow";
import { A_CONSTANT, IOL_MODEL, LENS_FACTOR } from "./lib/constants";
import { parseBiometryText } from "./lib/parseBiometry";
import { parseTopographyText } from "./lib/parseTopography";
import { recognizeText } from "./lib/ocr";
import type { EyeSide } from "./lib/types";

const CALCULATOR_URL = "https://calc.apacrs.org/barrett_universal2105/";

type ScanKind = "topography" | "biometry";

function App() {
  const [rows, setRows] = useState<Record<EyeSide, EyeRowState>>({
    OD: emptyRow("OD"),
    OS: emptyRow("OS"),
  });
  const [previews, setPreviews] = useState<Record<ScanKind, string | null>>({
    topography: null,
    biometry: null,
  });
  const [ocrBusy, setOcrBusy] = useState<Record<ScanKind, boolean>>({
    topography: false,
    biometry: false,
  });
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<CalculateResponse | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleScan(kind: ScanKind, blob: Blob) {
    setScanMessage(null);
    setPreviews((prev) => ({ ...prev, [kind]: URL.createObjectURL(blob) }));
    setOcrBusy((prev) => ({ ...prev, [kind]: true }));
    try {
      const text = await recognizeText(blob);
      if (kind === "topography") {
        const readings = parseTopographyText(text);
        if (readings.length === 0) {
          setScanMessage("Couldn't find K readings in that photo. Check focus/lighting, or enter the values by hand below.");
        } else {
          setRows((prev) => {
            const next = { ...prev };
            for (const reading of readings) next[reading.side] = applyKeratometry(next[reading.side], reading);
            return next;
          });
        }
      } else {
        const readings = parseBiometryText(text);
        if (readings.length === 0) {
          setScanMessage("Couldn't find AL/ACD readings in that photo. Check focus/lighting, or enter the values by hand below.");
        } else {
          setRows((prev) => {
            const next = { ...prev };
            for (const reading of readings) next[reading.side] = applyBiometry(next[reading.side], reading);
            return next;
          });
        }
      }
    } catch {
      setScanMessage("OCR failed on that photo. You can retake it or enter values by hand below.");
    } finally {
      setOcrBusy((prev) => ({ ...prev, [kind]: false }));
    }
  }

  function updateField(side: EyeSide, field: keyof EyeRowState, value: string) {
    setRows((prev) => ({ ...prev, [side]: { ...prev[side], [field]: value } }));
  }

  const bothComplete = isRowComplete(rows.OD) && isRowComplete(rows.OS);

  async function handleCalculate() {
    setCalcError(null);
    setResult(null);
    setCalculating(true);
    try {
      const response = await calculateBarrett({ od: toEyeInput(rows.OD), os: toEyeInput(rows.OS) });
      setResult(response);
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : "Calculation failed.");
    } finally {
      setCalculating(false);
    }
  }

  async function handleCopy() {
    const text = ["OD (right eye)", formatRowForClipboard(rows.OD), "", "OS (left eye)", formatRowForClipboard(rows.OS)].join("\n");
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
          especially anything read by OCR — and confirm the final IOL power on the official calculator
          before using it in surgical planning.</strong> Patient-identifying information (name, ID, date of
          birth, etc.) is never read, stored, or transmitted by this app — only the numeric clinical values
          you confirm below.
        </p>
      </header>

      <section className="scans">
        <CameraCapture
          label="1. Corneal topography / K readings"
          hint="Photograph the keratometer strip showing <R>/<L> Sim K's readings."
          onCapture={(blob) => handleScan("topography", blob)}
          previewUrl={previews.topography}
          busy={ocrBusy.topography}
        />
        <CameraCapture
          label="2. Biometry (AL / ACD)"
          hint="Photograph the A-scan printout showing AVGAXL, ACD, LENS, VITR."
          onCapture={(blob) => handleScan("biometry", blob)}
          previewUrl={previews.biometry}
          busy={ocrBusy.biometry}
        />
      </section>

      {scanMessage && <p className="scan-message">{scanMessage}</p>}

      <section className="review">
        <h2>3. Review &amp; complete</h2>
        <p className="hint">
          Fields marked <span className="ocr-badge">OCR</span> were read from your photos — double-check
          them. The printout doesn't label which K is which, so K1 is always the lower of the two values
          (swapped automatically if entered the other way round). Refraction target defaults to 0
          (emmetropia) — change it only when the plan differs.
        </p>
        <p className="fixed-iol-note">
          IOL: <strong>{IOL_MODEL}</strong> · A-Constant <strong>{A_CONSTANT}</strong> · Lens Factor{" "}
          <strong>{LENS_FACTOR}</strong> — fixed for this practice, sent with every calculation.
        </p>
        <div className="eye-forms">
          <EyeForm row={rows.OD} title="OD (right eye)" onChange={updateField} />
          <EyeForm row={rows.OS} title="OS (left eye)" onChange={updateField} />
        </div>
      </section>

      <section className="actions">
        <button type="button" onClick={handleCalculate} disabled={!bothComplete || calculating}>
          {calculating ? "Calculating…" : "Calculate with Barrett Universal II"}
        </button>
        <button type="button" onClick={handleCopy} className="secondary">
          {copied ? "Copied!" : "Copy values"}
        </button>
        <a href={CALCULATOR_URL} target="_blank" rel="noopener noreferrer" className="secondary link-btn">
          Open calculator manually
        </a>
        {!bothComplete && <p className="hint">Fill in every field for both eyes to enable calculation.</p>}
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
              <div className="recommended-card">
                <span className="recommended-label">OD — Recommended IOL</span>
                <span className="recommended-value">{result.recommended?.od ?? "—"} D</span>
              </div>
              <div className="recommended-card">
                <span className="recommended-label">OS — Recommended IOL</span>
                <span className="recommended-value">{result.recommended?.os ?? "—"} D</span>
              </div>
            </div>
          )}
          <div className="result-card">
            <pre>{result.resultsText}</pre>
          </div>
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

interface EyeFormProps {
  row: EyeRowState;
  title: string;
  onChange: (side: EyeSide, field: keyof EyeRowState, value: string) => void;
}

function EyeForm({ row, title, onChange }: EyeFormProps) {
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
      {field("axialLength", "Axial Length", "mm", true)}
      {field("k1", "Measured K1", "D", true)}
      {field("k2", "Measured K2", "D", true)}
      {field("acd", "Optical ACD", "mm", true)}
      {field("lensThickness", "Lens Thickness (optional)", "mm", true)}
      {field("targetRefraction", "Refraction (target)", "D", false)}
    </fieldset>
  );
}

export default App;
