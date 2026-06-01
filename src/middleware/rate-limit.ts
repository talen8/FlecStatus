import { createMiddleware } from 'hono/factory';

import type { Env } from '../env';
import { AppError } from './errors';

type Bucket = { resetAt: number; count: number };

// 注意：这是一个尽力而为的内存限流器。
// - 设计上不依赖额外的绑定（KV/DO）。
// - 限制是按 Worker 隔离的，因此无法保证全局一致性。
//   但它仍然有助于减少意外/暴力流量。
const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 5000;

function parsePositiveInt(
  raw: unknown,
  fallback: number,
  opts: { min: number; max: number },
): number {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.trunc(n);
  if (v < opts.min) return opts.min;
  if (v > opts.max) return opts.max;
  return v;
}

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  // 优先使用 Cloudflare 提供的 IP。
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();

  // 回退到 XFF 的第一个条目（当使用其他代理时）。
  const xff = c.req.header('x-forwarded-for');
  if (xff && xff.trim()) return (xff.split(',')[0] ?? '').trim();

  return 'unknown';
}

export const requireAdminRateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const max = parsePositiveInt(c.env.ADMIN_RATE_LIMIT_MAX, 60, { min: 1, max: 10_000 });
  const windowSec = parsePositiveInt(c.env.ADMIN_RATE_LIMIT_WINDOW_SEC, 60, {
    min: 1,
    max: 86_400,
  });

  const ip = getClientIp(c);
  const key = `admin:${ip}`;
  const now = Date.now();
  const windowMs = windowSec * 1000;

  if (buckets.size > MAX_BUCKETS) {
    // 机会性清理以控制内存使用。
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k);
    }
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { resetAt: now + windowMs, count: 1 });
    await next();
    return;
  }

  if (bucket.count >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    c.header('Retry-After', String(retryAfterSec));
    throw new AppError(429, 'RATE_LIMITED', 'Too Many Requests');
  }

  bucket.count += 1;
  await next();
});
