import { Queue } from "bullmq";
import Redis from "ioredis";
import { createClient } from "redis";

/**
 * Redis and the certificate queue are currently unused - every `pdfQ.add(...)`
 * call and the BullMQ worker in index.ts are commented out.
 *
 * This module used to throw at import time when the Redis variables were
 * absent, and opened a connection as a side effect of being imported. Between
 * them that meant an unused dependency could stop the whole API from booting,
 * and an unreachable Redis produced a permanent reconnect loop.
 *
 * Now nothing connects until something actually asks for a connection. To
 * re-enable certificate generation: set REDIS_URI_* and QUEUE_NAME_CERT, then
 * use `getPdfQueue()` in place of the old `pdfQ` export.
 */

const REDIS_URI =
  process.env.REDIS_MODE === "local"
    ? process.env.REDIS_URI_LOCAL
    : process.env.REDIS_URI_PROD;

export const CERT_QUEUE_NAME = process.env.QUEUE_NAME_CERT;

export interface PDFGenerationType {
  name: string;
  courseName: string;
  completedOn: string;
  certificateId: string;
  enrolmentId: string;
  instructor: string;
  startDate: string;
  endDate: string;
  logo?: string | null;
  digitalSignUrl?: string | null;
}

/** True when Redis and the queue name are both configured. */
export const isRedisConfigured = Boolean(REDIS_URI && CERT_QUEUE_NAME);

function requireRedisUri(): string {
  if (!REDIS_URI || !CERT_QUEUE_NAME) {
    throw new Error(
      "Redis is not configured. Set REDIS_URI_LOCAL/REDIS_URI_PROD and QUEUE_NAME_CERT to use the certificate queue.",
    );
  }
  return REDIS_URI;
}

let redisInstance: Redis | null = null;

/** Opens the connection on first call. Throws if Redis is not configured. */
export function getRedis(): Redis {
  const uri = requireRedisUri();

  if (!redisInstance) {
    redisInstance = new Redis(uri, {
      maxRetriesPerRequest: null,
      // Back off instead of retrying every 10ms, which pinned the CPU and
      // filled the logs whenever Redis was unreachable.
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
      reconnectOnError: (err) => !err.message.includes("ECONNREFUSED"),
      enableOfflineQueue: true,
    });
  }

  return redisInstance;
}

let redisClientInstance: ReturnType<typeof createClient> | null = null;

/** node-redis client, kept for parity with the previous export. */
export function getRedisClient() {
  const uri = requireRedisUri();

  if (!redisClientInstance) {
    redisClientInstance = createClient({
      url: uri,
      disableOfflineQueue: false,
    });
  }

  return redisClientInstance;
}

let pdfQueue: Queue<PDFGenerationType, boolean> | null = null;

/** The certificate queue. Throws if Redis is not configured. */
export function getPdfQueue(): Queue<PDFGenerationType, boolean> {
  requireRedisUri();

  if (!pdfQueue) {
    pdfQueue = new Queue<PDFGenerationType, boolean>(CERT_QUEUE_NAME!, {
      connection: getRedis(),
    });
  }

  return pdfQueue;
}
