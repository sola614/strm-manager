import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import cron from 'node-cron';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4173);
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin';
const RESET_ADMIN_PASSWORD = process.env.RESET_ADMIN_PASSWORD || '';
const DEFAULT_STRM_TARGET_PATH = process.env.STRM_TARGET_PATH || '/media/strm';
const DATABASE_PATH = resolveDatabasePath(
  process.env.DATABASE_PATH || path.join('data', 'database.sqlite'),
);
const DIST_PATH = path.join(__dirname, 'dist');
const MAX_RUN_HISTORY = 200;
const DEFAULT_DOWNLOAD_EXTENSIONS = 'mp4,mkv';
const DEFAULT_SUBTITLE_EXTENSIONS = 'srt,ass';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const app = express();
const db = new Database(DATABASE_PATH);
const scheduledJobs = new Map();
const activeRuns = new Set();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

createTables();
initializeSettings();
loadTasks().forEach(scheduleTask);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    databasePath: DATABASE_PATH,
    runningTasks: Array.from(activeRuns),
  });
});

app.post('/api/auth/login', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || !verifyPassword(password)) {
    return res.status(401).json({
      code: 'INVALID_CREDENTIALS',
      error: '账号或密码不正确。',
    });
  }

  const token = issueSession();
  res.json({
    token,
    username: DEFAULT_ADMIN_USERNAME,
    mustChangePassword: shouldForcePasswordChange(),
  });
});

app.get('/api/auth/me', requireAuth({ allowWhenPasswordChangeRequired: true }), (_req, res) => {
  res.json({
    username: DEFAULT_ADMIN_USERNAME,
    mustChangePassword: shouldForcePasswordChange(),
  });
});

app.get('/api/config', requireAuth({ allowWhenPasswordChangeRequired: true }), (_req, res) => {
  res.json({
    defaultStrmTargetPath: DEFAULT_STRM_TARGET_PATH,
  });
});

app.post('/api/auth/logout', requireAuth({ allowWhenPasswordChangeRequired: true }), (_req, res) => {
  clearSession();
  res.status(204).end();
});

app.put('/api/auth/password', requireAuth({ allowWhenPasswordChangeRequired: true }), (req, res) => {
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';
  if (newPassword.length < 8) {
    return res.status(400).json({
      code: 'INVALID_PASSWORD',
      error: '新密码至少需要 8 个字符。',
    });
  }

  setSetting('admin_password_hash', hashValue(newPassword));
  setSetting('force_password_change', '0');

  const token = issueSession();
  res.json({
    token,
    username: DEFAULT_ADMIN_USERNAME,
    mustChangePassword: false,
  });
});

app.get('/api/services', requireAuth(), (_req, res) => {
  res.json(loadServices());
});

app.post('/api/services', requireAuth(), (req, res) => {
  const { service, errors } = normalizeServicePayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      code: 'INVALID_SERVICE',
      error: errors.join(' '),
    });
  }

  const newId = createServiceRecord(service);
  res.status(201).json(getServiceById(newId));
});

app.put('/api/services/:id', requireAuth(), (req, res) => {
  const existing = getServiceById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      code: 'SERVICE_NOT_FOUND',
      error: 'OpenList 服务不存在。',
    });
  }

  const { service, errors } = normalizeServicePayload(req.body, existing);
  if (errors.length > 0) {
    return res.status(400).json({
      code: 'INVALID_SERVICE',
      error: errors.join(' '),
    });
  }

  updateServiceRecord(req.params.id, service);
  res.json(getServiceById(req.params.id));
});

app.delete('/api/services/:id', requireAuth(), (req, res) => {
  const existing = getServiceById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      code: 'SERVICE_NOT_FOUND',
      error: 'OpenList 服务不存在。',
    });
  }

  const usedByTasks = db.prepare('SELECT COUNT(1) AS count FROM tasks WHERE service_id = ?').get(req.params.id);
  if (Number(usedByTasks?.count || 0) > 0) {
    return res.status(409).json({
      code: 'SERVICE_IN_USE',
      error: '请先删除关联的定时任务。',
    });
  }

  removeServiceRecord(req.params.id);
  res.status(204).end();
});

app.get('/api/tasks', requireAuth(), (req, res) => {
  const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId.trim() : '';
  res.json(loadTasks(serviceId || null));
});

app.post('/api/tasks', requireAuth(), (req, res) => {
  const { task, errors } = normalizeTaskPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      code: 'INVALID_TASK',
      error: errors.join(' '),
    });
  }

  const newId = createTaskRecord(task);
  const created = getTaskById(newId);
  if (created) scheduleTask(created);
  res.status(201).json(created);
});

app.put('/api/tasks/:id', requireAuth(), (req, res) => {
  const existing = getTaskById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      code: 'TASK_NOT_FOUND',
      error: '定时任务不存在。',
    });
  }

  const { task, errors } = normalizeTaskPayload(req.body, existing);
  if (errors.length > 0) {
    return res.status(400).json({
      code: 'INVALID_TASK',
      error: errors.join(' '),
    });
  }

  updateTaskRecord(req.params.id, task);
  const updated = getTaskById(req.params.id);
  if (updated) scheduleTask(updated);
  res.json(updated);
});

app.delete('/api/tasks/:id', requireAuth(), (req, res) => {
  const existing = getTaskById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      code: 'TASK_NOT_FOUND',
      error: '定时任务不存在。',
    });
  }

  stopScheduledTask(existing.id);
  activeRuns.delete(existing.id);
  removeTaskRecord(existing.id);
  res.status(204).end();
});

app.post('/api/tasks/:id/trigger', requireAuth(), async (req, res) => {
  try {
    const run = await startTaskRun(req.params.id, 'manual');
    res.status(202).json(run);
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    res.status(status).json({
      code: error?.code || 'RUN_START_FAILED',
      error: formatError(error),
    });
  }
});

app.get('/api/tasks/:id/runs', requireAuth(), (req, res) => {
  res.json(loadRunsByTask(req.params.id));
});

app.get('/api/runs', requireAuth(), (_req, res) => {
  res.json(loadRuns());
});

app.get('/api/backup/export', requireAuth(), (_req, res) => {
  res.json(buildBackupPayload());
});

app.post('/api/backup/import', requireAuth(), upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      throw new Error('请上传备份文件。');
    }
    const payload = JSON.parse(req.file.buffer.toString('utf8'));
    const summary = restoreBackupPayload(payload);
    res.json(summary);
  } catch (error) {
    res.status(400).json({
      code: 'INVALID_BACKUP',
      error: formatError(error),
    });
  }
});

if (fs.existsSync(path.join(DIST_PATH, 'index.html'))) {
  app.use(express.static(DIST_PATH));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Strm Manager listening on http://localhost:${PORT}`);
});

function resolveDatabasePath(databasePath) {
  return path.isAbsolute(databasePath) ? databasePath : path.join(__dirname, databasePath);
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      token TEXT NOT NULL,
      base_url TEXT NOT NULL,
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
      request_delay_seconds REAL NOT NULL DEFAULT 5,
      overwrite_existing INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function initializeSettings() {
  if (!getSetting('admin_password_hash')) {
    setSetting('admin_password_hash', hashValue(DEFAULT_ADMIN_PASSWORD));
  }

  if (RESET_ADMIN_PASSWORD) {
    setSetting('admin_password_hash', hashValue(DEFAULT_ADMIN_PASSWORD));
    setSetting('force_password_change', '1');
    setSetting('session_token_hash', '');
    console.warn('Admin password was reset to the default password. Remove RESET_ADMIN_PASSWORD after login.');
    return;
  }

  if (!getSetting('force_password_change')) {
    setSetting('force_password_change', '1');
  }

  if (!getSetting('session_token_hash')) {
    setSetting('session_token_hash', '');
  }
}

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function now() {
  return new Date().toISOString();
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function shouldForcePasswordChange() {
  return getSetting('force_password_change') === '1';
}

function verifyPassword(password) {
  const hash = getSetting('admin_password_hash');
  return Boolean(hash) && hash === hashValue(password);
}

function issueSession() {
  const token = crypto.randomBytes(24).toString('hex');
  setSetting('session_token_hash', hashValue(token));
  return token;
}

function clearSession() {
  setSetting('session_token_hash', '');
}

function getSessionToken(req) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  return authorization.slice(7).trim() || null;
}

function requireAuth(options = {}) {
  return (req, res, next) => {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        error: '请先登录。',
      });
    }

    const tokenHash = getSetting('session_token_hash');
    if (!tokenHash || tokenHash !== hashValue(token)) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        error: '登录状态已失效，请重新登录。',
      });
    }

    if (shouldForcePasswordChange() && !options.allowWhenPasswordChangeRequired) {
      return res.status(403).json({
        code: 'PASSWORD_CHANGE_REQUIRED',
        error: '默认密码必须先修改后才能继续使用。',
      });
    }

    next();
  };
}

function normalizeTaskRow(row) {
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
    notifyEnabled: Boolean(row.notify_enabled),
    callbackUrl: row.callback_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
  };
}

function loadServices() {
  return db.prepare('SELECT * FROM services ORDER BY created_at DESC').all().map((row) => ({
    id: String(row.id),
    name: row.name,
    url: row.url,
    token: row.token,
    baseUrl: row.base_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function getServiceById(id) {
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    url: row.url,
    token: row.token,
    baseUrl: row.base_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createServiceRecord(service) {
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO services (name, url, token, base_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(service.name, service.url, service.token, service.baseUrl, timestamp, timestamp);
  return String(result.lastInsertRowid);
}

function updateServiceRecord(id, service) {
  db.prepare(`
    UPDATE services
    SET name = ?, url = ?, token = ?, base_url = ?, updated_at = ?
    WHERE id = ?
  `).run(service.name, service.url, service.token, service.baseUrl, now(), id);
}

function removeServiceRecord(id) {
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
}

function normalizeServicePayload(input, existing = null) {
  const name = sanitizeText(input?.name ?? existing?.name ?? '');
  const url = normalizeUrl(input?.url ?? existing?.url ?? '');
  const token = sanitizeText(input?.token ?? existing?.token ?? '');
  const baseUrl = normalizeBaseUrl(input?.baseUrl ?? input?.base_url ?? existing?.baseUrl ?? '/');
  const errors = [];

  if (!name) errors.push('服务名称不能为空。');
  if (!url) errors.push('服务 URL 不能为空。');
  if (!token) errors.push('服务 Token 不能为空。');

  if (url) {
    try {
      new URL(url);
    } catch {
      errors.push('服务 URL 不合法。');
    }
  }

  return {
    errors,
    service: { name, url, token, baseUrl },
  };
}

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
      overwrite_existing, notify_enabled, callback_url,
      created_at, updated_at, last_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    task.notifyEnabled ? 1 : 0,
    task.callbackUrl,
    now(),
    id,
  );
}

function removeTaskRecord(id) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

function updateTaskLastRunAt(id, value) {
  db.prepare('UPDATE tasks SET last_run_at = ?, updated_at = ? WHERE id = ?').run(value, now(), id);
}

function normalizeTaskPayload(input, existing = null) {
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
    input?.downloadExtensions ?? input?.download_extensions ?? existing?.downloadExtensions ?? DEFAULT_DOWNLOAD_EXTENSIONS,
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
  const notifyEnabled = Boolean(
    input?.notifyEnabled ?? input?.notify_enabled ?? existing?.notifyEnabled ?? false,
  );
  const callbackUrl = sanitizeText(input?.callbackUrl ?? input?.callback_url ?? existing?.callbackUrl ?? '');
  const errors = [];

  if (!name) errors.push('任务名称不能为空。');
  if (!serviceId) {
    errors.push('必须先选择一个 OpenList 服务。');
  } else if (!getServiceById(serviceId)) {
    errors.push('所选 OpenList 服务不存在。');
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
      notifyEnabled,
      callbackUrl,
    },
  };
}

function createRunRecord(run) {
  db.prepare(`
    INSERT INTO runs (
      id, task_id, task_name, service_id, service_name, trigger_type,
      started_at, completed_at, status, message, details, processed_count,
      subtitle_count, skipped_count, failure_count
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
    run.processedCount,
    run.subtitleCount,
    run.skippedCount,
    run.failureCount,
  );

  pruneRuns();
}

function updateRunRecord(runId, values) {
  const keys = Object.keys(values);
  if (!keys.length) return;
  const assignments = keys.map((key) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE runs SET ${assignments} WHERE id = ?`).run(
    ...keys.map((key) => values[key]),
    runId,
  );
}

function mapRunRow(row) {
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
    details: safeParseJsonArray(row.details),
    processedCount: Number(row.processed_count),
    subtitleCount: Number(row.subtitle_count),
    skippedCount: Number(row.skipped_count),
    failureCount: Number(row.failure_count),
  };
}

function loadRuns() {
  return db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 50').all().map(mapRunRow);
}

function loadRunsByTask(taskId) {
  return db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 20').all(taskId).map(mapRunRow);
}

function pruneRuns() {
  db.prepare(`
    DELETE FROM runs
    WHERE id NOT IN (
      SELECT id FROM runs ORDER BY started_at DESC LIMIT ?
    )
  `).run(MAX_RUN_HISTORY);
}

function scheduleTask(task) {
  stopScheduledTask(task.id);
  if (!task.cron || !cron.validate(task.cron)) return;

  const job = cron.schedule(task.cron, () => {
    startTaskRun(task.id, 'schedule').catch((error) => {
      console.error(`Scheduled task ${task.id} failed:`, error);
    });
  });

  scheduledJobs.set(task.id, job);
}

function stopScheduledTask(taskId) {
  const existing = scheduledJobs.get(taskId);
  if (existing) {
    existing.stop();
    scheduledJobs.delete(taskId);
  }
}

async function startTaskRun(taskId, triggerType) {
  const task = getTaskById(taskId);
  if (!task) {
    const error = new Error('定时任务不存在。');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }

  const service = getServiceById(task.serviceId);
  if (!service) {
    const error = new Error('任务对应的 OpenList 服务不存在。');
    error.status = 409;
    error.code = 'TASK_SERVICE_MISSING';
    throw error;
  }

  if (activeRuns.has(task.id)) {
    if (triggerType === 'schedule') {
      recordSkippedRun(task, service, '任务仍在运行中，本次定时触发已跳过。');
      return null;
    }

    const error = new Error('任务仍在运行中，请稍后再试。');
    error.status = 409;
    error.code = 'TASK_ALREADY_RUNNING';
    throw error;
  }

  const run = {
    id: generateId(task.id),
    taskId: task.id,
    taskName: task.name,
    serviceId: service.id,
    serviceName: service.name,
    triggerType,
    startedAt: now(),
    completedAt: null,
    status: 'running',
    message: triggerType === 'manual' ? '任务已手动触发，正在执行。' : '定时任务触发，正在执行。',
    details: [],
    processedCount: 0,
    subtitleCount: 0,
    skippedCount: 0,
    failureCount: 0,
  };

  createRunRecord(run);
  activeRuns.add(task.id);

  executeTaskRun(task, service, run).finally(() => {
    activeRuns.delete(task.id);
  });

  return run;
}

function recordSkippedRun(task, service, message) {
  createRunRecord({
    id: generateId(task.id),
    taskId: task.id,
    taskName: task.name,
    serviceId: service.id,
    serviceName: service.name,
    triggerType: 'schedule',
    startedAt: now(),
    completedAt: now(),
    status: 'skipped',
    message,
    details: [],
    processedCount: 0,
    subtitleCount: 0,
    skippedCount: 0,
    failureCount: 0,
  });
}

async function executeTaskRun(task, service, run) {
  const localDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alist2strm-'));
  const fullSourcePath = buildServiceSourcePath(service.baseUrl, task.sourcePath);
  const details = [];
  const downloadExtensionSet = buildExtensionSet(task.downloadExtensions);

  try {
    if (isMediaFile(fullSourcePath, downloadExtensionSet)) {
      await getFileInfo({ service, filePath: fullSourcePath, localDir, details, task, downloadExtensionSet });
    } else {
      await handleGetList({ service, dirPath: fullSourcePath, localDir, details, task, downloadExtensionSet });
    }

    const syncSummary = await syncGeneratedFiles(localDir, task.targetPath, task.overwriteExisting, details);
    const completedAt = now();

    if (task.notifyEnabled && task.callbackUrl && (syncSummary.processedCount > 0 || syncSummary.subtitleCount > 0)) {
      await triggerCallback(task.callbackUrl, {
        taskId: task.id,
        taskName: task.name,
        processedCount: syncSummary.processedCount,
        subtitleCount: syncSummary.subtitleCount,
        details,
        finishedAt: completedAt,
      });
      details.push(`回调通知已发送到 ${task.callbackUrl}`);
    }

    updateRunRecord(run.id, {
      completed_at: completedAt,
      status: syncSummary.failureCount > 0 ? 'error' : 'success',
      message:
        syncSummary.failureCount > 0
          ? `任务执行完成，但有 ${syncSummary.failureCount} 个文件处理失败。`
          : `任务执行完成，生成 ${syncSummary.processedCount} 个 STRM 文件，字幕 ${syncSummary.subtitleCount} 个。`,
      details: JSON.stringify(details.slice(0, 300)),
      processed_count: syncSummary.processedCount,
      subtitle_count: syncSummary.subtitleCount,
      skipped_count: syncSummary.skippedCount,
      failure_count: syncSummary.failureCount,
    });

    updateTaskLastRunAt(task.id, completedAt);
  } catch (error) {
    updateRunRecord(run.id, {
      completed_at: now(),
      status: 'error',
      message: formatError(error),
      details: JSON.stringify(details.slice(0, 300)),
      failure_count: 1,
    });
  } finally {
    await deleteLocalFiles(localDir).catch(() => {});
  }
}

async function getFileInfo({ service, filePath, localDir, details, task, downloadExtensionSet }) {
  const response = await fetch(buildApiUrl(service.url, '/api/fs/get'), {
    method: 'POST',
    headers: {
      Authorization: service.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: filePath,
      page: 1,
      refresh: true,
      per_page: 1000,
    }),
  });

  const payload = await readJsonResponse(response);
  if (!payload || payload.code !== 200) {
    throw new Error(`获取文件信息失败：${payload?.message || response.status}`);
  }

  await saveRemoteItem({
    service,
    item: payload.data,
    currentPath: path.posix.dirname(filePath),
    localDir,
    pathPrefix: '',
    details,
    task,
    downloadExtensionSet,
  });
}

async function handleGetList({ service, dirPath, pathPrefix = '', localDir, details, task, downloadExtensionSet }) {
  let page = 1;
  const perPage = 1000;

  while (true) {
    const response = await fetch(buildApiUrl(service.url, '/api/fs/list'), {
      method: 'POST',
      headers: {
        Authorization: service.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: dirPath,
        page,
        refresh: page === 1,
        per_page: perPage,
      }),
    });

    const payload = await readJsonResponse(response);
    if (!payload || payload.code !== 200) {
      throw new Error(`列出目录失败：${dirPath}`);
    }

    const files = Array.isArray(payload.data?.content) ? payload.data.content : [];
    await runWithConcurrency(files, task.maxConcurrency, async (item) => {
      if (!item?.name || !isSafePathPart(item.name)) return;

      if (item.is_dir) {
        await handleGetList({
          service,
          dirPath: joinRemotePath(dirPath, item.name),
          pathPrefix: path.posix.join(pathPrefix, item.name),
          localDir,
          details,
          task,
          downloadExtensionSet,
        });
        return;
      }

      await saveRemoteItem({
        service,
        item,
        currentPath: dirPath,
        localDir,
        pathPrefix,
        details,
        task,
        downloadExtensionSet,
      });
    });

    const total = Number(payload.data?.total || 0);
    if (files.length < perPage || page * perPage >= total) break;
    page += 1;
  }
}

async function saveRemoteItem({ service, item, currentPath, localDir, pathPrefix, details, task, downloadExtensionSet }) {
  if (!item?.name || !isSafePathPart(item.name)) return;
  const saveDir = path.join(localDir, pathPrefix);
  await fs.promises.mkdir(saveDir, { recursive: true });

  const fileName = item.name;
  const sign = item.sign || '';
  const streamUrl = buildDownloadUrl({
    domain: service.url,
    baseUrl: service.baseUrl,
    sourcePath: currentPath,
    fileName,
    sign,
  });

  if (task.requestDelaySeconds > 0) {
    await delay(task.requestDelaySeconds * 1000);
  }

  if (isSubtitleFile(fileName) && task.downloadSubtitles) {
    const subtitlePath = path.join(saveDir, fileName);

    if (!task.overwriteExisting && fs.existsSync(subtitlePath)) {
      details.push(`${fileName} 字幕已存在，跳过下载`);
      return;
    }

    const response = await fetch(streamUrl);
    if (!response.ok) {
      throw new Error(`字幕下载失败：${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.promises.writeFile(subtitlePath, Buffer.from(arrayBuffer));
    details.push(`${fileName} 字幕下载成功`);
    return;
  }

  if (!isMediaFile(fileName, downloadExtensionSet)) return;

  const savePath = path.join(saveDir, fileName.replace(/\.[^.]+$/i, '.strm'));

  if (!task.overwriteExisting && fs.existsSync(savePath)) {
    details.push(`${path.basename(savePath)} 已存在，跳过创建`);
    return;
  }

  await fs.promises.writeFile(savePath, streamUrl, 'utf8');
  details.push(`${path.basename(savePath)} 创建成功`);
}

async function triggerCallback(callbackUrl, payload) {
  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`回调通知失败：${response.status}`);
  }
}

function buildDownloadUrl({ domain, baseUrl, sourcePath, fileName, sign }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const resolvedSourcePath = buildServiceSourcePath(baseUrl, sourcePath);
  let relativeSourcePath = normalizeRemotePath(resolvedSourcePath);

  if (normalizedBaseUrl !== '/' && relativeSourcePath.startsWith(`${normalizedBaseUrl}/`)) {
    relativeSourcePath = relativeSourcePath.slice(normalizedBaseUrl.length);
  } else if (relativeSourcePath === normalizedBaseUrl) {
    relativeSourcePath = '/';
  }

  const parts = normalizeRemotePath(relativeSourcePath)
    .split('/')
    .filter(Boolean);

  if (parts.length > 0 && parts[parts.length - 1] === fileName) {
    parts.pop();
  }

  const encodedDir = parts.map((part) => encodeURIComponent(part)).join('/');
  const cleanDomain = domain.replace(/\/+$/, '');
  const dirSegment = encodedDir ? `/${encodedDir}` : '';
  const signQuery = sign ? `?sign=${encodeURIComponent(sign)}` : '';
  return `${cleanDomain}${normalizedBaseUrl}${dirSegment}/${encodeURIComponent(fileName)}${signQuery}`;
}

function buildServiceSourcePath(baseUrl, sourcePath) {
  const normalizedBase = normalizeRemotePath(baseUrl || '/');
  const normalizedSource = normalizeRemotePath(sourcePath || '/');

  if (normalizedBase === '/' || normalizedBase === normalizedSource) {
    return normalizedSource;
  }

  if (normalizedSource === '/') {
    return normalizedBase;
  }

  return normalizeRemotePath(`${normalizedBase}/${normalizedSource}`);
}

function buildApiUrl(domain, pathname) {
  return `${domain.replace(/\/+$/, '')}${pathname}`;
}

function buildExtensionSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
  );
}

function hasExtension(fileName, extensionSet) {
  const extension = path.extname(fileName || '').replace('.', '').toLowerCase();
  return extensionSet.has(extension);
}

async function readJsonResponse(response) {
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.message || `请求失败：${response.status}`);
  }

  return payload;
}

function isMediaFile(fileName, extensionSet = buildExtensionSet(DEFAULT_DOWNLOAD_EXTENSIONS)) {
  return hasExtension(fileName, extensionSet);
}

function isSubtitleFile(fileName) {
  return hasExtension(fileName, buildExtensionSet(DEFAULT_SUBTITLE_EXTENSIONS));
}

function normalizeRemotePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function joinRemotePath(basePath, childName) {
  if (!basePath || basePath === '/') return `/${childName}`;
  return `${basePath.replace(/\/+$/, '')}/${childName}`;
}

function isSafePathPart(name) {
  return Boolean(name) && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

async function syncGeneratedFiles(localDir, remoteDir, overwriteExisting = false, details = []) {
  const files = await collectLocalFiles(localDir);
  const summary = {
    processedCount: 0,
    subtitleCount: 0,
    skippedCount: 0,
    failureCount: 0,
  };

  await fs.promises.mkdir(path.resolve(remoteDir), { recursive: true });

  for (const file of files) {
    const relativePath = path.relative(localDir, file);
    const targetFile = path.join(path.resolve(remoteDir), relativePath);
    await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });

    if (!overwriteExisting && fs.existsSync(targetFile)) {
      summary.skippedCount += 1;
      details.push(`${relativePath} 已存在，跳过同步`);
      continue;
    }

    await fs.promises.copyFile(file, targetFile);

    if (targetFile.endsWith('.strm')) {
      summary.processedCount += 1;
    } else if (isSubtitleFile(targetFile)) {
      summary.subtitleCount += 1;
    }
  }

  return summary;
}

async function collectLocalFiles(rootDir) {
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectLocalFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function deleteLocalFiles(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedTemp = path.resolve(os.tmpdir());

  if (
    !resolvedTarget.startsWith(`${resolvedTemp}${path.sep}`) ||
    !path.basename(resolvedTarget).startsWith('alist2strm-')
  ) {
    throw new Error(`拒绝删除非临时目录：${targetPath}`);
  }

  await fs.promises.rm(resolvedTarget, { recursive: true, force: true });
}

async function runWithConcurrency(items, concurrency, handler) {
  if (!items.length) return;
  let index = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      await handler(items[currentIndex]);
    }
  });

  await Promise.all(workers);
}

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrl(value) {
  return sanitizeText(value).replace(/\/+$/, '');
}

function normalizeBaseUrl(value) {
  const trimmed = sanitizeText(value) || '/';
  const normalized = trimmed.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}

function normalizeExtensions(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .join(',');
}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function clampFloat(value, min, max) {
  const parsed = Number.parseFloat(String(value));
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function safeParseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildConfigYaml() {
  const services = loadServices();
  const tasks = loadTasks();
  const lines = ['openlistServices:'];

  services.forEach((service) => {
    lines.push(`  - id: ${JSON.stringify(service.id)}`);
    lines.push(`    name: ${JSON.stringify(service.name)}`);
    lines.push(`    url: ${JSON.stringify(service.url)}`);
    lines.push(`    token: ${JSON.stringify(service.token)}`);
    lines.push(`    baseUrl: ${JSON.stringify(service.baseUrl)}`);
  });

  lines.push('', 'tasks:');
  tasks.forEach((task) => {
    const service = getServiceById(task.serviceId);
    const resolvedSourcePath = service
      ? buildServiceSourcePath(service.baseUrl, task.sourcePath)
      : task.sourcePath;
    lines.push(`  - id: ${JSON.stringify(task.id)}`);
    lines.push(`    name: ${JSON.stringify(task.name)}`);
    lines.push(`    serviceId: ${JSON.stringify(task.serviceId)}`);
    lines.push(`    sourcePath: ${JSON.stringify(resolvedSourcePath)}`);
    lines.push(`    targetPath: ${JSON.stringify(task.targetPath)}`);
    lines.push(`    cron: ${JSON.stringify(task.cron)}`);
    lines.push(`    maxConcurrency: ${task.maxConcurrency}`);
    lines.push(`    downloadExtensions: ${JSON.stringify(task.downloadExtensions)}`);
    lines.push(`    downloadSubtitles: ${task.downloadSubtitles}`);
    lines.push(`    requestDelaySeconds: ${task.requestDelaySeconds}`);
    lines.push(`    overwriteExisting: ${task.overwriteExisting}`);
    lines.push(`    notifyEnabled: ${task.notifyEnabled}`);
    lines.push(`    callbackUrl: ${JSON.stringify(task.callbackUrl)}`);
  });

  return lines.join('\n');
}

function buildBackupPayload() {
  return {
    version: '1.1.0',
    exportedAt: now(),
    services: loadServices().map((service) => ({
      id: service.id,
      name: service.name,
      url: service.url,
      token: service.token,
      baseUrl: service.baseUrl,
    })),
    tasks: loadTasks().map((task) => ({
      id: task.id,
      name: task.name,
      serviceId: task.serviceId,
      sourcePath: task.sourcePath,
      targetPath: task.targetPath,
      cron: task.cron,
      maxConcurrency: task.maxConcurrency,
      downloadExtensions: task.downloadExtensions,
      downloadSubtitles: task.downloadSubtitles,
      requestDelaySeconds: task.requestDelaySeconds,
      overwriteExisting: task.overwriteExisting,
      notifyEnabled: task.notifyEnabled,
      callbackUrl: task.callbackUrl,
    })),
  };
}

function restoreBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('备份文件格式无效。');
  }

  const services = Array.isArray(payload.services) ? payload.services : [];
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];

  const normalizedServices = services.map((service) => {
    const result = normalizeServicePayload(service);
    if (result.errors.length > 0) {
      throw new Error(`服务恢复失败：${result.errors.join(' ')}`);
    }
    return result.service;
  });

  const serviceIdMap = new Map();

  const tx = db.transaction(() => {
    stopAllScheduledTasks();
    db.prepare('DELETE FROM runs').run();
    db.prepare('DELETE FROM tasks').run();
    db.prepare('DELETE FROM services').run();

    for (const service of normalizedServices) {
      const newId = createServiceRecord(service);
      if (service.id) {
        serviceIdMap.set(String(service.id), newId);
      }
    }

    for (const task of tasks) {
      const mappedServiceId = serviceIdMap.get(String(task.serviceId));
      if (!mappedServiceId) {
        throw new Error(`任务 ${task.name || task.id || ''} 对应的服务不存在。`);
      }

      const result = normalizeTaskPayload({
        ...task,
        serviceId: mappedServiceId,
      });

      if (result.errors.length > 0) {
        throw new Error(`任务恢复失败：${result.errors.join(' ')}`);
      }

      createTaskRecord(result.task);
    }
  });

  tx();
  loadTasks().forEach(scheduleTask);

  return {
    restoredServices: normalizedServices.length,
    restoredTasks: tasks.length,
  };
}

function stopAllScheduledTasks() {
  Array.from(scheduledJobs.keys()).forEach((taskId) => {
    stopScheduledTask(taskId);
  });
}
