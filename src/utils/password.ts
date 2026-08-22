/** Perfect implementation by:
 * https://stackoverflow.com/a/45652825
 */

import * as crypto from "crypto";

const PASSWORD_LENGTH = 256;
const SALT_LENGTH = 64;

/**
 * Work factor for newly created and newly verified passwords.
 *
 * 10,000 was far below OWASP's guidance for PBKDF2-HMAC-SHA256, which makes an
 * offline attack on a stolen `hash` column cheaper than it should be.
 *
 * OWASP's headline figure of 600,000 assumes a 32-byte derived key - one
 * SHA-256 block. PASSWORD_LENGTH here is 256 bytes, which is eight blocks, and
 * PBKDF2 runs the full iteration count once per block. So each iteration costs
 * eight times the reference, and 75,000 iterations at this output length is
 * equivalent work to the recommended 600,000 at 32 bytes - about 110ms per
 * verification rather than the ~900ms a literal 600,000 would cost.
 *
 * That matters: crypto.pbkdf2 runs on libuv's threadpool, which is four wide by
 * default, so an unnecessarily expensive hash turns concurrent sign-ins into a
 * queue and hands an attacker a cheap way to saturate it.
 *
 * The output length cannot change without invalidating every existing hash, so
 * the iteration count is the dial. Existing rows were hashed at the old cost
 * and must keep verifying, so the count is stored alongside each new hash and
 * old rows are read back at their original cost - see parseStoredHash. Nobody
 * is locked out and no reset is required.
 */
const ITERATIONS = 75_000;

/** What rows created before the iteration count was recorded were hashed with. */
const LEGACY_ITERATIONS = 10000;

/** Marks a stored hash that carries its own cost, as `pbkdf2$<iters>$<hex>`. */
const HASH_PREFIX = "pbkdf2$";

const DIGEST = "sha256";
const BYTE_TO_STRING_ENCODING = "hex"; // this could be base64, for instance

/**
 * The information about the password that is stored in the database
 */
interface PersistedPassword {
  salt: string;
  hash: string;
}

/**
 * Generates a PersistedPassword given the password provided by the user.
 * This should be called when creating a user or redefining the password
 */
/**
 * Splits a stored hash into the cost it was produced with and the digest.
 *
 * A bare hex string is a pre-existing row: those were all produced at
 * LEGACY_ITERATIONS, so they verify at that cost and keep working untouched.
 */
function parseStoredHash(stored: string): { iterations: number; hash: string } {
  if (stored.startsWith(HASH_PREFIX)) {
    const [, iterations, hash] = stored.split("$");
    const parsed = Number(iterations);
    if (Number.isFinite(parsed) && parsed > 0 && hash) {
      return { iterations: parsed, hash };
    }
  }
  return { iterations: LEGACY_ITERATIONS, hash: stored };
}

function pbkdf2(
  password: string,
  salt: string,
  iterations: number,
): Promise<string> {
  return new Promise((accept, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      iterations,
      PASSWORD_LENGTH,
      DIGEST,
      (error, hash) => {
        if (error) return reject(error);
        accept(hash.toString(BYTE_TO_STRING_ENCODING));
      },
    );
  });
}

export async function generateHashPassword(
  password: string,
): Promise<PersistedPassword> {
  const salt = crypto
    .randomBytes(SALT_LENGTH)
    .toString(BYTE_TO_STRING_ENCODING);
  const hash = await pbkdf2(password, salt, ITERATIONS);

  // The cost travels with the hash so it can be raised again later without
  // invalidating anything already stored.
  return { salt, hash: `${HASH_PREFIX}${ITERATIONS}$${hash}` };
}

/**
 * Verifies the attempted password against the password information saved in
 * the database. This should be called when
 * the user tries to log in.
 */
export async function verifyPassword(
  persistedPassword: PersistedPassword,
  passwordAttempt: string,
): Promise<boolean> {
  const { iterations, hash: expected } = parseStoredHash(
    persistedPassword.hash,
  );
  const actual = await pbkdf2(
    passwordAttempt,
    persistedPassword.salt,
    iterations,
  );

  /**
   * Constant time. `===` on the hex strings returns as soon as two characters
   * differ, so how long the comparison takes reveals how much of the digest a
   * guess got right.
   */
  const expectedBuf = Buffer.from(expected, BYTE_TO_STRING_ENCODING);
  const actualBuf = Buffer.from(actual, BYTE_TO_STRING_ENCODING);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * A salt/hash pair that no password can match, used only to burn the same
 * PBKDF2 work as a real verification.
 */
const DUMMY_SALT = "0".repeat(SALT_LENGTH * 2);

/**
 * Carries the *current* iteration count on purpose.
 *
 * A bare digest would be read as a legacy hash and verified at 10,000
 * iterations, so a sign-in for an unknown address would return roughly sixty
 * times faster than one for a real account - which is exactly the enumeration
 * signal this function exists to remove.
 */
const DUMMY_HASH = `${HASH_PREFIX}${ITERATIONS}$${"0".repeat(PASSWORD_LENGTH * 2)}`;

/**
 * Performs the same PBKDF2 work as verifyPassword and always resolves false.
 *
 * Call this when sign-in cannot find the account, or the stored credentials
 * are incomplete. Returning early in those cases makes the response
 * measurably faster than a wrong-password response, which re-opens the user
 * enumeration that a shared error message is meant to close.
 */
export function fakeVerifyPassword(passwordAttempt: string): Promise<boolean> {
  return verifyPassword(
    { salt: DUMMY_SALT, hash: DUMMY_HASH },
    passwordAttempt,
  );
}
