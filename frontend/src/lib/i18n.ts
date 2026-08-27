/**
 * Every user-visible string, in English and Portuguese.
 *
 * The Portuguese side is typed as the English side, so a missing or
 * misspelled key is a compile error rather than an English sentence
 * appearing mid-page. Clinical abbreviations the calculator itself uses
 * (K1, K2, ACD, WTW, IOL/LIO) are kept recognisable in both languages.
 */

export type Lang = "en" | "pt";

export const LANGUAGES: readonly Lang[] = ["en", "pt"];

/** Shown on the language switch itself, so each option reads in its own language. */
export const LANGUAGE_LABELS: Record<Lang, string> = {
  en: "English",
  pt: "Português",
};

const en = {
  langName: "English",
  title: "IOL Power Calculator Assistant",
  disclaimerIntro:
    "This tool only helps enter scanned biometry/topography values into the Barrett Universal II calculator faster. It does not replace clinical judgment. ",
  disclaimerVerify:
    "Always verify every value — especially anything read from a photo — and confirm the final IOL power on the official calculator before using it in surgical planning.",
  disclaimerPhotoBefore: " Photos are read by a vision model, which means ",
  disclaimerPhotoStrong: "the image is sent off this machine",
  // "Nothing is stored" was true of every path when it was written. It is
  // not true of a consultation form, whose identifying fields are kept on
  // the host — and a warning box that contradicts the page below it is
  // worse than no warning box.
  disclaimerPhotoAfter:
    ". For an exam photo, only the patient's name is read — to head the PDF record — and nothing is kept afterwards. A consultation form is different: the name, CPF, date of birth and prontuário on it are stored on the computer running this app.",

  captureLabel: "1. Photograph the exam printouts",
  captureHint:
    "One photo of the keratometry strip and the A-scan printout together — or either one on its own. Keep the paper flat and well-lit.",
  captureUseCamera: "Use camera",
  captureRetake: "Retake with camera",
  captureTake: "Capture",
  captureUpload: "Upload photo",
  captureBusy: "Reading numbers from the photo…",
  captureNoCamera: "Couldn't access the camera. You can upload a photo instead.",

  scanFallbackNote:
    "Read on this device — the server has no vision model configured (ANTHROPIC_API_KEY), so accuracy is much lower. Check every value.",
  scanNothing:
    "Couldn't read any values from that photo. Make sure the printouts are flat, well-lit, and large enough in the frame that the digits are legible — then retake, or type the values in below.",
  scanNothingReadable: "(nothing readable)",
  scanNoK: "No K values were found — enter K1/K2 for both eyes by hand.",
  scanOneK: (read: string, missing: string) =>
    `K values were only read for ${read} — enter ${missing}'s by hand.`,
  scanNoBiometry: "No axial length / ACD values were found — enter them by hand.",
  scanOneBiometry: (read: string, missing: string) =>
    `Axial length / ACD were only read for ${read} — enter ${missing}'s by hand.`,
  scanUnlabeledEye:
    'Only one eye was on this scan and its OD/OS label wasn\'t legible, so it was filed as OD. Check the printout\'s "Sex:… OD/OS …" line and move the values if it\'s the left eye.',
  scanNoName: "The patient's name wasn't legible on the photo — type it in for the PDF record.",
  scanFailedSuffix: (message: string) =>
    `${message} You can retake the photo or type the values in below.`,
  scanFailedGeneric: "Scanning failed on that photo. You can retake it or type the values in below.",
  scanShowRaw: "Show what the scanner could read",

  reviewTitle: "2. Review & complete",
  reviewHint:
    "Check every value read from the photo. K1 must be the lower of the two values — the flatter meridian. If it isn't, that eye is held back rather than corrected for you: a reversed pair is a transcription error, and which value is wrong isn't something the app can know. Refraction target defaults to 0 (emmetropia) — change it only when the plan differs. The Optional: fields are never read from the photo; type them in if you have them. To calculate a single eye, fill in only that eye — use \"Clear\" to empty the other one.",
  lensLabel: "Lens",
  fieldLensFactor: "Lens Factor",
  fieldAConstant: "A Constant",
  kIndexLabel: "K Index",
  constantsUnavailable:
    "Couldn't reach the calculator to look up the matching constant, so that box is left empty. This does not stop you: the value you set is what gets sent, and the calculator works the other one out itself.",
  constantsAsking:
    "Asking the calculator what the other constant becomes — it decides that, not this app, so the two always agree.",
  kOrderWarning: (side: string, k1: string, k2: string) =>
    `⚠ ${side}: K1 (${k1}) is above K2 (${k2}). K1 is the flatter meridian, so this pair is the wrong way round or mistyped — that eye will not be calculated until it is corrected.`,
  planSuspect: (sides: string) =>
    `${sides} left out: K1 is above K2, which cannot be a real cornea. Correct the values to include it.`,
  batchSuspectCount: (count: number) =>
    `⚠ ${count} row${count === 1 ? "" : "s"} with K1 above K2 — not calculated until corrected.`,
  kIndexHint: (defaultIndex: string) =>
    `The keratometric index the calculator reads your K values against. Leave it on ${defaultIndex} unless your keratometer reports against the other one — changing it changes every power returned.`,
  lensPersonalNote: (model: string) =>
    `IOL: ${model} · the two constants above are typed in and sent with every calculation. They start at this practice's own values; edit either one to use something else.`,
  lensNamedNote: (lens: string) =>
    `${lens} is selected in the calculator itself, so the calculator applies that lens's own constants — the values above are shown for reference only and are not sent. Switch back to "Personal Constant" to enter constants by hand. The constants actually used are reported with the results.`,
  lensConstantsUnknown: (lens: string) =>
    `The constants for ${lens} aren't stored here yet; the calculator supplies its own and reports them with the results.`,
  planBadLensFactor: (min: number, max: number) =>
    `Lens Factor must be a number between ${min} and ${max} (the calculator's own range).`,
  planBadAConstant: (min: number, max: number) =>
    `A Constant must be a number between ${min} and ${max} (the calculator's own range).`,

  eyeOd: "OD (right eye)",
  eyeOs: "OS (left eye)",
  clearEye: (side: string) => `Clear ${side}`,
  fieldAxialLength: "Axial Length",
  fieldK1: "Measured K1",
  fieldK2: "Measured K2",
  fieldAcd: "Optical ACD",
  fieldRefraction: "Refraction (target)",
  fieldLensThickness: "Lens Thickness",
  fieldWtw: "WTW",
  optionalHeading: "Optional:",

  calculate: "Calculate with Barrett Universal II",
  calculateOne: (side: string) => `Calculate ${side} with Barrett Universal II`,
  calculating: "Calculating…",
  copyValues: "Copy values",
  copied: "Copied!",
  openCalculator: "Open calculator manually",
  noValuesToCopy: "No values entered yet.",
  planSkipped: (side: string, fields: string) =>
    `${side} is missing ${fields}, so it is left out of the calculation — the calculator would reject it. Fill those in to include it.`,
  planNothingComplete: (fields: string) =>
    `No eye has all its values yet — ${fields} still missing. Fill them in to calculate.`,
  planEmpty: "Fill in every field for at least one eye to enable calculation.",
  cloudflareHint:
    'Usually nothing else is needed. If the calculator site asks for a security check, it appears here to be completed by hand — click "Verify you are human" and the calculation continues on its own.',
  formReviewTitle: "Check the form before it is stored",
  formHandwritingWarning:
    "⚠ This was read from handwriting, which is far less reliable than a printed exam. Check every field against the paper — this screen is the only place a misreading gets corrected.",
  formNotRead: "not read",
  formUnreadCount: (count: number) =>
    `${count} field${count === 1 ? "" : "s"} could not be read and ${count === 1 ? "is" : "are"} marked "not read" below. Blank means the model read the space as empty; "not read" means it could not tell.`,
  formTwoTicked: "two marked",
  formAmbiguousCount: (count: number) =>
    `⚠ ${count} field${count === 1 ? " has" : "s have"} more than one box ticked on the paper. The app will not choose between them — pick the one that is right, or leave it unanswered.`,
  formDetailPlaceholder: "what was written on the line",
  formNeedsIdentity:
    "To save, this needs the patient's name and either a CPF or a date of birth — those are the two ways the biometry finds this consultation again on exam day. Everything else can be left blank.",
  formCpfInvalid:
    "⚠ This CPF's check digits don't add up, so at least one digit was read or written wrong. Check it against the paper. It can still be saved — the form itself is sometimes wrong — but the patient will then be found by name and date of birth instead.",
  formCpfMismatch: (cpf: string, stored: string, scanned: string) =>
    `⚠ CPF ${cpf} is already stored for ${stored}, not ${scanned || "this patient"}. That is usually one misread digit. Check the number on the paper — saving now would file this consultation under the wrong patient.`,
  formCpfKnown: (name: string) =>
    `This CPF is already on file for ${name}; saving adds another consultation to that same patient.`,
  formBirthKnown: (name: string) =>
    `${name} is already on file with this date of birth; saving adds another consultation to that same patient.`,
  formConfirmMerge: "Save anyway — same patient",
  formSave: "Save this consultation",
  formSaving: "Saving…",
  formCancel: "Cancel",
  formSaveFailed: "Could not save this consultation.",
  formFieldsUnavailable: "Couldn't load the form's fields from the server.",
  formImportLabel: "Or send a consultation form (Ficha de Diagnóstico) — photo, PDF or Word",
  formStorageNote:
    "A photo or PDF is sent to the reading service. A Word file is read here and never leaves this computer. Either way, the name, CPF, date of birth and prontuário on the form are stored on the computer running this app, so the biometry can find them on exam day — the photo or file itself is not. There is no login yet, so use invented patients.",
  formWordNoMarks:
    "That Word file has no ticked boxes in it. Marks typed into the document (☒, or a checkbox clicked in Word) are read exactly — but a mark drawn over the page with a pen or stylus is a drawing, and the file gives no sign of it. The typed fields are below; tick the rest by hand, or send a photo or PDF instead so they can be read.",
  formReading: "Reading the form…",
  formSeenOn: "Date of this consultation",
  formSaved: (name: string, how: string) =>
    `Saved: ${name} (${how}). On exam day the biometry will find this consultation by that.`,
  matchTitle: "Attach the consultation from this patient's first visit",
  matchHint:
    "If this patient's form was photographed on an earlier visit, the findings from it go into this record — including what the examiner actually saw on fundoscopy, instead of the standard wording.",
  matchCpfLabel: "CPF",
  matchDobLabel: "Date of birth",
  matchSearch: "Look this patient up",
  matchNeedsName: "Type the patient's name above and this looks them up on its own.",
  matchOtherWays: "Not the right patient? Look them up by CPF or date of birth",
  matchIdentityCpf: (cpf: string) => `CPF ${cpf}`,
  matchIdentityBirth: (date: string) => `born ${date}`,
  matchIdentityNameOnly: "no CPF or date of birth on file",
  matchConfirmQuestion:
    "Found by name. Check the CPF or date of birth above against the patient in front of you before confirming — this attaches their consultation to today's measurements.",
  matchReject: "Not this patient",
  matchSearching: "Looking…",
  matchNone:
    "No stored consultation for this patient. The record is produced from the measurements alone, exactly as before.",
  matchStoreNew: "Store this exam under a new patient",
  matchStoredNew: (name: string) =>
    `${name} is now on file with this exam. When their form is photographed, it will attach to the same patient.`,
  matchNoKey: "Enter a CPF, or the date of birth to go with the name above.",
  matchByCpf: "Found by CPF.",
  matchByBirth: "Found by name and date of birth.",
  matchMismatch: (stored: string, scanned: string) =>
    `⚠ That CPF belongs to ${stored}, not ${scanned || "this patient"}. Usually one misread digit. Nothing has been attached — check the number before going on.`,
  matchCandidates: (count: number) =>
    `${count} patients share that name. Pick the right one — the date of birth and last visit are shown to tell them apart.`,
  matchNoConsultation: "That patient has no consultation stored yet, only this exam.",
  matchStoredSide: "Stored consultation",
  matchMeasuredSide: "Measured today",
  matchNothingRecorded: "Nothing was ticked on that form that a record would carry.",
  matchConfirm: "Yes — this is the same patient",
  matchAttached: (name: string) =>
    `Attached to ${name}. The findings below are in the record, and this exam is stored against that patient.`,
  matchDetach: "Undo",
  matchExamSaved: "This exam is now stored with the patient.",
  matchExamFailed:
    "The consultation was attached to the record, but this exam could not be stored on the server.",
  matchNoCpfInList:
    "A spreadsheet carries no CPF, so a patient can only be looked up here by name — and a name is shared. Check the date of birth before attaching.",
  navLabel: "Sections",
  navForm: "Consultation form",
  navBiometry: "Biometry",
  navStatistics: "Statistics",
  navPatients: "Patients",

  formPageTitle: "Photograph a consultation form",
  formPageHint:
    "The Ficha de Diagnóstico filled in at the patient's first visit. Send a photo of the paper, a PDF, or the Word file — you check everything read from it before it is stored.",

  formCorrectTitle: "Correct this consultation",
  formSaveCorrection: "Save the correction",

  statsTitle: "Statistics",
  statsComingSoon:
    "Not built yet — this is the next piece of work. It will count across every consultation stored, with filters on the fields the form already records:",
  statsPlanned: [
    "Pupil dilation — the list of patients who are hard to dilate",
    "IFIS suspected or present, and tamsulosin use",
    "DM2, hypertension and glaucoma",
    "Cataract grade and type",
    "Cross-tabs worth having, such as tamsulosin against IFIS",
  ] as readonly string[],

  patientsTitle: "Patients",
  patientsHint:
    "Everyone on file on this computer. Open one to read everything stored about them.",
  patientsFilter: "Find a patient",
  patientsFilterPlaceholder: "name or CPF",
  patientsLoading: "Loading…",
  patientsLoadFailed: "Couldn't load the patient list.",
  patientsEmpty: "No patients stored yet. They appear here once a consultation form is saved.",
  patientsNoneMatch: "No patient matches that.",
  patientsCount: (count: number) => `${count} patient${count === 1 ? "" : "s"}.`,
  patientsBack: "← All patients",
  patientsAge: (years: number) => `${years} years old`,
  patientsProntuario: (value: string) => `prontuário ${value}`,
  patientsConsultations: (count: number) =>
    count === 1 ? "1 consultation" : `${count} consultations`,
  patientsNoConsultations: "No consultation form stored for this patient yet.",
  patientsExams: (count: number) => (count === 1 ? "1 exam" : `${count} exams`),
  patientsNoExams: "No biometry stored for this patient yet.",
  patientsCorrect: "Correct this consultation",
  patientsRemoveVisit: "Remove this consultation",
  patientsRemoveVisitConfirm: "Yes, remove it",
  patientsRemoveVisitWarning:
    "⚠ This removes only this consultation. The patient and their exams stay. It cannot be undone.",
  patientsRemoveVisitFailed: "Couldn't remove that consultation.",
  patientsNoPhotos:
    "The photographs themselves were never stored — only the values read from them, which are everything above. That is deliberate: a filled form is the most identifying thing this app handles.",
  patientsDeleteTitle: "Remove this patient",
  patientsDeleteWarning: (name: string) =>
    `⚠ This deletes ${name} and every consultation and exam stored for them. It cannot be undone, and there is no login in front of it — take a backup from the form page first if you are unsure.`,
  patientsDeleteConfirmLabel: "Type the patient's name to confirm",
  patientsDelete: "Delete permanently",
  patientsDeleting: "Deleting…",
  patientsDeleteFailed: "Couldn't delete that patient.",

  databaseExport: "Download a backup of the database",
  listImportLabel: "Or import a patient list (.xlsx or .csv)",
  listImporting: "Reading the list…",
  listImported: (count: number) =>
    `${count} patient${count === 1 ? "" : "s"} read. Check the values before calculating — nothing has been sent anywhere yet.`,
  listDiscardedCount: (count: number) =>
    `${count} eye${count === 1 ? " was" : "s were"} left out for missing measurements; each is named on its row.`,
  listNothingUsable: (names: string) =>
    `These have no eye with all four measurements, so there is nothing to calculate for them: ${names}.`,
  listDiscardedEye: (side: string, missing: string) =>
    `${side} was left out of the list — no ${missing}.`,
  listSuspectEye: (side: string, k1: string, k2: string) =>
    `${side} was NOT imported: the list has K1 ${k1} above K2 ${k2}, which cannot be right — K1 is the flatter meridian. Check the source and type both values in.`,
  listSuspectCount: (count: number) =>
    `⚠ ${count} eye${count === 1 ? " has" : "s have"} K1 above K2 in the list — a transcription error, not a measurement. Those values were not imported; each row says which eye.`,
  listNoPatients: "That sheet has the right headings but no patient rows under them.",
  listFailed: "Couldn't read that file.",

  handoffSend: "Continue on another device",
  handoffCodeHint: (count: number) =>
    `${count} patient${count === 1 ? "" : "s"} saved. Type this code into the app on the other device to carry on there. The photos stay on this one — the values and results travel.`,
  handoffCodeExpiry: (time: string) =>
    `The code works once, and only until ${time}. Nothing is written to disk on the server.`,
  handoffOpenLabel: "Or pick up work from another device",
  handoffCodePlaceholder: "Code from the other device",
  handoffOpen: "Open",
  handoffOpening: "Opening…",
  handoffFailed: "Couldn't reach the server to hand the work over.",
  handoffUnreadable:
    "That code opened, but what came back wasn't a day's work this version understands. Check both devices are running the same version.",

  challengeTitle: "The calculator site is asking for a security check",
  challengeHint:
    'This is the real calculator page, shown live from wherever the automation is running. Tick "Verify you are human" below — the check only counts when a person does it, and the calculation continues by itself afterwards. Your patient values have not been sent anywhere yet.',
  challengeTypePlaceholder: "Type here only if the check asks for text",
  challengeSend: "Send",
  challengeWaiting: (seconds: number) =>
    `Waiting ${seconds}s — the run gives up after 3 minutes, and then you can simply calculate again.`,
  calcFailed: "Calculation failed.",
  calcErrorHint:
    'The automated calculator may be unreachable, or its form may have changed. Use "Copy values" and "Open calculator manually" above to enter them yourself.',

  resultsTitle: "Results",
  recommendedFor: (side: string) => `${side} — Recommended IOL`,
  colPower: "IOL Power",
  colOptic: "Optic",
  colRefraction: "Refraction",
  closestToZero: "closest to 0",
  rawText: "Raw calculator text",
  lensUsed: (lens: string, constants: string) =>
    `Calculated with ${lens}${constants} — as read back off the calculator page.`,
  verifyAgainst: "Verify these figures against calc.apacrs.org before using them clinically.",

  batchTitle: (count: number) => `Batch — ${count} photo${count === 1 ? "" : "s"}`,
  batchHint:
    "One patient per photo. Every photo is read, then listed here for you to check before anything is calculated — same rules as a single patient, just without the repetition. Correct anything that looks wrong, then calculate them all in one go.",
  batchClose: "Back to one patient",
  batchCounts: (scanning: number, ready: number, done: number, failed: number) =>
    `${scanning} reading · ${ready} to review · ${done} calculated · ${failed} failed.`,
  batchIncomplete: (count: number) =>
    `${count} could not be read completely — fill those in or they will be skipped.`,
  batchCalculateAll: (count: number) => `Calculate ${count} patient${count === 1 ? "" : "s"}`,
  batchDownloadAll: (count: number) =>
    `Download ${count} record${count === 1 ? "" : "s"} (one PDF)`,
  batchCalculatingHint:
    "Calculations run two at a time against the official calculator, so a full day takes a couple of minutes. You can keep this tab open and check the results as they land.",
  batchScanUnavailable:
    "Batch reading needs the server's vision model (ANTHROPIC_API_KEY). Without it, photos have to be read one at a time on this device.",
  batchPartialEye: (side: string, fields: string) =>
    `${side} is missing ${fields}, so it is left out of this patient's calculation. Fill those in to include it.`,
  batchStale:
    "These values changed after the calculation — the result below is from the old ones. Calculate again to update it.",
  batchStaleCount: (count: number) => `${count} changed after being calculated.`,
  batchStatusScanning: "reading…",
  batchStatusReady: "to review",
  batchStatusCalculating: "calculating…",
  batchStatusDone: "done",
  batchStatusFailed: "failed",
  batchUploadHint: "Selecting several photos at once opens the batch view — one patient per photo.",

  recordTitle: "Medical record (PDF)",
  recordHint:
    "Saves the measurements and the recommended IOL as a one-page PDF, on this device only — nothing is uploaded. The name is filled in from the photo when it's legible; check it before saving.",
  recordName: "Patient name (for the record)",
  recordNamePlaceholder: "Leave blank to omit",
  recordDownload: "Download PDF record",
  recordOpeningLine: "PATIENT ATTENDED FOR EXAMS:",
  recordRetina: "RETINAL MAPPING:",
  recordRetinaDefault:
    "CLEAR MEDIA ; RETINA ATTACHED 360 ; PINK DISC ; PHYSIOLOGIC CUP ; VESSELS UNREMARKABLE.",
  recordBiometry: "BIOMETRY:",
  recordTopography: "TOPOGRAPHY:",
  recordLensCalculation: "LENS CALCULATION:",
  recordLensLine: "Recommended IOL",

  /**
   * The consultation, as it reads in a record.
   *
   * Only what was actually ticked reaches these lines. An unanswered box
   * produces nothing at all — a record is read as a set of observations,
   * and "not recorded" must never come out looking like "normal".
   */
  recordPreOp: "PRE-OPERATIVE FINDINGS:",
  recordConsultationOn: (date: string) => `From the consultation of ${date}.`,
  recordRetinaFinding: {
    "Sem alterações": "NO ALTERATIONS.",
    "Opacidade de meios": "MEDIA OPACITY.",
  } as Record<string, string>,
  recordFlagIfis: (level: string): string =>
    level === "Presente" ? "FLOPPY IRIS SYNDROME (IFIS) PRESENT" : "SUSPECTED FLOPPY IRIS (IFIS)",
  recordFlagDilation: (level: string): string =>
    level === "Insuficiente" ? "INSUFFICIENT PUPIL DILATION" : "FAIR PUPIL DILATION",
  recordFlagTansulosin: "TAKING TAMSULOSIN / ALPHA-BLOCKER",
  recordFlagDm2: "DM2",
  recordFlagHas: "SYSTEMIC HYPERTENSION",
  recordFlagGlaucoma: "GLAUCOMA",
  recordFlagPreviousSurgery: "PREVIOUS OCULAR SURGERY",
  recordFlagAnteriorSegment: (finding: string) => `ANTERIOR SEGMENT: ${finding}`,
  recordFlagCataractNuclear: (grade: string) => `NUCLEAR CATARACT ${grade.toUpperCase()}`,
  recordFlagCataractCortical: (grade: string) => `${grade.toUpperCase()} CORTICAL CATARACT`,
  recordFlagCataractSubcapsular: "POSTERIOR SUBCAPSULAR CATARACT",
  recordFlagCataractOther: (kind: string) => `${kind.toUpperCase()} CATARACT`,
  recordCopy: "Copy record",
  recordCopySource: "Copy as source code (HTML)",
  recordSourceHint:
    'Two ways to paste into the hospital system. "Copy record" works for a normal paste. If the editor drops the spacing, use "Copy as source code", click Código-Fonte there, paste, and click it again — nothing filters a paste made in that view.',
  recordShowSource: "Show the source code",
  recordCopied: "Copied — paste it into the hospital system",
  recordSourceCopied: "Source code copied — paste it in Código-Fonte",
  recordCopyHint:
    "The PDF is for filing; the copy buttons are for pasting into a hospital system, laid out the way its own notes are written.",
  batchCopyAll: (count: number) => `Copy ${count} record${count === 1 ? "" : "s"}`,
  batchCopySourceAll: (count: number) =>
    `Copy ${count} record${count === 1 ? "" : "s"} as source code`,

  pdfTitle: "IOL Calculation Record",
  pdfSubtitle: "Barrett Universal II formula - calc.apacrs.org",
  pdfPatient: "Patient",
  pdfDate: "Date",
  pdfLens: "Lens",
  pdfKIndex: "K Index",
  pdfEyeOd: "OD - Right eye",
  pdfEyeOs: "OS - Left eye",
  pdfAxialLength: "Axial Length",
  pdfK1: "Measured K1",
  pdfK2: "Measured K2",
  pdfAcd: "Optical ACD",
  pdfLensThickness: "Lens Thickness",
  pdfWtw: "WTW",
  pdfTargetRefraction: "Target Refraction",
  pdfRecommended: (power: string) => `Recommended IOL: ${power} D`,
  pdfPredicted: (refraction: string) => `predicted refraction ${refraction} D`,
  pdfNoRecommendation: "Recommended IOL: not reported by the calculator",
  pdfLensFactor: (value: string) => `Lens Factor ${value}`,
  pdfAConstant: (value: string) => `A Constant ${value}`,
  pdfFooterValues:
    "Values read from the exam printouts and confirmed by the clinician before calculation.",
  pdfFooterFormula:
    "Computed with the Barrett Universal II calculator. Verify before surgical planning.",
  pdfUnnamed: "unnamed",
};

export type Strings = typeof en;

const pt: Strings = {
  langName: "Português",
  title: "Assistente de Cálculo de LIO",
  disclaimerIntro:
    "Esta ferramenta apenas agiliza a digitação dos valores de biometria/topografia na calculadora Barrett Universal II. Ela não substitui o julgamento clínico. ",
  disclaimerVerify:
    "Confira sempre cada valor — principalmente os lidos da foto — e confirme o poder final da LIO na calculadora oficial antes de usá-lo no planejamento cirúrgico.",
  disclaimerPhotoBefore: " As fotos são lidas por um modelo de visão, ou seja, ",
  disclaimerPhotoStrong: "a imagem sai deste computador",
  disclaimerPhotoAfter:
    ". Na foto de exame, só o nome do paciente é lido — para encabeçar o prontuário em PDF — e nada fica guardado depois. Com a ficha de consulta é diferente: o nome, o CPF, a data de nascimento e o prontuário nela contidos ficam guardados no computador que roda este aplicativo.",

  captureLabel: "1. Fotografe os exames impressos",
  captureHint:
    "Uma foto da tira de ceratometria e da biometria juntas — ou de apenas uma delas. Mantenha o papel plano e bem iluminado.",
  captureUseCamera: "Usar câmera",
  captureRetake: "Repetir foto",
  captureTake: "Capturar",
  captureUpload: "Enviar foto",
  captureBusy: "Lendo os números da foto…",
  captureNoCamera: "Não foi possível acessar a câmera. Você pode enviar uma foto.",

  scanFallbackNote:
    "Leitura feita neste dispositivo — o servidor não tem modelo de visão configurado (ANTHROPIC_API_KEY), então a precisão é muito menor. Confira todos os valores.",
  scanNothing:
    "Não foi possível ler nenhum valor dessa foto. Deixe o impresso plano, bem iluminado e grande o suficiente para os dígitos ficarem legíveis — refaça a foto ou digite os valores abaixo.",
  scanNothingReadable: "(nada legível)",
  scanNoK: "Nenhum valor de K foi encontrado — digite K1/K2 dos dois olhos.",
  scanOneK: (read: string, missing: string) =>
    `Os valores de K só foram lidos para ${read} — digite os de ${missing}.`,
  scanNoBiometry: "Nenhum valor de comprimento axial / ACD foi encontrado — digite-os.",
  scanOneBiometry: (read: string, missing: string) =>
    `Comprimento axial / ACD só foram lidos para ${read} — digite os de ${missing}.`,
  scanUnlabeledEye:
    'Só havia um olho nesta foto e a marcação OD/OS não estava legível, então ele foi registrado como OD. Confira a linha "Sex:… OD/OS …" do impresso e mova os valores se for o olho esquerdo.',
  scanNoName: "O nome do paciente não estava legível na foto — digite-o para o prontuário em PDF.",
  scanFailedSuffix: (message: string) =>
    `${message} Você pode refazer a foto ou digitar os valores abaixo.`,
  scanFailedGeneric:
    "A leitura dessa foto falhou. Você pode refazê-la ou digitar os valores abaixo.",
  scanShowRaw: "Mostrar o que a leitura conseguiu extrair",

  reviewTitle: "2. Revise e complete",
  reviewHint:
    "Confira cada valor lido da foto. K1 tem de ser o menor dos dois valores — o meridiano mais plano. Se não for, aquele olho fica retido em vez de ser corrigido sozinho: um par invertido é erro de transcrição, e qual dos valores está errado não é algo que o app possa saber. A refração alvo vem como 0 (emetropia) — altere apenas se o plano for outro. Os campos de Opcional: nunca são lidos da foto; digite-os se tiver os valores. Para calcular um olho só, preencha apenas esse olho — use \"Limpar\" para esvaziar o outro.",
  lensLabel: "Lente",
  fieldLensFactor: "Lens Factor",
  fieldAConstant: "Constante A",
  kIndexLabel: "Índice K",
  constantsUnavailable:
    "Não foi possível consultar a calculadora para saber a constante correspondente, então esse campo fica vazio. Isso não impede nada: o valor que você definiu é o que será enviado, e a calculadora calcula o outro sozinha.",
  constantsAsking:
    "Perguntando à calculadora qual fica a outra constante — quem decide isso é ela, não este app, então os dois sempre batem.",
  kOrderWarning: (side: string, k1: string, k2: string) =>
    `⚠ ${side}: K1 (${k1}) está acima de K2 (${k2}). K1 é o meridiano mais plano, então esse par está invertido ou digitado errado — esse olho não será calculado até ser corrigido.`,
  planSuspect: (sides: string) =>
    `${sides} ficou de fora: K1 está acima de K2, o que não existe numa córnea real. Corrija os valores para incluí-lo.`,
  batchSuspectCount: (count: number) =>
    `⚠ ${count} linha${count === 1 ? "" : "s"} com K1 acima de K2 — não calculadas até serem corrigidas.`,
  kIndexHint: (defaultIndex: string) =>
    `O índice ceratométrico com que a calculadora lê seus valores de K. Mantenha em ${defaultIndex}, a menos que seu ceratômetro use o outro — alterá-lo muda todos os poderes calculados.`,
  lensPersonalNote: (model: string) =>
    `LIO: ${model} · as duas constantes acima são digitadas e enviadas em todo cálculo. Elas começam com os valores próprios deste serviço; altere qualquer uma para usar outros.`,
  lensNamedNote: (lens: string) =>
    `${lens} é selecionada na própria calculadora, que aplica as constantes dessa lente — os valores acima são apenas referência e não são enviados. Volte para "Personal Constant" para digitar as constantes. As constantes realmente usadas aparecem junto com os resultados.`,
  lensConstantsUnknown: (lens: string) =>
    `As constantes da ${lens} ainda não estão cadastradas aqui; a calculadora usa as dela e as informa junto com os resultados.`,
  planBadLensFactor: (min: number, max: number) =>
    `O Lens Factor precisa ser um número entre ${min} e ${max} (faixa da própria calculadora).`,
  planBadAConstant: (min: number, max: number) =>
    `A Constante A precisa ser um número entre ${min} e ${max} (faixa da própria calculadora).`,

  eyeOd: "OD (olho direito)",
  eyeOs: "OS (olho esquerdo)",
  clearEye: (side: string) => `Limpar ${side}`,
  fieldAxialLength: "Comprimento axial",
  fieldK1: "K1 medido",
  fieldK2: "K2 medido",
  fieldAcd: "ACD óptica",
  fieldRefraction: "Refração (alvo)",
  fieldLensThickness: "Espessura do cristalino",
  fieldWtw: "WTW (branco a branco)",
  optionalHeading: "Opcional:",

  calculate: "Calcular com a Barrett Universal II",
  calculateOne: (side: string) => `Calcular ${side} com a Barrett Universal II`,
  calculating: "Calculando…",
  copyValues: "Copiar valores",
  copied: "Copiado!",
  openCalculator: "Abrir a calculadora manualmente",
  noValuesToCopy: "Nenhum valor digitado ainda.",
  planSkipped: (side: string, fields: string) =>
    `Falta ${fields} no ${side}, então ele fica de fora do cálculo — a calculadora o rejeitaria. Preencha esses valores para incluí-lo.`,
  planNothingComplete: (fields: string) =>
    `Nenhum olho tem todos os valores ainda — falta ${fields}. Preencha para calcular.`,
  planEmpty: "Preencha todos os campos de pelo menos um olho para liberar o cálculo.",
  cloudflareHint:
    'Normalmente nada mais é preciso. Se o site da calculadora pedir verificação de segurança, ela aparece aqui para ser feita à mão — clique em "Verify you are human" e o cálculo continua sozinho.',
  formReviewTitle: "Confira a ficha antes de guardar",
  formHandwritingWarning:
    "⚠ Isto foi lido de letra manuscrita, bem menos confiável que um exame impresso. Confira cada campo contra o papel — esta tela é o único lugar onde um erro de leitura é corrigido.",
  formNotRead: "não lido",
  formUnreadCount: (count: number) =>
    `${count} campo${count === 1 ? "" : "s"} não pôde${count === 1 ? "" : "ram"} ser lido${count === 1 ? "" : "s"} e está${count === 1 ? "" : "ão"} marcado${count === 1 ? "" : "s"} como "não lido" abaixo. Em branco significa que o modelo leu o espaço como vazio; "não lido" significa que ele não conseguiu distinguir.`,
  formTwoTicked: "duas marcadas",
  formAmbiguousCount: (count: number) =>
    `⚠ ${count} campo${count === 1 ? "" : "s"} ${count === 1 ? "está" : "estão"} com mais de uma caixa marcada no papel. O aplicativo não escolhe entre elas — marque a correta, ou deixe sem resposta.`,
  formDetailPlaceholder: "o que estava escrito na linha",
  formNeedsIdentity:
    "Para salvar são necessários o nome e o CPF ou a data de nascimento — são as duas formas de reencontrar esta consulta no dia do exame. O resto pode ficar em branco.",
  formCpfInvalid:
    "⚠ Os dígitos verificadores deste CPF não fecham, ou seja, algum algarismo foi lido ou escrito errado. Confira no papel. Ainda assim pode ser salvo — a própria ficha às vezes vem errada — mas o paciente será reencontrado pelo nome e data de nascimento.",
  formCpfMismatch: (cpf: string, stored: string, scanned: string) =>
    `⚠ O CPF ${cpf} já está guardado para ${stored}, não para ${scanned || "este paciente"}. Normalmente é um dígito lido errado. Confira o número no papel — salvar agora arquivaria esta consulta no paciente errado.`,
  formCpfKnown: (name: string) =>
    `Este CPF já está em ${name}; salvar acrescenta mais uma consulta a esse mesmo paciente.`,
  formBirthKnown: (name: string) =>
    `${name} já está cadastrado com esta data de nascimento; salvar acrescenta mais uma consulta a esse mesmo paciente.`,
  formConfirmMerge: "Salvar mesmo assim — é o mesmo paciente",
  formSave: "Salvar esta consulta",
  formSaving: "Salvando…",
  formCancel: "Cancelar",
  formSaveFailed: "Não foi possível salvar esta consulta.",
  formFieldsUnavailable: "Não foi possível carregar os campos da ficha do servidor.",
  formImportLabel: "Ou envie uma ficha de diagnóstico — foto, PDF ou Word",
  formStorageNote:
    "Foto ou PDF são enviados ao serviço de leitura. Um arquivo do Word é lido aqui mesmo e não sai deste computador. De todo modo, o nome, o CPF, a data de nascimento e o prontuário da ficha ficam guardados no computador que roda este aplicativo, para que a biometria os encontre no dia do exame — a foto ou o arquivo, não. Ainda não há login, então use pacientes inventados.",
  formWordNoMarks:
    "Esse arquivo do Word não tem nenhuma caixa marcada. Marcas digitadas no documento (☒, ou uma caixa de seleção clicada no Word) são lidas com exatidão — mas uma marca feita por cima da página com caneta ou stylus é um desenho, e o arquivo não dá sinal dela. Os campos digitados estão abaixo; marque o resto à mão, ou envie uma foto ou PDF para que sejam lidos.",
  formReading: "Lendo a ficha…",
  formSeenOn: "Data desta consulta",
  formSaved: (name: string, how: string) =>
    `Salvo: ${name} (${how}). No dia do exame, a biometria encontra esta consulta por isso.`,
  matchTitle: "Anexar a consulta da primeira visita deste paciente",
  matchHint:
    "Se a ficha deste paciente foi fotografada em uma consulta anterior, os achados dela entram neste prontuário — inclusive o que o examinador realmente viu na fundoscopia, no lugar do texto padrão.",
  matchCpfLabel: "CPF",
  matchDobLabel: "Data de nascimento",
  matchSearch: "Procurar este paciente",
  matchNeedsName: "Digite o nome do paciente acima e a busca acontece sozinha.",
  matchOtherWays: "Não é este paciente? Procure por CPF ou data de nascimento",
  matchIdentityCpf: (cpf: string) => `CPF ${cpf}`,
  matchIdentityBirth: (date: string) => `nascido em ${date}`,
  matchIdentityNameOnly: "sem CPF ou data de nascimento cadastrados",
  matchConfirmQuestion:
    "Encontrado pelo nome. Confira o CPF ou a data de nascimento acima com o paciente à sua frente antes de confirmar — isto anexa a consulta dele às medidas de hoje.",
  matchReject: "Não é este paciente",
  matchSearching: "Procurando…",
  matchNone:
    "Nenhuma consulta guardada para este paciente. O prontuário sai apenas com as medidas, como antes.",
  matchStoreNew: "Guardar este exame em um paciente novo",
  matchStoredNew: (name: string) =>
    `${name} agora está cadastrado com este exame. Quando a ficha for fotografada, ela se junta a esse mesmo paciente.`,
  matchNoKey: "Informe o CPF, ou a data de nascimento para acompanhar o nome acima.",
  matchByCpf: "Encontrado pelo CPF.",
  matchByBirth: "Encontrado pelo nome e data de nascimento.",
  matchMismatch: (stored: string, scanned: string) =>
    `⚠ Esse CPF é de ${stored}, não de ${scanned || "este paciente"}. Normalmente é um dígito lido errado. Nada foi anexado — confira o número antes de seguir.`,
  matchCandidates: (count: number) =>
    `${count} pacientes têm esse nome. Escolha o certo — a data de nascimento e a última consulta estão aí para diferenciar.`,
  matchNoConsultation: "Esse paciente ainda não tem consulta guardada, apenas este exame.",
  matchStoredSide: "Consulta guardada",
  matchMeasuredSide: "Medido hoje",
  matchNothingRecorded: "Nada foi marcado naquela ficha que o prontuário fosse carregar.",
  matchConfirm: "Sim — é o mesmo paciente",
  matchAttached: (name: string) =>
    `Anexado a ${name}. Os achados abaixo estão no prontuário, e este exame ficou guardado nesse paciente.`,
  matchDetach: "Desfazer",
  matchExamSaved: "Este exame agora está guardado junto ao paciente.",
  matchExamFailed:
    "A consulta foi anexada ao prontuário, mas não foi possível guardar este exame no servidor.",
  matchNoCpfInList:
    "Uma planilha não traz CPF, então aqui o paciente só pode ser procurado pelo nome — e nome se repete. Confira a data de nascimento antes de anexar.",
  navLabel: "Seções",
  navForm: "Ficha de consulta",
  navBiometry: "Biometria",
  navStatistics: "Estatísticas",
  navPatients: "Pacientes",

  formPageTitle: "Fotografe uma ficha de consulta",
  formPageHint:
    "A Ficha de Diagnóstico preenchida na primeira consulta do paciente. Envie uma foto do papel, um PDF ou o arquivo do Word — você confere tudo o que for lido antes de ser guardado.",

  formCorrectTitle: "Corrigir esta consulta",
  formSaveCorrection: "Salvar a correção",

  statsTitle: "Estatísticas",
  statsComingSoon:
    "Ainda não construído — é o próximo passo. Vai contar sobre todas as consultas guardadas, com filtros nos campos que a ficha já registra:",
  statsPlanned: [
    "Dilatação pupilar — a lista de pacientes difíceis de dilatar",
    "IFIS suspeita ou presente, e uso de tansulosina",
    "DM2, HAS e glaucoma",
    "Grau e tipo da catarata",
    "Cruzamentos que valem a pena, como tansulosina × IFIS",
  ] as readonly string[],

  patientsTitle: "Pacientes",
  patientsHint:
    "Todos os cadastrados neste computador. Abra um para ver tudo o que está guardado sobre ele.",
  patientsFilter: "Procurar paciente",
  patientsFilterPlaceholder: "nome ou CPF",
  patientsLoading: "Carregando…",
  patientsLoadFailed: "Não foi possível carregar a lista de pacientes.",
  patientsEmpty:
    "Nenhum paciente guardado ainda. Eles aparecem aqui assim que uma ficha for salva.",
  patientsNoneMatch: "Nenhum paciente corresponde a isso.",
  patientsCount: (count: number) => `${count} paciente${count === 1 ? "" : "s"}.`,
  patientsBack: "← Todos os pacientes",
  patientsAge: (years: number) => `${years} anos`,
  patientsProntuario: (value: string) => `prontuário ${value}`,
  patientsConsultations: (count: number) => (count === 1 ? "1 consulta" : `${count} consultas`),
  patientsNoConsultations: "Nenhuma ficha guardada para este paciente ainda.",
  patientsExams: (count: number) => (count === 1 ? "1 exame" : `${count} exames`),
  patientsNoExams: "Nenhuma biometria guardada para este paciente ainda.",
  patientsCorrect: "Corrigir esta consulta",
  patientsRemoveVisit: "Remover esta consulta",
  patientsRemoveVisitConfirm: "Sim, remover",
  patientsRemoveVisitWarning:
    "⚠ Isto remove apenas esta consulta. O paciente e os exames dele permanecem. Não há como desfazer.",
  patientsRemoveVisitFailed: "Não foi possível remover essa consulta.",
  patientsNoPhotos:
    "As fotos em si nunca foram guardadas — apenas os valores lidos delas, que são tudo o que está acima. Isso é proposital: uma ficha preenchida é a coisa mais identificável que este aplicativo manipula.",
  patientsDeleteTitle: "Remover este paciente",
  patientsDeleteWarning: (name: string) =>
    `⚠ Isto apaga ${name} e todas as consultas e exames guardados dele. Não há como desfazer, e não existe login na frente disso — faça um backup na página da ficha antes, se estiver em dúvida.`,
  patientsDeleteConfirmLabel: "Digite o nome do paciente para confirmar",
  patientsDelete: "Apagar definitivamente",
  patientsDeleting: "Apagando…",
  patientsDeleteFailed: "Não foi possível apagar esse paciente.",

  databaseExport: "Baixar um backup do banco de dados",
  listImportLabel: "Ou importe uma lista de pacientes (.xlsx ou .csv)",
  listImporting: "Lendo a lista…",
  listImported: (count: number) =>
    `${count} paciente${count === 1 ? "" : "s"} lido${count === 1 ? "" : "s"}. Confira os valores antes de calcular — nada foi enviado a lugar nenhum ainda.`,
  listDiscardedCount: (count: number) =>
    `${count} olho${count === 1 ? " ficou" : "s ficaram"} de fora por falta de medidas; cada um está indicado na sua linha.`,
  listNothingUsable: (names: string) =>
    `Estes não têm nenhum olho com as quatro medidas, então não há o que calcular para eles: ${names}.`,
  listDiscardedEye: (side: string, missing: string) =>
    `${side} ficou de fora da lista — sem ${missing}.`,
  listSuspectEye: (side: string, k1: string, k2: string) =>
    `${side} NÃO foi importado: a lista traz K1 ${k1} acima de K2 ${k2}, o que não pode estar certo — K1 é o meridiano mais plano. Confira a origem e digite os dois valores.`,
  listSuspectCount: (count: number) =>
    `⚠ ${count} olho${count === 1 ? "" : "s"} com K1 acima de K2 na lista — erro de transcrição, não medida. Esses valores não foram importados; cada linha indica qual olho.`,
  listNoPatients: "Essa planilha tem os cabeçalhos certos, mas nenhuma linha de paciente abaixo deles.",
  listFailed: "Não foi possível ler esse arquivo.",

  handoffSend: "Continuar em outro dispositivo",
  handoffCodeHint: (count: number) =>
    `${count} paciente${count === 1 ? "" : "s"} salvo${count === 1 ? "" : "s"}. Digite este código no app do outro dispositivo para continuar por lá. As fotos ficam neste aparelho — o que viaja são os valores e os resultados.`,
  handoffCodeExpiry: (time: string) =>
    `O código funciona uma vez, e só até ${time}. Nada é gravado em disco no servidor.`,
  handoffOpenLabel: "Ou retome o trabalho de outro dispositivo",
  handoffCodePlaceholder: "Código do outro dispositivo",
  handoffOpen: "Abrir",
  handoffOpening: "Abrindo…",
  handoffFailed: "Não foi possível falar com o servidor para transferir o trabalho.",
  handoffUnreadable:
    "O código abriu, mas o conteúdo não é um dia de trabalho que esta versão entenda. Verifique se os dois dispositivos estão na mesma versão.",

  challengeTitle: "O site da calculadora está pedindo uma verificação de segurança",
  challengeHint:
    'Esta é a página real da calculadora, mostrada ao vivo de onde a automação está rodando. Marque "Verify you are human" abaixo — a verificação só vale quando uma pessoa a faz, e depois o cálculo segue sozinho. Os valores do paciente ainda não foram enviados a lugar nenhum.',
  challengeTypePlaceholder: "Digite aqui só se a verificação pedir texto",
  challengeSend: "Enviar",
  challengeWaiting: (seconds: number) =>
    `Aguardando ${seconds}s — a tentativa desiste após 3 minutos, e aí é só calcular de novo.`,
  calcFailed: "O cálculo falhou.",
  calcErrorHint:
    'A calculadora automatizada pode estar inacessível ou o formulário dela pode ter mudado. Use "Copiar valores" e "Abrir a calculadora manualmente" acima para digitá-los você mesmo.',

  resultsTitle: "Resultados",
  recommendedFor: (side: string) => `${side} — LIO recomendada`,
  colPower: "Poder da LIO",
  colOptic: "Óptica",
  colRefraction: "Refração",
  closestToZero: "mais próximo de 0",
  rawText: "Texto bruto da calculadora",
  lensUsed: (lens: string, constants: string) =>
    `Calculado com ${lens}${constants} — conforme lido de volta na página da calculadora.`,
  verifyAgainst: "Confira estes valores em calc.apacrs.org antes de usá-los clinicamente.",

  batchTitle: (count: number) => `Lote — ${count} foto${count === 1 ? "" : "s"}`,
  batchHint:
    "Um paciente por foto. Cada foto é lida e listada aqui para você conferir antes de qualquer cálculo — as mesmas regras de um paciente só, sem a repetição. Corrija o que estiver errado e calcule todos de uma vez.",
  batchClose: "Voltar para um paciente",
  batchCounts: (scanning: number, ready: number, done: number, failed: number) =>
    `${scanning} lendo · ${ready} para revisar · ${done} calculados · ${failed} com falha.`,
  batchIncomplete: (count: number) =>
    `${count} não puderam ser lidos por completo — preencha-os ou serão ignorados.`,
  batchCalculateAll: (count: number) => `Calcular ${count} paciente${count === 1 ? "" : "s"}`,
  batchDownloadAll: (count: number) =>
    `Baixar ${count} prontuário${count === 1 ? "" : "s"} (um PDF)`,
  batchCalculatingHint:
    "Os cálculos rodam dois por vez na calculadora oficial, então um dia inteiro leva alguns minutos. Você pode deixar esta aba aberta e acompanhar os resultados chegando.",
  batchScanUnavailable:
    "A leitura em lote precisa do modelo de visão no servidor (ANTHROPIC_API_KEY). Sem ele, as fotos precisam ser lidas uma a uma neste dispositivo.",
  batchPartialEye: (side: string, fields: string) =>
    `Falta ${fields} no ${side}, então ele fica de fora do cálculo deste paciente. Preencha esses valores para incluí-lo.`,
  batchStale:
    "Estes valores mudaram depois do cálculo — o resultado abaixo é dos valores antigos. Calcule de novo para atualizar.",
  batchStaleCount: (count: number) => `${count} mudaram depois de calculados.`,
  batchStatusScanning: "lendo…",
  batchStatusReady: "para revisar",
  batchStatusCalculating: "calculando…",
  batchStatusDone: "pronto",
  batchStatusFailed: "falhou",
  batchUploadHint: "Selecionar várias fotos de uma vez abre a visão em lote — um paciente por foto.",

  recordTitle: "Prontuário (PDF)",
  recordHint:
    "Salva as medidas e a LIO recomendada em um PDF de uma página, somente neste dispositivo — nada é enviado. O nome vem da foto quando está legível; confira antes de salvar.",
  recordName: "Nome do paciente (para o prontuário)",
  recordNamePlaceholder: "Deixe em branco para omitir",
  recordDownload: "Baixar prontuário em PDF",
  recordOpeningLine: "PACIENTE VEM PARA REALIZAR EXAMES:",
  recordRetina: "MAPEAMENTO RETINA:",
  recordRetinaDefault:
    "MEIOS TRANSPARENTES ; RETINA APLICADA 360 ; NERVO CORADO ; ESCV FISIOLOGICA ; VASOS SEM ALTERAÇOES.",
  recordBiometry: "BIOMETRIA:",
  recordTopography: "TOPOGRAFIA:",
  recordLensCalculation: "CALCULO DA LENTE:",
  recordLensLine: "LIO recomendada",

  recordPreOp: "ACHADOS PRÉ-OPERATÓRIOS:",
  recordConsultationOn: (date: string) => `Da consulta de ${date}.`,
  recordRetinaFinding: {
    "Sem alterações": "SEM ALTERAÇÕES.",
    "Opacidade de meios": "OPACIDADE DE MEIOS.",
  } as Record<string, string>,
  recordFlagIfis: (level: string) =>
    level === "Presente" ? "SÍNDROME DA ÍRIS FLÁCIDA (IFIS) PRESENTE" : "SUSPEITA DE IFIS",
  recordFlagDilation: (level: string) =>
    level === "Insuficiente" ? "DILATAÇÃO PUPILAR INSUFICIENTE" : "DILATAÇÃO PUPILAR REGULAR",
  recordFlagTansulosin: "EM USO DE TANSULOSINA / ALFABLOQUEADOR",
  recordFlagDm2: "DM2",
  recordFlagHas: "HAS",
  recordFlagGlaucoma: "GLAUCOMA",
  recordFlagPreviousSurgery: "CIRURGIA OCULAR PRÉVIA",
  recordFlagAnteriorSegment: (finding: string) => `SEGMENTO ANTERIOR: ${finding}`,
  recordFlagCataractNuclear: (grade: string) => `CATARATA NUCLEAR ${grade.toUpperCase()}`,
  recordFlagCataractCortical: (grade: string) => `CATARATA CORTICAL ${grade.toUpperCase()}`,
  recordFlagCataractSubcapsular: "CATARATA SUBCAPSULAR POSTERIOR",
  recordFlagCataractOther: (kind: string) => `CATARATA ${kind.toUpperCase()}`,
  recordCopy: "Copiar prontuário",
  recordCopySource: "Copiar código-fonte (HTML)",
  recordSourceHint:
    'Duas formas de colar no sistema do hospital. "Copiar prontuário" serve para colar normalmente. Se o editor perder o espaçamento, use "Copiar código-fonte", clique em Código-Fonte lá, cole e clique de novo — nada filtra o que é colado nessa visão.',
  recordShowSource: "Ver o código-fonte",
  recordCopied: "Copiado — cole no sistema do hospital",
  recordSourceCopied: "Código-fonte copiado — cole em Código-Fonte",
  recordCopyHint:
    "O PDF é para arquivo; os botões de copiar são para colar no sistema do hospital, no mesmo formato das evoluções de lá.",
  batchCopyAll: (count: number) => `Copiar ${count} prontuário${count === 1 ? "" : "s"}`,
  batchCopySourceAll: (count: number) =>
    `Copiar ${count} prontuário${count === 1 ? "" : "s"} como código-fonte`,

  pdfTitle: "Prontuário de Cálculo de LIO",
  pdfSubtitle: "Fórmula Barrett Universal II - calc.apacrs.org",
  pdfPatient: "Paciente",
  pdfDate: "Data",
  pdfLens: "Lente",
  pdfKIndex: "Índice K",
  pdfEyeOd: "OD - Olho direito",
  pdfEyeOs: "OS - Olho esquerdo",
  pdfAxialLength: "Comprimento axial",
  pdfK1: "K1 medido",
  pdfK2: "K2 medido",
  pdfAcd: "ACD óptica",
  pdfLensThickness: "Espessura do cristalino",
  pdfWtw: "WTW",
  pdfTargetRefraction: "Refração alvo",
  pdfRecommended: (power: string) => `LIO recomendada: ${power} D`,
  pdfPredicted: (refraction: string) => `refração prevista ${refraction} D`,
  pdfNoRecommendation: "LIO recomendada: não informada pela calculadora",
  pdfLensFactor: (value: string) => `Lens Factor ${value}`,
  pdfAConstant: (value: string) => `Constante A ${value}`,
  pdfFooterValues:
    "Valores lidos dos exames impressos e conferidos pelo médico antes do cálculo.",
  pdfFooterFormula:
    "Calculado com a Barrett Universal II. Confira antes do planejamento cirúrgico.",
  pdfUnnamed: "sem-nome",
};

export const STRINGS: Record<Lang, Strings> = { en, pt };

const STORAGE_KEY = "barrett.lang";

/** Remembers the choice, and starts in Portuguese for a pt-* browser. */
export function initialLanguage(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "pt") return stored;
  } catch {
    // Private-mode browsers can throw on storage access; the default is fine.
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pt")
    ? "pt"
    : "en";
}

export function rememberLanguage(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not being able to remember the choice is not worth an error.
  }
}
