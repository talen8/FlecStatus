import type { Env } from '../env';
import { Trace } from '../observability/trace';
import {
  refreshPublicMonitorRuntimeSnapshot,
  type MonitorRuntimeUpdate,
} from '../public/monitor-runtime';
import { rebuildPublicMonitorRuntimeSnapshot } from '../public/monitor-runtime-rebuild';
import {
  readMonitorRuntimeUpdateFragments,
  readMonitorRuntimeUpdateFragmentsPage,
  type MonitorRuntimeUpdateFragmentPageReadResult,
} from '../snapshots/public-monitor-fragments';

export const MONITOR_RUNTIME_UPDATE_FRAGMENT_MAX_AGE_SECONDS = 5 * 60;
export const MONITOR_RUNTIME_UPDATE_FRAGMENT_FUTURE_TOLERANCE_SECONDS = 60;

export type InternalRuntimeFragmentsRefreshResult = {
  ok: boolean;
  refreshed: boolean;
  updateCount: number;
  invalidCount: number;
  staleCount: number;
  skip?: 'no_updates';
  error?: boolean;
  hasMore?: boolean;
  rowCount?: number;
  updateOffset?: number;
  updateLimit?: number;
};

function readBoundedPositiveIntegerEnv(
  env: Env,
  key: keyof Env,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (typeof raw !== 'string') {
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function latestUpdateTimestamp(updates: readonly MonitorRuntimeUpdate[]): number | null {
  let latest: number | null = null;
  for (const update of updates) {
    if (latest === null || update.checked_at > latest) {
      latest = update.checked_at;
    }
  }
  return latest;
}

async function refreshMonitorRuntimeSnapshotFromUpdates(opts: {
  env: Env;
  now: number;
  updates: readonly MonitorRuntimeUpdate[];
  trace?: Trace | null;
}): Promise<void> {
  const refreshNow = Math.max(opts.now, latestUpdateTimestamp(opts.updates) ?? opts.now);
  await (opts.trace
    ? opts.trace.timeAsync(
        'runtime_fragments_refresh_snapshot',
        async () =>
          await refreshPublicMonitorRuntimeSnapshot({
            db: opts.env.DB,
            now: refreshNow,
            updates: [...opts.updates],
            rebuild: async () => await rebuildPublicMonitorRuntimeSnapshot(opts.env.DB, refreshNow),
          }),
      )
    : refreshPublicMonitorRuntimeSnapshot({
        db: opts.env.DB,
        now: refreshNow,
        updates: [...opts.updates],
        rebuild: async () => await rebuildPublicMonitorRuntimeSnapshot(opts.env.DB, refreshNow),
      }));
}

function readRuntimeFragmentTimeWindow(opts: { env: Env; now: number }): {
  maxAgeSeconds: number;
  minGeneratedAt: number;
  maxGeneratedAt: number;
} {
  const maxAgeSeconds = readBoundedPositiveIntegerEnv(
    opts.env,
    'UPTIMER_MONITOR_RUNTIME_UPDATE_FRAGMENT_MAX_AGE_SECONDS',
    MONITOR_RUNTIME_UPDATE_FRAGMENT_MAX_AGE_SECONDS,
    30,
    15 * 60,
  );
  return {
    maxAgeSeconds,
    minGeneratedAt: Math.max(0, opts.now - maxAgeSeconds),
    maxGeneratedAt: opts.now + MONITOR_RUNTIME_UPDATE_FRAGMENT_FUTURE_TOLERANCE_SECONDS,
  };
}

export async function refreshMonitorRuntimeSnapshotFromUpdateFragments(opts: {
  env: Env;
  now: number;
  offset?: number;
  limit?: number;
  trace?: Trace | null;
}): Promise<InternalRuntimeFragmentsRefreshResult> {
  const paged = opts.offset != null && opts.limit != null;
  const updateOffset = paged ? Math.max(0, Math.floor(opts.offset ?? 0)) : 0;
  const updateLimit = paged ? Math.max(1, Math.min(10, Math.floor(opts.limit ?? 1))) : 0;
  const { maxAgeSeconds, minGeneratedAt, maxGeneratedAt } = readRuntimeFragmentTimeWindow(opts);

  try {
    opts.trace?.setLabel('route', paged ? 'internal/runtime-fragments-refresh-page' : 'internal/runtime-fragments-refresh');
    opts.trace?.setLabel('now', opts.now);
    opts.trace?.setLabel('fragment_max_age_s', maxAgeSeconds);
    if (paged) {
      opts.trace?.setLabel('runtime_update_offset', updateOffset);
      opts.trace?.setLabel('runtime_update_limit', updateLimit);
    }

    const readOpts = { minGeneratedAt, maxGeneratedAt };
    const fragmentRead = paged
      ? await Trace.timed(opts.trace, 'runtime_fragments_page_read', () =>
          readMonitorRuntimeUpdateFragmentsPage(opts.env.DB, { ...readOpts, offset: updateOffset, limit: updateLimit }),
        )
      : await Trace.timed(opts.trace, 'runtime_fragments_read', () =>
          readMonitorRuntimeUpdateFragments(opts.env.DB, readOpts),
        );

    opts.trace?.setLabel('runtime_update_fragment_count', fragmentRead.updates.length);
    opts.trace?.setLabel('runtime_update_fragment_invalid_count', fragmentRead.invalidCount);
    opts.trace?.setLabel('runtime_update_fragment_stale_count', fragmentRead.staleCount);

    const pageResult = paged ? (fragmentRead as MonitorRuntimeUpdateFragmentPageReadResult) : null;
    if (pageResult) {
      opts.trace?.setLabel('runtime_update_fragment_has_more', pageResult.hasMore ? 1 : 0);
    }
    const pagination = pageResult
      ? { hasMore: pageResult.hasMore, rowCount: pageResult.rowCount, updateOffset, updateLimit }
      : {};

    if (fragmentRead.updates.length === 0) {
      opts.trace?.setLabel('skip', 'no_updates');
      return { ok: true, refreshed: false, updateCount: 0, invalidCount: fragmentRead.invalidCount, staleCount: fragmentRead.staleCount, skip: 'no_updates', ...pagination };
    }

    await refreshMonitorRuntimeSnapshotFromUpdates({
      env: opts.env,
      now: opts.now,
      updates: fragmentRead.updates,
      trace: opts.trace ?? null,
    });

    return { ok: true, refreshed: true, updateCount: fragmentRead.updates.length, invalidCount: fragmentRead.invalidCount, staleCount: fragmentRead.staleCount, ...pagination };
  } catch (err) {
    console.warn('internal runtime fragments refresh failed', err);
    opts.trace?.setLabel('error', '1');
    const errorPagination = paged ? { hasMore: false, rowCount: 0, updateOffset, updateLimit } : {};
    return { ok: false, refreshed: false, updateCount: 0, invalidCount: 0, staleCount: 0, error: true, ...errorPagination };
  }
}
