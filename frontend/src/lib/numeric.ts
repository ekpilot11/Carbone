/** OCR of thermal-printer receipts occasionally yields a comma instead of a decimal point. */
export function parseDecimal(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}
