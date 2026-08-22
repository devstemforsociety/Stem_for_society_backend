// Must stay first - Sentry patches http, express and pg as they are required,
// so anything imported above this line goes uninstrumented.
import "./instrument";

import cookieParser from "cookie-parser";
import "dotenv/config";
import * as Sentry from "@sentry/node";
import {
  authLimiters,
  corsMiddleware,
  globalLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  clientErrorLimiter,
  CORS_DENIED,
  paymentLimiter,
  securityHeaders,
} from "./security";
import express, { Application, Request, Response } from "express";
import { db } from "./db/connection";
import { isDevelopmentEnv } from "./utils/env";
import adminAuthRouter from "./routes/adminAuth/route";
import adminPartnersRouter from "./routes/adminPartners/route";
import adminStudentsRouter from "./routes/adminStudents/route";
import adminTrainingRouter from "./routes/adminTrainings/route";
import authRouter from "./routes/auth/route";
import blogsRouter from "./routes/blog/route";
import partnerAuthRouter from "./routes/partnerAuth/route";
import partnerMiscRouter from "./routes/partnerMisc/route";
import partnerStudentsRouter from "./routes/partnerStudents/route";
import paymentRouter from "./routes/payments/route";
import studentTrainingRouter from "./routes/studentTraining/route";
import trainingRouter from "./routes/training/route";
import homeRouter from "./routes/home/route";
import emailRouter from "./routes/email/route"

import enquiryRouter from "./routes/enquiry/route";
import clientErrorsRouter from "./routes/clientErrors/route";
import adminApplicationsRouter from "./routes/adminEnquiry/route";

const app: Application = express();
const port = process.env.PORT || 8000;

// Special middleware for webhook that preserves raw body for signature verification
app.use("/payments/verify", express.raw({ 
  type: "application/json",
  limit: "50mb" // Increase limit if needed
}));

// Standard JSON middleware for all other routes. The body cap keeps a single
// oversized request from exhausting memory.
app.use(express.json({ limit: "1mb" }));

// Behind Render/Netlify the client IP arrives in X-Forwarded-For. Without
// this, every request looks like it comes from the proxy and the rate limits
// below would be shared by all users at once.
app.set("trust proxy", 1);

app.use(securityHeaders());
app.use(corsMiddleware());
app.use(cookieParser());
app.use(globalLimiter);

app.get("/", (req: Request, res: Response) => {
  res.send("Welcome to Express & TypeScript Server");
});

// Health check endpoint
app.get("/health", async (req: Request, res: Response) => {
  try {
    // Test database connection
    const testQuery = await db.query.userTable.findFirst();
    res.json({
      status: "healthy",
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      database: "connected",
      routes: {
        auth: "/auth/sign-in",
        health: "/health"
      }
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(503).json({
      status: "unhealthy",
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      database: "disconnected",
      error: isDevelopmentEnv() ? error : "Database connection failed"
    });
  }
});

// Handle preflight requests
app.options("*", corsMiddleware());

/**
 * Tighter limits on the endpoints worth attacking: credential guessing, OTP
 * brute force, OTP flooding (which also spends real email quota), and the
 * endpoints that create payment orders. Registered before the routers so they
 * run first.
 */
// One call per mount: each endpoint gets its own counter rather than all five
// sharing a single bucket (see authLimiters).
app.use("/auth/sign-in", authLimiters());
app.use("/auth/register", authLimiters());
app.use("/auth/reset-password", authLimiters());
app.use("/admin/auth/sign-in", authLimiters());
app.use("/partner/auth/sign-in", authLimiters());
app.use(["/email/sendOTP", "/email/resetOTP"], otpSendLimiter);
app.use("/email/verifyOTP", otpVerifyLimiter);
app.use("/payments/create", paymentLimiter);
app.use("/client-errors", clientErrorLimiter);
// Receipt endpoints now resolve the payment server-side before sending, so
// each call costs database work even when it is rejected. 20/hour is well
// above what a real checkout needs and well below useful abuse.
app.use(
  [
    "/email/send-course-registration",
    "/email/send-institution-booking",
    "/email/send-general-payment",
  ],
  paymentLimiter,
);
app.use("/enquiry", paymentLimiter);

app.use("/auth", authRouter);
app.use("/trainings", studentTrainingRouter);

app.use("/partner/auth", partnerAuthRouter);
app.use("/partner/trainings", trainingRouter);
app.use("/partner/students", partnerStudentsRouter);
app.use("/partner/misc", partnerMiscRouter);

app.use("/admin/auth", adminAuthRouter);
app.use("/admin/students", adminStudentsRouter);
app.use("/admin/partners", adminPartnersRouter);
app.use("/admin/trainings", adminTrainingRouter);
app.use("/admin/applications", adminApplicationsRouter);

app.use("/blogs", blogsRouter);
app.use("/enquiry", enquiryRouter);
app.use("/payments", paymentRouter);
app.use("/home", homeRouter);

app.use("/client-errors", clientErrorsRouter);

app.use("/email", emailRouter);

// Unmatched routes. This previously logged and then returned without sending
// anything, so every 404 hung the client until it timed out and held a
// connection open for the duration.
app.use("*", (req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});


/**
 * Sentry's Express handler, registered after every route so it sees the errors
 * they throw. It only reports; the handler below still decides what the client
 * is told, so error responses are unchanged.
 */
Sentry.setupExpressErrorHandler(app);

// Global error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  // A blocked cross-origin request is a deliberate refusal, not a server fault.
  if (err?.message === CORS_DENIED) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  /**
   * Upload failures are the caller's to fix, not server faults. Multer raises
   * these after the request body is parsed, so without this they reached the
   * catch-all below and came back as an opaque 500 - which is what an author
   * saw after writing an entire article and attaching a photo from a phone.
   */
  const uploadMessages: Record<string, string> = {
    LIMIT_FILE_SIZE: "That file is too large. Images must be 5 MB or smaller.",
    LIMIT_FIELD_VALUE: "One of the fields is too long to submit.",
    LIMIT_FILE_COUNT: "Too many files were attached.",
    LIMIT_FIELD_COUNT: "Too many fields were submitted.",
    LIMIT_UNEXPECTED_FILE: "An unexpected file was attached.",
  };
  if (err?.code && uploadMessages[err.code]) {
    res.status(400).json({ error: uploadMessages[err.code] });
    return;
  }
  if (err?.name === "UnsupportedImageType") {
    res.status(400).json({ error: err.message });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    // Only a development run may see the underlying message; anything else
    // (including an unset NODE_ENV, which is the deployed case) gets the
    // generic text, so stack detail never reaches a client.
    message: isDevelopmentEnv() ? err.message : 'Something went wrong'
  });
});


app.listen(port, () => {
  console.log(`Server is firing at http://localhost:${port}`);

});
