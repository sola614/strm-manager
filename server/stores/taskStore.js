import cron from 'node-cron';
import { now } from '../utils/time.js';
import {
  clampFloat,
  clampInteger,
  normalizeExtensions,
  parseBoolean,
  sanitizeText,
} from '../utils/validators.js';
import { normalizeRemotePath } from '../utils/paths.js';

export function normalizeTaskRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    serviceId: String(row.service_id),
    sourcePath: row.source_path,
    targetPath: row.target_path,
    cron: row.cron,
    maxConcurrency: Number(row.max_concurrency),
    downloadExtensions: row.download_extensions,
    downloadSubtitles: Boolean(row.download_subtitles),
    requestDelaySeconds: Number(row.request_delay_seconds),
    overwriteExisting: Boolean(row.overwrite_existing),
    enabled: Boolean(row.enabled),
    notifyEnabled: Boolean(row.notify_enabled),
    callbackUrl: row.callback_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
  };
}

export function createTaskStore({ db, getServiceById, scheduleTask, stopScheduledTask, defaultDownloadExtensions }) {
  function loadTasks(serviceId = null) {
    const rows = serviceId
      ? db.prepare('SELECT * FROM tasks WHERE service_id = ? ORDER BY created_at DESC').all(serviceId)
      : db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();

    return rows.map(normalizeTaskRow);
  }

  function getTaskById(id) {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? normalizeTaskRow(row) : null;
  }

  function createTaskRecord(task) {
    const timestamp = now();
    const result = db.prepare(`
      INSERT INTO tasks (
        name, service_id, source_path, target_path, cron,
        max_concurrency, download_extensions, download_subtitles, request_delay_seconds,
        overwrite_existing, enabled, notify_enabled, callback_url,
        created_at, updated_at, last_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.name,
      task.serviceId,
      task.sourcePath,
      task.targetPath,
      task.cron,
      task.maxConcurrency,
      task.downloadExtensions,
      task.downloadSubtitles ? 1 : 0,
      task.requestDelaySeconds,
      task.overwriteExisting ? 1 : 0,
      task.enabled ? 1 : 0,
      task.notifyEnabled ? 1 : 0,
      task.callbackUrl,
      timestamp,
      timestamp,
      null,
    );

    return String(result.lastInsertRowid);
  }

  function updateTaskRecord(id, task) {
    db.prepare(`
      UPDATE tasks
      SET
        name = ?,
        service_id = ?,
        source_path = ?,
        target_path = ?,
        cron = ?,
        max_concurrency = ?,
        download_extensions = ?,
        download_subtitles = ?,
        request_delay_seconds = ?,
        overwrite_existing = ?,
        enabled = ?,
        notify_enabled = ?,
        callback_url = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      task.name,
      task.serviceId,
      task.sourcePath,
      task.targetPath,
      task.cron,
      task.maxConcurrency,
      task.downloadExtensions,
      task.downloadSubtitles ? 1 : 0,
      task.requestDelaySeconds,
      task.overwriteExisting ? 1 : 0,
      task.enabled ? 1 : 0,
      task.notifyEnabled ? 1 : 0,
      task.callbackUrl,
      now(),
      id,
    );
  }

  function bulkUpdateTaskEnabled(ids, enabled) {
    const tasks = ids.map((id) => getTaskById(id)).filter(Boolean);
    const schedulableTasks = tasks.filter((task) => Boolean(task.cron));

    if (!schedulableTasks.length) {
      const error = new Error('请选择至少一个已配置定时的任务。');
      error.status = 400;
      error.code = 'TASK_BULK_UPDATE_EMPTY';
      throw error;
    }

    const timestamp = now();
    const update = db.prepare('UPDATE tasks SET enabled = ?, updated_at = ? WHERE id = ? AND cron != ?');
    const tx = db.transaction(() => {
      for (const task of schedulableTasks) {
        update.run(enabled ? 1 : 0, timestamp, task.id, '');
      }
    });
    tx();

    schedulableTasks.forEach((task) => {
      const updated = getTaskById(task.id);
      if (updated) scheduleTask(updated);
    });

    return {
      updatedCount: schedulableTasks.length,
      skippedCount: ids.length - schedulableTasks.length,
    };
  }

  function removeTaskRecord(id) {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  function updateTaskLastRunAt(id, value) {
    db.prepare('UPDATE tasks SET last_run_at = ?, updated_at = ? WHERE id = ?').run(value, now(), id);
  }

  function disableTasksByServiceId(serviceId) {
    const tasks = loadTasks(serviceId);
    db.prepare('UPDATE tasks SET enabled = 0, updated_at = ? WHERE service_id = ?').run(now(), serviceId);
    tasks.forEach((task) => stopScheduledTask(task.id));
  }

  function findDuplicateTask(serviceId, sourcePath, targetPath, excludeId = null) {
    if (!serviceId || !sourcePath || !targetPath) return null;
    const row = excludeId
      ? db.prepare(`
        SELECT id FROM tasks
        WHERE service_id = ? AND source_path = ? AND target_path = ? AND id != ?
      `).get(serviceId, sourcePath, targetPath, excludeId)
      : db.prepare(`
        SELECT id FROM tasks
        WHERE service_id = ? AND source_path = ? AND target_path = ?
      `).get(serviceId, sourcePath, targetPath);
    return row ? String(row.id) : null;
  }

  function normalizeTaskPayload(input, existing = null, options = {}) {
    const name = sanitizeText(input?.name ?? existing?.name ?? '');
    const serviceId = sanitizeText(input?.serviceId ?? input?.service_id ?? existing?.serviceId ?? '');
    const sourcePath = normalizeRemotePath(input?.sourcePath ?? input?.source_path ?? existing?.sourcePath ?? '/');
    const targetPath = sanitizeText(input?.targetPath ?? input?.target_path ?? existing?.targetPath ?? '');
    const cronExpr = sanitizeText(input?.cron ?? existing?.cron ?? '');
    const maxConcurrency = clampInteger(
      input?.maxConcurrency ?? input?.max_concurrency ?? existing?.maxConcurrency ?? 5,
      1,
      50,
    );
    const downloadExtensions = normalizeExtensions(
      input?.downloadExtensions ?? input?.download_extensions ?? existing?.downloadExtensions ?? defaultDownloadExtensions,
    );
    const downloadSubtitles = Boolean(
      input?.downloadSubtitles ?? input?.download_subtitles ?? existing?.downloadSubtitles ?? false,
    );
    const requestDelaySeconds = clampFloat(
      input?.requestDelaySeconds ?? input?.request_delay_seconds ?? existing?.requestDelaySeconds ?? 5,
      0,
      600,
    );
    const overwriteExisting = Boolean(
      input?.overwriteExisting ?? input?.overwrite_existing ?? existing?.overwriteExisting ?? false,
    );
    const enabled = parseBoolean(input?.enabled ?? existing?.enabled ?? true);
    const notifyEnabled = Boolean(
      input?.notifyEnabled ?? input?.notify_enabled ?? existing?.notifyEnabled ?? false,
    );
    const callbackUrl = sanitizeText(input?.callbackUrl ?? input?.callback_url ?? existing?.callbackUrl ?? '');
    const errors = [];
    const selectedService = serviceId ? getServiceById(serviceId) : null;

    if (!name) errors.push('任务名称不能为空。');
    if (!serviceId) {
      errors.push('必须先选择一个 OpenList 服务。');
    } else if (!selectedService) {
      errors.push('所选 OpenList 服务不存在。');
    } else if (!selectedService.enabled && !options.allowDisabledService) {
      errors.push('所选 OpenList 服务已禁用，请先启用服务。');
    }
    if (!targetPath) errors.push('目标输出目录不能为空。');
    if (!downloadExtensions) errors.push('自定义下载后缀不能为空。');
    if (cronExpr && !cron.validate(cronExpr)) errors.push('Cron 表达式无效。');
    if (notifyEnabled && !callbackUrl) errors.push('开启通知后必须填写回调地址。');
    if (callbackUrl) {
      try {
        new URL(callbackUrl);
      } catch {
        errors.push('回调地址不合法。');
      }
    }
    if (serviceId && sourcePath && targetPath) {
      const duplicate = findDuplicateTask(serviceId, sourcePath, targetPath, existing?.id || null);
      if (duplicate) {
        errors.push('相同服务、源目录和输出目录的任务已存在。');
      }
    }

    return {
      errors,
      task: {
        name,
        serviceId,
        sourcePath,
        targetPath,
        cron: cronExpr,
        maxConcurrency,
        downloadExtensions,
        downloadSubtitles,
        requestDelaySeconds,
        overwriteExisting,
        enabled,
        notifyEnabled,
        callbackUrl: notifyEnabled ? callbackUrl : '',
      },
    };
  }

  return {
    loadTasks,
    getTaskById,
    createTaskRecord,
    updateTaskRecord,
    bulkUpdateTaskEnabled,
    removeTaskRecord,
    updateTaskLastRunAt,
    disableTasksByServiceId,
    normalizeTaskPayload,
  };
}
