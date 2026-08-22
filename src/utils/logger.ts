import { isProductionEnv } from "./env";

const isProduction = isProductionEnv();

/**
 * Developer tracing. Silent in production.
 *
 * These call sites print whole request bodies and database rows, which put
 * customer names, email addresses and phone numbers into the host's log
 * retention in cleartext (SFS-12). They are useful locally and unacceptable in
 * production, so the environment decides rather than the author.
 *
 * For anything that must be visible in production - startup state, genuine
 * errors - use `console.error`/`console.warn` directly and log an identifier
 * rather than the record itself.
 */
export function debugLog(...args: unknown[]): void {
  if (isProduction) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}
