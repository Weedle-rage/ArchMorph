/**
 * Best-effort usage limits for the AI assistant.
 *
 * State lives in memory, so on a multi-instance host (e.g. Cloudflare Workers) each
 * instance counts separately. That is fine as a cost guard for the first release;
 * swap `createLimiter` for a KV / Durable Object backed store before scaling out
 * or once accounts exist (then key by user id instead of IP).
 */

export type LimitConfig = {
  perMinute: number;
  perDay: number;
  globalPerDay: number;
};

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number; scope: "minute" | "day" | "global" };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Bucket = { start: number; count: number };

export function createLimiter(config: LimitConfig, now: () => number = Date.now) {
  const minute = new Map<string, Bucket>();
  const day = new Map<string, Bucket>();
  let global: Bucket = { start: now(), count: 0 };

  function take(map: Map<string, Bucket>, key: string, windowMs: number, max: number, time: number) {
    const bucket = map.get(key);
    if (!bucket || time - bucket.start >= windowMs) {
      map.set(key, { start: time, count: 1 });
      return 0;
    }
    if (bucket.count >= max) return Math.ceil((bucket.start + windowMs - time) / 1000);
    bucket.count += 1;
    return 0;
  }

  function prune(time: number) {
    if (minute.size + day.size < 5000) return;
    for (const [key, bucket] of minute) if (time - bucket.start >= MINUTE) minute.delete(key);
    for (const [key, bucket] of day) if (time - bucket.start >= DAY) day.delete(key);
  }

  return {
    check(clientId: string): LimitResult {
      const time = now();
      prune(time);

      if (time - global.start >= DAY) global = { start: time, count: 0 };
      if (global.count >= config.globalPerDay) {
        return { ok: false, retryAfterSeconds: Math.ceil((global.start + DAY - time) / 1000), scope: "global" };
      }

      const perDayWait = take(day, clientId, DAY, config.perDay, time);
      if (perDayWait) return { ok: false, retryAfterSeconds: perDayWait, scope: "day" };
      const perMinuteWait = take(minute, clientId, MINUTE, config.perMinute, time);
      if (perMinuteWait) {
        // Do not charge the daily allowance for a request that was rejected.
        const bucket = day.get(clientId);
        if (bucket) bucket.count -= 1;
        return { ok: false, retryAfterSeconds: perMinuteWait, scope: "minute" };
      }

      global.count += 1;
      return { ok: true };
    },
  };
}

export function limitConfigFromEnv(env: Record<string, string | undefined>): LimitConfig {
  const read = (key: string, fallback: number) => {
    const value = Number(env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    perMinute: read("AI_LIMIT_PER_MINUTE", 12),
    perDay: read("AI_LIMIT_PER_DAY", 150),
    globalPerDay: read("AI_LIMIT_GLOBAL_PER_DAY", 3000),
  };
}

export function clientIdFromRequest(request: Request) {
  const headers = request.headers;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
