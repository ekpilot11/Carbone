import Anthropic from "@anthropic-ai/sdk";

/**
 * Failures from the reading service, said in a sentence first.
 *
 * Three times running, the whole of the clinic's experience of a failure
 * was a machine string: `(502)`, and then a wall of JSON beginning
 * `400 {"type":"error"...`. None of it told the person holding the form
 * whether to retake the photo, wait a minute, or fetch whoever maintains
 * the app.
 *
 * So every one of these leads with what to *do*, and keeps the technical
 * detail after it rather than instead of it — the detail is what made the
 * schema bug findable, and throwing it away would trade one bad failure
 * mode for another.
 */

interface Explained {
  /** What the clinician should do, in their own terms. */
  sentence: string;
  /** Whether trying the same thing again could plausibly work. */
  retryable: boolean;
}

function explain(error: unknown): Explained | null {
  if (error instanceof Anthropic.AuthenticationError) {
    return {
      sentence:
        "The reading service rejected this server's API key. Check ANTHROPIC_API_KEY in the .env " +
        "file on the computer running the app, then start it again.",
      retryable: false,
    };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return {
      sentence:
        "The reading service refused this account access. Whoever set the app up will need to " +
        "check the account's billing and permissions.",
      retryable: false,
    };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return {
      sentence:
        "The reading service is busy with too many requests from this account. Wait a minute " +
        "and try again.",
      retryable: true,
    };
  }
  if (error instanceof Anthropic.BadRequestError) {
    // Not the photograph's fault, and worth saying so plainly: retaking it
    // will not help, because the app asked for something malformed.
    return {
      sentence:
        "The app asked the reading service for something it refused. That is a fault in the app " +
        "itself, not in the photo — retaking it will not help. Show the detail below to whoever " +
        "maintains the app.",
      retryable: false,
    };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return {
      sentence:
        "Could not reach the reading service. Check this computer's internet connection and try " +
        "again.",
      retryable: true,
    };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return {
      sentence:
        "The reading service is having trouble at the moment. Try again in a minute.",
      retryable: true,
    };
  }
  return null;
}

/**
 * Runs a model call, and rewrites what it throws into something readable.
 *
 * Anything that isn't a recognised API error passes through untouched —
 * this file's job is to explain the service's failures, not to bury a bug
 * of ours under a friendly sentence.
 */
export async function readableErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const explained = explain(error);
    if (!explained) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${explained.sentence}\n\n${detail}`);
  }
}
