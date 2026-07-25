import cors from "cors";
import express from "express";
import { runBarrettCalculation } from "./barrett.js";
import type { CalculateRequest } from "./types.js";
import { validateCalculateRequest } from "./validate.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20kb" }));

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
