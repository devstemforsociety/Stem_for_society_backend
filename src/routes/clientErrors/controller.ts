import { Request, RequestHandler, Response } from "express";
import { z } from "zod";

/**
 * Diagnostics the browser could not keep to itself.
 *
 * A visitor is deliberately shown plain language and a short reference id; the
 * technical detail behind that id used to go only to Sentry, which is disabled
 * whenever VITE_SENTRY_DSN is unset - so in practice nothing was recorded and
 * the reference a student quoted led nowhere. This writes it to the server log
 * instead, keyed by the same id.
 *
 * Deliberately field-limited: no free-form blobs, nothing that could carry a
 * token or a message body, and everything capped in length.
 */
const clientErrorSchema = z.object({
  correlationId: z.string().trim().min(1).max(64),
  code: z.string().trim().max(64).optional(),
  kind: z.string().trim().max(32).optional(),
  status: z.coerce.number().int().min(0).max(599).optional(),
  technical: z.string().trim().max(500).optional(),
  source: z.string().trim().max(64).optional(),
  route: z.string().trim().max(200).optional(),
  role: z.string().trim().max(32).optional(),
  appVersion: z.string().trim().max(64).optional(),
});

export const recordClientError: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  const parsed = clientErrorSchema.safeParse(req.body);

  // A malformed report is not worth an error of its own; accept and drop it so
  // reporting can never become a source of noise for the caller.
  if (!parsed.success) {
    res.status(204).end();
    return;
  }

  const report = parsed.data;

  console.error(
    "[client-error] " +
      JSON.stringify({
        ref: report.correlationId,
        code: report.code ?? "UNKNOWN",
        kind: report.kind ?? "unknown",
        status: report.status ?? null,
        route: report.route ?? null,
        role: report.role ?? "anonymous",
        appVersion: report.appVersion ?? null,
        source: report.source ?? null,
        technical: report.technical ?? null,
        at: new Date().toISOString(),
      }),
  );

  // Nothing useful to hand back, and a body would only invite the client to
  // branch on it.
  res.status(204).end();
};
