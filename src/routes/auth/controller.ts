import { debugLog } from "../../utils/logger";
import { emailEquals } from "../../utils/email";
import { RequestHandler, Request, Response } from "express";
import {
  getUserInfoSchema,
  registerUserSchema,
  signInUserSchema,
  resetPasswordSchema,
  googleAuthSchema,
} from "./validation";
import { supabase } from "../../supabase";
import { randomBytes } from "crypto";
import { db } from "../../db/connection";
import { userTable } from "../../db/schema";
import {
  fakeVerifyPassword,
  generateHashPassword,
  verifyPassword,
} from "../../utils/password";
import { authRoleEnum, createValidationError } from "../../utils/validation";
import { isUniqueViolation } from "../../utils/dbError";
import {
  credentialFingerprint,
  signJWT,
  verifyPasswordResetToken,
} from "../../utils/jwt";
import { JWT_SECRET_STU } from "../../middleware";
import {
  INVALID_CREDENTIALS_MSG,
  INVALID_SESSION_MSG,
} from "../../utils/constants";
import { eq } from "drizzle-orm";

export const registerUser: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const registerUserValidation = registerUserSchema.safeParse(req.body);
    if (!registerUserValidation.success) {
      res.status(400).json({
        errors: createValidationError(registerUserValidation),
      });
      return;
    }
    const pwd = await generateHashPassword(
      registerUserValidation.data.password,
    );
    await db.insert(userTable).values({
      ...registerUserValidation.data,
      hash: pwd.hash,
      salt: pwd.salt,
    });
    res.json({
      message: "Account created successfully!",
    });
  } catch (error) {
    debugLog("🚀 ~ constregisterUser:RequestHandler= ~ error:", error);
    {
      /**
       * 409, not 500. These are expected outcomes of a unique constraint, not
       * server faults - and the frontend deliberately suppresses the body of
       * any 5xx (that is where stack traces leak), so returning 500 hid
       * "Email already registered" behind a generic "something went wrong"
       * and left the visitor with no idea what to change.
       */
      if (isUniqueViolation(error, "user_mobile_unique")) {
        res.status(409).json({
          error: "Mobile number already exists",
        });
        return;
      }
      if (isUniqueViolation(error, "user_email_unique")) {
        res.status(409).json({
          error: "Email already registered",
        });
        return;
      }
    }
    // Anything unrecognised really is a server fault; it used to answer 200
    // with an error body, which no client could treat as a failure.
    res.status(500).json({
      error: "Server error in registering",
    });
  }
};

export const signIn: RequestHandler = async (req: Request, res: Response) => {
  try {
    const signInUserValidation = signInUserSchema.safeParse(req.body);
    if (!signInUserValidation.success) {
      res.status(400).json({
        errors: createValidationError(signInUserValidation),
      });
      return;
    }
    const user = await db.query.userTable.findFirst({
      where(fields, operators) {
        return emailEquals(fields.email, signInUserValidation.data.email);
      },
    });
    // Unknown account and incomplete stored credentials take the same path as
    // a wrong password: same status, same message, same PBKDF2 cost. Any
    // difference between them lets a caller enumerate registered emails.
    if (!user?.hash || !user.salt) {
      await fakeVerifyPassword(signInUserValidation.data.password);
      res.status(401).json({
        error: INVALID_CREDENTIALS_MSG,
      });
      return;
    }
    const doPwdMatch = await verifyPassword(
      { hash: user.hash, salt: user.salt },
      signInUserValidation.data.password,
    );
    if (!doPwdMatch) {
      res.status(401).json({
        error: INVALID_CREDENTIALS_MSG,
      });
      return;
    }
    const userAuth = {
      email: user.email,
      firstName: user.firstName,
      id: user.id,
      mobile: user.mobile,
      role: authRoleEnum.Enum.STUDENT,
      lastName: user.lastName,
      createdAt: user.createdAt,
    };
    const token = await signJWT(userAuth, JWT_SECRET_STU!);
    /**
     * No cookie is set here on purpose. Authentication is Bearer-token only -
     * requireAuthToken reads Authorization and never looks at cookies - so the
     * httpOnly cookie this used to set was never read by anything. It implied
     * an XSS protection that did not exist, since the token the client
     * actually uses is the one returned below.
     */
    res.json({
      data: {
        token,
        user: userAuth,
      },
    });
  } catch (error) {
    debugLog("🚀 ~ signIn ~ error:", error);
    res.status(500).json({
      error: "Server error in signing in",
    });
  }
};

export const getUserInfo: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const studentAuth = req.auth["STUDENT"];
    if (!studentAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }

    const userInfo = await db.query.userTable.findFirst({
      where(fields, operators) {
        return operators.eq(fields.id, studentAuth.id);
      },
      columns: {
        hash: false,
        salt: false,
        updatedAt: false,
      },
    });
    res.json({ ...userInfo, role: "STUDENT" });
  } catch (error) {
    debugLog("🚀 ~ getUserInfo ~ error:", error);
    res.status(500).json({
      error: "Server error in obtaining user information",
    });
  }
};

export const resetPassword: RequestHandler = async (req: Request, res: Response) => {
  try {
    // Validate input using Zod
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
      return;
    }
    const { email, newPassword, resetToken } = parsed.data;

    // The token proves this caller just passed the emailed OTP for THIS
    // address. Comparing the two matters: a valid token for one account must
    // not be usable to reset another.
    const tokenClaims = await verifyPasswordResetToken(
      resetToken,
      JWT_SECRET_STU!,
    );
    const tokenEmail = tokenClaims?.email;
    if (!tokenEmail || tokenEmail.toLowerCase() !== email.toLowerCase()) {
      res.status(401).json({
        error: "Password reset link is invalid or has expired. Request a new code.",
      });
      return;
    }

    // Check if user exists
    const user = await db.query.userTable.findFirst({
      where(fields, operators) {
        return emailEquals(fields.email, email);
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    /**
     * One reset per code. The token carries a fingerprint of the hash that was
     * stored when it was issued; once a reset rewrites that hash the
     * fingerprint no longer matches, so a replayed token is refused even
     * though its signature and expiry are still valid.
     */
    if (tokenClaims!.credential !== credentialFingerprint(user.hash)) {
      res.status(401).json({
        error:
          "This password reset link has already been used. Request a new code.",
      });
      return;
    }

    // Hash new password
    const hashedPassword = await generateHashPassword(newPassword);

    // Update user password
    await db
      .update(userTable)
      .set({ hash: hashedPassword.hash, salt: hashedPassword.salt })
      .where(eq(userTable.id, user.id));
    debugLog("🚀 ~ resetPassword ~ user.id:", user.id);
    res.json({ message: "Password reset successfully" });
  } catch (error) {
    debugLog("🚀 ~ resetPassword ~ error:", error);
    res.status(500).json({ error: "Server error in resetting password" });
  }
};


/**
 * Google sign-in and sign-up.
 *
 * Replaces a frontend-only shim that derived a password from the Supabase user
 * id - literally "Google" + the first six characters of the uuid + "123!" - and
 * then called /auth/register and /auth/sign-in with it. That made every Google
 * account's password computable by anyone who learned its Supabase id, and it
 * routed identity decisions through an endpoint that knew nothing about Google:
 * an address that already had a password account could never sign in with
 * Google (register answered 409 and the browser reported "Authentication
 * failed"), and a first name shorter than three characters failed validation.
 *
 * Here the access token is verified with Supabase, so the email is established
 * by Google rather than asserted by the caller, and no password is involved at
 * any point.
 */
export const googleAuth: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const parsed = googleAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errors: createValidationError(parsed) });
      return;
    }

    // The token is the only thing trusted here.
    const { data: supabaseUser, error: supabaseError } =
      await supabase.auth.getUser(parsed.data.accessToken);

    if (supabaseError || !supabaseUser?.user?.email) {
      res.status(401).json({
        error: "Google sign-in could not be verified. Please try again.",
      });
      return;
    }

    const email = supabaseUser.user.email.trim().toLowerCase();
    const metadata = supabaseUser.user.user_metadata ?? {};
    const fullName =
      (typeof metadata.full_name === "string" && metadata.full_name) ||
      (typeof metadata.name === "string" && metadata.name) ||
      "";
    const [firstNameRaw, ...restName] = fullName.trim().split(/\s+/);
    // Google accounts legitimately carry one-character names; the registration
    // form's three-character minimum must not apply to an identity we did not
    // ask the user to type.
    const firstName = firstNameRaw || email.split("@")[0] || "User";
    const lastName = restName.join(" ") || null;

    let user = await db.query.userTable.findFirst({
      where(fields) {
        return emailEquals(fields.email, email);
      },
    });

    if (!user) {
      // A new account still needs a mobile number, which Google does not
      // provide. The browser collects it and calls again.
      if (!parsed.data.mobile) {
        res.status(409).json({
          code: "PHONE_REQUIRED",
          error: "A mobile number is required to finish creating your account.",
        });
        return;
      }

      /**
       * The column is not nullable and this account has no password to store.
       * A long random value means the row can never be signed into through
       * /auth/sign-in - the only way in is Google, or a password reset, which
       * proves control of the mailbox first.
       */
      const unusablePassword = randomBytes(48).toString("hex");
      const pwd = await generateHashPassword(unusablePassword);

      try {
        [user] = await db
          .insert(userTable)
          .values({
            email,
            firstName,
            lastName,
            mobile: parsed.data.mobile,
            hash: pwd.hash,
            salt: pwd.salt,
          })
          .returning();
      } catch (error) {
        if (isUniqueViolation(error, "user_mobile_unique")) {
          res.status(409).json({
            code: "MOBILE_TAKEN",
            error:
              "That mobile number is already registered to another account. " +
              "Use a different number, or sign in with the account that owns it.",
          });
          return;
        }
        // Two tabs, or a second click before the first finished.
        if (isUniqueViolation(error, "user_email_unique")) {
          res.status(409).json({
            error: "An account already exists for this email. Please sign in.",
          });
          return;
        }
        throw error;
      }
    }

    const userAuth = {
      email: user.email,
      firstName: user.firstName,
      id: user.id,
      mobile: user.mobile,
      role: authRoleEnum.Enum.STUDENT,
      lastName: user.lastName,
      createdAt: user.createdAt,
    };
    const token = await signJWT(userAuth, JWT_SECRET_STU!);

    res.json({ data: { token, user: userAuth } });
  } catch (error) {
    console.error("[auth] Google sign-in failed:", error);
    res.status(500).json({ error: "Server error in Google sign-in" });
  }
};
