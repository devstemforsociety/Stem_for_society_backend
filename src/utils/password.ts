/** Perfect implementation by:
 * https://stackoverflow.com/a/45652825
 */

import * as crypto from "crypto";

const PASSWORD_LENGTH = 256;
const SALT_LENGTH = 64;
const ITERATIONS = 10000;
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
export function generateHashPassword(
  password: string,
): Promise<PersistedPassword> {
  return new Promise<PersistedPassword>((accept, reject) => {
    const salt = crypto
      .randomBytes(SALT_LENGTH)
      .toString(BYTE_TO_STRING_ENCODING);
    crypto.pbkdf2(
      password,
      salt,
      ITERATIONS,
      PASSWORD_LENGTH,
      DIGEST,
      (error, hash) => {
        if (error) {
          return reject(error);
        }

        accept({
          salt,
          hash: hash.toString(BYTE_TO_STRING_ENCODING),
        });
      },
    );
  });
}

/**
 * Verifies the attempted password against the password information saved in
 * the database. This should be called when
 * the user tries to log in.
 */
export function verifyPassword(
  persistedPassword: PersistedPassword,
  passwordAttempt: string,
): Promise<boolean> {
  return new Promise<boolean>((accept, reject) => {
    crypto.pbkdf2(
      passwordAttempt,
      persistedPassword.salt,
      ITERATIONS,
      PASSWORD_LENGTH,
      DIGEST,
      (error, hash) => {
        if (error) {
          return reject(error);
        }

        accept(
          persistedPassword.hash === hash.toString(BYTE_TO_STRING_ENCODING),
        );
      },
    );
  });
}

/**
 * A salt/hash pair that no password can match, used only to burn the same
 * PBKDF2 work as a real verification.
 */
const DUMMY_SALT = "0".repeat(SALT_LENGTH * 2);
const DUMMY_HASH = "0".repeat(PASSWORD_LENGTH * 2);

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
