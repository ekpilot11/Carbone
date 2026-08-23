/**
 * Displaying a CPF. Whether one is *valid* is the server's answer — the
 * check-digit rule lives in `backend/src/cpf.ts` and is asked for through
 * `lookupPatient`, so there is one implementation of it rather than two that
 * can drift apart.
 */

/** Digits only. Forms are written "123.456.789-09", with spaces anywhere. */
export function cpfDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** "12345678909" → "123.456.789-09". Anything else is handed back as-is. */
export function formatCpf(value: string): string {
  const digits = cpfDigits(value);
  if (digits.length !== 11) return value.trim();
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}
