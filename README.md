# IOL Power Calculator Assistant

Photograph the ophthalmology exam printouts once — keratometry strip and
A-scan biometry together — and a vision model reads the keratometry (K1/K2)
and biometry (axial length, ACD) for both eyes, plus the patient's name for
the record. After you review and complete the remaining clinical inputs,
the app drives the
[Barrett Universal II calculator](https://calc.apacrs.org/barrett_universal2105/)
to compute IOL power recommendations for cataract surgery, and can save the
whole thing as a PDF record.

## ⚠️ Medical disclaimer

This is a data-entry convenience tool, not a clinical decision system. It
does not replace clinical judgment, and every value — especially anything
read by OCR — must be verified before being used in surgical planning. The
app enforces a manual review step before any calculation runs, and always
shows a manual fallback (copy values / open the calculator yourself) in
case the automation fails.

## ⚠️ Privacy — photos leave the device when scanning is enabled

**Read this before pointing the app at real patients.**

Photos are read by a vision model through the Anthropic API. **The
photograph is transmitted off the clinician's machine.** In-browser OCR
could not read photographed thermal printouts reliably, and this was the
deliberate trade made to fix that.

What this means in practice:

- The image is sent as it was captured. Whatever is in the frame — record
  number, CPF, date of birth, address — **is transmitted**, whether or not
  the app asks the model to read it.
- The prompt asks for the clinical numbers **and the patient's name**, which
  heads the PDF record; every other identifier is excluded, and the server
  validates the numbers against physiologic ranges. That constrains what
  comes *back*, not what is *sent*.
- The name is used only for the local PDF. It is never sent on to the
  Barrett calculator, which receives a neutral "-" as its Patient Name.
- Nothing is written to disk or logged by this app: the image is held in
  memory for the duration of the request and discarded.
- **Check this against your institution's data protection rules (LGPD in
  Brazil) before clinical use.** Sending identifiable patient data to a
  third-party processor is a decision for your institution, not one this
  README can make for you.

**To keep photos on-device instead**, leave `ANTHROPIC_API_KEY` unset. The
app falls back to in-browser OCR (Tesseract.js) automatically — no image
leaves the machine, at the cost of much weaker reading of faded printouts;
expect to type more values by hand.

Either way, the confirmed numeric values (K1/K2, axial length, ACD, target
refraction) are sent to the Barrett calculator to compute IOL power, and
nothing is persisted anywhere.

## Architecture

- **`frontend/`** — React + Vite app. A single camera capture (live
  `getUserMedia` view or native photo upload), image downscaling, an
  editable review form laid out like the calculator's own (measurements,
  then its "Optional:" block, whose Lens Thickness and WTW are typed by
  hand), the results view, the PDF record, and an English/Portuguese
  switch in the top-right corner.
  Carries the on-device OCR fallback (Tesseract.js plus format-specific
  parsers) used when no vision model is configured.
- **`backend/`** — Express server: `POST /api/scan` reads one photograph of
  the printouts with a vision model and returns range-validated values for
  both eyes, `POST /api/calculate` drives a Playwright automation that
  fills those values into the Barrett Universal II calculator and scrapes
  back the results, and `GET /api/lenses` reads the calculator's lens list
  so the app's dropdown matches the site exactly.

## Lens and constants

The form carries the calculator's three IOL controls: the lens dropdown and
the Lens Factor / A Constant boxes beside it. Both constants are typed in —
never read from a photo — and start on this practice's own values (1.57 and
118.4), with the dropdown on "Personal Constant".

- **Nothing changed** → the automation types 1.57 and 118.4 into the site's
  own boxes.
- **Either constant edited** → the automation types whatever is in the
  boxes. They are range-checked against the bands the site prints beside
  them (Lens Factor -2 to 5, A Constant 112 to 125) before a run starts.
- **A lens picked from the dropdown** → the automation only selects that
  lens on the site, and **the site applies that lens's own constants**. The
  boxes then show that lens's values for reference and stop accepting edits;
  switch back to "Personal Constant" to type constants again.

All 37 lenses in the calculator's dropdown have their constants mirrored
here (`frontend/src/lib/lenses.ts`, transcribed from the site's own list).
None of them are used for the calculation itself — they are shown so the
form matches what the site will apply, so an entry that goes out of date is
a wrong number on screen, never a wrong calculation. A unit test checks
every pair against the line the site's own values follow
(A = 118.4 + (LF − 1.57) × 1.9195), which catches a mistyped digit.

Whichever constants the site actually held are read back off the page and
reported with the results and on the PDF. The two are linked on
the site (it derives one from the other), so if it rewrites what was typed,
the results say so.

If a lens name ever stops matching the site's list, the run stops and the
error names every option the site offers — it never silently substitutes a
different lens.

## K Index

The calculator's keratometric index radio (1.3375 / 1.332) is on the form
too, defaulting to 1.3375 as the site does. It decides how the site reads
your K values, so it changes every power returned — leave it alone unless
your keratometer reports against 1.332. The chosen index is sent with the
run, shown with the results, and printed on the PDF record.

If the automation cannot select a **non-default** index it stops without
submitting, rather than let the site compute against 1.3375 and hand back
plausible wrong powers.

## A day at a time (batch)

Selecting **several photos at once** switches the app to the batch view —
one patient per photo, which suits photographing a day's exams and
processing them together.

Photos are read three at a time, and each becomes an editable row: the
patient's name (from the photo when legible), both eyes' values, and a note
saying what couldn't be read. **Nothing is calculated until you press
Calculate**, so the review step survives the batch — what batching removes
is the repetition, not the checking. Calculations then run two at a time
against calc.apacrs.org (deliberately gentle on someone else's site), and
the results appear per row as they land.

Rows that need attention say so rather than passing quietly:

- a photo that couldn't be read completely is counted separately and
  skipped unless you fill it in;
- an eye that was only half read is named on the row, along with the values
  it lacks — that eye is left out of the calculation, never silently
  included;
- editing a row after it was calculated marks the result as out of date,
  and the record keeps reporting the values that actually produced it until
  you calculate again.

Finish with **Download N records (one PDF)** — a single file, one page per
patient, in upload order — or take any single patient's record on its own.

## Eyes are all-or-nothing

The calculator rejects an eye that is missing any of axial length, K1, K2,
optical ACD or target refraction — so an eye is sent only when it has all of
them. This comes up in practice: photograph a two-eye topography strip
beside a one-eye A-scan and you get K values for both eyes but biometry for
one.

That eye is left out of the run and the other still calculates, with the app
naming the eye and the exact values it lacks ("OD is missing Axial Length,
Optical ACD…"). Fill them in and it joins the next calculation. The same
rule and the same message apply per row in the batch view.

## Medical record (PDF)

After a calculation, the results view offers a one-page PDF holding each
eye's K1/K2, axial length, ACD and optional values, the lens and constants
used, and the recommended IOL power with its predicted refraction. The full
table of alternatives stays on screen; the record carries the decision.

The patient's name is filled in from the photo when it's legible and stays
editable — check it before saving. **The PDF is built and saved entirely in
the browser**, so nothing in it is transmitted anywhere. It follows the
language the app is set to.

### Pasting into a hospital system

A PDF is a page layout, not a document: pasting one into a rich-text box
linearises its columns, and the labels arrive separated from their values.
So the record is also produced as text, laid out the way the clinic's own
notes are written (transcribed from the source of a record they had
formatted by hand):

```
BIOMETRIA:        OD / OE, then AXL and ACD, one per line
TOPOGRAFIA:       OD: / OE:, then K1 and K2
CALCULO DA LENTE: one line per eye, the power set larger
```

Two buttons, because hospital editors filter pastes differently:

- **Copy record** — normal paste. The clipboard carries rich text (16px
  body, bold headings, blank paragraphs for the gaps) and plain lines
  together; the editor takes whichever it prefers.
- **Copy as source code (HTML)** — for the editor's own *Código-Fonte*
  view. Paste there and toggle back, and the layout arrives exactly as
  built, because nothing filters a paste made in that view. The same markup
  is shown on screen under "Show the source code" for selecting by hand if
  the clipboard is blocked.

Both are built in the browser; nothing is uploaded. The record names the
eye on every power (`OD - LIO recomendada: 23.5 D`), and ends with the lens,
constants and K index that produced them. In the batch view each row has
both buttons, and the header pair copies the whole day at once.

## Status: verified working (2026-08-01)

The automation was verified end-to-end against the live calculator: an
automated run returned IOL Power tables identical to a manual run with the
same inputs. Two operational notes:

- `calc.apacrs.org` sits behind Cloudflare bot protection. Runs are
  invisible by default; when Cloudflare challenges (intermittently), a
  **visible** browser window opens so the person at the machine can
  complete the verification by hand — this project deliberately does not
  evade bot protection. See [`backend/README.md`](backend/README.md).
- If the site's form layout ever changes and runs start failing, re-pin
  the selectors with `npm run inspect` per the backend README, and fall
  back to the app's "Copy values" / "Open calculator manually" buttons
  meanwhile.

## Setup

### Backend

```bash
cd backend
npm install   # also downloads a Chromium build for Playwright

# Optional — enables vision-model photo scanning. Leave unset to keep photos
# on-device (weaker reading; see the privacy section above).
export ANTHROPIC_API_KEY=sk-ant-...

npm run dev   # listens on :4000
```

Get an API key from [console.anthropic.com](https://console.anthropic.com).
Scanning costs a few cents per photo.

See [`backend/README.md`](backend/README.md) for selector verification and
deployment notes.

### Frontend

```bash
cd frontend
npm install
npm run dev   # listens on :5173, proxies /api to the backend on :4000
```

`Upload photo` and the live camera both work at `http://localhost:5173` on
the machine you're running this on, no extra setup needed.

## Using it on your phone (temporary link)

Browsers only allow camera access over HTTPS (or on `localhost` itself), so
reaching the dev server from your phone over plain LAN HTTP (`http://192.168.x.x:5173`)
won't let it use the camera. The fix is a single HTTPS tunnel to the
frontend's port — the frontend's dev server proxies `/api` calls to the
backend internally, so you only need to tunnel one port, not two.

With both `npm run dev` commands above running, in a third terminal:

```bash
npx ngrok http 5173
```

(No ngrok account needed for a quick anonymous session; sign up at
ngrok.com and run `ngrok config add-authtoken <token>` first if prompted.
Any HTTPS tunnel tool — Cloudflare Tunnel, etc. — works the same way.)

Open the `https://....ngrok-free.app` URL it prints on your phone. The link
stops working once you kill the `ngrok` process or the `npm run dev`
servers — it's meant for trying the app out, not for daily clinical use.
For that, deploy the frontend and backend properly (e.g. Vercel + Render)
so you get a stable HTTPS URL — ask if you'd like help setting that up.

## Testing

```bash
cd frontend && npm test    # OCR parsing + form-state unit tests
cd frontend && npm run build
cd backend && npm run build
```
