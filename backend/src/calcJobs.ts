import { randomUUID } from "node:crypto";
import { runBarrettCalculation } from "./barrett.js";
import { scanForm, type FormMediaType, type FormScanResponse } from "./scanForm.js";
import type { CalculateRequest, CalculateResponse } from "./types.js";

/**
 * Slow work as jobs, so no HTTP request has to stay open while it runs.
 *
 * A calculation takes 10–30 seconds normally, and up to three minutes when
 * the calculator's site raises a security check and waits for a person to
 * complete it. Reading a photographed form is quicker but not quick.
 * Holding a request open that long works on localhost and fails everywhere
 * else: a tunnel, a reverse proxy or a hospital firewall will cut it, and
 * the app then shows the proxy's error page instead of a result.
 *
 * That is not hypothetical for either one. It happened to calculations
 * through a Cloudflare tunnel, which gives up on an origin after about a
 * hundred seconds — and then it happened again to the first real form
 * anyone tried to scan, which came back as a bare "502" with no explanation
 * because the page the tunnel served wasn't ours to write.
 *
 * So the request starts a job and returns immediately; the app asks how it
 * went every couple of seconds. Each of those exchanges is short, which is
 * the only property that matters to anything sitting in between.
 *
 * Jobs hold results — clinical values, and in the form's case a patient's
 * name and CPF — so the same rules as the handoff store apply: memory only,
 * and they don't linger.
 */

/** How long a finished job stays readable — long enough to survive a reload. */
const KEEP_FINISHED_MS = 10 * 60 * 1000;

/** How long a job that never finishes is kept before being forgotten. */
const KEEP_RUNNING_MS = 15 * 60 * 1000;

const MAX_JOBS = 100;

export type JobStatus = "running" | "done" | "failed";

interface Job {
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
}

const jobs = new Map<string, Job>();

function purge(now = Date.now()): void {
  for (const [id, job] of jobs) {
    const age = now - (job.finishedAt ?? job.startedAt);
    const limit = job.finishedAt === undefined ? KEEP_RUNNING_MS : KEEP_FINISHED_MS;
    if (age > limit) jobs.delete(id);
  }
  // Still too many: drop the oldest finished ones. A running job is never
  // evicted — someone is waiting on it.
  if (jobs.size > MAX_JOBS) {
    const finished = [...jobs.entries()]
      .filter(([, job]) => job.finishedAt !== undefined)
      .sort((a, b) => (a[1].finishedAt ?? 0) - (b[1].finishedAt ?? 0));
    for (const [id] of finished.slice(0, jobs.size - MAX_JOBS)) jobs.delete(id);
  }
}

/**
 * Runs something in the background and hands back the ticket for it.
 *
 * `whenItFails` is the sentence shown if the work throws something that
 * isn't an Error — the caller knows what was being attempted and this file
 * does not.
 */
function startJob(run: () => Promise<unknown>, whenItFails: string): string {
  purge();
  const id = randomUUID();
  jobs.set(id, { status: "running", startedAt: Date.now() });

  // Deliberately not awaited: the caller's HTTP request ends now.
  void run()
    .then((result) => {
      jobs.set(id, { ...jobs.get(id)!, status: "done", result, finishedAt: Date.now() });
    })
    .catch((err: unknown) => {
      jobs.set(id, {
        ...jobs.get(id)!,
        status: "failed",
        error: err instanceof Error ? err.message : whenItFails,
        finishedAt: Date.now(),
      });
    });

  return id;
}

export function startCalculation(request: CalculateRequest): string {
  return startJob(() => runBarrettCalculation(request), "The calculation failed.");
}

export function startFormScan(data: string, mediaType: FormMediaType): string {
  return startJob(() => scanForm(data, mediaType), "Could not read that form.");
}

export interface JobView<T> {
  status: JobStatus;
  result?: T;
  error?: string;
}

export function readJob<T = CalculateResponse>(id: string): JobView<T> | null {
  purge();
  const job = jobs.get(id);
  if (!job) return null;
  return { status: job.status, result: job.result as T | undefined, error: job.error };
}

/** Reading a form scan job, named so the call site says what it expects back. */
export function readFormScanJob(id: string): JobView<FormScanResponse> | null {
  return readJob<FormScanResponse>(id);
}

/** For the shutdown path, and for tests that want a clean slate. */
export function clearJobs(): void {
  jobs.clear();
}
