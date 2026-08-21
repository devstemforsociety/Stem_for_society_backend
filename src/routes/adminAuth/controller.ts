import { debugLog } from "../../utils/logger";
import { Request, RequestHandler, Response } from "express";
import { db } from "../../db/connection";
import { JWT_SECRET_AD } from "../../middleware";
import {
  ADMIN_AUTH_COOKIE_NAME,
  AUTH_COOKIE_MAX_AGE_MS,
  INVALID_CREDENTIALS_MSG,
  INVALID_SESSION_MSG,
} from "../../utils/constants";
import { signJWT } from "../../utils/jwt";
import { fakeVerifyPassword, verifyPassword } from "../../utils/password";
import { authRoleEnum, createValidationError } from "../../utils/validation";
import { signInUserSchema } from "./validation";

export const registerUser: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    // const registerUserValidation = registerUserSchema.safeParse(req.body);
    // if (!registerUserValidation.success) {
    //   res.status(400).json({
    //     errors: createValidationError(registerUserValidation),
    //   });
    //   return;
    // }
    // const pwd = await generateHashPassword(
    //   registerUserValidation.data.password,
    // );
    // const { data } = registerUserValidation;
    // await db.transaction(async (tx) => {
    //   const [address] = await tx
    //     .insert(addressTable)
    //     .values({
    //       addressLine1: data.addressLine1,
    //       addressLine2: data.addressLine2,
    //       city: data.city,
    //       state: data.state,
    //       pincode: data.pincode,
    //     })
    //     .returning();
    //   await tx.insert(instructorTable).values({
    //     email: data.email,
    //     firstName: data.owner,
    //     mobile: data.phone,
    //     institutionName: data.companyName,
    //     hash: pwd.hash,
    //     salt: pwd.salt,
    //     addressId: address.id,
    //   });
    // });
    res.status(403).json({
      message: "This feature has not been implemented yet!",
    });
  } catch (error) {
    debugLog("🚀 ~ constregisterUser:RequestHandler= ~ error:", error);
    // if (error instanceof DatabaseError) {
    //   if (error.code === "23505" && error.constraint === "user_mobile_unique") {
    //     res.status(500).json({
    //       error: "Mobile number already exists",
    //     });
    //     return;
    //   }
    //   if (error.code === "23505" && error.constraint === "user_email_unique") {
    //     res.status(500).json({
    //       error: "Email already registered",
    //     });
    //     return;
    //   }
    // }
    res.json({
      error: "Server error in signing In",
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
    const user = await db.query.adminTable.findFirst({
      where(fields, operators) {
        return operators.eq(fields.email, signInUserValidation.data.email);
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
      role: authRoleEnum.Enum.ADMIN,
      lastName: user.lastName,
      createdAt: user.createdAt,
    };
    const token = await signJWT(userAuth, JWT_SECRET_AD!);
    res.cookie(ADMIN_AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
      sameSite: "lax",
    });
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
    const adminAuth = req.auth["ADMIN"];
    if (!adminAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }

    const userInfo = await db.query.adminTable.findFirst({
      where(fields, operators) {
        return operators.eq(fields.id, adminAuth.id);
      },
      columns: {
        hash: false,
        salt: false,
        updatedAt: false,
      },
    });
    res.json({ ...userInfo, role: "ADMIN" });
  } catch (error) {
    debugLog("🚀 ~ getUserInfo ~ error:", error);
    res.status(500).json({
      error: "Server error in obtaining user information",
    });
  }
};
