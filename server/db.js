import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function createDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

export function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      token TEXT NOT NULL,
      base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      service_id INTEGER NOT NULL,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      cron TEXT NOT NULL,
      max_concurrency INTEGER NOT NULL DEFAULT 5,
      download_extensions TEXT NOT NULL DEFAULT 'mp4,mkv',
      download_subtitles INTEGER NOT NULL DEFAULT 0,
      request_delay_seconds TEXT NOT NULL DEFAULT '5',
      overwrite_existing INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      notify_enabled INTEGER NOT NULL DEFAULT 0,
      callback_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '[]',
      processed_count INTEGER NOT NULL DEFAULT 0,
      subtitle_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      line_index INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_logs_run_id_line_index
      ON run_logs(run_id, line_index);

    CREATE INDEX IF NOT EXISTS idx_runs_task_id
      ON runs(task_id);

    CREATE INDEX IF NOT EXISTS idx_runs_started_at
      ON runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  addColumnIfMissing(db, 'services', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'tasks', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  migrateRunDetailsToLogs(db);
}

function addColumnIfMissing(db, tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`).run();
}

function migrateRunDetailsToLogs(db) {
  const rows = db.prepare(`
    SELECT id, details
    FROM runs
    WHERE details IS NOT NULL
      AND details != '[]'
      AND NOT EXISTS (
        SELECT 1 FROM run_logs WHERE run_logs.run_id = runs.id
      )
  `).all();

  if (!rows.length) return;

  const insert = db.prepare(`
    INSERT INTO run_logs (run_id, line_index, message, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const row of rows) {
      let details = [];
      try {
        details = JSON.parse(row.details || '[]');
      } catch {
        details = [];
      }

      details.forEach((message, index) => {
        insert.run(row.id, index, String(message || ''), new Date().toISOString());
      });
    }
  });
  tx();
}

export function createSettingsStore(db) {
  return {
    getSetting(key) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? row.value : null;
    },
    setSetting(key, value) {
      db.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key, value);
    },
  };
}
