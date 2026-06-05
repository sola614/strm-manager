import { now } from '../utils/time.js';
import { safeParseJsonArray, sanitizeText } from '../utils/validators.js';

export function createRunStore({ db, maxRunHistory, getLogCleanupEnabled, getLogRetentionDays }) {
  const insertRunLog = db.prepare(`
    INSERT INTO run_logs (run_id, line_index, message, created_at)
    VALUES (?, ?, ?, ?)
  `);

  let runCountSincePrune = 0;
  const PRUNE_INTERVAL = 10;

  function createRunRecord(run) {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO runs (
          id, task_id, task_name, service_id, service_name, trigger_type,
          started_at, completed_at, status, message, details,
          processed_count, subtitle_count, skipped_count, failure_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.taskId,
        run.taskName,
        run.serviceId,
        run.serviceName,
        run.triggerType,
        run.startedAt,
        run.completedAt,
        run.status,
        run.message,
        JSON.stringify(run.details || []),
        run.processedCount || 0,
        run.subtitleCount || 0,
        run.skippedCount || 0,
        run.failureCount || 0,
      );

      appendRunLogs(run.id, run.details || []);
    });
    tx();

    runCountSincePrune += 1;
    if (runCountSincePrune >= PRUNE_INTERVAL) {
      pruneRuns();
      runCountSincePrune = 0;
    }
  }

  function updateRunRecord(runId, values) {
    const normalizedValues = { ...values };

    if (Array.isArray(values.details)) {
      appendNewRunLogs(runId, values.details);
      normalizedValues.details = JSON.stringify(values.details.slice(-300));
    }

    const keys = Object.keys(normalizedValues);
    if (!keys.length) return;
    const assignments = keys.map((key) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE runs SET ${assignments} WHERE id = ?`).run(
      ...keys.map((key) => normalizedValues[key]),
      runId,
    );
  }

  function appendNewRunLogs(runId, messages) {
    const existingCount = Number(
      db.prepare('SELECT COUNT(*) AS cnt FROM run_logs WHERE run_id = ?').get(runId)?.cnt || 0,
    );
    const newMessages = messages.slice(existingCount);
    if (!newMessages.length) return;

    const tx = db.transaction(() => {
      newMessages.forEach((message, index) => {
        insertRunLog.run(runId, existingCount + index, String(message || ''), now());
      });
    });
    tx();
  }

  function mapRunRow(row, logsMap = null) {
    const logs = logsMap ? (logsMap.get(row.id) || []) : loadRunLogs(row.id);

    return {
      id: row.id,
      taskId: row.task_id,
      taskName: row.task_name,
      serviceId: row.service_id,
      serviceName: row.service_name,
      triggerType: row.trigger_type,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status,
      message: row.message,
      details: logs.length ? logs : safeParseJsonArray(row.details),
      processedCount: Number(row.processed_count),
      subtitleCount: Number(row.subtitle_count),
      skippedCount: Number(row.skipped_count),
      failureCount: Number(row.failure_count),
    };
  }

  function batchLoadRunLogsMap(rows) {
    if (!rows.length) return new Map();
    const placeholders = rows.map(() => '?').join(',');
    const ids = rows.map((row) => row.id);
    const logRows = db.prepare(`
      SELECT run_id, message
      FROM run_logs
      WHERE run_id IN (${placeholders})
      ORDER BY run_id, line_index ASC
    `).all(...ids);

    const map = new Map();
    for (const logRow of logRows) {
      if (!map.has(logRow.run_id)) {
        map.set(logRow.run_id, []);
      }
      map.get(logRow.run_id).push(logRow.message);
    }
    return map;
  }

  function loadRuns() {
    const rows = db.prepare('SELECT * FROM runs ORDER BY started_at DESC').all();
    const logsMap = batchLoadRunLogsMap(rows);
    return rows.map((row) => mapRunRow(row, logsMap));
  }

  function loadRunsByTask(taskId) {
    const rows = db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId);
    const logsMap = batchLoadRunLogsMap(rows);
    return rows.map((row) => mapRunRow(row, logsMap));
  }

  function getRunById(id) {
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    if (!row) return null;
    const logsMap = batchLoadRunLogsMap([row]);
    return mapRunRow(row, logsMap);
  }

  function listRunsByIds(ids) {
    const normalizedIds = Array.from(new Set(ids.map((id) => sanitizeText(id)).filter(Boolean)));
    if (!normalizedIds.length) return [];

    const placeholders = normalizedIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM runs WHERE id IN (${placeholders})`).all(...normalizedIds);
    const logsMap = batchLoadRunLogsMap(rows);
    return rows.map((row) => mapRunRow(row, logsMap));
  }

  function deleteRunRecords(ids) {
    const runs = listRunsByIds(ids);
    const runningRun = runs.find((run) => run.status === 'running');
    if (runningRun) {
      const error = new Error('运行中的记录暂不支持删除，请等待任务完成后再试。');
      error.status = 409;
      error.code = 'RUN_STILL_RUNNING';
      throw error;
    }

    const targetIds = runs.map((run) => run.id);
    if (!targetIds.length) return 0;

    const placeholders = targetIds.map(() => '?').join(',');
    const result = db.transaction(() => {
      db.prepare(`DELETE FROM run_logs WHERE run_id IN (${placeholders})`).run(...targetIds);
      return db.prepare(`DELETE FROM runs WHERE id IN (${placeholders})`).run(...targetIds);
    })();
    return Number(result.changes || 0);
  }

  function appendRunLog(runId, message) {
    const nextIndex = Number(
      db.prepare('SELECT COALESCE(MAX(line_index), -1) + 1 AS nextIndex FROM run_logs WHERE run_id = ?')
        .get(runId)?.nextIndex || 0,
    );
    insertRunLog.run(runId, nextIndex, String(message || ''), now());
  }

  function appendRunLogs(runId, messages) {
    messages.forEach((message) => appendRunLog(runId, message));
  }

  function replaceRunLogs(runId, messages) {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM run_logs WHERE run_id = ?').run(runId);
      messages.forEach((message, index) => {
        insertRunLog.run(runId, index, String(message || ''), now());
      });
    });
    tx();
  }

  function loadRunLogs(runId) {
    return db.prepare(`
      SELECT message
      FROM run_logs
      WHERE run_id = ?
      ORDER BY line_index ASC
    `).all(runId).map((row) => row.message);
  }

  function pruneRuns() {
    db.prepare(`
      DELETE FROM runs
      WHERE id NOT IN (
        SELECT id FROM runs ORDER BY started_at DESC LIMIT ?
      )
    `).run(maxRunHistory);
  }

  function cleanupExpiredRuns() {
    if (!getLogCleanupEnabled()) {
      return 0;
    }

    const retentionDays = getLogRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = db.transaction(() => {
      db.prepare(`
        DELETE FROM run_logs
        WHERE run_id IN (
          SELECT id FROM runs
          WHERE status != 'running'
            AND COALESCE(completed_at, started_at) < ?
        )
      `).run(cutoff);

      return db.prepare(`
        DELETE FROM runs
        WHERE status != 'running'
          AND COALESCE(completed_at, started_at) < ?
      `).run(cutoff);
    })();

    return Number(result.changes || 0);
  }

  return {
    createRunRecord,
    updateRunRecord,
    appendRunLog,
    loadRuns,
    loadRunsByTask,
    getRunById,
    deleteRunRecords,
    cleanupExpiredRuns,
  };
}
