import { DatabaseError } from "pg";

/**
 * Finds the driver error inside whatever the ORM threw.
 *
 * Up to drizzle-orm 0.36 a failing query rejected with the pg DatabaseError
 * itself, so `error instanceof DatabaseError` worked. From 0.44 drizzle wraps it
 * in a DrizzleQueryError and hangs the original off `cause`, which makes that
 * check silently false - and every branch guarded by it stops running.
 *
 * The effect was that a duplicate email or mobile number, which the handlers
 * deliberately answer with a 409 and a message the visitor can act on, fell
 * through to the catch-all and came back as "Internal server error". Google
 * sign-up hit it too: the phone step 500'd whenever the number was already
 * registered.
 *
 * The cause chain is walked rather than checked one level deep, so another
 * wrapper appearing in a future release does not quietly break this again.
 */
export function asDatabaseError(error: unknown): DatabaseError | null {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof DatabaseError) return current;
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

/** True when the error is a unique-constraint violation, optionally a named one. */
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  const dbError = asDatabaseError(error);
  if (!dbError || dbError.code !== "23505") return false;
  return constraint ? dbError.constraint === constraint : true;
}
