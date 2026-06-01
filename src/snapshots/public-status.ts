import { AppError } from '../middleware/errors';
import { Trace } from '../observability/trace';
import { publicStatusResponseSchema, type PublicStatusResponse } from '../schemas/public-status';
import { storedPublicStatusResponseSchema } from '../schemas/public-status-stored';
import { parseJsonText } from './shared';

const SNAPSHOT_KEY = 'status';
const MAX_AGE_SECONDS = 60;
const MAX_STALE_SECONDS = 10 * 60;
const FUTURE_SNAPSHOT_TOLERANCE_SECONDS = 60;
const READ_STATUS_SQL = `
  SELECT generated_at, updated_at, body_json
  FROM public_snapshots
  WHERE key = ?1
`;
const READ_STATUS_METADATA_SQL = `
  SELECT generated_at, updated_at
  FROM public_snapshots
  WHERE key = ?1
`;
const UPSERT_STATUS_SQL = `
  INSERT INTO public_snapshots (key, generated_at, body_json, updated_at)
  VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT(key) DO UPDATE SET
    generated_at = excluded.generated_at,
    body_json = excluded.body_json,
    updated_at = excluded.updated_at
  WHERE excluded.generated_at >= public_snapshots.generated_at
    OR public_snapshots.generated_at > ?5
`;
const UPSERT_STATUS_AFTER_HOMEPAGE_SQL = `
  INSERT INTO public_snapshots (key, generated_at, body_json, updated_at)
  SELECT ?1, ?2, ?3, ?4
  WHERE EXISTS (
    SELECT 1
    FROM public_snapshots homepage_snapshot
    WHERE homepage_snapshot.key = ?6
      AND homepage_snapshot.generated_at = ?7
      AND homepage_snapshot.updated_at = ?8
  )
  ON CONFLICT(key) DO UPDATE SET
    generated_at = excluded.generated_at,
    body_json = excluded.body_json,
    updated_at = excluded.updated_at
  WHERE (
      excluded.generated_at >= public_snapshots.generated_at
      OR public_snapshots.generated_at > ?5
    )
    AND EXISTS (
      SELECT 1
      FROM public_snapshots homepage_snapshot
      WHERE homepage_snapshot.key = ?6
        AND homepage_snapshot.generated_at = ?7
        AND homepage_snapshot.updated_at = ?8
    )
`;
const UPSERT_STATUS_AFTER_HOMEPAGE_AND_LEASE_SQL = `
  INSERT INTO public_snapshots (key, generated_at, body_json, updated_at)
  SELECT ?1, ?2, ?3, ?4
  WHERE EXISTS (
    SELECT 1
    FROM public_snapshots homepage_snapshot
    WHERE homepage_snapshot.key = ?6
      AND homepage_snapshot.generated_at = ?7
      AND homepage_snapshot.updated_at = ?8
  )
    AND EXISTS (
      SELECT 1
      FROM locks refresh_lock
      WHERE refresh_lock.name = ?9
        AND refresh_lock.expires_at = ?10
        AND refresh_lock.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
    )
  ON CONFLICT(key) DO UPDATE SET
    generated_at = excluded.generated_at,
    body_json = excluded.body_json,
    updated_at = excluded.updated_at
  WHERE (
      excluded.generated_at >= public_snapshots.generated_at
      OR public_snapshots.generated_at > ?5
    )
    AND EXISTS (
      SELECT 1
      FROM public_snapshots homepage_snapshot
      WHERE homepage_snapshot.key = ?6
        AND homepage_snapshot.generated_at = ?7
        AND homepage_snapshot.updated_at = ?8
    )
    AND EXISTS (
      SELECT 1
      FROM locks refresh_lock
      WHERE refresh_lock.name = ?9
        AND refresh_lock.expires_at = ?10
        AND refresh_lock.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
    )
`;

const readStatusStatementByDb = new WeakMap<D1Database, D1PreparedStatement>();
const readStatusMetadataStatementByDb = new WeakMap<D1Database, D1PreparedStatement>();
const upsertStatusStatementByDb = new WeakMap<D1Database, D1PreparedStatement>();
const upsertStatusAfterHomepageStatementByDb = new WeakMap<D1Database, D1PreparedStatement>();
const upsertStatusAfterHomepageAndLeaseStatementByDb = new WeakMap<
  D1Database,
  D1PreparedStatement
>();
const normalizedStatusCacheByDb = new WeakMap<D1Database, StatusSnapshotCacheEntry>();

type StatusSnapshotRow = {
  generated_at: number;
  updated_at?: number | null;
  body_json: string;
};

type StatusSnapshotMetadataRow = {
  generated_at: number;
  updated_at?: number | null;
};

type ValidatedStatusSnapshotJson = {
  bodyJson: string;
  data: PublicStatusResponse;
};

type StatusSnapshotCacheEntry = {
  generatedAt: number;
  updatedAt: number;
  bodyJson: string;
  data: PublicStatusResponse;
};

export function getSnapshotKey() {
  return SNAPSHOT_KEY;
}

export function getSnapshotMaxAgeSeconds() {
  return MAX_AGE_SECONDS;
}

function normalizeStoredStatusPayload(value: unknown): PublicStatusResponse | null {
  const stored = storedPublicStatusResponseSchema.safeParse(value);
  return stored.success ? stored.data : null;
}

function validateStatusSnapshotBodyJson(bodyJson: string): ValidatedStatusSnapshotJson | null {
  const parsed = parseJsonText(bodyJson);
  if (parsed === null) {
    return null;
  }

  const payload = normalizeStoredStatusPayload(parsed.value);
  return payload
    ? {
        bodyJson: parsed.trimmed,
        data: payload,
      }
    : null;
}

function toSnapshotUpdatedAt(row: StatusSnapshotMetadataRow): number {
  return typeof row.updated_at === 'number' && Number.isFinite(row.updated_at)
    ? row.updated_at
    : row.generated_at;
}

function readCachedStatusSnapshot(
  db: D1Database,
  generatedAt: number,
  updatedAt: number,
): StatusSnapshotCacheEntry | null {
  const cached = normalizedStatusCacheByDb.get(db);
  if (!cached) {
    return null;
  }

  return cached.generatedAt === generatedAt && cached.updatedAt === updatedAt ? cached : null;
}

function writeCachedStatusSnapshot(
  db: D1Database,
  generatedAt: number,
  updatedAt: number,
  validated: ValidatedStatusSnapshotJson,
): StatusSnapshotCacheEntry {
  const cached: StatusSnapshotCacheEntry = {
    generatedAt,
    updatedAt,
    bodyJson: validated.bodyJson,
    data: validated.data,
  };
  normalizedStatusCacheByDb.set(db, cached);
  return cached;
}

async function readStatusSnapshotMetadataRow(
  db: D1Database,
): Promise<StatusSnapshotMetadataRow | null> {
  try {
    const cached = readStatusMetadataStatementByDb.get(db);
    const statement = cached ?? db.prepare(READ_STATUS_METADATA_SQL);
    if (!cached) {
      readStatusMetadataStatementByDb.set(db, statement);
    }

    return await statement.bind(SNAPSHOT_KEY).first<StatusSnapshotMetadataRow>();
  } catch {
    return null;
  }
}

async function readStatusSnapshotRow(
  db: D1Database,
): Promise<StatusSnapshotRow | null> {
  const cached = readStatusStatementByDb.get(db);
  const statement = cached ?? db.prepare(READ_STATUS_SQL);
  if (!cached) {
    readStatusStatementByDb.set(db, statement);
  }

  return await statement
    .bind(SNAPSHOT_KEY)
    .first<StatusSnapshotRow>();
}

function readValidatedStatusSnapshotRow(
  db: D1Database,
  row: StatusSnapshotRow,
): StatusSnapshotCacheEntry | null {
  const updatedAt = toSnapshotUpdatedAt(row);
  const cached = readCachedStatusSnapshot(db, row.generated_at, updatedAt);
  if (cached) {
    return cached;
  }

  const validated = validateStatusSnapshotBodyJson(row.body_json);
  if (validated === null) {
    return null;
  }

  return writeCachedStatusSnapshot(db, row.generated_at, updatedAt, validated);
}

export async function readStatusSnapshot(
  db: D1Database,
  now: number,
): Promise<{ data: PublicStatusResponse; age: number } | null> {
  const result = await readStatusSnapshotJson(db, now);
  if (!result) return null;

  const parsed = parseJsonText(result.bodyJson);
  if (!parsed) return null;
  const payload = publicStatusResponseSchema.safeParse(parsed.value);
  if (!payload.success) return null;
  return { data: payload.data, age: result.age };
}

export async function readStatusSnapshotJson(
  db: D1Database,
  now: number,
): Promise<{ bodyJson: string; age: number } | null> {
  try {
    const metadata = await readStatusSnapshotMetadataRow(db);
    if (!metadata) {
      const row = await readStatusSnapshotRow(db);
      if (!row) return null;
      if (row.generated_at > now + FUTURE_SNAPSHOT_TOLERANCE_SECONDS) return null;

      const age = Math.max(0, now - row.generated_at);
      if (age > MAX_AGE_SECONDS) return null;

      const validated = readValidatedStatusSnapshotRow(db, row);
      if (validated === null) {
        console.warn('public snapshot: invalid JSON, falling back to live');
        return null;
      }
      return { bodyJson: validated.bodyJson, age };
    }
    if (metadata.generated_at > now + FUTURE_SNAPSHOT_TOLERANCE_SECONDS) return null;

    const age = Math.max(0, now - metadata.generated_at);
    if (age > MAX_AGE_SECONDS) return null;

    const updatedAt = toSnapshotUpdatedAt(metadata);
    const cached = readCachedStatusSnapshot(db, metadata.generated_at, updatedAt);
    if (cached) {
      return { bodyJson: cached.bodyJson, age };
    }

    const row = await readStatusSnapshotRow(db);
    if (!row || row.generated_at !== metadata.generated_at || toSnapshotUpdatedAt(row) !== updatedAt) {
      return null;
    }

    const validated = readValidatedStatusSnapshotRow(db, row);
    if (validated === null) {
      console.warn('public snapshot: invalid JSON, falling back to live');
      return null;
    }

    return { bodyJson: validated.bodyJson, age };
  } catch (err) {
    console.warn('public snapshot: read failed, falling back to live', err);
    return null;
  }
}

async function readStatusSnapshotEntryWithinAge(
  db: D1Database,
  now: number,
  maxAgeSeconds: number,
): Promise<{ entry: StatusSnapshotCacheEntry; age: number } | null> {
  try {
    const metadata = await readStatusSnapshotMetadataRow(db);
    if (!metadata) {
      const row = await readStatusSnapshotRow(db);
      if (!row) return null;
      if (row.generated_at > now + FUTURE_SNAPSHOT_TOLERANCE_SECONDS) return null;

      const age = Math.max(0, now - row.generated_at);
      if (age > maxAgeSeconds) return null;

      const validated = readValidatedStatusSnapshotRow(db, row);
      if (validated === null) return null;
      return { entry: validated, age };
    }
    if (metadata.generated_at > now + FUTURE_SNAPSHOT_TOLERANCE_SECONDS) return null;

    const age = Math.max(0, now - metadata.generated_at);
    if (age > maxAgeSeconds) return null;

    const updatedAt = toSnapshotUpdatedAt(metadata);
    const cached = readCachedStatusSnapshot(db, metadata.generated_at, updatedAt);
    if (cached) {
      return { entry: cached, age };
    }

    const row = await readStatusSnapshotRow(db);
    if (!row || row.generated_at !== metadata.generated_at || toSnapshotUpdatedAt(row) !== updatedAt) {
      return null;
    }

    const validated = readValidatedStatusSnapshotRow(db, row);
    if (validated === null) return null;

    return { entry: validated, age };
  } catch {
    return null;
  }
}

export async function readStatusSnapshotPayloadAnyAge(
  db: D1Database,
  now: number,
  maxAgeSeconds = MAX_STALE_SECONDS,
): Promise<{ data: PublicStatusResponse; bodyJson: string; age: number } | null> {
  const result = await readStatusSnapshotEntryWithinAge(db, now, maxAgeSeconds);
  if (!result) return null;
  return { data: result.entry.data, bodyJson: result.entry.bodyJson, age: result.age };
}

export function readCachedStatusSnapshotPayloadAnyAge(
  db: D1Database,
  now: number,
  maxAgeSeconds = MAX_STALE_SECONDS,
): { data: PublicStatusResponse; bodyJson: string; age: number } | null {
  const cached = normalizedStatusCacheByDb.get(db);
  if (!cached) return null;
  if (cached.generatedAt > now + FUTURE_SNAPSHOT_TOLERANCE_SECONDS) return null;

  const age = Math.max(0, now - cached.generatedAt);
  if (age > maxAgeSeconds) return null;

  return { data: cached.data, bodyJson: cached.bodyJson, age };
}

export async function readStaleStatusSnapshotJson(
  db: D1Database,
  now: number,
  maxStaleSeconds = MAX_STALE_SECONDS,
): Promise<{ bodyJson: string; age: number } | null> {
  const result = await readStatusSnapshotEntryWithinAge(db, now, maxStaleSeconds);
  if (!result) return null;
  return { bodyJson: result.entry.bodyJson, age: result.age };
}

export async function writeStatusSnapshot(
  db: D1Database,
  now: number,
  payload: PublicStatusResponse,
  trace?: Trace,
): Promise<void> {
  const prepared = prepareStatusSnapshotWrite({ db, now, payload, ...(trace ? { trace } : {}) });
  const result = await Trace.timed(
    trace,
    'status_write_run',
    async () => await prepared.statement.run(),
  );
  if (didApplyStatusSnapshotWrite(result)) {
    prepared.prime();
  }
}

export function didApplyStatusSnapshotWrite(
  result: Awaited<ReturnType<D1PreparedStatement['run']>> | undefined,
): boolean {
  const changes = result?.meta?.changes;
  if (typeof changes === 'number' && Number.isFinite(changes)) {
    return changes > 0;
  }
  return result !== undefined;
}

export type PreparedStatusSnapshotWrite = {
  statement: D1PreparedStatement;
  prime: () => void;
};

function bindStatusSnapshotUpsert(
  db: D1Database,
  now: number,
  bodyJson: string,
  generatedAt: number,
): D1PreparedStatement {
  const cached = upsertStatusStatementByDb.get(db);
  const statement = cached ?? db.prepare(UPSERT_STATUS_SQL);
  if (!cached) {
    upsertStatusStatementByDb.set(db, statement);
  }

  return statement.bind(
    SNAPSHOT_KEY,
    generatedAt,
    bodyJson,
    now,
    now + FUTURE_SNAPSHOT_TOLERANCE_SECONDS,
  );
}

function bindStatusSnapshotAfterHomepageUpsert(opts: {
  db: D1Database;
  now: number;
  bodyJson: string;
  generatedAt: number;
  homepageSnapshotKey: string;
  homepageGeneratedAt: number;
  homepageUpdatedAt: number;
  homepageLease?: {
    name: string;
    expiresAt: number;
  };
}): D1PreparedStatement {
  const cached = opts.homepageLease
    ? upsertStatusAfterHomepageAndLeaseStatementByDb.get(opts.db)
    : upsertStatusAfterHomepageStatementByDb.get(opts.db);
  const statement = cached ?? opts.db.prepare(
    opts.homepageLease
      ? UPSERT_STATUS_AFTER_HOMEPAGE_AND_LEASE_SQL
      : UPSERT_STATUS_AFTER_HOMEPAGE_SQL,
  );
  if (!cached) {
    if (opts.homepageLease) {
      upsertStatusAfterHomepageAndLeaseStatementByDb.set(opts.db, statement);
    } else {
      upsertStatusAfterHomepageStatementByDb.set(opts.db, statement);
    }
  }

  const args = [
    SNAPSHOT_KEY,
    opts.generatedAt,
    opts.bodyJson,
    opts.now,
    opts.now + FUTURE_SNAPSHOT_TOLERANCE_SECONDS,
    opts.homepageSnapshotKey,
    opts.homepageGeneratedAt,
    opts.homepageUpdatedAt,
  ];
  if (opts.homepageLease) {
    args.push(opts.homepageLease.name, opts.homepageLease.expiresAt);
  }

  return statement.bind(...args);
}

export function prepareStatusSnapshotWrite(opts: {
  db: D1Database;
  now: number;
  payload: PublicStatusResponse;
  trace?: Trace;
  afterHomepage?: {
    key: string;
    generatedAt: number;
    updatedAt: number;
    lease?: {
      name: string;
      expiresAt: number;
    };
  };
}): PreparedStatusSnapshotWrite {
  const bodyJson = Trace.timedSync(opts.trace, 'status_write_stringify', () =>
    JSON.stringify(opts.payload),
  );
  if (opts.trace?.enabled) {
    opts.trace.setLabel('status_payload_monitors', opts.payload.monitors.length);
    opts.trace.setLabel('status_payload_bytes', bodyJson.length);
  }
  const statement = opts.afterHomepage
    ? bindStatusSnapshotAfterHomepageUpsert({
        db: opts.db,
        now: opts.now,
        bodyJson,
        generatedAt: opts.payload.generated_at,
        homepageSnapshotKey: opts.afterHomepage.key,
        homepageGeneratedAt: opts.afterHomepage.generatedAt,
        homepageUpdatedAt: opts.afterHomepage.updatedAt,
        ...(opts.afterHomepage.lease ? { homepageLease: opts.afterHomepage.lease } : {}),
      })
    : bindStatusSnapshotUpsert(opts.db, opts.now, bodyJson, opts.payload.generated_at);

  return {
    statement,
    prime: () => {
      primeStatusSnapshotCache({
        db: opts.db,
        generatedAt: opts.payload.generated_at,
        updatedAt: opts.now,
        bodyJson,
        data: opts.payload,
      });
    },
  };
}

export function primeStatusSnapshotCache(opts: {
  db: D1Database;
  generatedAt: number;
  updatedAt: number;
  bodyJson: string;
  data: PublicStatusResponse;
}): void {
  normalizedStatusCacheByDb.set(opts.db, {
    generatedAt: opts.generatedAt,
    updatedAt: opts.updatedAt,
    bodyJson: opts.bodyJson,
    data: opts.data,
  });
}

export function applyStatusCacheHeaders(res: Response, ageSeconds: number): void {
  const remaining = Math.max(0, MAX_AGE_SECONDS - ageSeconds);
  const maxAge = Math.min(30, remaining);
  const stale = Math.max(0, remaining - maxAge);

  res.headers.set(
    'Cache-Control',
    `public, max-age=${maxAge}, stale-while-revalidate=${stale}, stale-if-error=${stale}`,
  );
}

export function toSnapshotPayload(value: unknown): PublicStatusResponse {
  const parsed = publicStatusResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(500, 'INTERNAL', 'Failed to generate status snapshot');
  }
  return parsed.data;
}

export async function refreshPublicStatusSnapshot(opts: {
  db: D1Database;
  now: number;
  compute: () => Promise<unknown>;
}): Promise<void> {
  const payload = toSnapshotPayload(await opts.compute());
  await writeStatusSnapshot(opts.db, opts.now, payload);
}
