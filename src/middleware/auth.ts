import { createMiddleware } from 'hono/factory';

import type { Env } from '../env';
import { AppError } from './errors';

const ACCESS_EMAIL_HEADER = 'Cf-Access-Authenticated-User-Email';

/** 获取通过 Cloudflare Access 认证的用户邮箱，未认证时返回 null。 */
export function getAccessAuthenticatedEmail(req: {
  header(name: string): string | undefined;
}): string | null {
  const email = req.header(ACCESS_EMAIL_HEADER);
  return typeof email === 'string' && email.length > 0 ? email : null;
}

/** 检查请求是否已通过 Cloudflare Access 认证。 */
export function isAccessAuthenticated(req: {
  header(name: string): string | undefined;
}): boolean {
  return getAccessAuthenticatedEmail(req) !== null;
}

export const requireAdmin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!isAccessAuthenticated(c.req)) {
    throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
  }

  await next();
});
