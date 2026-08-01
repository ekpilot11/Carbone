/**
 * The lens choices of the calculator's own dropdown.
 *
 * Selecting one here makes the automation select the same option on
 * calc.apacrs.org, so the site applies that lens's constants itself — the
 * manufacturer constants are deliberately not copied into this app, where
 * they could drift out of date and silently produce a wrong IOL power.
 *
 * This list is a transcription of the site's dropdown and is only a
 * starting point: the app asks the backend for the live list on load and
 * replaces it when that succeeds. A name that no longer matches an option
 * on the site aborts the run with the site's actual list rather than
 * calculating with the wrong lens.
 */

export const PERSONAL_CONSTANT = "Personal Constant";

export const BUNDLED_LENS_OPTIONS: readonly string[] = [
  PERSONAL_CONSTANT,
  "Alcon SN60WF",
  "Alcon SN6AD",
  "Alcon SN6ATx",
  "Alcon SND1Tx",
  "Alcon SV25Tx",
  "Alcon TFNTx",
  "Alcon DFTx",
  "Alcon SA60AT",
  "Alcon MN60MA",
  "Rayner RayOne EMV",
  "J&J ZCB00",
  "J&J ZCT",
  "J&J ZCT(USA)",
  "J&J ZCU",
  "J&J DIU",
  "J&J ZKU",
  "J&J ZLU",
  "J&J AR40e",
  "J&J AR40M",
  "J&J ZXR00",
  "J&J ZXT",
  "J&J ZHR00V",
  "J&J ZHW",
  "Zeiss 409M",
  "Zeiss 709M",
  "Hoya iSert 251",
  "Hoya iSert 351",
  "Bausch & Lomb MX60",
  "Bausch & Lomb MX60T",
  "Bausch & Lomb MX60ET",
  "Bausch & Lomb MX60ET(USA)",
  "Bausch & Lomb BL1UT",
  "Bausch & Lomb LI60AO",
  "MBI T302A",
  "Lenstec SBL-3",
  "SIFI Mini WELL",
  "Ophtec 565",
];

export function isPersonalConstant(lens: string): boolean {
  return lens.replace(/\s+/g, " ").trim().toLowerCase() === PERSONAL_CONSTANT.toLowerCase();
}

/**
 * The constants the calculator shows for a given lens, so the form can
 * display them the moment that lens is picked.
 *
 * These are only mirrored for display: the automation selects the lens on
 * the site and lets the site apply its own constants, so an entry that
 * falls out of date shows a wrong number here but cannot change a
 * calculation. Entries are added only from the calculator's own screen —
 * never from memory.
 */
export const LENS_CONSTANTS: Record<string, { lensFactor: number; aConstant: number }> = {
  "Alcon SN6ATx": { lensFactor: 2.02, aConstant: 119.26 },
};

export function lensConstants(lens: string): { lensFactor: number; aConstant: number } | undefined {
  const wanted = lens.replace(/\s+/g, " ").trim().toLowerCase();
  const match = Object.entries(LENS_CONSTANTS).find(
    ([name]) => name.replace(/\s+/g, " ").trim().toLowerCase() === wanted,
  );
  return match?.[1];
}
