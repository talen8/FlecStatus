import type { Env } from '../env';
import { isAccessAuthenticated } from '../middleware/auth';
import { computePublicHomepagePayload } from '../public/homepage';
import {
  buildNumberedPlaceholders,
  chunkPositiveIntegerIds,
} from '../public/visibility';
import { refreshPublicHomepageSnapshotIfNeeded } from '../snapshots';

// ── 行类型 ─────────────────────────────────────────────────────────────────

export type IncidentRow = {
  id: number;
  title: string;
  status: string;
  impact: string;
  message: string | null;
  started_at: number;
  resolved_at: number | null;
};

export type IncidentUpdateRow = {
  id: number;
  incident_id: number;
  status: string | null;
  message: string;
  created_at: number;
};

export type IncidentMonitorLinkRow = {
  incident_id: number;
  monitor_id: number;
};

export type MaintenanceWindowRow = {
  id: number;
  title: string;
  message: string | null;
  starts_at: number;
  ends_at: number;
  created_at: number;
};

export type MaintenanceWindowMonitorLinkRow = {
  maintenance_window_id: number;
  monitor_id: number;
};

// ── 状态转换 ───────────────────────────────────────────────────────────────

export function toCheckStatus(value: string | null): 'up' | 'down' | 'maintenance' | 'unknown' {
  switch (value) {
    case 'up':
    case 'down':
    case 'maintenance':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

export function toIncidentStatus(
  value: string | null,
): 'investigating' | 'identified' | 'monitoring' | 'resolved' {
  switch (value) {
    case 'investigating':
    case 'identified':
    case 'monitoring':
    case 'resolved':
      return value;
    default:
      return 'investigating';
  }
}

export function toIncidentImpact(value: string | null): 'none' | 'minor' | 'major' | 'critical' {
  switch (value) {
    case 'none':
    case 'minor':
    case 'major':
    case 'critical':
      return value;
    default:
      return 'minor';
  }
}

// ── 行 → API 转换 ──────────────────────────────────────────────────────────

export function incidentUpdateRowToApi(row: IncidentUpdateRow) {
  return {
    id: row.id,
    incident_id: row.incident_id,
    status: row.status === null ? null : toIncidentStatus(row.status),
    message: row.message,
    created_at: row.created_at,
  };
}

export function incidentRowToApi(
  row: IncidentRow,
  updates: IncidentUpdateRow[] = [],
  monitorIds: number[] = [],
) {
  return {
    id: row.id,
    title: row.title,
    status: toIncidentStatus(row.status),
    impact: toIncidentImpact(row.impact),
    message: row.message,
    started_at: row.started_at,
    resolved_at: row.resolved_at,
    monitor_ids: monitorIds,
    updates: updates.map(incidentUpdateRowToApi),
  };
}

export function maintenanceWindowRowToApi(row: MaintenanceWindowRow, monitorIds: number[] = []) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    created_at: row.created_at,
    monitor_ids: monitorIds,
  };
}

// ── 批量查询（带 chunking，安全处理大 ID 列表）─────────────────────────────

export async function listIncidentUpdatesByIncidentId(
  db: D1Database,
  incidentIds: number[],
): Promise<Map<number, IncidentUpdateRow[]>> {
  const byIncident = new Map<number, IncidentUpdateRow[]>();

  for (const ids of chunkPositiveIntegerIds(incidentIds)) {
    const placeholders = buildNumberedPlaceholders(ids.length);
    const sql = `
      SELECT id, incident_id, status, message, created_at
      FROM incident_updates
      WHERE incident_id IN (${placeholders})
      ORDER BY incident_id, created_at, id
    `;

    const { results } = await db
      .prepare(sql)
      .bind(...ids)
      .all<IncidentUpdateRow>();
    for (const r of results ?? []) {
      const existing = byIncident.get(r.incident_id) ?? [];
      existing.push(r);
      byIncident.set(r.incident_id, existing);
    }
  }

  return byIncident;
}

export async function listIncidentMonitorIdsByIncidentId(
  db: D1Database,
  incidentIds: number[],
): Promise<Map<number, number[]>> {
  const byIncident = new Map<number, number[]>();

  for (const ids of chunkPositiveIntegerIds(incidentIds)) {
    const placeholders = buildNumberedPlaceholders(ids.length);
    const sql = `
      SELECT incident_id, monitor_id
      FROM incident_monitors
      WHERE incident_id IN (${placeholders})
      ORDER BY incident_id, monitor_id
    `;

    const { results } = await db
      .prepare(sql)
      .bind(...ids)
      .all<IncidentMonitorLinkRow>();
    for (const r of results ?? []) {
      const existing = byIncident.get(r.incident_id) ?? [];
      existing.push(r.monitor_id);
      byIncident.set(r.incident_id, existing);
    }
  }

  return byIncident;
}

export async function listMaintenanceWindowMonitorIdsByWindowId(
  db: D1Database,
  windowIds: number[],
): Promise<Map<number, number[]>> {
  const byWindow = new Map<number, number[]>();

  for (const ids of chunkPositiveIntegerIds(windowIds)) {
    const placeholders = buildNumberedPlaceholders(ids.length);
    const sql = `
      SELECT maintenance_window_id, monitor_id
      FROM maintenance_window_monitors
      WHERE maintenance_window_id IN (${placeholders})
      ORDER BY maintenance_window_id, monitor_id
    `;

    const { results } = await db
      .prepare(sql)
      .bind(...ids)
      .all<MaintenanceWindowMonitorLinkRow>();
    for (const r of results ?? []) {
      const existing = byWindow.get(r.maintenance_window_id) ?? [];
      existing.push(r.monitor_id);
      byWindow.set(r.maintenance_window_id, existing);
    }
  }

  return byWindow;
}

// ── 认证与缓存 ─────────────────────────────────────────────────────────────

export function isAuthorizedStatusAdminRequest(c: {
  req: { header(name: string): string | undefined };
}): boolean {
  return isAccessAuthenticated(c.req);
}

export function appendAccessVary(res: Response): Response {
  const vary = res.headers.get('Vary');
  if (!vary) {
    res.headers.set('Vary', 'Cf-Access-Authenticated-User-Email');
  } else if (!vary.split(',').some((part) => part.trim().toLowerCase() === 'cf-access-authenticated-user-email')) {
    res.headers.set('Vary', `${vary}, Cf-Access-Authenticated-User-Email`);
  }

  return res;
}

export function applyPrivateNoStore(res: Response): Response {
  appendAccessVary(res);
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

export function withVisibilityAwareCaching(res: Response, includeHiddenMonitors: boolean): Response {
  return includeHiddenMonitors ? applyPrivateNoStore(res) : appendAccessVary(res);
}

// ── Uptime 工具 ────────────────────────────────────────────────────────────

export function resolveUptimeRangeStart(
  rangeStart: number,
  rangeEnd: number,
  monitorCreatedAt: number,
  lastCheckedAt: number | null,
  checks: Array<{ checked_at: number; status: string }>,
): number | null {
  const monitorRangeStart = Math.max(rangeStart, monitorCreatedAt);
  if (rangeEnd <= monitorRangeStart) return null;

  // 仅对在此时间窗口内创建的监控器，从首次观测到的探测开始计算。
  if (monitorRangeStart > rangeStart) {
    const firstCheckAt = checks.find(
      (check) => check.checked_at >= monitorRangeStart && check.checked_at < rangeEnd,
    )?.checked_at;
    if (firstCheckAt !== undefined) {
      return firstCheckAt;
    }

    return lastCheckedAt === null ? null : monitorRangeStart;
  }

  return monitorRangeStart;
}

export function addUptimeTotals(
  target: { total_sec: number; downtime_sec: number; unknown_sec: number; uptime_sec: number },
  source: { total_sec: number; downtime_sec: number; unknown_sec: number; uptime_sec: number },
): void {
  target.total_sec += source.total_sec;
  target.downtime_sec += source.downtime_sec;
  target.unknown_sec += source.unknown_sec;
  target.uptime_sec += source.uptime_sec;
}

// ── JSON 工具 ──────────────────────────────────────────────────────────────

export function jsonNumberLiteral(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : 'null';
}

export function jsonArrayLiteral(value: string | null | undefined): string {
  if (typeof value !== 'string') return '[]';
  const trimmed = value.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed : '[]';
}

// ── 管理端共享 ─────────────────────────────────────────────────────────────

export function queuePublicHomepageSnapshotRefresh(c: { env: Env; executionCtx: ExecutionContext }) {
  const now = Math.floor(Date.now() / 1000);
  c.executionCtx.waitUntil(
    refreshPublicHomepageSnapshotIfNeeded({
      db: c.env.DB,
      now,
      force: true,
      seedDataSnapshot: true,
      compute: () => computePublicHomepagePayload(c.env.DB, Math.floor(Date.now() / 1000)),
    }).catch((err) => {
      console.warn('homepage snapshot: refresh failed', err);
    }),
  );
}
