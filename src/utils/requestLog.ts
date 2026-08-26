import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "crypto";

/**
 * One line per request, safe to run in production.
 *
 * The API had no request logging at all. What visibility existed came from 107
 * debugLog calls that print whole request bodies and database rows, and those
 * are silenced outside development precisely because they put customer names,
 * addresses and phone numbers into the host's log retention. Turning them back
 * on is not an option; this replaces them with something that can always run.
 *
 * Deliberately excluded: request and response bodies, query strings, headers,
 * and anything derived from them. A path can still carry an identifier, so only
 * the route shape is kept - /admin/students/<uuid> logs as
 * /admin/students/:id - which is what you want for grouping anyway.
 */

/** Replaces the parts of a path that identify a person or a record. */
function routeShape(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      // uuid
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          segment,
        )
      ) {
        return ":id";
      }
      // numeric id
      if (/^\d+$/.test(segment)) return ":id";
      // razorpay order/payment ids and our own reference numbers
      if (/^(order_|pay_|INST_|IND_|CAREER_|PSYC|FREE-)/.test(segment)) {
        return ":ref";
      }
      // long opaque tokens (nanoid slugs, blog slugs with a random suffix)
      if (segment.length > 40) return ":slug";
      return segment;
    })
    .join("/");
}

/**
 * Correlation id for one request.
 *
 * Reuses the browser's X-Correlation-Id when it sent one, so the reference a
 * visitor reads off an error screen matches a line in these logs. That was the
 * whole point of the client-errors endpoint, and without a request log there
 * was nothing on this side to match against.
 */
function correlationId(req: Request): string {
  const supplied = req.headers["x-correlation-id"];
  if (typeof supplied === "string" && supplied.length > 0 && supplied.length <= 64) {
    return supplied;
  }
  return randomUUID();
}

export function requestLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    const ref = correlationId(req);

    // Echoed so the browser can quote it, and so a proxy can stitch the two
    // sides of a request together.
    res.setHeader("X-Correlation-Id", ref);

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const line = {
        ref,
        method: req.method,
        route: routeShape(req.originalUrl.split("?")[0]),
        status: res.statusCode,
        ms: Math.round(durationMs),
      };

      // 5xx is a fault worth finding in a log search; everything else is
      // ordinary traffic.
      const emit = res.statusCode >= 500 ? console.error : console.log;
      emit(`[req] ${JSON.stringify(line)}`);
    });

    next();
  };
}
