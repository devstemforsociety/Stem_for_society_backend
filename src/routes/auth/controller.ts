import { debugLog } from "../../utils/logger";
import { emailEquals } from "../../utils/email";
import { RequestHandler, Request, Response } from "express";
import {
  getUserInfoSchema,
  registerUserSchema,
  signInUserSchema,
  resetPasswordSchema,
} from "./validation";
import { db } from "../../db/connection";
import { userTable } from "../../db/schema";
import {
  fakeVerifyPassword,
  generateHashPassword,
  verifyPassword,
} from "../../utils/password";
import { authRoleEnum, createValidationError } from "../../utils/validation";
import { DatabaseError } from "pg";
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
    if (error instanceof DatabaseError) {
      /**
       * 409, not 500. These are expected outcomes of a unique constraint, not
       * server faults - and the frontend deliberately suppresses the body of
       * any 5xx (that is where stack traces leak), so returning 500 hid
       * "Email already registered" behind a generic "something went wrong"
       * and left the visitor with no idea what to change.
       */
      if (error.code === "23505" && error.constraint === "user_mobile_unique") {
        res.status(409).json({
          error: "Mobile number already exists",
        });
        return;
      }
      if (error.code === "23505" && error.constraint === "user_email_unique") {
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
