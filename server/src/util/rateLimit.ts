import type { FastifyReply, FastifyRequest } from "fastify";
import { Errors } from "./errors.js";

/**
 * Sliding-window rate limiter (in-memory, zero deps).
 * (Throttling concept adapted from MeshCentral server, Apache-2.0.)
 *
 * Each key keeps a ring of hit timestamps inside the window; a request is
 * allowed when the count inside the window is below max. Oldest entries
 * are pruned lazily on check and periodically via sweep().
 */

export interface RateLimitRule {
  /** window length in ms */
  windowMs: number;
  /** max hits per key inside the window */
  max: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** hits consumed inside the current window */
  remaining: number;
  /** ms until the oldest hit leaves the window (0 when allowed) */
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private rule: RateLimitRule) {}

  /** Register a hit for key and return the verdict. */
  check(key: string, now = Date.now()): RateLimitVerdict {
    this.prune(key, now);
    const hits = this.hits.get(key) ?? [];
    if (hits.length >= this.rule.max) {
      const retryAfterMs = Math.max(1, hits[0]! + this.rule.windowMs - now);
      return { allowed: false, remaining: 0, retryAfterMs };
    }
    hits.push(now);
    this.hits.set(key, hits);
    return {
      allowed: true,
      remaining: this.rule.max - hits.length,
      retryAfterMs: 0,
    };
  }

  /** Drop expired entries for one key. */
  private prune(key: string, now: number): void {
    const hits = this.hits.get(key);
    if (!hits) return;
    const cutoff = now - this.rule.windowMs;
    let i = 0;
    while (i < hits.length && hits[i]! <= cutoff) i++;
    if (i === hits.length) {
      this.hits.delete(key);
    } else if (i > 0) {
      this.hits.set(key, hits.slice(i));
    }
  }

  /** Periodic cleanup of idle keys; call once, returns a stop fn. */
  startSweeping(intervalMs = 60_000): () => void {
    if (this.sweeper) return () => this.stopSweeping();
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const key of this.hits.keys()) this.prune(key, now);
    }, intervalMs);
    this.sweeper.unref();
    return () => this.stopSweeping();
  }

  stopSweeping(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  /** Test hook: wipe state. */
  reset(): void {
    this.hits.clear();
  }

  /** Read-only copy of the active rule (for headers/metrics). */
  getRule(): RateLimitRule {
    return { ...this.rule };
  }
}

/**
 * Fastify preHandler that rate-limits requests by key (defaults to client
 * IP). Sends X-RateLimit-* headers; throws the shared 429 with Retry-After.
 * For REST routes only (not websockets).
 */
export function rateLimitPreHandler(
  limiter: SlidingWindowLimiter,
  keyFn: (req: FastifyRequest) => string = (req) => req.ip,
) {
  return async function rateLimit(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const verdict = limiter.check(keyFn(req));
    reply.header("x-ratelimit-limit", limiter.getRule().max);
    reply.header("x-ratelimit-remaining", verdict.remaining);
    if (!verdict.allowed) {
      reply.header("retry-after", Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)));
      throw Errors.rateLimited();
    }
  };
}