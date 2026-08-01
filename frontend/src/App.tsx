import { useState } from "react";
import "./App.css";
import { CameraCapture } from "./components/CameraCapture";
import { calculateBarrett, type CalculateResponse, type IolTableRow } from "./lib/api";
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
  const [failedOcrText, setFailedOcrText] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<CalculateResponse | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleScan(kind: ScanKind, blob: Blob) {
    setScanMessage(null);
    setFailedOcrText(null);
    setPreviews((prev) => ({ ...prev, [kind]: URL.createObjectURL(blob) }));
    setOcrBusy((prev) => ({ ...prev, [kind]: true }));
    try {
      // Each image treatment reads different parts of a faded printout, so
      // keep the first good reading found for each eye and stop once both
      // eyes are covered.
      const keratometry = new Map<EyeSide, KeratometryReading>();
      const biometry = new Map<EyeSide, BiometryReading>();
      let bestText = "";

      for await (const text of recognizeVariants(blob)) {
        if (text.trim().length > bestText.trim().length) bestText = text;

        if (kind === "topography") {
          for (const reading of parseTopographyText(text)) {
            if (!keratometry.has(reading.side)) keratometry.set(reading.side, reading);
          }
          if (keratometry.size === 2) break;
        } else {
          for (const reading of parseBiometryText(text)) {
            if (!biometry.has(reading.side)) biometry.set(reading.side, reading);
          }
          if (biometry.size === 2) break;
        }
      }

      const found = kind === "topography" ? keratometry : biometry;
      if (found.size === 0) {
        setScanMessage(
          kind === "topography"
            ? "Couldn't read the K values from that photo. Move closer so the numbers fill the frame, hold the paper flat and well-lit, then retake — or type the values in below."
            : "Couldn't read the AL/ACD values from that photo. Move closer so the printout fills the frame, hold it flat and well-lit, then retake — or type the values in below.",
        );
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

      const missing = (["OD", "OS"] as const).filter((side) => !found.has(side));
      const notes: string[] = [];
      if (missing.length === 1) {
        const readSide = [...found.keys()][0];
        notes.push(`Only ${readSide} could be read — enter ${missing[0]} by hand.`);
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
      if (notes.length > 0) setFailedOcrText(bestText.trim());
    } catch {
      setScanMessage("Scanning failed on that photo. You can retake it or type the values in below.");
    } finally {
      setOcrBusy((prev) => ({ ...prev, [kind]: false }));
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
          especially anything read by OCR — and confirm the final IOL power on the official calculator
          before using it in surgical planning.</strong> Patient-identifying information (name, ID, date of
          birth, etc.) is never read, stored, or transmitted by this app — only the numeric clinical values
          you confirm below.
        </p>
      </header>

      <section className="scans">
        <CameraCapture
          label="1. Corneal topography / K readings"
          hint="Photograph the printed Sim K's strip (or printed K1/K2 values) so the numbers fill the frame — close, flat, well-lit. Handwriting usually can't be read."
          onCapture={(blob) => handleScan("topography", blob)}
          previewUrl={previews.topography}
          busy={ocrBusy.topography}
        />
        <CameraCapture
          label="2. Biometry (AL / ACD)"
          hint="Photograph the A-scan printout (AVGAXL, ACD, LENS, VITR) so it fills the frame — close, flat, well-lit."
          onCapture={(blob) => handleScan("biometry", blob)}
          previewUrl={previews.biometry}
          busy={ocrBusy.biometry}
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
      {field("lensThickness", "Lens Thickness (optional)", "mm", true)}
      {field("targetRefraction", "Refraction (target)", "D", false)}
    </fieldset>
  );
}

export default App;
