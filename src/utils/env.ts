/**
 * How the process decides whether it is running in development.
 *
 * Every protection that used to be written as `NODE_ENV === "production"`
 * failed open: NODE_ENV is not set on the deployed API, so query logging,
 * request-body tracing and raw error messages were all running against real
 * customer traffic. Asking the opposite question makes the unset case safe -
 * anything that is not explicitly a development or test run is treated as
 * production.
 *
 * Local development sets NODE_ENV=development (see .env.example) and behaves
 * exactly as it did before.
 */
const NODE_ENV = process.env.NODE_ENV?.trim().toLowerCase();

/** True only when NODE_ENV explicitly says development or test. */
export function isDevelopmentEnv(): boolean {
  return NODE_ENV === "development" || NODE_ENV === "test";
}

/** True unless NODE_ENV explicitly says development or test. */
export function isProductionEnv(): boolean {
  return !isDevelopmentEnv();
}
