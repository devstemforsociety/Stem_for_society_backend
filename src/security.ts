import cors, { CorsOptions } from "cors";
import { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";

/**
 * Security middleware: headers, origin control and rate limiting.
 *
 * Kept together so the protections are visible in one place rather than
 * scattered through index.ts.
 */

/* ------------------------------------------------------------------ CORS */

/**
 * Origins allowed to call this API, as a comma-separated list:
 *
 *   ALLOWED_ORIGINS=https://stemforsociety.com,https://www.stemforsociety.com
 *
 * Localhost dev servers are always allowed outside production.
 */
function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Marker so the error handler can answer 403 rather than a generic 500. */
export const CORS_DENIED = "CORS_ORIGIN_DENIED";

export function buildCorsOptions(): CorsOptions {
  const allowlist = allowedOrigins();
  const isProduction = process.env.NODE_ENV === "production";

  if (allowlist.length === 0) {
    // Falling back to permissive rather than breaking a live deployment that
    // has not set the variable yet - but say so loudly, because until it is
    // set this protection does nothing.
    console.error(
      "[security] ALLOWED_ORIGINS is not set - the API currently accepts requests from ANY origin. " +
        "Set it to your frontend domains and redeploy.",
    );
    return {
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Cookie",
        "X-Correlation-Id",
        // Also needed here: this permissive branch is what runs whenever
        // ALLOWED_ORIGINS is unset, which is the case in production today.
        "sentry-trace",
        "baggage",
      ],
      optionsSuccessStatus: 200,
    };
  }

  console.log(`[security] CORS allowlist: ${allowlist.join(", ")}`);

  return {
    origin(origin, callback) {
      // Same-origin and server-to-server callers (curl, Razorpay webhooks)
      // send no Origin header at all; those are not browser requests and CORS
      // does not apply to them.
      if (!origin) return callback(null, true);
      if (allowlist.includes(origin)) return callback(null, true);
      if (!isProduction && LOCALHOST.test(origin)) return callback(null, true);

      return callback(new Error(CORS_DENIED));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Cookie",
      "X-Correlation-Id",
      // Sent by the browser Sentry SDK when this API is a trace propagation
      // target. A header that is not listed here fails preflight and takes
      // every request down with it, so tracing headers are admitted explicitly.
      "sentry-trace",
      "baggage",
    ],
    optionsSuccessStatus: 200,
  };
}

export function corsMiddleware(): RequestHandler {
  return cors(buildCorsOptions());
}

/* ---------------------------------------------------------------- Helmet */

export function securityHeaders(): RequestHandler {
  // helmet types its handler against Node's IncomingMessage, which no longer
  // structurally matches Express 5's Request. Behaviourally identical.
  return helmet({
    // This service returns JSON, not documents - the CSP that protects users
    // belongs on the frontend host (see netlify.toml / vercel.json / nginx.conf).
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }) as unknown as RequestHandler;
}

/* --------------------------------------------------------- Rate limiting */

const shared = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  message: { error: "Too many requests. Please wait a moment and try again." },
};

/**
 * Broad ceiling for ordinary browsing. Generous enough that a real user
 * clicking through the site will never see it.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  ...shared,
  // Razorpay retries webhooks; throttling them would lose payment
  // confirmations.
  skip: (req) => req.path === "/payments/verify",
});

const AUTH_WINDOW_MS = 15 * 60 * 1000;

/**
 * Identifies who is knocking on a credential endpoint.
 *
 * Keyed by IP *and* the address being tried, so one person fumbling their own
 * password cannot spend the allowance of everyone else behind the same NAT -
 * a college, an office or a mobile carrier all share one public IP.
 * ipKeyGenerator is used rather than req.ip directly so IPv6 clients group by
 * subnet instead of by individual address, which is trivial to rotate.
 */
function credentialKey(req: Request): string {
  const ip = ipKeyGenerator(req.ip ?? "");
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  return email ? ip + "|" + email : ip;
}

/**
 * A fresh pair of limiters for ONE credential endpoint.
 *
 * This replaces a single shared instance that was mounted on student, admin
 * and partner sign-in, registration and password reset simultaneously. One
 * instance means one store, so all five routes drew from the same bucket of
 * ten requests per IP: mistyping a password twice and then requesting a reset
 * locked the account owner out for fifteen minutes, and on a shared IP the
 * whole building shared that allowance. Call this once per mount so each
 * endpoint counts separately.
 *
 * Two layers, because they defend different things:
 *  - per identity (IP + address): stops guessing against one account
 *  - per IP: stops someone cycling through many addresses from one place,
 *    which the per-identity key alone would happily allow
 */
export function authLimiters(): RequestHandler[] {
  return [
    rateLimit({
      windowMs: AUTH_WINDOW_MS,
      limit: 10,
      keyGenerator: credentialKey,
      ...shared,
    }),
    rateLimit({
      windowMs: AUTH_WINDOW_MS,
      limit: 60,
      ...shared,
    }),
  ];
}

/**
 * Sending an OTP costs an email and can be aimed at an address the caller does
 * not own, so it is the tightest limit here.
 */
export const otpSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  ...shared,
});

/** Verifying an OTP is a 6-digit guess; cap the attempts. */
export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  ...shared,
});

/**
 * Browser error reports.
 *
 * Generous, because a genuinely broken release makes every visitor report at
 * once and losing those is the opposite of what the endpoint is for - but
 * still bounded, since it is unauthenticated.
 */
export const clientErrorLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  ...shared,
});

/** Order creation costs money to process and creates records. */
export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  ...shared,
});
