import { Hono } from 'hono';

import type { Env } from './env';
import { handleError, handleNotFound } from './middleware/errors';
import { publicHotRoutes } from './routes/public-hot';

const app = new Hono<{ Bindings: Env }>();
const CORS_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const CORS_GET_ONLY_METHODS = 'GET, OPTIONS';

function normalizeApiPathname(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  if (!collapsed) return '/';
  if (collapsed.length === 1) return collapsed;
  return collapsed.replace(/\/+$/, '') || '/';
}

function isGetOnlyPublicApiPath(pathname: string): boolean {
  const normalizedPathname = normalizeApiPathname(pathname);
  return normalizedPathname === '/api' || normalizedPathname.startsWith('/api/');
}

function allowedMethodsForApiPath(pathname: string): string {
  return isGetOnlyPublicApiPath(pathname) ? CORS_GET_ONLY_METHODS : CORS_ALLOW_METHODS;
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

function applyCorsHeaders(res: Response, origin: string | null): Response {
  const out = new Response(res.body, res);
  appendVaryHeader(out, 'Origin');
  if (origin) {
    out.headers.set('Access-Control-Allow-Origin', origin);
    out.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    out.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  }
  return out;
}

function rewriteAdminRequest(req: Request): Request {
  const url = new URL(req.url);
  const prefix = '/admin/api';
  if (url.pathname === prefix) {
    url.pathname = '/';
  } else if (url.pathname.startsWith(`${prefix}/`)) {
    url.pathname = url.pathname.slice(prefix.length);
  }
  return new Request(url.toString(), req);
}

// 最小化的 CORS 支持，使 Pages（或任何 Web UI）在部署于不同源时能调用 API
//（例如 Pages 在 *.pages.dev，API 在 *.workers.dev）。这里直接反射 Origin 以保持简单，
// 避免在 Worker 配置中硬编码单一主机名。
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin');
  const pathname = new URL(c.req.url).pathname;
  const allowedMethods = allowedMethodsForApiPath(pathname);
  c.header('Vary', 'Origin');
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', allowedMethods);
    c.header('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
});

app.use('/admin/api/*', async (c, next) => {
  const origin = c.req.header('Origin');
  c.header('Vary', 'Origin');
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
    c.header('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
});

app.onError(handleError);
app.notFound(handleNotFound);

app.get('/', (c) => c.text('ok'));

app.route('/api', publicHotRoutes);

// 与公开状态页相比，管理端点的访问频率较低。通过懒加载管理路由，
// 使冷启动 CPU 资源集中在首页热路径上。
app.all('/admin/api', async (c) => {
  try {
    const { adminRoutes } = await import('./routes/admin');
    const rewritten = rewriteAdminRequest(c.req.raw);
    const res = await adminRoutes.fetch(rewritten, c.env, c.executionCtx);
    return applyCorsHeaders(res, c.req.header('Origin') ?? null);
  } catch (err) {
    console.error('[admin-api] error:', err);
    throw err;
  }
});
app.all('/admin/api/*', async (c) => {
  try {
    const { adminRoutes } = await import('./routes/admin');
    const rewritten = rewriteAdminRequest(c.req.raw);
    const res = await adminRoutes.fetch(rewritten, c.env, c.executionCtx);
    return applyCorsHeaders(res, c.req.header('Origin') ?? null);
  } catch (err) {
    console.error('[admin-api] error:', err);
    throw err;
  }
});

export const fetch = app.fetch;
