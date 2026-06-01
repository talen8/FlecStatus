import type { Env } from '../env';
import { isTruthyEnvFlag } from './env-utils';
import { refreshMonitorRuntimeSnapshotFromUpdateFragments } from './runtime-refresh';
import {
  assembleShardedPublicSnapshot,
  seedShardedPublicSnapshotFragments,
  type ShardedPublicSnapshotAssemblyMode,
  type ShardedPublicSnapshotKind,
  type ShardedPublicSnapshotSeedPart,
} from './sharded-snapshot';

export type ShardedPublicSnapshotContinuationStep =
  | { step: 'runtime'; updateOffset?: number; updateLimit?: number }
  | {
      step: 'seed';
      kind: ShardedPublicSnapshotKind;
      part: Exclude<ShardedPublicSnapshotSeedPart, 'all'>;
      monitorOffset?: number;
      monitorLimit?: number;
    }
  | { step: 'assemble'; kind: ShardedPublicSnapshotKind };

export type ShardedPublicSnapshotContinuationResult = {
  ok: boolean;
  step: ShardedPublicSnapshotContinuationStep['step'];
  continued: boolean;
  nextStep?: ShardedPublicSnapshotContinuationStep;
  nextSteps?: ShardedPublicSnapshotContinuationStep[];
  refreshed?: boolean;
  seeded?: boolean;
  assembled?: boolean;
  published?: boolean;
  kind?: ShardedPublicSnapshotKind;
  part?: Exclude<ShardedPublicSnapshotSeedPart, 'all'>;
  generatedAt?: number;
  monitorCount?: number;
  monitorOffset?: number;
  monitorLimit?: number;
  writeCount?: number;
  invalidCount?: number;
  staleCount?: number;
  updateOffset?: number;
  updateLimit?: number;
  rowCount?: number;
  hasMore?: boolean;
  skipped?: string;
  error?: boolean;
  errorName?: string;
  errorMessage?: string;
};

const CONTINUATION_PATH = '/internal/continue/sharded-public-snapshot';
const DEFAULT_MONITOR_LIMIT = 5;

function readBoundedMonitorLimit(env: Env, requested?: number): number {
  const raw = requested ?? (env as unknown as Record<string, unknown>).UPTIMER_SHARDED_FRAGMENT_SEED_BATCH_SIZE;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_MONITOR_LIMIT;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

function readOptionalBoundedRuntimeUpdateLimit(env: Env, requested?: number): number | null {
  const raw = requested ?? (env as unknown as Record<string, unknown>).UPTIMER_SHARDED_RUNTIME_UPDATE_BATCH_SIZE;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

function readAssemblyMode(env: Env): ShardedPublicSnapshotAssemblyMode {
  const raw = (env as unknown as Record<string, unknown>).UPTIMER_SHARDED_ASSEMBLER_MODE;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'json' ? 'json' : 'validated';
}

function canRefreshRuntimeFragments(env: Env): boolean {
  return isTruthyEnvFlag((env as unknown as Record<string, unknown>).UPTIMER_SCHEDULED_RUNTIME_FRAGMENT_REFRESH);
}

function canSeedShardedFragments(env: Env): boolean {
  return isTruthyEnvFlag((env as unknown as Record<string, unknown>).UPTIMER_SHARDED_FRAGMENT_SEED);
}

function canAssembleShardedSnapshots(env: Env): boolean {
  return isTruthyEnvFlag((env as unknown as Record<string, unknown>).UPTIMER_SHARDED_ASSEMBLER);
}

function shouldPublishShardedSnapshots(env: Env): boolean {
  return isTruthyEnvFlag((env as unknown as Record<string, unknown>).UPTIMER_SHARDED_PUBLISH);
}

function nextSeedStep(opts: {
  kind: ShardedPublicSnapshotKind;
  part: Exclude<ShardedPublicSnapshotSeedPart, 'all'>;
  monitorOffset: number;
  monitorLimit: number;
  monitorCount: number;
}): ShardedPublicSnapshotContinuationStep {
  if (opts.part === 'envelope') {
    return opts.monitorCount > 0
      ? {
          step: 'seed',
          kind: opts.kind,
          part: 'monitors',
          monitorOffset: 0,
          monitorLimit: opts.monitorLimit,
        }
      : { step: 'assemble', kind: opts.kind };
  }

  const nextOffset = opts.monitorOffset + opts.monitorLimit;
  if (nextOffset < opts.monitorCount) {
    return {
      step: 'seed',
      kind: opts.kind,
      part: 'monitors',
      monitorOffset: nextOffset,
      monitorLimit: opts.monitorLimit,
    };
  }

  return { step: 'assemble', kind: opts.kind };
}

function firstSeedSteps(monitorLimit: number): ShardedPublicSnapshotContinuationStep[] {
  return [
    {
      step: 'seed',
      kind: 'homepage',
      part: 'envelope',
      monitorOffset: 0,
      monitorLimit,
    },
    {
      step: 'seed',
      kind: 'status',
      part: 'envelope',
      monitorOffset: 0,
      monitorLimit,
    },
  ];
}

function toWireStep(step: ShardedPublicSnapshotContinuationStep): Record<string, unknown> {
  if (step.step === 'seed') {
    return {
      step: step.step,
      kind: step.kind,
      part: step.part,
      monitor_offset: step.monitorOffset ?? 0,
      monitor_limit: step.monitorLimit ?? DEFAULT_MONITOR_LIMIT,
    };
  }
  if (step.step === 'assemble') {
    return { step: step.step, kind: step.kind };
  }
  return {
    step: step.step,
    ...(step.updateOffset !== undefined ? { update_offset: step.updateOffset } : {}),
    ...(step.updateLimit !== undefined ? { update_limit: step.updateLimit } : {}),
  };
}

function queueContinuation(
  env: Env,
  ctx: ExecutionContext,
  nextStep: ShardedPublicSnapshotContinuationStep | null,
): boolean {
  return queueContinuations(env, ctx, nextStep ? [nextStep] : []) > 0;
}

function queueContinuations(
  env: Env,
  ctx: ExecutionContext,
  nextSteps: readonly ShardedPublicSnapshotContinuationStep[],
): number {
  if (nextSteps.length === 0 || !env.SELF) {
    return 0;
  }

  let queued = 0;
  for (const nextStep of nextSteps) {
    queued += 1;
    ctx.waitUntil(
      env.SELF.fetch(
        new Request(`http://internal${CONTINUATION_PATH}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify(toWireStep(nextStep)),
        }),
      )
        .then(async (res) => {
          const bodyText = await res.text().catch(() => '');
          if (!res.ok) {
            throw new Error(
              `sharded public snapshot continuation failed: HTTP ${res.status} ${bodyText}`.trim(),
            );
          }
        })
        .catch((err) => {
          console.warn('sharded public snapshot continuation dispatch failed', err);
        }),
    );
  }
  return queued;
}

export async function runShardedPublicSnapshotContinuation(opts: {
  env: Env;
  ctx: ExecutionContext;
  now: number;
  step: ShardedPublicSnapshotContinuationStep;
}): Promise<ShardedPublicSnapshotContinuationResult> {
  if (opts.step.step === 'runtime') {
    if (!canRefreshRuntimeFragments(opts.env)) {
      return {
        ok: true,
        step: 'runtime',
        continued: false,
        skipped: 'runtime_disabled',
      };
    }
    const runtimeLimit = readOptionalBoundedRuntimeUpdateLimit(opts.env, opts.step.updateLimit);
    const updateOffset = Math.max(0, Math.floor(opts.step.updateOffset ?? 0));
    const result = await refreshMonitorRuntimeSnapshotFromUpdateFragments({
      env: opts.env,
      now: opts.now,
      ...(runtimeLimit ? { offset: updateOffset, limit: runtimeLimit } : {}),
    });
    const nextSteps: ShardedPublicSnapshotContinuationStep[] = !result.ok
      ? []
      : runtimeLimit && result.hasMore
        ? [{ step: 'runtime', updateOffset: updateOffset + runtimeLimit, updateLimit: runtimeLimit }]
        : firstSeedSteps(readBoundedMonitorLimit(opts.env));
    const continuedCount = queueContinuations(opts.env, opts.ctx, nextSteps);
    const continued = continuedCount > 0;
    return {
      ok: result.ok,
      step: 'runtime',
      refreshed: result.refreshed,
      invalidCount: result.invalidCount,
      staleCount: result.staleCount,
      monitorCount: result.updateCount,
      continued,
      ...(continued ? { nextSteps: nextSteps.slice(0, continuedCount) } : {}),
      ...(result.skip ? { skipped: result.skip } : {}),
      ...(runtimeLimit
        ? {
            updateOffset: result.updateOffset ?? updateOffset,
            updateLimit: result.updateLimit ?? runtimeLimit,
            rowCount: result.rowCount ?? 0,
            hasMore: result.hasMore ?? false,
          }
        : {}),
    };
  }

  if (opts.step.step === 'seed') {
    const monitorLimit = readBoundedMonitorLimit(opts.env, opts.step.monitorLimit);
    const monitorOffset = Math.max(0, Math.floor(opts.step.monitorOffset ?? 0));
    if (!canSeedShardedFragments(opts.env)) {
      return {
        ok: true,
        step: 'seed',
        kind: opts.step.kind,
        part: opts.step.part,
        monitorOffset,
        monitorLimit,
        continued: false,
        skipped: 'seed_disabled',
      };
    }
    const result = await seedShardedPublicSnapshotFragments({
      env: opts.env,
      kind: opts.step.kind,
      part: opts.step.part,
      now: opts.now,
      offset: monitorOffset,
      limit: monitorLimit,
    });
    const nextStep = result.ok
      ? nextSeedStep({
          kind: opts.step.kind,
          part: opts.step.part,
          monitorOffset,
          monitorLimit,
          monitorCount: result.monitorCount,
        })
      : null;
    const continued = queueContinuation(opts.env, opts.ctx, nextStep);
    return {
      ok: result.ok,
      step: 'seed',
      seeded: result.seeded,
      kind: result.kind,
      part: opts.step.part,
      monitorCount: result.monitorCount,
      monitorOffset,
      monitorLimit,
      writeCount: result.writeCount,
      continued,
      ...(continued && nextStep ? { nextStep } : {}),
      ...(result.skipped ? { skipped: result.skipped } : {}),
      ...(result.error ? { error: true } : {}),
    };
  }

  if (!canAssembleShardedSnapshots(opts.env)) {
    return {
      ok: true,
      step: 'assemble',
      kind: opts.step.kind,
      continued: false,
      skipped: 'assemble_disabled',
    };
  }
  const publishShardedSnapshots = shouldPublishShardedSnapshots(opts.env);
  const result = await assembleShardedPublicSnapshot({
    env: opts.env,
    kind: opts.step.kind,
    mode: readAssemblyMode(opts.env),
    now: opts.now,
    publish: publishShardedSnapshots,
  });
  return {
    ok: result.ok,
    step: 'assemble',
    assembled: result.assembled,
    kind: result.kind,
    ...(result.generatedAt !== undefined ? { generatedAt: result.generatedAt } : {}),
    monitorCount: result.monitorCount,
    invalidCount: result.invalidCount,
    staleCount: result.staleCount,
    continued: false,
    ...(result.skip ? { skipped: result.skip } : {}),
    ...(result.published !== undefined ? { published: result.published } : {}),
    ...(result.writeCount !== undefined ? { writeCount: result.writeCount } : {}),
    ...(result.error ? { error: true } : {}),
    ...(result.errorName ? { errorName: result.errorName } : {}),
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
  };
}
