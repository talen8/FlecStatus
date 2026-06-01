import type { Env } from '../env';
import { Trace } from '../observability/trace';
import type { PublicHomepageResponse } from '../schemas/public-homepage';
import type { PublicStatusResponse } from '../schemas/public-status';
import { LeaseLostError, startRenewableLease } from '../scheduler/lease-guard';
import { utcDayStart } from '../analytics/uptime';
import { isTruthyEnvFlag, isFalsyEnvFlag } from './env-utils';
import {
  fromRuntimeStatusCode,
  MONITOR_RUNTIME_MAX_AGE_SECONDS,
  readPublicMonitorRuntimeSnapshot,
  toMonitorRuntimeEntryMap,
  type MonitorRuntimeUpdate,
  type PublicMonitorRuntimeSnapshot,
} from '../public/monitor-runtime';
import {
  buildHomepageMonitorFragmentWrites,
  buildStatusMonitorFragmentWrites,
} from '../snapshots/public-monitor-fragments';
import { writePublicSnapshotFragments } from '../snapshots/public-fragments';

export const HOMEPAGE_REFRESH_LOCK_NAME = 'snapshot:homepage:refresh';
export const HOMEPAGE_REFRESH_LOCK_LEASE_SECONDS = 55;
export const HOMEPAGE_REFRESH_LOCK_RENEW_INTERVAL_MS = 15_000;
export const HOMEPAGE_REFRESH_LOCK_RENEW_MIN_REMAINING_SECONDS = 20;

const INTERNAL_BASELINE_QUERY_CHUNK_SIZE = 64;

export type InternalHomepageRefreshCoreResult = {
  ok: boolean;
  refreshed: boolean;
  error?: boolean;
  baseSnapshotSource?: 'memory_cache' | 'd1';
  skip?:
    | 'fresh'
    | 'lease'
    | 'fresh_after_lease'
    | 'homepage_write_noop'
    | 'lease_lost';
};

export type InternalHomepageRefreshCoreOptions = {
  env: Env;
  now: number;
  scheduledRefreshRequest: boolean;
  runtimeUpdates?: MonitorRuntimeUpdate[];
  trace?: Trace | null;
  preferCachedBaseSnapshot?: boolean;
  scheduledRuntimeSnapshotBaseline?: PublicMonitorRuntimeSnapshot;
};


export function isSameMinuteTimestamp(a: number, b: number): boolean {
  return Math.floor(a / 60) === Math.floor(b / 60);
}

export function shouldTraceHomepageResidualDetails(env: Env, trace: Trace | null | undefined): boolean {
  return trace?.enabled === true && isTruthyEnvFlag(env.UPTIMER_HOMEPAGE_RESIDUAL_TRACE ?? null);
}

export function toInternalHomepageRefreshCoreResult(
  ok: boolean,
  refreshed: boolean,
  extra: Omit<InternalHomepageRefreshCoreResult, 'ok' | 'refreshed'> = {},
): InternalHomepageRefreshCoreResult {
  return { ok, refreshed, ...extra };
}

function normalizeRuntimeUpdateStatus(
  value: MonitorRuntimeUpdate['check_status'] | MonitorRuntimeUpdate['next_status'],
): 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' {
  switch (value) {
    case 'up':
    case 'down':
    case 'maintenance':
    case 'paused':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

function readRuntimeUpdateCurrentStatus(
  update: MonitorRuntimeUpdate,
): 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' {
  return normalizeRuntimeUpdateStatus(update.next_status ?? update.check_status);
}

function readRuntimeUpdateHeartbeatStatus(
  update: MonitorRuntimeUpdate,
): 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' {
  return normalizeRuntimeUpdateStatus(update.check_status);
}

function isUsableScheduledRuntimeSnapshotBaseline(
  snapshot: PublicMonitorRuntimeSnapshot | undefined,
  now: number,
): snapshot is PublicMonitorRuntimeSnapshot {
  if (!snapshot) {
    return false;
  }
  if (snapshot.generated_at > now + 60) {
    return false;
  }
  if (Math.max(0, now - snapshot.generated_at) > MONITOR_RUNTIME_MAX_AGE_SECONDS) {
    return false;
  }
  return snapshot.day_start_at === utcDayStart(now);
}

function buildNumberedPlaceholders(count: number, start = 1): string {
  return Array.from({ length: count }, (_, index) => `?${index + start}`).join(', ');
}

async function readPersistedRuntimeUpdateBaseline(
  db: D1Database,
  updates: MonitorRuntimeUpdate[],
): Promise<ReadonlyMap<number, { last_checked_at: number | null; status: string | null }> | null> {
  const monitorIds = [...new Set(updates.map((update) => update.monitor_id))];
  if (monitorIds.length === 0) {
    return new Map();
  }

  const baseline = new Map<number, { last_checked_at: number | null; status: string | null }>();
  try {
    for (let index = 0; index < monitorIds.length; index += INTERNAL_BASELINE_QUERY_CHUNK_SIZE) {
      const chunk = monitorIds.slice(index, index + INTERNAL_BASELINE_QUERY_CHUNK_SIZE);
      const { results } = await db
        .prepare(
          `
            SELECT monitor_id, last_checked_at, status
            FROM monitor_state
            WHERE monitor_id IN (${buildNumberedPlaceholders(chunk.length)})
          `,
        )
        .bind(...chunk)
        .all<{
          monitor_id: number;
          last_checked_at: number | null;
          status: string | null;
        }>();

      for (const row of results ?? []) {
        baseline.set(row.monitor_id, {
          last_checked_at: row.last_checked_at,
          status: row.status,
        });
      }
    }

    return baseline;
  } catch {
    return null;
  }
}

export async function sanitizeScheduledRuntimeUpdatesForFastPath(opts: {
  db: D1Database;
  now: number;
  updates: MonitorRuntimeUpdate[];
  trace?: Trace | null;
  runtimeSnapshotBaseline?: PublicMonitorRuntimeSnapshot;
}): Promise<MonitorRuntimeUpdate[]> {
  if (opts.updates.length === 0) {
    return opts.updates;
  }

  const runtimeSnapshot = isUsableScheduledRuntimeSnapshotBaseline(
    opts.runtimeSnapshotBaseline,
    opts.now,
  )
    ? opts.runtimeSnapshotBaseline
    : await readPublicMonitorRuntimeSnapshot(opts.db, opts.now);
  if (!runtimeSnapshot) {
    const persistedBaseline = await readPersistedRuntimeUpdateBaseline(opts.db, opts.updates);
    if (!persistedBaseline) {
      opts.trace?.setLabel('runtime_updates_baseline', 'stale');
      opts.trace?.setLabel('runtime_updates_stale_reason', 'baseline_unavailable');
      return [];
    }

    for (const update of opts.updates) {
      const persistedState = persistedBaseline.get(update.monitor_id);
      if (!persistedState || persistedState.last_checked_at === null) {
        continue;
      }

      if (update.checked_at < persistedState.last_checked_at) {
        opts.trace?.setLabel('runtime_updates_baseline', 'stale');
        opts.trace?.setLabel('runtime_updates_stale_monitor_id', update.monitor_id);
        opts.trace?.setLabel('runtime_updates_stale_reason', 'checked_at_regressed');
        return [];
      }

      if (
        update.checked_at === persistedState.last_checked_at &&
        normalizeRuntimeUpdateStatus(persistedState.status as MonitorRuntimeUpdate['next_status']) !==
          readRuntimeUpdateCurrentStatus(update)
      ) {
        opts.trace?.setLabel('runtime_updates_baseline', 'stale');
        opts.trace?.setLabel('runtime_updates_stale_monitor_id', update.monitor_id);
        opts.trace?.setLabel('runtime_updates_stale_reason', 'state_mismatch');
        return [];
      }

      if (update.checked_at === persistedState.last_checked_at) {
        opts.trace?.setLabel('runtime_updates_baseline', 'stale');
        opts.trace?.setLabel('runtime_updates_stale_monitor_id', update.monitor_id);
        opts.trace?.setLabel('runtime_updates_stale_reason', 'heartbeat_unverified');
        return [];
      }
    }

    opts.trace?.setLabel('runtime_updates_baseline', 'persisted');
    return opts.updates;
  }

  const runtimeById = toMonitorRuntimeEntryMap(runtimeSnapshot);
  for (const update of opts.updates) {
    const runtimeEntry = runtimeById.get(update.monitor_id);
    if (!runtimeEntry || runtimeEntry.last_checked_at === null) {
      continue;
    }

    if (update.checked_at < runtimeEntry.last_checked_at) {
      opts.trace?.setLabel('runtime_updates_baseline', 'stale');
      opts.trace?.setLabel('runtime_updates_stale_monitor_id', update.monitor_id);
      opts.trace?.setLabel('runtime_updates_stale_reason', 'checked_at_regressed');
      return [];
    }

    if (update.checked_at > runtimeEntry.last_checked_at) {
      continue;
    }

    if (fromRuntimeStatusCode(runtimeEntry.last_status_code) !== readRuntimeUpdateCurrentStatus(update)) {
      opts.trace?.setLabel('runtime_updates_baseline', 'stale');
      opts.trace?.setLabel('runtime_updates_stale_monitor_id', update.monitor_id);
      opts.trace?.setLabel('runtime_updates_stale_reason', 'state_mismatch');
      return [];
    }

    const latestHeartbeatStatusCode = runtimeEntry.heartbeat_status_codes[0];
    if (
      latestHeartbeatStatusCode === 'u' ||
      latestHeartbeatStatusCode === 'd' ||
      latestHeartbeatStatusCode === 'm' ||
      latestHeartbeatStatusCode === 'p' ||
      latestHeartbeatStatusCode === 'x'
    ) {
      if (fromRuntimeStatusCode(latestHeartbeatStatusCode) !== readRuntimeUpdateHeartbeatStatus(update)) {
        opts.trace?.setLabel('runtime_updates_baseline', 'stale');
        opts.trace?.setLabel('runtime_updates_stale_monitor_id', update.monitor_id);
        opts.trace?.setLabel('runtime_updates_stale_reason', 'heartbeat_mismatch');
        return [];
      }

      if ((runtimeEntry.heartbeat_latency_ms[0] ?? null) !== update.latency_ms) {
        opts.trace?.setLabel('runtime_updates_baseline', 'stale');
        opts.trace?.setLabel('runtime_updates_stale_monitor_id', update.monitor_id);
        opts.trace?.setLabel('runtime_updates_stale_reason', 'latency_mismatch');
        return [];
      }
    }
  }

  opts.trace?.setLabel('runtime_updates_baseline', 'ok');
  return opts.updates;
}

type PublicMonitorFragmentRefreshResult = {
  ok: boolean;
  writeCount: number;
  statusWriteCount: number;
  homepageWriteCount: number;
  monitorCount: number;
};

function uniqueRuntimeUpdateMonitorIds(
  runtimeUpdates: readonly MonitorRuntimeUpdate[] | undefined,
): number[] | undefined {
  if (!runtimeUpdates || runtimeUpdates.length === 0) {
    return undefined;
  }

  const ids = new Set<number>();
  for (const update of runtimeUpdates) {
    if (Number.isInteger(update.monitor_id) && update.monitor_id > 0) {
      ids.add(update.monitor_id);
    }
  }

  return [...ids];
}

async function refreshPublicMonitorFragmentsFromPayloads(opts: {
  db: D1Database;
  now: number;
  homepagePayload?: PublicHomepageResponse | null;
  statusPayload?: PublicStatusResponse | null;
  runtimeUpdates?: readonly MonitorRuntimeUpdate[];
  trace?: Trace | null;
}): Promise<PublicMonitorFragmentRefreshResult> {
  const monitorIds = uniqueRuntimeUpdateMonitorIds(opts.runtimeUpdates);
  const statusWrites = opts.statusPayload
    ? buildStatusMonitorFragmentWrites(opts.statusPayload, opts.now, monitorIds)
    : [];
  const homepageWrites = opts.homepagePayload
    ? buildHomepageMonitorFragmentWrites(opts.homepagePayload, opts.now, monitorIds)
    : [];
  const writes = [...statusWrites, ...homepageWrites];

  opts.trace?.setLabel('monitor_fragment_write_count', writes.length);
  opts.trace?.setLabel('monitor_fragment_status_write_count', statusWrites.length);
  opts.trace?.setLabel('monitor_fragment_homepage_write_count', homepageWrites.length);
  opts.trace?.setLabel('monitor_fragment_monitor_count', monitorIds?.length ?? 0);

  if (writes.length === 0) {
    return {
      ok: true,
      writeCount: 0,
      statusWriteCount: 0,
      homepageWriteCount: 0,
      monitorCount: monitorIds?.length ?? 0,
    };
  }

  await Trace.timed(opts.trace, 'monitor_fragment_writes_batch', () => writePublicSnapshotFragments(opts.db, writes));

  return {
    ok: true,
    writeCount: writes.length,
    statusWriteCount: statusWrites.length,
    homepageWriteCount: homepageWrites.length,
    monitorCount: monitorIds?.length ?? 0,
  };
}

export async function runInternalHomepageRefreshCore({
  env,
  now,
  scheduledRefreshRequest,
  runtimeUpdates,
  trace,
  preferCachedBaseSnapshot = false,
  scheduledRuntimeSnapshotBaseline,
}: InternalHomepageRefreshCoreOptions): Promise<InternalHomepageRefreshCoreResult> {
  const traceResidualDetails = shouldTraceHomepageResidualDetails(env, trace);
  const detailTrace: Trace | undefined = traceResidualDetails && trace ? trace : undefined;

  if (trace?.enabled) {
    trace.setLabel('route', 'internal/homepage-refresh');
    trace.setLabel('now', now);
    trace.setLabel('runtime_updates_count', runtimeUpdates?.length ?? 0);
  }

  const trustScheduledRuntimeUpdates = isTruthyEnvFlag(
    env.UPTIMER_TRUST_SCHEDULED_RUNTIME_UPDATES ?? null,
  );
  const fastPathRuntimeUpdates =
    scheduledRefreshRequest && runtimeUpdates && !trustScheduledRuntimeUpdates
      ? await Trace.timed(detailTrace, 'homepage_refresh_sanitize_runtime_updates', () =>
          sanitizeScheduledRuntimeUpdatesForFastPath({
            db: env.DB,
            now,
            updates: runtimeUpdates,
            trace: trace ?? null,
            ...(scheduledRuntimeSnapshotBaseline
              ? { runtimeSnapshotBaseline: scheduledRuntimeSnapshotBaseline }
              : {}),
          }),
        )
      : (runtimeUpdates ?? []);
  if (trace?.enabled) {
    if (scheduledRefreshRequest && runtimeUpdates && trustScheduledRuntimeUpdates) {
      trace.setLabel('runtime_updates_baseline', 'trusted_request');
    }
    trace.setLabel('runtime_updates_fast_path_count', fastPathRuntimeUpdates.length);
  }

  const scheduledRuntimeUpdatesRequested =
    scheduledRefreshRequest && (runtimeUpdates?.length ?? 0) > 0;
  const useScheduledRuntimeFastPath =
    scheduledRefreshRequest && fastPathRuntimeUpdates.length > 0;
  const skipInitialFreshnessCheck = scheduledRuntimeUpdatesRequested;
  if (trace?.enabled && skipInitialFreshnessCheck) {
    trace.setLabel('skip_initial_freshness_check', '1');
  }

  let claimedLeaseExpiresAt: number | null = null;
  let homepageRefreshLease: ReturnType<typeof startRenewableLease> | null = null;
  let releaseHomepageRefreshLease:
    | ((db: D1Database, name: string, expiresAt: number) => Promise<void>)
    | null = null;
  let baseSnapshotSource: InternalHomepageRefreshCoreResult['baseSnapshotSource'];

  try {
    const {
      readCachedHomepageRefreshBaseSnapshot,
      readHomepageRefreshBaseSnapshot,
      readHomepageSnapshotGeneratedAt,
    } = await Trace.timed(trace, 'import_homepage_snapshot_read_module', () =>
      import('../snapshots/public-homepage-read'),
    );

    if (!skipInitialFreshnessCheck) {
      const generatedAt = await Trace.timed(trace, 'homepage_refresh_read_generated_at_1', () =>
        readHomepageSnapshotGeneratedAt(env.DB, now),
      );
      if (generatedAt !== null && isSameMinuteTimestamp(generatedAt, now)) {
        trace?.setLabel('skip', 'fresh');
        return toInternalHomepageRefreshCoreResult(true, false, { skip: 'fresh' });
      }
    }

    const { acquireLease, releaseLease } = await Trace.timed(trace, 'import_scheduler_lock_module', () =>
      import('../scheduler/lock'),
    );
    releaseHomepageRefreshLease = releaseLease;
    const acquired = await Trace.timed(trace, 'homepage_refresh_lease', () =>
      acquireLease(env.DB, HOMEPAGE_REFRESH_LOCK_NAME, now, HOMEPAGE_REFRESH_LOCK_LEASE_SECONDS),
    );
    if (!acquired) {
      trace?.setLabel('skip', 'lease');
      return toInternalHomepageRefreshCoreResult(true, false, { skip: 'lease' });
    }

    claimedLeaseExpiresAt = now + HOMEPAGE_REFRESH_LOCK_LEASE_SECONDS;
    homepageRefreshLease = startRenewableLease({
      db: env.DB,
      name: HOMEPAGE_REFRESH_LOCK_NAME,
      leaseSeconds: HOMEPAGE_REFRESH_LOCK_LEASE_SECONDS,
      initialExpiresAt: claimedLeaseExpiresAt,
      renewIntervalMs: HOMEPAGE_REFRESH_LOCK_RENEW_INTERVAL_MS,
      renewMinRemainingSeconds: HOMEPAGE_REFRESH_LOCK_RENEW_MIN_REMAINING_SECONDS,
      logPrefix: 'internal refresh',
    });

    const cachedBaseSnapshot = preferCachedBaseSnapshot
      ? readCachedHomepageRefreshBaseSnapshot(env.DB, now)
      : null;
    const baseSnapshot = cachedBaseSnapshot
      ? cachedBaseSnapshot
      : await Trace.timed(trace, 'homepage_refresh_read_snapshot_base', () =>
          readHomepageRefreshBaseSnapshot(env.DB, now),
        );
    baseSnapshotSource = cachedBaseSnapshot ? 'memory_cache' : 'd1';
    if (trace?.enabled) {
      trace.setLabel('base_snapshot', baseSnapshotSource);
      trace.setLabel('base_seed_data', baseSnapshot.seedDataSnapshot ? '1' : '0');
      trace.setLabel(
        'base_age_s',
        baseSnapshot.generatedAt === null ? 'none' : Math.max(0, now - baseSnapshot.generatedAt),
      );
    }

    const shouldHonorFreshAfterLeaseGate = !scheduledRuntimeUpdatesRequested;
    if (
      shouldHonorFreshAfterLeaseGate &&
      baseSnapshot.generatedAt !== null &&
      isSameMinuteTimestamp(baseSnapshot.generatedAt, now)
    ) {
      trace?.setLabel('skip', 'fresh_after_lease');
      return toInternalHomepageRefreshCoreResult(true, false, {
        skip: 'fresh_after_lease',
        baseSnapshotSource,
      });
    }

    const shouldRefreshStatusSnapshot = isTruthyEnvFlag(
      env.UPTIMER_SCHEDULED_STATUS_REFRESH ?? '1',
    );
    const [homepageMod, snapshotMod, statusModules] = await Promise.all([
      Trace.timed(trace, 'import_homepage_module', () => import('../public/homepage')),
      Trace.timed(trace, 'import_homepage_snapshot_module', () => import('../snapshots/public-homepage')),
      shouldRefreshStatusSnapshot
        ? Promise.all([
            Trace.timed(trace, 'import_status_refresh_module', () => import('../public/status-refresh')),
            Trace.timed(trace, 'import_status_snapshot_module', () => import('../snapshots/public-status')),
          ])
        : Promise.resolve(null),
    ]);
    const statusMod = statusModules?.[0] ?? null;
    const statusSnapshotMod = statusModules?.[1] ?? null;

    let statusFastGuardState:
      | {
          settings: {
            site_title: string;
            site_description: string;
            site_locale: 'auto' | 'en' | 'zh-CN' | 'zh-TW';
            site_timezone: string;
            site_nav_links: { label: string; url: string }[];
            retention_check_results_days: number;
            state_failures_to_down_from_up: number;
            state_successes_to_up_from_down: number;
            admin_default_overview_range: '24h' | '7d';
            admin_default_monitor_range: '24h' | '7d' | '30d' | '90d';
          };
          monitorMetadataStamp: {
            monitorCountTotal: number;
            maxUpdatedAt: number | null;
          };
          hasActiveIncidents: boolean;
          hasActiveMaintenance: boolean;
          hasUpcomingMaintenance: boolean;
        }
      | undefined;

    const tryScheduledRuntimeSnapshotRefresh =
      scheduledRefreshRequest &&
      baseSnapshot.snapshot !== null &&
      (!scheduledRuntimeUpdatesRequested || useScheduledRuntimeFastPath);
    let payload =
      tryScheduledRuntimeSnapshotRefresh && baseSnapshot.snapshot
        ? await Trace.timed(trace, 'homepage_refresh_fast_compute', () =>
            homepageMod.tryComputePublicHomepagePayloadFromScheduledRuntimeUpdates({
              db: env.DB,
              now,
              baseSnapshot: baseSnapshot.snapshot,
              baseSnapshotBodyJson: null,
              updates: fastPathRuntimeUpdates,
              ...(trace ? { trace } : {}),
              onGuardState: (guardState) => {
                statusFastGuardState = guardState;
              },
            }),
          )
        : null;
    if (trace?.enabled && payload) {
      trace.setLabel('fast_path', 'scheduled_runtime');
    }
    if (payload === null) {
      if (trace?.enabled && skipInitialFreshnessCheck) {
        trace.setLabel('fast_path', 'full_compute_fallback');
      }
      payload = await Trace.timed(trace, 'homepage_refresh_compute', () =>
        homepageMod.computePublicHomepagePayload(env.DB, now, {
          ...(trace ? { trace } : {}),
          baseSnapshot: baseSnapshot.snapshot,
          baseSnapshotBodyJson: null,
        }),
      );
    }

    payload = Trace.timedSync(trace, 'homepage_refresh_validate', () => snapshotMod.toHomepageSnapshotPayload(payload));

    let refreshedStatusPayload: PublicStatusResponse | null = null;
    if (shouldRefreshStatusSnapshot && statusMod && statusSnapshotMod) {
      const cachedStatusBaseSnapshot = statusSnapshotMod.readCachedStatusSnapshotPayloadAnyAge(
        env.DB,
        now,
      );
      if (trace?.enabled && cachedStatusBaseSnapshot) {
        trace.setLabel('status_base_snapshot', 'memory_cache');
      }
      const statusBaseSnapshot = cachedStatusBaseSnapshot
        ? cachedStatusBaseSnapshot
        : await Trace.timed(trace, 'status_refresh_read_base_snapshot', () =>
            statusSnapshotMod.readStatusSnapshotPayloadAnyAge(env.DB, now),
          );
      if (trace?.enabled && !cachedStatusBaseSnapshot && statusBaseSnapshot) {
        trace.setLabel('status_base_snapshot', 'd1');
      }
      const statusRefreshArgs = statusFastGuardState
        ? {
            db: env.DB,
            now,
            updates: fastPathRuntimeUpdates,
            guardState: statusFastGuardState,
            baseSnapshot: statusBaseSnapshot?.data ?? null,
          }
        : {
            db: env.DB,
            now,
            updates: fastPathRuntimeUpdates,
            baseSnapshot: statusBaseSnapshot?.data ?? null,
          };
      refreshedStatusPayload = await Trace.timed(trace, 'status_refresh_fast_compute', () =>
        statusMod.tryComputePublicStatusPayloadFromScheduledRuntimeUpdates(statusRefreshArgs),
      );
    } else if (trace?.enabled) {
      trace.setLabel('status_refresh', 'disabled');
    }

    homepageRefreshLease.assertHeld('writing homepage snapshot');
    const activeHomepageRefreshLease = homepageRefreshLease;
    const shouldCheckHomepageWriteLease = !isFalsyEnvFlag(
      env.UPTIMER_HOMEPAGE_WRITE_LEASE_CHECK,
    );
    const homepageWriteLease = shouldCheckHomepageWriteLease
      ? {
          name: HOMEPAGE_REFRESH_LOCK_NAME,
          expiresAt: activeHomepageRefreshLease.getExpiresAt(),
        }
      : undefined;
    const prepareSnapshotWrites = (writeTrace?: Trace) => {
      const preparedHomepageWrite = snapshotMod.prepareHomepageSnapshotWrite(
        env.DB,
        now,
        payload,
        writeTrace,
        baseSnapshot.seedDataSnapshot,
        homepageWriteLease,
      );
      const preparedStatusWrite = refreshedStatusPayload && statusSnapshotMod
        ? statusSnapshotMod.prepareStatusSnapshotWrite({
            db: env.DB,
            now,
            payload: refreshedStatusPayload,
            ...(writeTrace ? { trace: writeTrace } : {}),
            afterHomepage: {
              key: 'homepage',
              generatedAt: preparedHomepageWrite.generatedAt,
              updatedAt: now,
              ...(homepageWriteLease ? { lease: homepageWriteLease } : {}),
            },
          })
        : null;
      return { preparedHomepageWrite, preparedStatusWrite };
    };
    const { preparedHomepageWrite, preparedStatusWrite } = Trace.timedSync(detailTrace, 'snapshot_prepare_writes', () =>
      prepareSnapshotWrites(detailTrace),
    );
    const homepageWriteStatements = [
      preparedHomepageWrite.statement,
    ];
    const writeStatements = preparedStatusWrite
      ? [...homepageWriteStatements, preparedStatusWrite.statement]
      : homepageWriteStatements;
    if (trace?.enabled && traceResidualDetails) {
      trace.setLabel('snapshot_write_count', writeStatements.length);
    }
    const writeResults = await Trace.timed(
      trace,
      writeStatements.length > 1 ? 'snapshot_writes_batch' : 'homepage_refresh_write',
      () =>
        writeStatements.length > 1
          ? env.DB.batch(writeStatements)
          : (() => {
              const stmt = writeStatements[0];
              if (!stmt) throw new Error('writeStatements is empty');
              return stmt.run().then((r) => [r]);
            })(),
    );
    homepageRefreshLease.assertHeld('finalizing snapshot writes');
    const inspectSnapshotWriteResults = () => {
      const homepageWriteResult = writeResults[0];
      if (!homepageWriteResult) {
        throw new Error('homepage snapshot write returned no result');
      }
      const homepageSnapshotWritten = snapshotMod.didApplyHomepageSnapshotWrite(homepageWriteResult);
      const statusWriteResult = writeResults[homepageWriteStatements.length];
      const statusSnapshotWritten = refreshedStatusPayload && statusSnapshotMod
        ? statusSnapshotMod.didApplyStatusSnapshotWrite(statusWriteResult)
        : false;
      return { homepageSnapshotWritten, statusSnapshotWritten };
    };
    const writeInspection = Trace.timedSync(detailTrace, 'snapshot_write_result_inspect', inspectSnapshotWriteResults);
    if (!writeInspection.homepageSnapshotWritten) {
      trace?.setLabel('skip', 'homepage_write_noop');
      return toInternalHomepageRefreshCoreResult(true, false, {
        skip: 'homepage_write_noop',
        baseSnapshotSource,
      });
    }

    preparedHomepageWrite.prime();
    if (refreshedStatusPayload && writeInspection.statusSnapshotWritten) {
      preparedStatusWrite?.prime();
      trace?.setLabel('status_refresh', 'patched');
    } else if (refreshedStatusPayload) {
      trace?.setLabel('status_refresh', 'skipped_after_homepage_write');
    } else {
      trace?.setLabel('status_refresh', 'skipped');
    }

    if (isTruthyEnvFlag(env.UPTIMER_PUBLIC_MONITOR_FRAGMENT_WRITES)) {
      const fragmentRefresh = await Trace.timed(trace, 'monitor_fragment_refresh', () =>
        refreshPublicMonitorFragmentsFromPayloads({
          db: env.DB,
          now,
          homepagePayload: payload,
          statusPayload: refreshedStatusPayload,
          runtimeUpdates: fastPathRuntimeUpdates,
          trace: trace ?? null,
        }),
      );
      trace?.setLabel('monitor_fragment_refresh_ok', fragmentRefresh.ok ? 1 : 0);
    }

    return toInternalHomepageRefreshCoreResult(true, true, { baseSnapshotSource });
  } catch (err) {
    if (err instanceof LeaseLostError) {
      console.warn(err.message);
      trace?.setLabel('skip', 'lease_lost');
      return toInternalHomepageRefreshCoreResult(true, false, {
        skip: 'lease_lost',
        ...(baseSnapshotSource ? { baseSnapshotSource } : {}),
      });
    }

    console.warn('internal refresh: homepage failed', err);
    return toInternalHomepageRefreshCoreResult(false, false, {
      error: true,
      ...(baseSnapshotSource ? { baseSnapshotSource } : {}),
    });
  } finally {
    if (homepageRefreshLease) {
      await homepageRefreshLease.stop().catch((err) => {
        console.warn('internal refresh: lease renewal task failed', err);
      });
    }
    const shouldReleaseHomepageRefreshLease = !isFalsyEnvFlag(
      env.UPTIMER_HOMEPAGE_RELEASE_LOCK,
    );
    if (claimedLeaseExpiresAt !== null && releaseHomepageRefreshLease && shouldReleaseHomepageRefreshLease) {
      await releaseHomepageRefreshLease(
        env.DB,
        HOMEPAGE_REFRESH_LOCK_NAME,
        homepageRefreshLease?.getExpiresAt() ?? claimedLeaseExpiresAt,
      ).catch((err) => {
        console.warn('internal refresh: failed to release homepage lease', err);
      });
    }
  }
}
