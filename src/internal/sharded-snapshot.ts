import type { Env } from '../env';
import { isTruthyEnvFlag } from './env-utils';
import type { PublicHomepageResponse } from '../schemas/public-homepage';
import type { PublicStatusResponse } from '../schemas/public-status';
import {
  writePublicSnapshotFragments,
  type PublicSnapshotFragmentWrite,
} from '../snapshots/public-fragments';
import {
  assemblePublicHomepagePayloadFromFragments,
  assemblePublicStatusPayloadFromFragments,
  buildHomepageEnvelopeFragmentWrite,
  buildHomepageMonitorFragmentWrites,
  buildStatusEnvelopeFragmentWrite,
  buildStatusMonitorFragmentWrites,
  readHomepageSnapshotBodyJsonFromFragments,
  readHomepageSnapshotFragments,
  readStatusSnapshotBodyJsonFromFragments,
  readStatusSnapshotFragments,
} from '../snapshots/public-monitor-fragments';

export type ShardedPublicSnapshotKind = 'homepage' | 'status';
export type ShardedPublicSnapshotAssemblyMode = 'validated' | 'json';
export type ShardedPublicSnapshotSeedPart = 'envelope' | 'monitors' | 'all';

export type ShardedPublicSnapshotAssembleOptions = {
  env: Env;
  kind: ShardedPublicSnapshotKind;
  mode?: ShardedPublicSnapshotAssemblyMode;
  measureBodyBytes?: boolean;
  publish?: boolean;
  now?: number;
};

export type ShardedPublicSnapshotAssembleResult = {
  ok: boolean;
  assembled: boolean;
  kind: ShardedPublicSnapshotKind;
  generatedAt?: number;
  monitorCount: number;
  invalidCount: number;
  staleCount: number;
  mode: ShardedPublicSnapshotAssemblyMode;
  bodyBytes?: number | undefined;
  published?: boolean;
  writeCount?: number;
  skip?: 'missing_envelope' | 'missing_monitors' | 'invalid_payload';
  error?: boolean;
  errorName?: string;
  errorMessage?: string;
};

export type ShardedPublicSnapshotSeedOptions = {
  env: Env;
  kind: ShardedPublicSnapshotKind;
  part: ShardedPublicSnapshotSeedPart;
  now: number;
  offset?: number;
  limit?: number;
};

export type ShardedPublicSnapshotSeedResult = {
  ok: boolean;
  seeded: boolean;
  kind: ShardedPublicSnapshotKind;
  part: ShardedPublicSnapshotSeedPart;
  generatedAt?: number;
  monitorCount: number;
  monitorOffset: number;
  monitorLimit: number;
  writeCount: number;
  skipped?: 'missing_snapshot' | 'empty_batch';
  error?: boolean;
};

function measuredBodyBytes(value: unknown, enabled: boolean): number | undefined {
  if (!enabled) {
    return undefined;
  }
  return JSON.stringify(value).length;
}

function toErrorInfo(err: unknown): { errorName: string; errorMessage: string } {
  if (err instanceof Error) {
    return {
      errorName: err.name || 'Error',
      errorMessage: err.message || 'Unknown error',
    };
  }
  return {
    errorName: typeof err,
    errorMessage: String(err),
  };
}

function bodyJsonBytes(bodyJson: string, enabled: boolean): number | undefined {
  return enabled ? bodyJson.length : undefined;
}

function shouldSeedHomepageFromRuntimeSnapshot(env: Env): boolean {
  const raw = (env as unknown as Record<string, unknown>).UPTIMER_PUBLIC_SHARDED_HOMEPAGE_RUNTIME_SEED;
  return isTruthyEnvFlag(raw);
}

const RAW_PUBLIC_SNAPSHOT_FUTURE_TOLERANCE_SECONDS = 60;
const UPSERT_RAW_PUBLIC_SNAPSHOT_SQL = `
  INSERT INTO public_snapshots (key, generated_at, body_json, updated_at)
  VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT(key) DO UPDATE SET
    generated_at = excluded.generated_at,
    body_json = excluded.body_json,
    updated_at = excluded.updated_at
  WHERE excluded.generated_at >= public_snapshots.generated_at
    OR public_snapshots.generated_at > ?5
`;
type PublicSnapshotPublishKey = 'homepage' | 'status';
const rawPublicSnapshotUpsertStatementByDb = new WeakMap<D1Database, D1PreparedStatement>();

function publicSnapshotKeyForKind(kind: ShardedPublicSnapshotKind): 'homepage' | 'status' {
  return kind === 'homepage' ? 'homepage' : 'status';
}

function rawPublicSnapshotUpsertStatement(
  db: D1Database,
  key: PublicSnapshotPublishKey,
  generatedAt: number,
  bodyJson: string,
  updatedAt: number,
): D1PreparedStatement {
  const cached = rawPublicSnapshotUpsertStatementByDb.get(db);
  const statement = cached ?? db.prepare(UPSERT_RAW_PUBLIC_SNAPSHOT_SQL);
  if (!cached) {
    rawPublicSnapshotUpsertStatementByDb.set(db, statement);
  }
  return statement.bind(
    key,
    generatedAt,
    bodyJson,
    updatedAt,
    updatedAt + RAW_PUBLIC_SNAPSHOT_FUTURE_TOLERANCE_SECONDS,
  );
}

function didApplySnapshotWrite(result: D1Result): boolean {
  const changed = result.meta?.changes;
  return typeof changed === 'number' ? changed > 0 : true;
}

async function publishRawPublicSnapshot(opts: {
  env: Env;
  kind: ShardedPublicSnapshotKind;
  generatedAt: number;
  bodyJson: string;
  now: number;
}): Promise<boolean> {
  const updatedAt = Math.max(opts.now, Math.floor(Date.now() / 1000));
  const result = await rawPublicSnapshotUpsertStatement(
    opts.env.DB,
    publicSnapshotKeyForKind(opts.kind),
    opts.generatedAt,
    opts.bodyJson,
    updatedAt,
  ).run();
  return didApplySnapshotWrite(result);
}

function normalizeSliceBounds(offset: number | undefined, limit: number | undefined): {
  offset: number;
  limit: number;
} {
  return {
    offset: Math.max(0, Math.floor(offset ?? 0)),
    limit: Math.max(1, Math.min(10, Math.floor(limit ?? 5))),
  };
}

function selectMonitorIds(
  payload: PublicHomepageResponse | PublicStatusResponse,
  offset: number,
  limit: number,
): number[] {
  return payload.monitors.slice(offset, offset + limit).map((monitor) => monitor.id);
}

async function readHomepageSeedPayload(
  env: Env,
  now: number,
): Promise<PublicHomepageResponse | null> {
  const { readHomepageRefreshBaseSnapshot } = await import('../snapshots/public-homepage-read');
  const base = await readHomepageRefreshBaseSnapshot(env.DB, now);
  if (!base.snapshot || !shouldSeedHomepageFromRuntimeSnapshot(env)) {
    return base.snapshot;
  }

  try {
    const [{ tryComputePublicHomepagePayloadFromScheduledRuntimeUpdates }, { readPublicMonitorRuntimeSnapshot }] =
      await Promise.all([import('../public/homepage'), import('../public/monitor-runtime')]);
    const runtimeSnapshot = await readPublicMonitorRuntimeSnapshot(env.DB, now);
    const seedNow = runtimeSnapshot?.generated_at ?? now;
    return (
      await tryComputePublicHomepagePayloadFromScheduledRuntimeUpdates({
        db: env.DB,
        now: seedNow,
        baseSnapshot: base.snapshot,
        baseSnapshotBodyJson: null,
        updates: [],
      })
    ) ?? base.snapshot;
  } catch (err) {
    console.warn('internal sharded homepage runtime seed failed', err);
    return base.snapshot;
  }
}

async function readStatusSeedPayload(
  env: Env,
  now: number,
): Promise<PublicStatusResponse | null> {
  const { readStatusSnapshotPayloadAnyAge } = await import('../snapshots/public-status');
  return (await readStatusSnapshotPayloadAnyAge(env.DB, now))?.data ?? null;
}

function buildSeedWrites(opts: {
  kind: ShardedPublicSnapshotKind;
  part: ShardedPublicSnapshotSeedPart;
  payload: PublicHomepageResponse | PublicStatusResponse;
  monitorIds: number[];
  now: number;
}): PublicSnapshotFragmentWrite[] {
  if (opts.kind === 'homepage') {
    const payload = opts.payload as PublicHomepageResponse;
    return [
      ...(opts.part === 'envelope' || opts.part === 'all'
        ? [buildHomepageEnvelopeFragmentWrite(payload, opts.now)]
        : []),
      ...(opts.part === 'monitors' || opts.part === 'all'
        ? buildHomepageMonitorFragmentWrites(payload, opts.now, opts.monitorIds)
        : []),
    ];
  }

  const payload = opts.payload as PublicStatusResponse;
  return [
    ...(opts.part === 'envelope' || opts.part === 'all'
      ? [buildStatusEnvelopeFragmentWrite(payload, opts.now)]
      : []),
    ...(opts.part === 'monitors' || opts.part === 'all'
      ? buildStatusMonitorFragmentWrites(payload, opts.now, opts.monitorIds)
      : []),
  ];
}

export async function seedShardedPublicSnapshotFragments(
  opts: ShardedPublicSnapshotSeedOptions,
): Promise<ShardedPublicSnapshotSeedResult> {
  const { offset, limit } = normalizeSliceBounds(opts.offset, opts.limit);
  try {
    const payload = opts.kind === 'homepage'
      ? await readHomepageSeedPayload(opts.env, opts.now)
      : await readStatusSeedPayload(opts.env, opts.now);
    if (!payload) {
      return {
        ok: true,
        seeded: false,
        kind: opts.kind,
        part: opts.part,
        monitorCount: 0,
        monitorOffset: offset,
        monitorLimit: limit,
        writeCount: 0,
        skipped: 'missing_snapshot',
      };
    }

    const monitorIds = selectMonitorIds(payload, offset, limit);
    if ((opts.part === 'monitors' || opts.part === 'all') && monitorIds.length === 0) {
      return {
        ok: true,
        seeded: false,
        kind: opts.kind,
        part: opts.part,
        generatedAt: payload.generated_at,
        monitorCount: payload.monitors.length,
        monitorOffset: offset,
        monitorLimit: limit,
        writeCount: 0,
        skipped: 'empty_batch',
      };
    }

    const writes = buildSeedWrites({
      kind: opts.kind,
      part: opts.part,
      payload,
      monitorIds,
      now: opts.now,
    });
    if (writes.length === 0) {
      return {
        ok: true,
        seeded: false,
        kind: opts.kind,
        part: opts.part,
        generatedAt: payload.generated_at,
        monitorCount: payload.monitors.length,
        monitorOffset: offset,
        monitorLimit: limit,
        writeCount: 0,
        skipped: 'empty_batch',
      };
    }

    await writePublicSnapshotFragments(opts.env.DB, writes);
    return {
      ok: true,
      seeded: true,
      kind: opts.kind,
      part: opts.part,
      generatedAt: payload.generated_at,
      monitorCount: payload.monitors.length,
      monitorOffset: offset,
      monitorLimit: limit,
      writeCount: writes.length,
    };
  } catch (err) {
    console.warn('internal sharded public snapshot fragment seed failed', err);
    return {
      ok: false,
      seeded: false,
      kind: opts.kind,
      part: opts.part,
      monitorCount: 0,
      monitorOffset: offset,
      monitorLimit: limit,
      writeCount: 0,
      error: true,
    };
  }
}

export async function assembleShardedPublicSnapshot(
  opts: ShardedPublicSnapshotAssembleOptions,
): Promise<ShardedPublicSnapshotAssembleResult> {
  const mode = opts.mode ?? 'validated';
  try {
    if (mode === 'json') {
      const assembled = opts.kind === 'homepage'
        ? await readHomepageSnapshotBodyJsonFromFragments(opts.env.DB)
        : await readStatusSnapshotBodyJsonFromFragments(opts.env.DB);
      if (!assembled) {
        return {
          ok: true,
          assembled: false,
          kind: opts.kind,
          monitorCount: 0,
          invalidCount: 0,
          staleCount: 0,
          mode,
          skip: 'invalid_payload',
        };
      }
      const publishNow = opts.now ?? Math.floor(Date.now() / 1000);
      const published = opts.publish
        ? await publishRawPublicSnapshot({
            env: opts.env,
            kind: opts.kind,
            generatedAt: assembled.generatedAt,
            bodyJson: assembled.bodyJson,
            now: publishNow,
          })
        : false;
      return {
        ok: true,
        assembled: true,
        kind: opts.kind,
        generatedAt: assembled.generatedAt,
        monitorCount: assembled.monitorCount,
        invalidCount: assembled.invalidCount,
        staleCount: assembled.staleCount,
        mode,
        ...(opts.measureBodyBytes
          ? { bodyBytes: bodyJsonBytes(assembled.bodyJson, true) }
          : {}),
        ...(opts.publish
          ? {
              published,
              writeCount: published ? 1 : 0,
            }
          : {}),
      };
    }

    if (opts.kind === 'homepage') {
      const fragments = await readHomepageSnapshotFragments(opts.env.DB);
      if (!fragments.envelope) {
        return {
          ok: true,
          assembled: false,
          kind: opts.kind,
          monitorCount: 0,
          invalidCount: fragments.monitors.invalidCount,
          staleCount: fragments.monitors.staleCount,
          mode,
          skip: 'missing_envelope',
        };
      }

      const assembled = assemblePublicHomepagePayloadFromFragments(
        fragments.envelope.data,
        fragments.monitors.data,
      );
      if (!assembled) {
        return {
          ok: true,
          assembled: false,
          kind: opts.kind,
          generatedAt: fragments.envelope.generatedAt,
          monitorCount: fragments.monitors.data.length,
          invalidCount: fragments.monitors.invalidCount,
          staleCount: fragments.monitors.staleCount,
          mode,
          skip:
            fragments.monitors.data.length < fragments.envelope.data.monitor_ids.length
              ? 'missing_monitors'
              : 'invalid_payload',
        };
      }

      return {
        ok: true,
        assembled: true,
        kind: opts.kind,
        generatedAt: assembled.generated_at,
        monitorCount: assembled.monitors.length,
        invalidCount: fragments.monitors.invalidCount,
        staleCount: fragments.monitors.staleCount,
        mode,
        ...(opts.measureBodyBytes
          ? { bodyBytes: measuredBodyBytes(assembled, true) }
          : {}),
      };
    }

    const fragments = await readStatusSnapshotFragments(opts.env.DB);
    if (!fragments.envelope) {
      return {
        ok: true,
        assembled: false,
        kind: opts.kind,
        monitorCount: 0,
        invalidCount: fragments.monitors.invalidCount,
        staleCount: fragments.monitors.staleCount,
        mode,
        skip: 'missing_envelope',
      };
    }

    const assembled = assemblePublicStatusPayloadFromFragments(
      fragments.envelope.data,
      fragments.monitors.data,
    );
    if (!assembled) {
      return {
        ok: true,
        assembled: false,
        kind: opts.kind,
        generatedAt: fragments.envelope.generatedAt,
        monitorCount: fragments.monitors.data.length,
        invalidCount: fragments.monitors.invalidCount,
        staleCount: fragments.monitors.staleCount,
        mode,
        skip:
          fragments.monitors.data.length < fragments.envelope.data.monitor_ids.length
            ? 'missing_monitors'
            : 'invalid_payload',
      };
    }

    return {
      ok: true,
      assembled: true,
      kind: opts.kind,
      generatedAt: assembled.generated_at,
      monitorCount: assembled.monitors.length,
      invalidCount: fragments.monitors.invalidCount,
      staleCount: fragments.monitors.staleCount,
      mode,
      ...(opts.measureBodyBytes ? { bodyBytes: measuredBodyBytes(assembled, true) } : {}),
    };
  } catch (err) {
    console.warn('internal sharded public snapshot assembly failed', err);
    const errorInfo = toErrorInfo(err);
    return {
      ok: false,
      assembled: false,
      kind: opts.kind,
      monitorCount: 0,
      invalidCount: 0,
      staleCount: 0,
      mode,
      error: true,
      ...errorInfo,
    };
  }
}
