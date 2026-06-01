import type { MiddlewareHandler } from 'hono';

import {
  Trace,
  TRACE_HEADER,
  TRACE_ID_HEADER,
  applyTraceToResponse,
  resolveTraceOptions,
} from '../observability/trace';

function hasAuthorizationHeader(req: { header?(name: string): string | undefined }): boolean {
  const value = req.header?.('Authorization');
  return typeof value === 'string' && value.trim().length > 0;
}

function appendVaryHeader(res: Response, value: string): void {
  const next = value.trim();
  if (!next) return;
  const existing = res.headers.get('Vary');
  if (!existing) {
    res.headers.set('Vary', next);
    return;
  }
  const parts = existing.split(',').map((part) => part.trim().toLowerCase());
  if (parts.includes(next.toLowerCase())) return;
  res.headers.set('Vary', `${existing}, ${next}`);
}

function buildCacheKey(
  url: string,
  origin: string | undefined,
  normalizeCacheKeyUrl?: (url: URL) => void,
): Request {
  const cacheUrl = new URL(url);
  normalizeCacheKeyUrl?.(cacheUrl);
  if (origin) {
    cacheUrl.searchParams.set('__uptimer_origin_cache_key', origin);
  }
  return new Request(cacheUrl.toString(), { method: 'GET' });
}

const openedCachesByStorage = new WeakMap<object, Map<string, Promise<Cache>>>();

function openNamedCache(name: string): Promise<Cache> {
  const storage = globalThis.caches as unknown as object & { open(name: string): Promise<Cache> };
  let byName = openedCachesByStorage.get(storage);
  if (!byName) {
    byName = new Map<string, Promise<Cache>>();
    openedCachesByStorage.set(storage, byName);
  }

  const cached = byName.get(name);
  if (cached) {
    return cached;
  }

  const opened = storage.open(name).catch((error) => {
    byName?.delete(name);
    throw error;
  });
  byName.set(name, opened);
  return opened;
}

// 在边缘缓存公共（未认证）GET 响应。
// 这可以减少 D1 读取压力，并大幅改善慢速网络上的 TTFB。
//
// 重要：携带 Authorization 头的请求会完全绕过共享缓存，
// 因为公共端点在收到有效的 bearer token 时可能会返回仅限管理员的有效载荷。
// 如果处理器已经设置了 Cache-Control，则遵循其设置（不覆盖）。
// 这允许类似 `/public/status` 的端点精确控制缓存新鲜度（<= 60 秒）。
export function cachePublic(opts: {
  cacheName: string;
  maxAgeSeconds: number;
  skipPathnames?: readonly string[];
  normalizeCacheKeyUrl?: (url: URL) => void;
}): MiddlewareHandler {
  return async (c, next) => {
    const traceOptions =
      c.req.header(TRACE_HEADER) !== undefined
        ? resolveTraceOptions({
            header: (name) => c.req.header(name),
            env: c.env as unknown as Record<string, unknown>,
          })
        : { enabled: false, id: '', mode: null };
    const trace = traceOptions.enabled ? new Trace(traceOptions) : null;

    if (c.req.method !== 'GET' || hasAuthorizationHeader(c.req)) {
      await next();
      return;
    }

    const skipPathnames = opts.skipPathnames ?? [];
    if (skipPathnames.length > 0) {
      const pathname = new URL(c.req.url).pathname;
      if (skipPathnames.includes(pathname)) {
        await next();
        return;
      }
    }

    const cache = await openNamedCache(opts.cacheName);
    const cacheKey = buildCacheKey(
      c.req.url,
      c.req.header('Origin'),
      opts.normalizeCacheKeyUrl,
    );

    const bypassCache = trace?.mode === 'bypass-cache';
    if (!bypassCache) {
      const matchT0 = trace ? performance.now() : 0;
      const cached = await cache.match(cacheKey);
      if (trace) {
        trace.addSpan('cache_match', performance.now() - matchT0);
      }
      if (cached) {
        if (trace) {
          trace.setLabel('edge_cache', 'hit');
          trace.finish('total');
          const res = new Response(cached.body, cached);
          applyTraceToResponse({ res, trace, prefix: 'edge' });
          // 避免在浏览器/边缘层缓存带追踪的响应。
          res.headers.set('Cache-Control', 'private, no-store');
          appendVaryHeader(res, TRACE_HEADER);
          res.headers.set(TRACE_ID_HEADER, trace.id);
          return res;
        }
        return cached;
      }
      if (trace) {
        trace.setLabel('edge_cache', 'miss');
      }
    } else if (trace) {
      trace.setLabel('edge_cache', 'bypass');
    }

    await next();

    if (c.res.status !== 200) return;

    // 遵循显式设置的 no-store/no-cache/private 响应。
    const cacheControl = c.res.headers.get('Cache-Control');
    if (
      cacheControl &&
      /(?:^|,\s*)(?:private|no-(?:store|cache))(?:\s*(?:=|,|$))/i.test(cacheControl)
    ) {
      return;
    }

    // 如果处理器已经设置了 Cache-Control，则保留它。
    if (!cacheControl) {
      c.res.headers.set('Cache-Control', `public, max-age=${opts.maxAgeSeconds}`);
    }

    if (trace) {
      trace.finish('total');
      applyTraceToResponse({ res: c.res, trace, prefix: 'edge' });
      c.res.headers.set('Cache-Control', 'private, no-store');
      appendVaryHeader(c.res, TRACE_HEADER);
      return;
    }

    // 将响应存入 Cloudflare 缓存，不阻塞响应发送。
    c.executionCtx.waitUntil(cache.put(cacheKey, c.res.clone()));
  };
}
