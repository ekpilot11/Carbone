import cors from "cors";
import express from "express";
import { runBarrettCalculation } from "./barrett.js";
import { scanImage, visionConfigured, type ScanKind } from "./scan.js";
import type { CalculateRequest } from "./types.js";
import { validateCalculateRequest } from "./validate.js";

const app = express();
app.use(cors());
// Clinical values are tiny; photographs are not, so the scan route gets its
// own limit rather than raising it for every endpoint.
app.use("/api/scan", express.json({ limit: "12mb" }));
app.use(express.json({ limit: "20kb" }));

const SCAN_KINDS: ScanKind[] = ["topography", "biometry"];
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

  const { kind, imageBase64, mediaType } = req.body ?? {};
  if (!SCAN_KINDS.includes(kind)) {
    res.status(400).json({ error: `kind must be one of: ${SCAN_KINDS.join(", ")}` });
    return;
  }
  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    res.status(400).json({ error: "imageBase64 must be a non-empty base64 string" });
    return;
  }
  if (!MEDIA_TYPES.includes(mediaType)) {
    res.status(400).json({ error: `mediaType must be one of: ${MEDIA_TYPES.join(", ")}` });
    return;
  }

  try {
    res.json(await scanImage(kind, imageBase64, mediaType as MediaType));
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

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Backend listening on :${port}`);
});
