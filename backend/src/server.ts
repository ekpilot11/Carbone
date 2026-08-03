import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import {
  challengeClick,
  challengeFrame,
  challengeType,
  closeSharedBrowser,
  currentChallenge,
  fetchLensOptions,
  runBarrettCalculation,
} from "./barrett.js";
import { scanImage, visionConfigured } from "./scan.js";
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
  app.use(express.static(frontendDist));
  // Single-page app: anything that isn't a file and isn't the API is a route.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// Runs share one Chromium process; hand it back rather than orphaning it.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void closeSharedBrowser().finally(() => process.exit(0));
  });
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
