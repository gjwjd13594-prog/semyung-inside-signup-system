import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from "express-rate-limit";
import { redis } from "../redis.js";

type MemoryRecord = {
  hits: number;
  resetTime: Date;
};

export class RedisRateLimitStore implements Store {
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;
  private fallback = new Map<string, MemoryRecord>();

  constructor(prefix: string) {
    this.prefix = `rate-limit:${prefix}`;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      await ensureRedis();
      const [hits, ttl] = await Promise.all([redis.get(this.key(key)), redis.pttl(this.key(key))]);
      if (!hits) return undefined;
      return {
        totalHits: Number(hits),
        resetTime: resetTimeFromTtl(ttl),
      };
    } catch {
      return this.getFallback(key);
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      await ensureRedis();
      const redisKey = this.key(key);
      const totalHits = await redis.incr(redisKey);
      if (totalHits === 1) {
        await redis.pexpire(redisKey, this.windowMs);
      }
      const ttl = await redis.pttl(redisKey);
      return {
        totalHits,
        resetTime: resetTimeFromTtl(ttl),
      };
    } catch {
      return this.incrementFallback(key);
    }
  }

  async decrement(key: string) {
    try {
      await ensureRedis();
      await redis.decr(this.key(key));
    } catch {
      const record = this.fallback.get(key);
      if (record) record.hits = Math.max(0, record.hits - 1);
    }
  }

  async resetKey(key: string) {
    try {
      await ensureRedis();
      await redis.del(this.key(key));
    } catch {
      this.fallback.delete(key);
    }
  }

  async resetAll() {
    try {
      await ensureRedis();
      const stream = redis.scanStream({ match: `${this.prefix}:*`, count: 100 });
      for await (const keys of stream) {
        const batch = keys as string[];
        if (batch.length) await redis.del(...batch);
      }
    } catch {
      this.fallback.clear();
    }
  }

  private key(key: string) {
    return `${this.prefix}:${key}`;
  }

  private getFallback(key: string): ClientRateLimitInfo | undefined {
    const record = this.fallback.get(key);
    if (!record) return undefined;
    if (record.resetTime.getTime() <= Date.now()) {
      this.fallback.delete(key);
      return undefined;
    }
    return { totalHits: record.hits, resetTime: record.resetTime };
  }

  private incrementFallback(key: string): IncrementResponse {
    const current = this.getFallback(key);
    if (current) {
      const resetTime = current.resetTime ?? new Date(Date.now() + this.windowMs);
      const next = { totalHits: current.totalHits + 1, resetTime };
      this.fallback.set(key, { hits: next.totalHits, resetTime });
      return next;
    }
    const resetTime = new Date(Date.now() + this.windowMs);
    this.fallback.set(key, { hits: 1, resetTime });
    return { totalHits: 1, resetTime };
  }
}

async function ensureRedis() {
  if (redis.status !== "ready" && redis.status !== "connect") {
    await redis.connect();
  }
}

function resetTimeFromTtl(ttl: number) {
  return new Date(Date.now() + Math.max(ttl, 0));
}
