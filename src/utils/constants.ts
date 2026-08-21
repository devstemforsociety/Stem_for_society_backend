export const STUDENT_AUTH_COOKIE_NAME = "s4s_st_sestok";
export const PARTNER_AUTH_COOKIE_NAME = "s4s_pt_sestok";
export const ADMIN_AUTH_COOKIE_NAME = "s4s_ad_sestok";

export const AUTH_TOKEN_EXPIRES_IN = "7d";
export const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Whenver this constant is changed, make sure you change it in frontend repo as well */
export const INVALID_SESSION_MSG = "Invalid session, please login again";

/**
 * The single response for every failed sign-in.
 *
 * Sign-in must not reveal whether an account exists: distinct replies for
 * "no such user" and "wrong password" let anyone enumerate registered emails.
 * Every sign-in failure returns this message with status 401.
 */
export const INVALID_CREDENTIALS_MSG = "Invalid email or password";
