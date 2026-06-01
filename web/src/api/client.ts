import type {
  AdminMonitor,
  AdminSettings,
  AdminSettingsResponse,
  AdminIncidentsResponse,
  AnalyticsOverviewResponse,
  AnalyticsOverviewRange,
  AnalyticsRange,
  CreateMonitorInput,
  CreateIncidentInput,
  CreateIncidentUpdateInput,
  CreateNotificationChannelInput,
  CreateMaintenanceWindowInput,
  LatencyResponse,
  MaintenanceWindow,
  MonitorTestResult,
  Incident,
  IncidentUpdate,
  NotificationChannel,
  NotificationChannelTestResult,
  PatchMaintenanceWindowInput,
  PatchMonitorInput,
  PatchNotificationChannelInput,
  PublicUptimeOverviewResponse,
  PublicIncidentsResponse,
  PublicMaintenanceWindowsResponse,
  PublicDayContextResponse,
  AssignMonitorsToGroupInput,
  AssignMonitorsToGroupResult,
  ResolveIncidentInput,
  StatusResponse,
  MonitorAnalyticsResponse,
  MonitorOutagesResponse,
  PublicHomepageResponse,
  UptimeResponse,
} from './types';

// 生产部署时的构建时覆盖配置。
// - 公开 API：`/api`（无需认证）
// - 管理 API：`/admin/api`（需要 Cloudflare Access 认证）
// - 覆盖：将 `VITE_API_HOST` 设置为 Worker 的完整 URL（如 `https://<worker>.workers.dev`）
const API_HOST = (import.meta.env.VITE_API_HOST as string | undefined) ?? '';
const PUBLIC_API_HOST = `${API_HOST}/api`;
const ADMIN_API_HOST = `${API_HOST}/admin/api`;

const PUBLIC_CACHE_TTL_MS = 30_000;
const publicCache = new Map<string, { at: number; value: unknown }>();

const LS_PUBLIC_HOMEPAGE_KEY = 'uptimer_public_homepage_snapshot_v2';
const LS_PUBLIC_STATUS_KEY = 'uptimer_public_status_snapshot_v1';

type PersistedCache<T> = { at: number; value: T };

type CompactLatencyResponse = Omit<LatencyResponse, 'points'> & {
  points: {
    checked_at: number[];
    status_codes: string;
    latency_ms: Array<number | null>;
  };
};

function isCompactLatencyResponse(
  value: LatencyResponse | CompactLatencyResponse,
): value is CompactLatencyResponse {
  if (Array.isArray(value.points) || !value.points || typeof value.points !== 'object') {
    return false;
  }

  return (
    Array.isArray(value.points.checked_at) &&
    typeof value.points.status_codes === 'string' &&
    Array.isArray(value.points.latency_ms)
  );
}

/** 将紧凑编码的延迟响应解码为标准格式。 */
function decodeCompactLatencyResponse(raw: CompactLatencyResponse): LatencyResponse {
  return {
    ...raw,
    points: raw.points.checked_at.map((checked_at, index) => {
      const code = raw.points.status_codes[index] ?? 'x';
      return {
        checked_at,
        status:
          code === 'u'
            ? 'up'
            : code === 'd'
              ? 'down'
              : code === 'm'
                ? 'maintenance'
                : 'unknown',
        latency_ms: raw.points.latency_ms[index] ?? null,
      };
    }),
  };
}

function getCachedPublic<T>(key: string): T | null {
  const hit = publicCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PUBLIC_CACHE_TTL_MS) return null;
  return hit.value as T;
}

function setCachedPublic(key: string, value: unknown) {
  publicCache.set(key, { at: Date.now(), value });
}

/** 从 localStorage 读取持久化缓存，超时或格式异常时返回 null。 */
function readPersistedCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;

    const at = (parsed as { at?: unknown }).at;
    const value = (parsed as { value?: unknown }).value;
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    if (Date.now() - at > maxAgeMs) return null;
    if (!value || typeof value !== 'object') return null;
    return value as T;
  } catch {
    return null;
  }
}

/** 将数据写入 localStorage 持久化缓存，失败时静默忽略。 */
function writePersistedCache<T>(key: string, value: T): void {
  try {
    const payload: PersistedCache<T> = { at: Date.now(), value };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // 尽力而为，忽略错误。
  }
}

class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 获取管理端认证头（当前由 Cloudflare Access 处理，预留扩展点）。 */
function getAuthHeaders(): HeadersInit {
  return {};
}

/** 获取公共 API 可选认证信息（当前无需认证，预留扩展点）。 */
function getOptionalPublicAuth(): {
  fetchInit: RequestInit;
  shouldBypassCache: boolean;
} {
  return { fetchInit: {}, shouldBypassCache: false };
}

function safeJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  // 优先将响应体读取为文本再自行解析，以便处理"返回 HTML 而非 JSON"的情况
  // （常见于 API_HOST/代理/路由配置错误时）。
  const text = await res.text();
  const body = safeJsonParse(text);

  if (!res.ok) {
    const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const code = typeof err?.code === 'string' ? err.code : 'UNKNOWN';
    const message =
      typeof err?.message === 'string'
        ? err.message
        : text.trim().startsWith('<')
          ? 'API returned HTML instead of JSON. Check VITE_API_HOST / proxy / routing to the Worker.'
          : `Request failed (HTTP ${res.status}).`;

    throw new ApiError(code, message, res.status);
  }

  if (body === null) {
    const hint = text.trim().startsWith('<')
      ? 'API returned HTML instead of JSON. Check VITE_API_HOST / proxy / routing to the Worker.'
      : 'API returned an invalid response (expected JSON).';
    throw new ApiError('INVALID_RESPONSE', hint, res.status);
  }

  return body as T;
}

/** 带缓存的公共 API 请求，封装内存缓存、持久化缓存及弱网降级逻辑。 */
async function cachedPublicFetch<T>(
  url: string,
  fetcher: (url: string, init: RequestInit) => Promise<T>,
  opts?: {
    persistedCacheKey?: string;
    persistedCacheMaxAgeMs?: number;
  },
): Promise<T> {
  const auth = getOptionalPublicAuth();
  const cached = auth.shouldBypassCache ? null : getCachedPublic<T>(url);
  if (cached) return cached;

  try {
    const data = await fetcher(url, auth.fetchInit);
    if (!auth.shouldBypassCache) {
      setCachedPublic(url, data);
      if (opts?.persistedCacheKey) {
        writePersistedCache(opts.persistedCacheKey, data);
      }
    }
    return data;
  } catch (err) {
    if (opts?.persistedCacheKey && !auth.shouldBypassCache) {
      const persisted = readPersistedCache<T>(
        opts.persistedCacheKey,
        opts.persistedCacheMaxAgeMs ?? 10 * 60_000,
      );
      if (persisted) return persisted;
    }
    const stale = auth.shouldBypassCache ? null : getCachedPublic<T>(url);
    if (stale) return stale;
    throw err;
  }
}

/** 管理端 API 请求，统一处理认证头和 JSON 序列化。 */
async function adminRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers:
      body !== undefined
        ? { 'Content-Type': 'application/json', ...getAuthHeaders() }
        : getAuthHeaders(),
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${ADMIN_API_HOST}${path}`, init);
  return handleResponse<T>(res);
}

// 公共 API
export async function fetchStatus(): Promise<StatusResponse> {
  return cachedPublicFetch(
    `${PUBLIC_API_HOST}/status`,
    (url, init) => fetch(url, init).then(handleResponse<StatusResponse>),
    { persistedCacheKey: LS_PUBLIC_STATUS_KEY },
  );
}

export async function fetchHomepage(): Promise<PublicHomepageResponse> {
  return cachedPublicFetch(
    `${PUBLIC_API_HOST}/homepage`,
    (url, init) => fetch(url, init).then(handleResponse<PublicHomepageResponse>),
    { persistedCacheKey: LS_PUBLIC_HOMEPAGE_KEY },
  );
}

export async function fetchLatency(
  monitorId: number,
  range: '24h' = '24h',
): Promise<LatencyResponse> {
  const url = `${PUBLIC_API_HOST}/monitors/${monitorId}/latency?range=${range}&format=compact-v1`;
  return cachedPublicFetch(url, async (fetchUrl, init) => {
    const res = await fetch(fetchUrl, init);
    const raw = await handleResponse<LatencyResponse | CompactLatencyResponse>(res);
    return isCompactLatencyResponse(raw) ? decodeCompactLatencyResponse(raw) : raw;
  });
}

export async function fetchUptime(
  monitorId: number,
  range: '24h' | '7d' | '30d' = '24h',
): Promise<UptimeResponse> {
  const url = `${PUBLIC_API_HOST}/monitors/${monitorId}/uptime?range=${range}`;
  return cachedPublicFetch(url, (fetchUrl, init) =>
    fetch(fetchUrl, init).then(handleResponse<UptimeResponse>),
  );
}

export async function fetchPublicUptimeOverview(
  range: '30d' | '90d' = '30d',
): Promise<PublicUptimeOverviewResponse> {
  const url = `${PUBLIC_API_HOST}/analytics/uptime?range=${range}`;
  return cachedPublicFetch(url, (fetchUrl, init) =>
    fetch(fetchUrl, init).then(handleResponse<PublicUptimeOverviewResponse>),
  );
}

export async function fetchPublicMonitorOutages(
  monitorId: number,
  opts: { range?: '30d'; limit?: number; cursor?: number } = {},
): Promise<MonitorOutagesResponse> {
  const auth = getOptionalPublicAuth();
  const qs = new URLSearchParams();
  qs.set('range', opts.range ?? '30d');
  qs.set('limit', String(opts.limit ?? 200));
  if (opts.cursor !== undefined) qs.set('cursor', String(opts.cursor));

  const url = `${PUBLIC_API_HOST}/monitors/${monitorId}/outages?${qs.toString()}`;
  const res = await fetch(url, auth.fetchInit);
  return handleResponse<MonitorOutagesResponse>(res);
}

export { ApiError };

// 管理员认证（由 Cloudflare Access 处理，此端点仅确认 Access 会话有效）
export async function verifyAccessSession(): Promise<void> {
  const res = await fetch(`${ADMIN_API_HOST}/auth/verify`);
  await handleResponse<{ ok: true }>(res);
}

// 管理 API - 监控项
export async function fetchAdminMonitors(limit = 50): Promise<{ monitors: AdminMonitor[] }> {
  return adminRequest('GET', `/monitors?limit=${limit}`);
}

export async function createMonitor(input: CreateMonitorInput): Promise<{ monitor: AdminMonitor }> {
  return adminRequest('POST', '/monitors', input);
}

export async function updateMonitor(
  id: number,
  input: PatchMonitorInput,
): Promise<{ monitor: AdminMonitor }> {
  return adminRequest('PATCH', `/monitors/${id}`, input);
}

export async function deleteMonitor(id: number): Promise<{ deleted: boolean }> {
  return adminRequest('DELETE', `/monitors/${id}`);
}

export async function pauseMonitor(id: number): Promise<{ monitor: AdminMonitor }> {
  return adminRequest('POST', `/monitors/${id}/pause`);
}

export async function resumeMonitor(id: number): Promise<{ monitor: AdminMonitor }> {
  return adminRequest('POST', `/monitors/${id}/resume`);
}

export async function testMonitor(id: number): Promise<MonitorTestResult> {
  return adminRequest('POST', `/monitors/${id}/test`);
}

export async function assignMonitorsToGroup(
  input: AssignMonitorsToGroupInput,
): Promise<AssignMonitorsToGroupResult> {
  return adminRequest('POST', '/monitors/groups/assign', input);
}

// 管理 API - 通知渠道
export async function fetchNotificationChannels(
  limit = 50,
): Promise<{ notification_channels: NotificationChannel[] }> {
  return adminRequest('GET', `/notification-channels?limit=${limit}`);
}

export async function createNotificationChannel(
  input: CreateNotificationChannelInput,
): Promise<{ notification_channel: NotificationChannel }> {
  return adminRequest('POST', '/notification-channels', input);
}

export async function updateNotificationChannel(
  id: number,
  input: PatchNotificationChannelInput,
): Promise<{ notification_channel: NotificationChannel }> {
  return adminRequest('PATCH', `/notification-channels/${id}`, input);
}

export async function testNotificationChannel(id: number): Promise<NotificationChannelTestResult> {
  return adminRequest('POST', `/notification-channels/${id}/test`);
}

export async function deleteNotificationChannel(id: number): Promise<{ deleted: boolean }> {
  return adminRequest('DELETE', `/notification-channels/${id}`);
}

// 公共 API - 事件
export async function fetchPublicIncidents(
  limit = 20,
  cursor?: number,
  opts: { resolvedOnly?: boolean } = {},
): Promise<PublicIncidentsResponse> {
  const auth = getOptionalPublicAuth();
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.resolvedOnly) qs.set('resolved_only', '1');
  if (cursor) qs.set('cursor', String(cursor));
  const res = await fetch(`${PUBLIC_API_HOST}/incidents?${qs.toString()}`, auth.fetchInit);
  return handleResponse<PublicIncidentsResponse>(res);
}

export async function fetchPublicIncidentDetail(
  id: number,
  opts: { resolvedOnly?: boolean } = {},
): Promise<Incident> {
  const data = await fetchPublicIncidents(20, undefined, opts);
  const incident = data.incidents.find((entry) => entry.id === id);
  if (!incident) {
    throw new ApiError('NOT_FOUND', 'Incident not found in public feed.', 404);
  }
  return incident;
}

// 公共 API - 维护窗口
export async function fetchPublicMaintenanceWindows(
  limit = 20,
  cursor?: number,
): Promise<PublicMaintenanceWindowsResponse> {
  const auth = getOptionalPublicAuth();
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', String(cursor));
  const res = await fetch(
    `${PUBLIC_API_HOST}/maintenance-windows?${qs.toString()}`,
    auth.fetchInit,
  );
  return handleResponse<PublicMaintenanceWindowsResponse>(res);
}

// 公共 API - 每日上下文（某监控项的维护窗口 + 事件）
export async function fetchPublicDayContext(
  monitorId: number,
  dayStartAt: number,
): Promise<PublicDayContextResponse> {
  const auth = getOptionalPublicAuth();
  const qs = new URLSearchParams({ day_start_at: String(dayStartAt) });
  const res = await fetch(
    `${PUBLIC_API_HOST}/monitors/${monitorId}/day-context?${qs.toString()}`,
    auth.fetchInit,
  );
  return handleResponse<PublicDayContextResponse>(res);
}

// 管理 API - 事件
export async function fetchAdminIncidents(limit = 50): Promise<AdminIncidentsResponse> {
  return adminRequest('GET', `/incidents?limit=${limit}`);
}

export async function createIncident(input: CreateIncidentInput): Promise<{ incident: Incident }> {
  return adminRequest('POST', '/incidents', input);
}

export async function addIncidentUpdate(
  id: number,
  input: CreateIncidentUpdateInput,
): Promise<{ incident: Incident; update: IncidentUpdate }> {
  return adminRequest('POST', `/incidents/${id}/updates`, input);
}

export async function resolveIncident(
  id: number,
  input: ResolveIncidentInput,
): Promise<{ incident: Incident; update?: IncidentUpdate }> {
  return adminRequest('PATCH', `/incidents/${id}/resolve`, input);
}

export async function deleteIncident(id: number): Promise<{ deleted: boolean }> {
  return adminRequest('DELETE', `/incidents/${id}`);
}

// 管理 API - 维护窗口
export async function fetchMaintenanceWindows(
  limit = 50,
): Promise<{ maintenance_windows: MaintenanceWindow[] }> {
  return adminRequest('GET', `/maintenance-windows?limit=${limit}`);
}

export async function createMaintenanceWindow(
  input: CreateMaintenanceWindowInput,
): Promise<{ maintenance_window: MaintenanceWindow }> {
  return adminRequest('POST', '/maintenance-windows', input);
}

export async function updateMaintenanceWindow(
  id: number,
  input: PatchMaintenanceWindowInput,
): Promise<{ maintenance_window: MaintenanceWindow }> {
  return adminRequest('PATCH', `/maintenance-windows/${id}`, input);
}

export async function deleteMaintenanceWindow(id: number): Promise<{ deleted: boolean }> {
  return adminRequest('DELETE', `/maintenance-windows/${id}`);
}

// 管理 API - 数据分析
export async function fetchAdminAnalyticsOverview(
  range: AnalyticsOverviewRange = '24h',
): Promise<AnalyticsOverviewResponse> {
  return adminRequest('GET', `/analytics/overview?range=${range}`);
}

export async function fetchAdminMonitorAnalytics(
  monitorId: number,
  range: AnalyticsRange = '24h',
): Promise<MonitorAnalyticsResponse> {
  return adminRequest('GET', `/analytics/monitors/${monitorId}?range=${range}`);
}

export async function fetchAdminMonitorOutages(
  monitorId: number,
  opts: { range?: AnalyticsRange; limit?: number; cursor?: number } = {},
): Promise<MonitorOutagesResponse> {
  const qs = new URLSearchParams();
  qs.set('range', opts.range ?? '7d');
  qs.set('limit', String(opts.limit ?? 50));
  if (opts.cursor !== undefined) qs.set('cursor', String(opts.cursor));

  return adminRequest('GET', `/analytics/monitors/${monitorId}/outages?${qs.toString()}`);
}

export async function fetchAdminSettings(): Promise<AdminSettingsResponse> {
  return adminRequest('GET', '/settings');
}

export async function patchAdminSettings(
  input: Partial<AdminSettings>,
): Promise<AdminSettingsResponse> {
  return adminRequest('PATCH', '/settings', input);
}
