import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import {
  challengeClick,
  challengeFrame,
  challengeType,
  closeSharedBrowser,
  convertConstant,
  currentChallenge,
  fetchLensOptions,
  runBarrettCalculation,
} from "./barrett.js";
import { clearJobs, readJob, startCalculation } from "./calcJobs.js";
import {
  closeDatabase,
  consultationsFor,
  deletePatient,
  exportAll,
  listPatients,
  matchPatient,
  openDatabase,
  saveConsultation,
} from "./db.js";
import { clearHandoffs, collectHandoff, parkHandoff } from "./handoff.js";
import { scanImage, visionConfigured } from "./scan.js";
import { FORM_SECTIONS } from "./formFields.js";
import { formScanConfigured, scanForm } from "./scanForm.js";
import type { CalculateRequest } from "./types.js";
import { validateCalculateRequest } from "./validate.js";

const app = express();

/**
 * Wide open by default, because the usual setup is this server handing out
 * the frontend itself (see FRONTEND_DIST below) — same origin, nothing to
 * allow. Set ALLOWED_ORIGINS (comma-separated) when the app is hosted
 * somewhere else, so this API isn't callable from any page on the internet.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : {}));
// Clinical values are tiny; photographs are not, so the scan route gets its
// own limit rather than raising it for every endpoint.
app.use("/api/scan", express.json({ limit: "12mb" }));
// A day's handoff is thirty patients' values and results — bigger than a
// single calculation, nowhere near a photograph.
app.use("/api/handoff", express.json({ limit: "2mb" }));
// A photographed form, same order of size as a biometry photo.
app.use("/api/forms/scan", express.json({ limit: "12mb" }));
app.use(express.json({ limit: "20kb" }));

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

app.post("/api/scan", async (req, res) => {
  if (!visionConfigured()) {
    res.status(503).json({
      error:
        "Photo scanning is not configured on this server. Set ANTHROPIC_API_KEY to enable it, or enter the values by hand.",
    });
    return;
  }

  const { imageBase64, mediaType } = req.body ?? {};
  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    res.status(400).json({ error: "imageBase64 must be a non-empty base64 string" });
    return;
  }
  if (!MEDIA_TYPES.includes(mediaType)) {
    res.status(400).json({ error: `mediaType must be one of: ${MEDIA_TYPES.join(", ")}` });
    return;
  }

  try {
    res.json(await scanImage(imageBase64, mediaType as MediaType));
  } catch (err) {
    // Deliberately not logging the image or the model's output: both carry
    // clinical content that shouldn't sit in server logs.
    console.error("Scan failed:", err instanceof Error ? err.message : err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Could not read that photo.",
    });
  }
});

/**
 * The synchronous calculation, kept for same-origin use (localhost, curl,
 * the offline mock scripts) where holding the connection open is harmless.
 * Anything reached through a proxy should use the job routes below instead.
 */
app.post("/api/calculate", async (req, res) => {
  const validationError = validateCalculateRequest(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const result = await runBarrettCalculation(req.body as CalculateRequest);
    res.json(result);
  } catch (err) {
    // Deliberately not logging req.body: it carries clinical values that
    // shouldn't sit in server logs any longer than necessary.
    console.error("Barrett calculation failed:", err instanceof Error ? err.message : err);
    res.status(502).json({
      error:
        (err instanceof Error ? err.message : "Could not complete the automated calculation.") +
        " Use the app's manual fallback (copy values, open calculator manually) instead.",
    });
  }
});

/**
 * The same calculation, as a job.
 *
 * This is what the app actually uses. A run can take minutes when the
 * calculator's site raises a security check, and nothing between the browser
 * and this server — tunnel, proxy, firewall — will hold a request open that
 * long. Starting a job returns at once, and the app asks for the outcome
 * every couple of seconds. See calcJobs.ts.
 */
app.post("/api/calculate/jobs", (req, res) => {
  const validationError = validateCalculateRequest(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  res.status(202).json({ jobId: startCalculation(req.body as CalculateRequest) });
});

app.get("/api/calculate/jobs/:jobId", (req, res) => {
  const job = readJob(req.params.jobId);
  if (!job) {
    res.status(404).json({
      error:
        "That calculation is no longer on the server — results are kept for a few minutes. " +
        "Press Calculate again.",
    });
    return;
  }
  res.json(job);
});

/**
 * What the calculator turns one constant into.
 *
 * `?aConstant=119.5` or `?lensFactor=2.1`; the answer is both boxes as the
 * site itself filled them. The app asks this instead of computing the
 * partner from a formula, because a formula of ours disagreed with the
 * site's and showed the clinician a Lens Factor the calculator would never
 * produce. Best-effort: the form simply shows nothing when it fails.
 */
app.get("/api/constants", async (req, res) => {
  const read = (name: string) => {
    const raw = req.query[name];
    return typeof raw === "string" && raw.trim() !== "" ? Number(raw) : undefined;
  };
  try {
    res.json(
      await convertConstant({ aConstant: read("aConstant"), lensFactor: read("lensFactor") }),
    );
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Couldn't ask the calculator.",
    });
  }
});

// The lens names the live calculator offers, so the frontend's dropdown can
// match it exactly. Best-effort: the frontend falls back to its bundled list.
app.get("/api/lenses", async (_req, res) => {
  try {
    res.json({ lenses: await fetchLensOptions() });
  } catch (err) {
    console.error("Lens list lookup failed:", err instanceof Error ? err.message : err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Could not read the calculator's lens list.",
    });
  }
});

/**
 * The Cloudflare challenge, made solvable from wherever the clinician is.
 *
 * When the site challenges, the automation reopens the run in a visible
 * browser window so a person can complete the verification. On a hosted
 * server that window is on a machine nobody is looking at — and the
 * clearance only counts if it is earned from that server's own IP, so it
 * can't be solved anywhere else either. These three routes carry the window
 * to the app instead: a picture of it, and the clicks and keystrokes of the
 * person looking at the picture. Nothing here answers a challenge; it moves
 * a human's hand, and only while a challenge window is actually open.
 *
 * Like the rest of this API, they are unauthenticated — put the server
 * behind your own access control before exposing it (see backend/README).
 */
app.get("/api/challenge", (_req, res) => {
  res.json({ challenge: currentChallenge() });
});

app.get("/api/challenge/:id/frame.jpg", async (req, res) => {
  const frame = await challengeFrame(req.params.id);
  if (!frame) {
    res.status(404).json({ error: "No challenge window is open." });
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(frame);
});

app.post("/api/challenge/:id/input", async (req, res) => {
  const { x, y, text } = req.body ?? {};
  const done =
    typeof text === "string"
      ? await challengeType(req.params.id, text)
      : await challengeClick(req.params.id, Number(x), Number(y));
  if (!done) {
    res.status(404).json({ error: "No challenge window is open, or that one has closed." });
    return;
  }
  res.json({ ok: true });
});

/**
 * Carrying a day's work from the phone to the hospital PC.
 *
 * The two machines have no other way to reach each other, so the work is
 * parked here under a short code and collected on the other one. See
 * handoff.ts for what that store will and won't do — in short: memory only,
 * expires the same day, no photographs, and reading it deletes it.
 */
app.post("/api/handoff", (req, res) => {
  const payload = req.body;
  if (payload === null || typeof payload !== "object") {
    res.status(400).json({ error: "Expected the work to hand off as a JSON object." });
    return;
  }
  // Deliberately not logging the payload: it carries patient names and
  // clinical values.
  res.json(parkHandoff(payload));
});

app.get("/api/handoff/:code", (req, res) => {
  const payload = collectHandoff(req.params.code);
  if (payload === null) {
    res.status(404).json({
      error:
        "That code doesn't match anything. Codes last the working day, and each one can be " +
        "opened once — if this device already opened it, the work is here, not on the server.",
    });
    return;
  }
  res.json({ payload });
});

/**
 * The form's own field list.
 *
 * Served rather than duplicated in the frontend: the extraction schema is
 * generated from this same list, so a field added to the paper form appears
 * in the review screen and the statistics without anything being kept in
 * step by hand.
 */
app.get("/api/forms/fields", (_req, res) => {
  res.json({ sections: FORM_SECTIONS });
});

/**
 * Reads a photographed Ficha de Triagem.
 *
 * Nothing is stored by this route. It returns what the model made of the
 * page, including a list of what it could not read, and the clinician
 * reviews all of it before anything reaches the database — which matters
 * more here than anywhere else in the app, because this is handwriting.
 */
app.post("/api/forms/scan", async (req, res) => {
  if (!formScanConfigured()) {
    res.status(503).json({
      error:
        "Reading forms needs a vision model. Set ANTHROPIC_API_KEY, or type the form in by hand.",
    });
    return;
  }
  const { imageBase64, mediaType } = req.body ?? {};
  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    res.status(400).json({ error: "imageBase64 must be a non-empty base64 string" });
    return;
  }
  if (!MEDIA_TYPES.includes(mediaType)) {
    res.status(400).json({ error: `mediaType must be one of: ${MEDIA_TYPES.join(", ")}` });
    return;
  }
  try {
    res.json(await scanForm(imageBase64, mediaType as MediaType));
  } catch (err) {
    // Deliberately not logging the image or the model's output: a filled
    // form is the most identifying thing this app handles.
    console.error("Form scan failed:", err instanceof Error ? err.message : err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not read that form." });
  }
});

/**
 * Stores a reviewed consultation.
 *
 * The prontuário is required: it is what a consultation is later found by,
 * and a consultation nobody can find again is worse than one not stored.
 */
app.post("/api/patients", (req, res) => {
  const { prontuario, name, ageYears, seenOn, form } = req.body ?? {};
  if (typeof prontuario !== "string" || prontuario.trim() === "") {
    res.status(400).json({ error: "A prontuário is required — it is how this patient is found again." });
    return;
  }
  if (typeof name !== "string" || name.trim() === "") {
    res.status(400).json({ error: "A patient name is required." });
    return;
  }
  try {
    res.status(201).json(
      saveConsultation({
        prontuario,
        name,
        ageYears: typeof ageYears === "number" ? ageYears : undefined,
        seenOn: typeof seenOn === "string" ? seenOn : undefined,
        form: form ?? {},
      }),
    );
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not save." });
  }
});

/**
 * Finding a stored patient.
 *
 * Answers with what was found *and how*, because "the number matched but the
 * name doesn't" is the one case that must never be resolved automatically —
 * one misread digit lands on a real patient who isn't this one.
 */
app.get("/api/patients", (req, res) => {
  const read = (name: string) => {
    const raw = req.query[name];
    return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
  };
  const prontuario = read("prontuario");
  const name = read("name");
  if (!prontuario && !name) {
    res.json({ patients: listPatients() });
    return;
  }
  res.json(matchPatient({ prontuario, name }));
});

app.get("/api/patients/:id/consultations", (req, res) => {
  res.json({ consultations: consultationsFor(Number(req.params.id)) });
});

app.delete("/api/patients/:id", (req, res) => {
  deletePatient(Number(req.params.id));
  res.json({ ok: true });
});

/**
 * The whole database as one file.
 *
 * The backup story until something better exists. Most of the ways this data
 * can be lost — `docker compose down -v`, a Docker Desktop reset, the PC
 * dying — are undone by having pressed this recently.
 */
app.get("/api/export", (_req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="lens-backup-${stamp}.json"`);
  res.send(JSON.stringify(exportAll(), null, 2));
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, visionScanning: visionConfigured() });
});

/**
 * In a deployment the built frontend is served from here, so the app and its
 * API share one origin, one port and one URL — the phone and the hospital PC
 * open the same address, and there is no CORS to configure. In development
 * the directory doesn't exist and Vite serves the app instead.
 */
const frontendDist =
  process.env.FRONTEND_DIST ?? path.resolve(import.meta.dirname, "../../frontend/dist");
if (existsSync(frontendDist)) {
  // index.html is never cached; everything else is free to be.
  //
  // The built asset filenames carry a content hash, so a new version means
  // new filenames and the browser fetches them. index.html is the one file
  // whose name never changes — cache it and the browser keeps pointing at
  // last week's assets, which is why an update used to need Ctrl+Shift+R to
  // show up. Revalidating one small file per visit is a cheap price for
  // "click the launcher and you have the new version".
  const noCacheHtml = (res: express.Response) => {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
  };

  app.use(
    express.static(frontendDist, {
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) noCacheHtml(res);
      },
    }),
  );
  // Single-page app: anything that isn't a file and isn't the API is a route.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    noCacheHtml(res);
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// Runs share one Chromium process; hand it back rather than orphaning it.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearHandoffs();
    clearJobs();
    // Checkpoints the WAL. A power cut is the one failure a restart can't
    // undo; a clean close is what keeps that to power cuts only.
    closeDatabase();
    void closeSharedBrowser().finally(() => process.exit(0));
  });
}

// Opened at startup rather than on the first save: a path that can't be
// written is worth finding out about while someone is watching the console,
// not halfway through storing a patient.
try {
  openDatabase();
} catch (err) {
  console.error("Could not open the patient database:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Backend listening on :${port}`);
  if (existsSync(frontendDist)) console.log(`Serving the built frontend from ${frontendDist}`);
  // Printed at startup because a missing key otherwise shows up only as a
  // silently worse scan, which is impossible to diagnose from the UI.
  if (visionConfigured()) {
    console.log(`Photo scanning: ENABLED (${process.env.SCAN_MODEL ?? "claude-opus-5"})`);
  } else {
    console.log(
      "Photo scanning: DISABLED — no ANTHROPIC_API_KEY in this process's environment.\n" +
        "  Photos will be read on-device instead, which reads faded printouts poorly.\n" +
        "  PowerShell: set the key and start the server in the SAME window:\n" +
        '    $env:ANTHROPIC_API_KEY="sk-ant-..."\n' +
        "    npm run dev",
    );
  }
});
