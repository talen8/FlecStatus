// =========================================================================
// 迁移 V1：初始建表
// =========================================================================
const V1_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('http', 'tcp')),
    target TEXT NOT NULL,
    interval_sec INTEGER NOT NULL DEFAULT 60 CHECK (interval_sec >= 60),
    timeout_ms   INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms >= 1000),
    http_method TEXT,
    http_headers_json TEXT,
    http_body TEXT,
    expected_status_json TEXT,
    response_keyword TEXT,
    response_forbidden_keyword TEXT,
    response_keyword_mode TEXT CHECK (response_keyword_mode IN ('contains', 'regex')),
    response_forbidden_keyword_mode TEXT CHECK (response_forbidden_keyword_mode IN ('contains', 'regex')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    group_name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    group_sort_order INTEGER NOT NULL DEFAULT 0,
    show_on_status_page INTEGER NOT NULL DEFAULT 1 CHECK (show_on_status_page IN (0, 1)),
    public_access INTEGER NOT NULL DEFAULT 0 CHECK (public_access IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_monitors_group_sort
    ON monitors(group_name, group_sort_order, sort_order, id)`,
  `CREATE TABLE IF NOT EXISTS monitor_state (
    monitor_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('up', 'down', 'maintenance', 'paused', 'unknown')),
    last_checked_at INTEGER,
    last_changed_at INTEGER,
    last_latency_ms INTEGER,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    consecutive_successes INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS check_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    checked_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('up', 'down', 'maintenance', 'unknown')),
    latency_ms INTEGER,
    http_status INTEGER,
    error TEXT,
    location TEXT,
    attempt INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time
    ON check_results(monitor_id, checked_at)`,
  `CREATE TABLE IF NOT EXISTS outages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    initial_error TEXT,
    last_error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_outages_monitor_start
    ON outages(monitor_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
    impact TEXT NOT NULL DEFAULT 'minor' CHECK (impact IN ('none', 'minor', 'major', 'critical')),
    message TEXT,
    started_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    resolved_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS incident_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    status TEXT CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_incident_updates_incident_time
    ON incident_updates(incident_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS incident_monitors (
    incident_id INTEGER NOT NULL,
    monitor_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    PRIMARY KEY (incident_id, monitor_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_incident_monitors_monitor
    ON incident_monitors(monitor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_incident_monitors_incident
    ON incident_monitors(incident_id)`,
  `CREATE TABLE IF NOT EXISTS maintenance_windows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  )`,
  `CREATE TABLE IF NOT EXISTS maintenance_window_monitors (
    maintenance_window_id INTEGER NOT NULL,
    monitor_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    PRIMARY KEY (maintenance_window_id, monitor_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_maintenance_window_monitors_monitor
    ON maintenance_window_monitors(monitor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_maintenance_window_monitors_window
    ON maintenance_window_monitors(maintenance_window_id)`,
  `CREATE TABLE IF NOT EXISTS notification_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('webhook')),
    config_json TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  )`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL,
    channel_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    http_status INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_event_channel
    ON notification_deliveries(event_key, channel_id)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('site_title', 'Uptimer')`,
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('site_description', '')`,
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('site_timezone', 'UTC')`,
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_check_results_days', '7')`,
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('state_failures_to_down_from_up', '2')`,
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('state_successes_to_up_from_down', '2')`,
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_default_overview_range', '24h')`,
  `INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_default_monitor_range', '24h')`,
  `CREATE TABLE IF NOT EXISTS locks (
    name TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS monitor_daily_rollups (
    monitor_id INTEGER NOT NULL,
    day_start_at INTEGER NOT NULL,
    total_sec INTEGER NOT NULL,
    downtime_sec INTEGER NOT NULL,
    unknown_sec INTEGER NOT NULL,
    uptime_sec INTEGER NOT NULL,
    checks_total INTEGER NOT NULL,
    checks_up INTEGER NOT NULL,
    checks_down INTEGER NOT NULL,
    checks_unknown INTEGER NOT NULL,
    checks_maintenance INTEGER NOT NULL,
    avg_latency_ms INTEGER,
    p50_latency_ms INTEGER,
    p95_latency_ms INTEGER,
    latency_histogram_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
    PRIMARY KEY (monitor_id, day_start_at)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_monitor_daily_rollups_day
    ON monitor_daily_rollups(day_start_at)`,
  `CREATE INDEX IF NOT EXISTS idx_monitor_daily_rollups_monitor_day
    ON monitor_daily_rollups(monitor_id, day_start_at)`,
  `CREATE TABLE IF NOT EXISTS public_snapshots (
    key TEXT PRIMARY KEY,
    generated_at INTEGER NOT NULL,
    body_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  )`,
  `CREATE TABLE IF NOT EXISTS public_snapshot_guard_versions (
    key TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    state_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS public_snapshot_fragments (
    snapshot_key TEXT NOT NULL,
    fragment_key TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    body_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (snapshot_key, fragment_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_public_snapshot_fragments_snapshot_generated
    ON public_snapshot_fragments (snapshot_key, generated_at)`,
];

// =========================================================================
// 数据库迁移指南
// =========================================================================
// 1. 在下方 migrations 数组尾部追加新条目，version 递增、内容自包含
// 2. 使用 IF NOT EXISTS / INSERT OR IGNORE 保证幂等，可安全重复执行
// 3. 不可变原则：已有迁移绝不可修改，追加新迁移修复或扩展
// =========================================================================
// 模板:
// {
//   version: 2,
//   up: async (db) => {
//     await db.exec("ALTER TABLE monitors ADD COLUMN new_col TEXT");
//   },
// },
// =========================================================================

interface Migration {
  version: number;
  up: (db: D1Database) => Promise<void>;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: async (db) => {
      await db.batch(V1_STATEMENTS.map(s => db.prepare(s)));
    },
  },
];

let initialized = false;

async function getSchemaVersion(db: D1Database): Promise<number | null> {
  try {
    const row = await db.prepare(
      "SELECT value FROM settings WHERE key = 'schema_version'",
    ).first<{ value: string }>();
    return row ? parseInt(row.value, 10) : null;
  } catch {
    return null;
  }
}

async function setSchemaVersion(db: D1Database, version: number): Promise<void> {
  await db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', ?)",
  ).bind(String(version)).run();
}

export async function ensureDbInitialized(db: D1Database): Promise<void> {
  if (initialized) return;

  const current = await getSchemaVersion(db);

  if (current === null) {
    for (const m of migrations) {
      await m.up(db);
      await setSchemaVersion(db, m.version);
    }
    initialized = true;
    return;
  }

  for (const m of migrations) {
    if (m.version > current) {
      await m.up(db);
      await setSchemaVersion(db, m.version);
    }
  }

  initialized = true;
}
