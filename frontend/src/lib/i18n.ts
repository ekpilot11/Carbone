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
  disclaimerPhotoAfter:
    ". The patient's name is read from the photo to head the PDF record; no other identifier is read. Nothing is stored or logged.",

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
    "Check every value read from the photo. The printout doesn't label which K is which, so K1 is always the lower of the two values (swapped automatically if entered the other way round). Refraction target defaults to 0 (emmetropia) — change it only when the plan differs. The Optional: fields are never read from the photo; type them in if you have them. To calculate a single eye, fill in only that eye — use \"Clear\" to empty the other one.",
  lensLabel: "Lens",
  fieldLensFactor: "Lens Factor",
  fieldAConstant: "A Constant",
  kIndexLabel: "K Index",
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
    'Usually nothing else is needed. If the calculator site asks for a security check, a browser window opens on the computer running the backend — click "Verify you are human" there and the calculation continues automatically.',
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
    ". O nome do paciente é lido da foto apenas para encabeçar o prontuário em PDF; nenhum outro identificador é lido. Nada é armazenado nem registrado em log.",

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
    "Confira cada valor lido da foto. O impresso não indica qual K é qual, então K1 é sempre o menor dos dois valores (trocados automaticamente se digitados ao contrário). A refração alvo vem como 0 (emetropia) — altere apenas se o plano for outro. Os campos de Opcional: nunca são lidos da foto; digite-os se tiver os valores. Para calcular um olho só, preencha apenas esse olho — use \"Limpar\" para esvaziar o outro.",
  lensLabel: "Lente",
  fieldLensFactor: "Lens Factor",
  fieldAConstant: "Constante A",
  kIndexLabel: "Índice K",
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
    'Normalmente nada mais é preciso. Se o site da calculadora pedir verificação de segurança, uma janela do navegador abre no computador que roda o backend — clique em "Verify you are human" lá e o cálculo continua sozinho.',
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
