import { useEffect, useRef, useState } from "react";
import { ChallengeOverlay } from "./ChallengeOverlay";
import {
  calculateBarrett,
  scanPhoto,
  ScanUnavailableError,
  type CalculateResponse,
} from "../lib/api";
import {
  CALCULATE_CONCURRENCY,
  countBatch,
  createBatchItems,
  isItemCalculable,
  isStale,
  itemSides,
  partialSides,
  runWithConcurrency,
  SCAN_CONCURRENCY,
  type BatchItem,
} from "../lib/batch";
import {
  applyBiometry,
  applyKeratometry,
  missingFields,
  toEyeInput,
  type EyeRowState,
  type LensSettings,
} from "../lib/eyeRow";
import type { Lang, Strings } from "../lib/i18n";
import { prepareImage } from "../lib/imagePrep";
import { isPersonalConstant } from "../lib/lenses";
import {
  buildCombinedRecordPdf,
  buildMedicalRecordPdf,
  combinedRecordFileName,
  medicalRecordFileName,
  type MedicalRecordInput,
} from "../lib/medicalRecord";
import { downloadPdf } from "../lib/pdf";
import { copyRecords, copyRecordSource } from "../lib/recordText";
import type { EyeSide } from "../lib/types";

interface BatchPanelProps {
  t: Strings;
  lang: Lang;
  files: File[];
  settings: LensSettings;
  kIndex: string;
  onClose: () => void;
}

/**
 * The batch view: one uploaded photo per patient, scanned in parallel, then
 * reviewed as a list before any of them is calculated. The single-patient
 * flow's rules all still apply per row — K1 is the lower K, an eye is either
 * complete or ignored, nothing is calculated that the clinician hasn't seen.
 */
export function BatchPanel({ t, lang, files, settings, kIndex, onClose }: BatchPanelProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [copied, setCopied] = useState<"rich" | "source" | null>(null);
  // Reading the newest items (and strings) inside the long-running queues
  // without making them dependencies of the effect that starts them —
  // rescanning a day's photos because the language changed would be absurd.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const tRef = useRef(t);
  tRef.current = t;

  const update = (id: string, patch: Partial<BatchItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  // Scan everything as soon as the files arrive; the review list fills in as
  // results land rather than waiting for the slowest photo.
  useEffect(() => {
    let cancelled = false;
    const queue = createBatchItems(files);
    setItems(queue);

    void runWithConcurrency(queue, SCAN_CONCURRENCY, async (item) => {
      if (cancelled) return;
      try {
        const { base64, mediaType } = await prepareImage(item.file);
        const scan = await scanPhoto(base64, mediaType);
        if (cancelled) return;

        let rows: Record<EyeSide, EyeRowState> = { ...item.rows };
        for (const k of scan.keratometry) {
          rows = { ...rows, [k.side]: applyKeratometry(rows[k.side], { ...k, cylinder: k.k2 - k.k1 }) };
        }
        for (const b of scan.biometry) {
          rows = {
            ...rows,
            [b.side]: applyBiometry(rows[b.side], { ...b, sideSource: "marker" }),
          };
        }

        const missingK = (["OD", "OS"] as const).filter(
          (side) => !scan.keratometry.some((k) => k.side === side),
        );
        const missingB = (["OD", "OS"] as const).filter(
          (side) => !scan.biometry.some((b) => b.side === side),
        );
        const strings = tRef.current;
        const notes = [
          scan.warning,
          missingK.length === 2
            ? strings.scanNoK
            : missingK.length === 1
              ? strings.scanOneK(missingK[0] === "OD" ? "OS" : "OD", missingK[0])
              : null,
          missingB.length === 2
            ? strings.scanNoBiometry
            : missingB.length === 1
              ? strings.scanOneBiometry(missingB[0] === "OD" ? "OS" : "OD", missingB[0])
              : null,
          scan.patientName ? null : strings.scanNoName,
        ].filter((note): note is string => Boolean(note));

        update(item.id, {
          status: "ready",
          rows,
          patientName: scan.patientName ?? "",
          note: notes.join(" ") || undefined,
        });
      } catch (err) {
        if (cancelled) return;
        update(item.id, {
          status: "failed",
          error:
            err instanceof ScanUnavailableError
              ? tRef.current.batchScanUnavailable
              : err instanceof Error
                ? err.message
                : tRef.current.scanFailedGeneric,
        });
      }
    });

    return () => {
      cancelled = true;
      for (const item of queue) URL.revokeObjectURL(item.previewUrl);
    };
  }, [files]);

  function updateField(id: string, side: EyeSide, field: keyof EyeRowState, value: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, rows: { ...item.rows, [side]: { ...item.rows[side], [field]: value } } }
          : item,
      ),
    );
  }

  async function calculateAll() {
    const queue = itemsRef.current.filter(
      (item) => (item.status !== "done" || isStale(item)) && isItemCalculable(item),
    );
    if (queue.length === 0) return;
    setCalculating(true);
    for (const item of queue) update(item.id, { status: "calculating", error: undefined });

    await runWithConcurrency(queue, CALCULATE_CONCURRENCY, async (queued) => {
      // Re-read: the clinician may have edited a value while the queue ran.
      const item = itemsRef.current.find((candidate) => candidate.id === queued.id) ?? queued;
      const sides = itemSides(item);
      try {
        const result: CalculateResponse = await calculateBarrett({
          od: sides.includes("OD") ? toEyeInput(item.rows.OD, settings) : undefined,
          os: sides.includes("OS") ? toEyeInput(item.rows.OS, settings) : undefined,
          kIndex,
        });
        update(item.id, {
          status: "done",
          result,
          // Snapshot the values that produced this result: the record must
          // report those, not whatever the row holds later.
          submitted: { sides, settings, kIndex, rows: item.rows },
        });
      } catch (err) {
        update(item.id, {
          status: "failed",
          error: err instanceof Error ? err.message : tRef.current.calcFailed,
        });
      }
    });

    setCalculating(false);
  }

  function recordFor(item: BatchItem): MedicalRecordInput | null {
    if (!item.result || !item.submitted) return null;
    const personal = isPersonalConstant(item.submitted.settings.lens);
    return {
      patientName: item.patientName,
      recordedAt: new Date(),
      lang,
      kIndex: item.result.kIndex ?? item.submitted.kIndex,
      lens: {
        name: item.result.lens?.name ?? item.submitted.settings.lens,
        lensFactor:
          item.result.lens?.lensFactor ?? (personal ? item.submitted.settings.lensFactor : undefined),
        aConstant:
          item.result.lens?.aConstant ?? (personal ? item.submitted.settings.aConstant : undefined),
      },
      eyes: item.submitted.sides.map((side) => ({
        side,
        measurements: item.submitted!.rows[side],
        recommended: side === "OD" ? item.result?.recommended?.od : item.result?.recommended?.os,
        rows: (side === "OD" ? item.result?.tables?.od : item.result?.tables?.os) ?? [],
      })),
    };
  }

  async function copyOne(item: BatchItem, asSource: boolean) {
    const record = recordFor(item);
    if (!record) return;
    await (asSource ? copyRecordSource([record]) : copyRecords([record]));
  }

  function downloadOne(item: BatchItem) {
    const record = recordFor(item);
    if (record) downloadPdf(buildMedicalRecordPdf(record), medicalRecordFileName(record));
  }

  async function copyAll(asSource: boolean) {
    const records = items
      .map(recordFor)
      .filter((record): record is MedicalRecordInput => record !== null);
    if (records.length === 0) return;
    await (asSource ? copyRecordSource(records) : copyRecords(records));
    setCopied(asSource ? "source" : "rich");
    setTimeout(() => setCopied(null), 3000);
  }

  function downloadAll() {
    const records = items
      .map(recordFor)
      .filter((record): record is MedicalRecordInput => record !== null);
    if (records.length > 0) {
      downloadPdf(buildCombinedRecordPdf(records), combinedRecordFileName(records));
    }
  }

  const counts = countBatch(items);
  const calculable = items.filter(
    (item) => (item.status !== "done" || isStale(item)) && isItemCalculable(item),
  ).length;

  return (
    <section className="batch">
      <div className="batch-header">
        <h2>{t.batchTitle(counts.total)}</h2>
        <button type="button" className="secondary" onClick={onClose}>
          {t.batchClose}
        </button>
      </div>
      <p className="hint">{t.batchHint}</p>

      <p className="batch-counts">
        {t.batchCounts(counts.scanning, counts.ready, counts.done, counts.failed)}
        {counts.incomplete > 0 && ` ${t.batchIncomplete(counts.incomplete)}`}
        {counts.stale > 0 && ` ${t.batchStaleCount(counts.stale)}`}
      </p>

      <div className="batch-actions">
        <button type="button" onClick={calculateAll} disabled={calculating || calculable === 0}>
          {calculating ? t.calculating : t.batchCalculateAll(calculable)}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => copyAll(false)}
          disabled={counts.done === 0}
        >
          {copied === "rich" ? t.recordCopied : t.batchCopyAll(counts.done)}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => copyAll(true)}
          disabled={counts.done === 0}
        >
          {copied === "source" ? t.recordSourceCopied : t.batchCopySourceAll(counts.done)}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={downloadAll}
          disabled={counts.done === 0}
        >
          {t.batchDownloadAll(counts.done)}
        </button>
      </div>
      {calculating && <p className="hint">{t.batchCalculatingHint}</p>}
      <ChallengeOverlay t={t} active={calculating} />

      <ol className="batch-list">
        {items.map((item, index) => (
          <BatchRow
            key={item.id}
            t={t}
            index={index + 1}
            item={item}
            onName={(name) => update(item.id, { patientName: name })}
            onField={(side, field, value) => updateField(item.id, side, field, value)}
            onDownload={() => downloadOne(item)}
            onCopy={(asSource) => copyOne(item, asSource)}
          />
        ))}
      </ol>
    </section>
  );
}

interface BatchRowProps {
  t: Strings;
  index: number;
  item: BatchItem;
  onName: (name: string) => void;
  onField: (side: EyeSide, field: keyof EyeRowState, value: string) => void;
  onDownload: () => void;
  onCopy: (asSource: boolean) => void;
}

function BatchRow({ t, index, item, onName, onField, onDownload, onCopy }: BatchRowProps) {
  const statusLabel: Record<BatchItem["status"], string> = {
    scanning: t.batchStatusScanning,
    ready: t.batchStatusReady,
    calculating: t.batchStatusCalculating,
    done: t.batchStatusDone,
    failed: t.batchStatusFailed,
  };

  const field = (side: EyeSide, key: keyof EyeRowState, label: string) => (
    <label className="batch-field">
      <span>{label}</span>
      <input
        type="number"
        step="0.01"
        value={item.rows[side][key]}
        onChange={(e) => onField(side, key, e.target.value)}
      />
    </label>
  );

  const recommended = item.result?.recommended;
  const partial = partialSides(item);
  const stale = isStale(item);
  const fieldLabels: Record<ReturnType<typeof missingFields>[number], string> = {
    axialLength: t.fieldAxialLength,
    k1: t.fieldK1,
    k2: t.fieldK2,
    acd: t.fieldAcd,
    targetRefraction: t.fieldRefraction,
  };

  return (
    <li className={`batch-item batch-${item.status}`}>
      <div className="batch-item-head">
        <span className="batch-index">{index}</span>
        {item.previewUrl && <img src={item.previewUrl} alt="" className="batch-thumb" />}
        <label className="field batch-name">
          <span>{t.recordName}</span>
          <input
            type="text"
            value={item.patientName}
            onChange={(e) => onName(e.target.value)}
            placeholder={item.fileName}
            autoComplete="off"
          />
        </label>
        <span className={`batch-status batch-status-${item.status}`}>{statusLabel[item.status]}</span>
      </div>

      {item.error && <p className="batch-error">{item.error}</p>}
      {item.note && <p className="batch-note">{item.note}</p>}
      {partial.map((side) => (
        <p className="batch-note" key={side}>
          {t.batchPartialEye(
            side === "OD" ? t.eyeOd : t.eyeOs,
            missingFields(item.rows[side])
              .map((field) => fieldLabels[field])
              .join(", "),
          )}
        </p>
      ))}
      {stale && <p className="batch-note">{t.batchStale}</p>}

      {item.status !== "scanning" && (
        <div className="batch-eyes">
          {(["OD", "OS"] as const).map((side) => (
            <div className="batch-eye" key={side}>
              <span className="batch-eye-label">{side === "OD" ? t.eyeOd : t.eyeOs}</span>
              {field(side, "axialLength", t.fieldAxialLength)}
              {field(side, "k1", t.fieldK1)}
              {field(side, "k2", t.fieldK2)}
              {field(side, "acd", t.fieldAcd)}
              {field(side, "targetRefraction", t.fieldRefraction)}
              <details className="batch-optional">
                <summary>{t.optionalHeading}</summary>
                {field(side, "lensThickness", t.fieldLensThickness)}
                {field(side, "wtw", t.fieldWtw)}
              </details>
            </div>
          ))}
        </div>
      )}

      {item.status === "done" && (
        <div className="batch-result">
          <span>
            {recommended?.od && (
              <strong>
                {t.recommendedFor("OD")}: {recommended.od} D
              </strong>
            )}
            {recommended?.od && recommended?.os && " · "}
            {recommended?.os && (
              <strong>
                {t.recommendedFor("OS")}: {recommended.os} D
              </strong>
            )}
          </span>
          <span className="batch-row-buttons">
            <button type="button" className="secondary" onClick={() => onCopy(false)}>
              {t.recordCopy}
            </button>
            <button type="button" className="secondary" onClick={() => onCopy(true)}>
              {t.recordCopySource}
            </button>
            <button type="button" className="secondary" onClick={onDownload}>
              {t.recordDownload}
            </button>
          </span>
        </div>
      )}
    </li>
  );
}
