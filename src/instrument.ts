/**
 * Sentry for the API. Imported before anything else in index.ts.
 *
 * Order matters: the SDK patches http, express and the pg driver as they are
 * required, so anything loaded ahead of this file is never instrumented.
 *
 * Inert without SENTRY_DSN. That is deliberate - a developer running the API
 * locally, or a deploy where the variable has not been set yet, gets a working
 * server rather than a crash or a stream of failed reporting calls.
 *
 * The DSN belongs to a Node project, not the browser one: platform, grouping
 * and quota are all per-project, so events from here must not be sent to the
 * React DSN.
 */
import "dotenv/config";
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
  const isProduction = environment === "production";

  Sentry.init({
    dsn,
    environment,
    release: process.env.SENTRY_RELEASE || undefined,

    /**
     * Full traces while developing, a sample in production. Every request to a
     * public API would otherwise be a transaction, which exhausts the quota
     * long before it becomes useful.
     */
    tracesSampleRate: isProduction
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1")
      : 1.0,

    /**
     * Local variables make a stack trace worth reading, but they also capture
     * whatever was in scope - passwords, tokens, request bodies. On in
     * development only; sendDefaultPii stays off everywhere.
     */
    includeLocalVariables: !isProduction,
    sendDefaultPii: false,

    /**
     * Last line of defence before an event leaves the process. The frontend
     * scrubs its own events the same way; this covers headers and query
     * strings that the SDK attaches automatically.
     */
    beforeSend(event) {
      const headers = event.request?.headers;
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (/^(authorization|cookie|x-api-key|apikey)$/i.test(key)) {
            headers[key] = "[redacted]";
          }
        }
      }
      if (event.request?.query_string) {
        event.request.query_string = "[redacted]";
      }
      // Never ship a request body: sign-in posts arrive here with a password.
      if (event.request?.data) {
        event.request.data = "[redacted]";
      }
      return event;
    },
  });

  console.log(`[sentry] reporting enabled (environment=${environment})`);
} else {
  console.log(
    "[sentry] SENTRY_DSN is not set - error reporting is disabled for this process.",
  );
}
