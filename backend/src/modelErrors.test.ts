import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { readableErrors } from "./modelErrors.js";

/**
 * Three failures in a row reached the clinic as a machine string and
 * nothing else — `(502)`, then a wall of JSON starting `400 {"type":...`.
 * None of them said whether to retake the photo, wait, or fetch help.
 */

/**
 * The SDK builds an error's `.message` from the response body, so the
 * detail has to go there — which is exactly why the clinic saw a wall of
 * JSON rather than a sentence.
 */
type ApiErrorClass = new (
  status: never,
  error: Object | undefined,
  message: string | undefined,
  headers: Headers,
) => Error;

function apiError(Cls: ApiErrorClass, status: number, detail: string) {
  const body = { type: "error", error: { type: "invalid_request_error", message: detail } };
  // Each subclass pins its own status in its type; the runtime takes any.
  return new Cls(status as never, body, undefined, new Headers());
}

const fails = (error: unknown) => readableErrors(() => Promise.reject(error));

describe("what the clinic is told when a read fails", () => {
  it("says the key is wrong, and where to fix it", async () => {
    await expect(
      fails(apiError(Anthropic.AuthenticationError, 401, "invalid x-api-key")),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  /**
   * The failure that prompted this file. A malformed request is the app's
   * fault, and a clinician retaking the photograph would be wasting their
   * time — so the message says so outright.
   */
  it("says a rejected request is not the photograph's fault", async () => {
    const thrown = await fails(
      apiError(Anthropic.BadRequestError, 400, "Invalid schema: Enum value 'OD' does not match"),
    ).catch((err: Error) => err);
    expect(thrown.message).toMatch(/fault in the app/);
    expect(thrown.message).toMatch(/retaking it will not help/i);
    // ...and the detail survives, because that is what made this findable.
    expect(thrown.message).toContain("Enum value 'OD'");
  });

  it("tells someone to wait when the service is busy", async () => {
    await expect(fails(apiError(Anthropic.RateLimitError, 429, "rate limited"))).rejects.toThrow(
      /Wait a minute/,
    );
  });

  it("names the connection when the service can't be reached", async () => {
    await expect(
      fails(new Anthropic.APIConnectionError({ message: "socket hang up" })),
    ).rejects.toThrow(/internet connection/);
  });

  /**
   * Our own bugs must not be dressed up as service trouble — a TypeError
   * explained as "try again in a minute" would send someone in circles.
   */
  it("lets anything that isn't an API error through untouched", async () => {
    const bug = new TypeError("cannot read properties of undefined");
    await expect(fails(bug)).rejects.toBe(bug);
  });

  it("stays out of the way when the call succeeds", async () => {
    await expect(readableErrors(() => Promise.resolve("read"))).resolves.toBe("read");
  });
});
