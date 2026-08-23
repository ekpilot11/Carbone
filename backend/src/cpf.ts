/**
 * The CPF — Brazil's individual taxpayer number, and this app's patient key.
 *
 * It is the key for one reason that matters here: **it carries check
 * digits.** Every identifier in this app arrives as handwriting read off a
 * photograph, and a misread digit in a hospital record number is invisible —
 * any eleven digits look like a plausible number, and the wrong one lands on
 * a real patient who isn't this one. A misread digit in a CPF almost always
 * fails the arithmetic below, which turns a silent, dangerous error into a
 * question on screen.
 *
 * "Almost always", not always: two compensating errors, or a transposition
 * the weights happen to absorb, still pass. This narrows the risk; it does
 * not remove it, which is why a person still confirms every match.
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

function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  // 10 is written as 0 — the one place the mod-11 rule isn't just the remainder.
  return remainder === 10 ? 0 : remainder;
}

/**
 * Whether this is a well-formed CPF: eleven digits whose last two are the
 * mod-11 check digits of the first nine.
 *
 * Repeated digits ("111.111.111-11") satisfy the arithmetic but are not
 * issued to anyone, and they are exactly what gets written when a field is
 * filled in to get past it. Rejected.
 *
 * A well-formed CPF is not a *real* one — this says the number is internally
 * consistent, nothing more. There is no lookup, and there must not be one.
 */
export function isValidCpf(value: string): boolean {
  const digits = cpfDigits(value);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  return checkDigit(digits, 9) === Number(digits[9]) && checkDigit(digits, 10) === Number(digits[10]);
}
