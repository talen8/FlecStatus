const statementCache = new WeakMap<D1Database, Map<string, D1PreparedStatement>>();

/** 获取或创建缓存的 prepared statement，避免重复 db.prepare() */
function cachedStatement(db: D1Database, sql: string): D1PreparedStatement {
  let dbCache = statementCache.get(db);
  if (!dbCache) {
    dbCache = new Map();
    statementCache.set(db, dbCache);
  }
  let stmt = dbCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    dbCache.set(sql, stmt);
  }
  return stmt;
}

/** 获取单个分布式锁 */
export async function acquireLease(
  db: D1Database,
  name: string,
  now: number,
  leaseSeconds: number,
): Promise<boolean> {
  const expiresAt = now + leaseSeconds;
  const r = await cachedStatement(db, ACQUIRE_LEASE_SQL).bind(name, expiresAt, now).run();
  return (r.meta.changes ?? 0) > 0;
}

/** 批量获取分布式锁，使用 db.batch() 将 N 次网络往返合并为 1 次 */
export async function acquireLeaseBatch(
  db: D1Database,
  entries: ReadonlyArray<{ name: string; now: number; leaseSeconds: number }>,
): Promise<boolean[]> {
  if (entries.length === 0) return [];
  const stmt = cachedStatement(db, ACQUIRE_LEASE_SQL);
  const results = await db.batch(
    entries.map((e) => stmt.bind(e.name, e.now + e.leaseSeconds, e.now)),
  );
  return results.map((r) => (r.meta.changes ?? 0) > 0);
}

/** 释放单个分布式锁 */
export async function releaseLease(
  db: D1Database,
  name: string,
  expiresAt: number,
): Promise<void> {
  await cachedStatement(db, RELEASE_LEASE_SQL).bind(name, expiresAt).run();
}

/** 批量释放分布式锁，使用 db.batch() 将 N 次网络往返合并为 1 次 */
export async function releaseLeaseBatch(
  db: D1Database,
  entries: ReadonlyArray<{ name: string; expiresAt: number }>,
): Promise<void> {
  if (entries.length === 0) return;
  const stmt = cachedStatement(db, RELEASE_LEASE_SQL);
  await db.batch(entries.map((e) => stmt.bind(e.name, e.expiresAt)));
}

export async function renewLease(
  db: D1Database,
  name: string,
  currentExpiresAt: number,
  nextExpiresAt: number,
): Promise<boolean> {
  const result = await cachedStatement(db, RENEW_LEASE_SQL)
    .bind(name, nextExpiresAt, currentExpiresAt)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

const ACQUIRE_LEASE_SQL = `
  INSERT INTO locks (name, expires_at)
  VALUES (?1, ?2)
  ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at
  WHERE locks.expires_at <= ?3
`;
const RELEASE_LEASE_SQL = `
  DELETE FROM locks
  WHERE name = ?1 AND expires_at = ?2
`;
const RENEW_LEASE_SQL = `
  UPDATE locks
  SET expires_at = ?2
  WHERE name = ?1 AND expires_at = ?3
`;
