import { z } from "zod";

const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const PASSWORD_RULE_MESSAGE =
  "Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, a number and one of @$!%*?&";

export const registerUserSchema = z
  .object({
    firstName: z
      .string({ required_error: "First name is required!" })
      .min(3, "First name must be at least 3 characters"),
    email: z.string({ required_error: "Email is required!" }).trim().toLowerCase().email(),
    mobile: z
      .string({ required_error: "Mobile is required!" })
      .regex(/^[6789]\d{9}$/, "Mobile number is invalid"),
    password: z
      .string({ required_error: "Password is required!" })
      .regex(PASSWORD_REGEX, PASSWORD_RULE_MESSAGE),
    confirmPassword: z
      .string({ required_error: "Please confirm same password!" })
      .min(8),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
  });

export const signInUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email"),
  // Sign-in must not enforce the registration policy: accounts created before
  // the current rule would be permanently locked out, and echoing the policy
  // to unauthenticated callers leaks it. Credentials are checked below.
  password: z.string().min(1, "Password is required"),
});

export const getUserInfoSchema = z
  .string({ required_error: "Invalid request" })
  .uuid("Invalid user id");


export const resetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  // Issued by /email/verifyOTP. Without it this endpoint reset any account
  // from an email address alone.
  resetToken: z.string({ required_error: "Reset token is required" }).min(1),
  newPassword: z
    .string()
    .max(100, "Password too long")
    .regex(PASSWORD_REGEX, PASSWORD_RULE_MESSAGE),
});
