import cookieParser from "cookie-parser";
import "dotenv/config";
import {
  authLimiter,
  corsMiddleware,
  globalLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  CORS_DENIED,
  paymentLimiter,
  securityHeaders,
} from "./security";
import { eq } from "drizzle-orm";
import { trainingEnrolmentTable } from "./db/schema";
import express, { Application, Request, Response } from "express";
import { db } from "./db/connection";
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
import testRouter from "./routes/test/route";
import trainingRouter from "./routes/training/route";
import { Worker } from "bullmq";
import { CERT_QUEUE_NAME, PDFGenerationType} from "./redis";
import { generateCertificate } from "./utils/pdf";
import homeRouter from "./routes/home/route";
import emailRouter from "./routes/email/route"

import enquiryRouter from "./routes/enquiry/route";
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
      error: process.env.NODE_ENV === 'development' ? error : "Database connection failed"
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
app.use(["/auth/sign-in", "/auth/register", "/auth/reset-password"], authLimiter);
app.use("/admin/auth/sign-in", authLimiter);
app.use("/partner/auth/sign-in", authLimiter);
app.use(["/email/sendOTP", "/email/resetOTP"], otpSendLimiter);
app.use("/email/verifyOTP", otpVerifyLimiter);
app.use("/payments/create", paymentLimiter);
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

app.use("/email", emailRouter);

app.use("/testing", testRouter);

// Unmatched routes. This previously logged and then returned without sending
// anything, so every 404 hung the client until it timed out and held a
// connection open for the duration.
app.use("*", (req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});


// Global error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  // A blocked cross-origin request is a deliberate refusal, not a server fault.
  if (err?.message === CORS_DENIED) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});


// const worker = new Worker<PDFGenerationType>(
//   CERT_QUEUE_NAME!,
//   async (job) => {
//     console.log(
//       `🚀 Processing certificate for enrolment ID: ${job.data.enrolmentId}`,
//     );
//     try {
//       const response = await generateCertificate(job.data);
//       if (response) {
//         console.log(`✅ PDF generation succeeded: ${job.data.enrolmentId}`);
//         return { success: true, enrolmentId: job.data.enrolmentId };
//       } else {
//         console.error(`❌ PDF generation failed: ${job.data.enrolmentId}`);
//         // Update database to show error state
//         await db
//           .update(trainingEnrolmentTable)
//           .set({ certificate: null })
//           .where(eq(trainingEnrolmentTable.id, job.data.enrolmentId));
//         throw new Error(`PDF generation failed for ${job.data.enrolmentId}`);
//       }
//     } catch (error) {
//       console.error(`💥 Error in PDF worker for ${job.data.enrolmentId}:`, error);
//       // Reset certificate status on error
//       await db
//         .update(trainingEnrolmentTable)
//         .set({ certificate: null })
//         .where(eq(trainingEnrolmentTable.id, job.data.enrolmentId));
//       throw error;
//     }
//   },
//   {
//     connection: redis,
//     concurrency: 2,
//     lockDuration: 5 * 60 * 1000, // 5 minutes
//   }
// );



// worker.on("error", (err) => {
//   console.log("Connection error --- :", err.message);
// });

// worker.on("completed", (job) => {
//   console.log(`Job ${job.id} completed successfully!`);
// });

// worker.on("failed", (job, err) => {
//   console.error(`Job ${job?.id} failed:`, err);
// });

app.listen(port, () => {
  console.log(`Server is firing at http://localhost:${port}`);

});
