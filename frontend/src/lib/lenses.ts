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
 * calculation. Entries come from the calculator's own screen — never from
 * memory — and the pairs are cross-checked in lenses.test.ts against the
 * linear relation the site's own values follow.
 */
export const LENS_CONSTANTS: Record<string, { lensFactor: number; aConstant: number }> = {
  "Alcon SN60WF": { lensFactor: 1.88, aConstant: 118.99 },
  "Alcon SN6AD": { lensFactor: 1.89, aConstant: 119.01 },
  "Alcon SN6ATx": { lensFactor: 2.02, aConstant: 119.26 },
  "Alcon SND1Tx": { lensFactor: 2.07, aConstant: 119.36 },
  "Alcon SV25Tx": { lensFactor: 2.15, aConstant: 119.51 },
  "Alcon TFNTx": { lensFactor: 2.02, aConstant: 119.26 },
  "Alcon DFTx": { lensFactor: 1.96, aConstant: 119.15 },
  "Alcon SA60AT": { lensFactor: 1.64, aConstant: 118.53 },
  "Alcon MN60MA": { lensFactor: 1.99, aConstant: 119.2 },
  "Rayner RayOne EMV": { lensFactor: 1.51, aConstant: 118.29 },
  "J&J ZCB00": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J ZCT": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J ZCT(USA)": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J ZCU": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J DIU": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J ZKU": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J ZLU": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J AR40e": { lensFactor: 1.73, aConstant: 118.71 },
  "J&J AR40M": { lensFactor: 1.73, aConstant: 118.71 },
  "J&J ZXR00": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J ZXT": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J ZHR00V": { lensFactor: 2.09, aConstant: 119.39 },
  "J&J ZHW": { lensFactor: 2.09, aConstant: 119.39 },
  "Zeiss 409M": { lensFactor: 1.53, aConstant: 118.32 },
  "Zeiss 709M": { lensFactor: 1.62, aConstant: 118.5 },
  "Hoya iSert 251": { lensFactor: 1.61, aConstant: 118.48 },
  "Hoya iSert 351": { lensFactor: 1.61, aConstant: 118.48 },
  "Bausch & Lomb MX60": { lensFactor: 1.96, aConstant: 119.15 },
  "Bausch & Lomb MX60T": { lensFactor: 1.96, aConstant: 119.15 },
  "Bausch & Lomb MX60ET": { lensFactor: 1.96, aConstant: 119.15 },
  "Bausch & Lomb MX60ET(USA)": { lensFactor: 1.96, aConstant: 119.15 },
  "Bausch & Lomb BL1UT": { lensFactor: 1.99, aConstant: 119.2 },
  "Bausch & Lomb LI60AO": { lensFactor: 1.66, aConstant: 118.57 },
  "MBI T302A": { lensFactor: 1.7, aConstant: 118.65 },
  "Lenstec SBL-3": { lensFactor: 1.24, aConstant: 117.77 },
  "SIFI Mini WELL": { lensFactor: 1.75, aConstant: 118.74 },
  "Ophtec 565": { lensFactor: 1.61, aConstant: 118.48 },
};

export function lensConstants(lens: string): { lensFactor: number; aConstant: number } | undefined {
  const wanted = lens.replace(/\s+/g, " ").trim().toLowerCase();
  const match = Object.entries(LENS_CONSTANTS).find(
    ([name]) => name.replace(/\s+/g, " ").trim().toLowerCase() === wanted,
  );
  return match?.[1];
}
