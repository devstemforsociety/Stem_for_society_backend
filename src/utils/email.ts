import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Normalises an address for storage and comparison.
 *
 * The local part of an address is technically case-sensitive, but no provider
 * anyone here uses treats it that way, and users do not expect
 * "Admin@Gmail.com" and "admin@gmail.com" to be different accounts.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Case-insensitive email comparison for queries.
 *
 * Validation now lowercases every address on the way in, so rows created from
 * here on are already lowercase. Rows created before that are not, and an
 * exact match against a lowercased input would silently fail to find them -
 * locking those accounts out of sign-in, OTP and password reset. Comparing
 * with lower() on both sides keeps them reachable.
 *
 * Note this cannot use a plain index on the column; add an index on
 * lower(email) if these lookups ever become hot.
 */
export function emailEquals(column: PgColumn, email: string): SQL {
  return sql`lower(${column}) = ${normaliseEmail(email)}`;
}
