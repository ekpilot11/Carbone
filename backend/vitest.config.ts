import { defineConfig } from "vitest/config";

/**
 * node:sqlite ships with Node 22 but is still behind a flag there, and
 * vitest runs tests in worker processes that don't inherit the flag from
 * the command line. Setting it here keeps `npm test` working the same way
 * on every machine, rather than relying on NODE_OPTIONS being set by hand.
 */
export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--experimental-sqlite"] } },
  },
});
