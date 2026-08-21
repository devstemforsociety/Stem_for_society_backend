import { jwtVerify, SignJWT } from "jose";
import { AUTH_TOKEN_EXPIRES_IN } from "./constants";
import { AuthCookieType } from "./validation";

export async function signJWT(
  payload: AuthCookieType,
  secret: string,
  expiresIn: string = AUTH_TOKEN_EXPIRES_IN,
): Promise<string> {
  const encoder = new TextEncoder();
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .setNotBefore("0s")
    .sign(encoder.encode(secret));

  return jwt;
}

/** Return type is just a hinting and there is not guarantee that the return shape follows the payload type */
export async function verifyJWT(
  token: string,
  secret: string,
): Promise<AuthCookieType> {
  const encoder = new TextEncoder();
  try {
    const { payload } = await jwtVerify<AuthCookieType>(
      token,
      encoder.encode(secret),
    );
    return payload;
  } catch (err) {
    throw new Error("Invalid or expired JWT");
  }
}

/**
 * Password-reset tokens.
 *
 * Proving control of the mailbox (via the emailed OTP) and actually changing
 * the password are two separate requests, so the second one needs evidence
 * that the first succeeded. Without it `/auth/reset-password` accepted any
 * email plus a new password and reset the account outright.
 *
 * The `purpose` claim is what keeps these from being interchangeable with
 * session tokens: a session token carries no purpose and fails the check
 * below, and a reset token fails `commonAuthCookieSchema` in the auth
 * middleware. They share a signing secret only so that deploying this needs
 * no new environment variable.
 */
const RESET_TOKEN_PURPOSE = "password-reset";

/** Long enough to type a new password, short enough to be worthless if leaked. */
export const RESET_TOKEN_EXPIRES_IN = "10m";

export async function signPasswordResetToken(
  email: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  return new SignJWT({ email, purpose: RESET_TOKEN_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(RESET_TOKEN_EXPIRES_IN)
    .setIssuedAt()
    .setNotBefore("0s")
    .sign(encoder.encode(secret));
}

/**
 * Returns the email the token was issued for, or null if it is invalid,
 * expired, or not a reset token. Callers must compare it to the email being
 * reset - a valid token for one account must not reset another.
 */
export async function verifyPasswordResetToken(
  token: string,
  secret: string,
): Promise<string | null> {
  const encoder = new TextEncoder();
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret));
    if (payload.purpose !== RESET_TOKEN_PURPOSE) return null;
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
