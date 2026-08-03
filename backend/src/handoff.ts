import { randomInt } from "node:crypto";

/**
 * The phone-to-PC handoff: a day's work, parked under a short code so it can
 * be picked up on the other machine.
 *
 * The photographs are taken on a phone and the records are typed into a
 * hospital PC, and those two machines cannot talk to each other. This is the
 * bridge — you finish reviewing on one, read the code off the screen, and
 * type it on the other.
 *
 * It holds clinical values and patient names, so the design is deliberately
 * mean about it:
 *
 * - **Memory only.** Nothing is written to disk, ever. A restart loses every
 *   handoff, which is the correct trade: a lost handoff costs one re-upload,
 *   whereas a file of patient data outliving the day it was needed is a
 *   different kind of problem entirely.
 * - **It expires.** {@link TTL_MS} after it was parked, whether or not it was
 *   collected, and a collected handoff is deleted the moment it is read —
 *   the receiving device now has it.
 * - **No photographs.** Only the values read off them. The images are the
 *   most identifying thing the app touches and they never enter this store.
 * - **Codes are unguessable, not memorable.** 8 characters from an alphabet
 *   with no look-alikes is about a trillion possibilities; a 4-digit PIN
 *   would be brute-forced over a lunch break, and this is the only thing
 *   standing between a stranger and a patient list.
 */

/** How long a parked handoff survives uncollected. One clinic day, not more. */
const TTL_MS = 8 * 60 * 60 * 1000;

/** A cap, so a loop or a bad actor can't grow this without limit. */
const MAX_HANDOFFS = 200;

/** No 0/O, 1/I/L — these codes get read off one screen and typed into another. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

interface Handoff {
  payload: unknown;
  expiresAt: number;
}

const handoffs = new Map<string, Handoff>();

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function purgeExpired(now = Date.now()): void {
  for (const [code, handoff] of handoffs) {
    if (handoff.expiresAt <= now) handoffs.delete(code);
  }
}

export interface ParkedHandoff {
  code: string;
  expiresAt: number;
}

export function parkHandoff(payload: unknown): ParkedHandoff {
  purgeExpired();
  if (handoffs.size >= MAX_HANDOFFS) {
    // Drop the oldest rather than refuse the newest: the person standing at
    // the machine right now is the one who needs this to work.
    const oldest = [...handoffs.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) handoffs.delete(oldest[0]);
  }

  let code = newCode();
  while (handoffs.has(code)) code = newCode();

  const expiresAt = Date.now() + TTL_MS;
  handoffs.set(code, { payload, expiresAt });
  return { code, expiresAt };
}

/**
 * Collects a handoff, and forgets it. Reading is one-shot on purpose: the
 * work now lives on the device that asked for it, and a code that keeps
 * working is a code that keeps being a way in.
 */
export function collectHandoff(code: string): unknown | null {
  purgeExpired();
  const normalised = code.trim().toUpperCase();
  const handoff = handoffs.get(normalised);
  if (!handoff) return null;
  handoffs.delete(normalised);
  return handoff.payload;
}

/** For the shutdown path — leaving patient values in a dying process is untidy. */
export function clearHandoffs(): void {
  handoffs.clear();
}

export const HANDOFF_TTL_MS = TTL_MS;
