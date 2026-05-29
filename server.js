import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import multer from 'multer';
import packageInfo from './package.json' with { type: 'json' };
import { createAppConfigManager } from './server/config.js';
import { createDatabase, createSettingsStore, createTables } from './server/db.js';
import { formatError } from './server/utils/errors.js';
import { isSafePathPart, normalizeRemotePath } from './server/utils/paths.js';
import { delay, now } from './server/utils/time.js';
import {
  clampFloat,
  clampInteger,
  normalizeBaseUrl,
  normalizeExtensions,
  normalizeUrl,
  parseBoolean,
  safeParseJsonArray,
  sanitizeText,
} from './server/utils/validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV_PORT = clampInteger(process.env.PORT || 4173, 1, 65535);
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin';
const RESET_ADMIN_PASSWORD = process.env.RESET_ADMIN_PASSWORD || '';
const ENV_DEFAULT_STRM_TARGET_PATH = sanitizeText(process.env.STRM_TARGET_PATH) || '/media/strm';
const DATABASE_PATH = resolveDatabasePath(
  process.env.DATABASE_PATH || path.join('data', 'database.sqlite'),
);
const DIST_PATH = path.join(__dirname, 'dist');
const MAX_RUN_HISTORY = 200;
const DEFAULT_DOWNLOAD_EXTENSIONS = 'mp4,mkv';
const DEFAULT_SUBTITLE_EXTENSIONS = 'srt,ass';
const DEFAULT_LOG_CLEANUP_ENABLED = true;
const DEFAULT_LOG_RETENTION_DAYS = 7;
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const db = createDatabase(DATABASE_PATH);
const { getSetting, setSetting } = createSettingsStore(db);
const scheduledJobs = new Map();
const activeRuns = new Set();
let maintenanceJob = null;
let runtimePort = ENV_PORT;
const appConfig = createAppConfigManager({
  getSetting,
  setSetting,
  envPort: ENV_PORT,
  envDefaultStrmTargetPath: ENV_DEFAULT_STRM_TARGET_PATH,
  databasePath: DATABASE_PATH,
  resetAdminPassword: RESET_ADMIN_PASSWORD,
  defaultLogCleanupEnabled: DEFAULT_LOG_CLEANUP_ENABLED,
  defaultLogRetentionDays: DEFAULT_LOG_RETENTION_DAYS,
  defaultTimezone: DEFAULT_TIMEZONE,
  getRuntimePort: () => runtimePort,
  onApply: () => rescheduleTasks(),
});
const {
  applyAppConfig,
  ensureAppSettings,
  getAppConfigPayload,
  getConfiguredPort,
  getConfiguredStrmTargetPath,
  getConfiguredTimezone,
  getLogCleanupEnabled,
  getLogRetentionDays,
  normalizeAppConfigPayload,
} = appConfig;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

createTables(db);
initializeSettings();
runtimePort = getConfiguredPort();
startMaintenanceJobs();
loadTasks().forEach(scheduleTask);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    databasePath: DATABASE_PATH,
    runningTasks: Array.from(activeRuns),
  });
});

app.get('/api/auth/setup-required', (_req, res) => {
  res.json({
    required: shouldForcePasswordChange(),
  });
});

app.post('/api/auth/setup-password', (req, res) => {
  if (!shouldForcePasswordChange()) {
    return res.status(409).json({
      code: 'SETUP_NOT_REQUIRED',
      error: '当前不需要设置管理员密码。',
    });
  }

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
  res.json(getAppConfigPayload());
});

app.put('/api/config', requireAuth(), (req, res) => {
  const { config, errors } = normalizeAppConfigPayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({
      code: 'INVALID_CONFIG',
      error: errors.join(' '),
    });
  }

  applyAppConfig(config);
  if (config.logCleanupEnabled) {
    cleanupExpiredRuns();
  }

  res.json(getAppConfigPayload());
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

app.post('/api/services/bulk-enabled', requireAuth(), (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? Array.from(new Set(req.body.ids.map((id) => sanitizeText(id)).filter(Boolean)))
    : [];
  const enabled = parseBoolean(req.body?.enabled);

  if (!ids.length) {
    return res.status(400).json({
      code: 'INVALID_SERVICE_IDS',
      error: '请选择至少一个 OpenList 服务。',
    });
  }

  try {
    const result = bulkUpdateServiceEnabled(ids, enabled);
    res.json(result);
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    res.status(status).json({
      code: error?.code || 'SERVICE_BULK_UPDATE_FAILED',
      error: formatError(error),
    });
  }
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
  if (!service.enabled) {
    disableTasksByServiceId(req.params.id);
  }
  loadTasks(req.params.id).forEach(scheduleTask);
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

app.post('/api/tasks/bulk-enabled', requireAuth(), (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? Array.from(new Set(req.body.ids.map((id) => sanitizeText(id)).filter(Boolean)))
    : [];
  const enabled = parseBoolean(req.body?.enabled);

  if (!ids.length) {
    return res.status(400).json({
      code: 'INVALID_TASK_IDS',
      error: '请选择至少一个定时任务。',
    });
  }

  try {
    const result = bulkUpdateTaskEnabled(ids, enabled);
    res.json(result);
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    res.status(status).json({
      code: error?.code || 'TASK_BULK_UPDATE_FAILED',
      error: formatError(error),
    });
  }
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

app.get('/api/files', requireAuth(), async (req, res) => {
  try {
    const rootId = sanitizeText(req.query.rootId);
    const directory = sanitizeText(req.query.directory);
    res.json(await buildManagedFilesPayload(rootId, directory));
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    res.status(status).json({
      code: error?.code || 'FILES_LOAD_FAILED',
      error: formatError(error),
    });
  }
});

app.get('/api/files/content', requireAuth(), async (req, res) => {
  try {
    const rootId = sanitizeText(req.query.rootId);
    const relativePath = sanitizeText(req.query.relativePath);
    res.json(await readManagedStrmFileContent(rootId, relativePath));
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    res.status(status).json({
      code: error?.code || 'FILE_CONTENT_LOAD_FAILED',
      error: formatError(error),
    });
  }
});

app.delete('/api/files', requireAuth(), async (req, res) => {
  try {
    const rootId = sanitizeText(req.body?.rootId);
    const relativePath = sanitizeText(req.body?.relativePath);
    await deleteManagedFileEntry(rootId, relativePath);
    res.status(204).end();
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    res.status(status).json({
      code: error?.code || 'FILE_DELETE_FAILED',
      error: formatError(error),
    });
  }
});

app.post('/api/files/bulk-delete', requireAuth(), async (req, res) => {
  try {
    const rootId = sanitizeText(req.body?.rootId);
    const relativePaths = Array.isArray(req.body?.relativePaths)
      ? Array.from(new Set(req.body.relativePaths.map((item) => sanitizeText(item)).filter(Boolean)))
      : [];

    const deletedCount = await deleteManagedFileEntries(rootId, relativePaths);
    res.json({ deletedCount });
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    res.status(status).json({
      code: error?.code || 'FILES_BULK_DELETE_FAILED',
      error: formatError(error),
    });
  }
});

app.get('/api/runs', requireAuth(), (_req, res) => {
  res.json(loadRuns());
});

app.post('/api/runs/bulk-delete', requireAuth(), (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? Array.from(new Set(req.body.ids.map((id) => sanitizeText(id)).filter(Boolean)))
    : [];

  if (!ids.length) {
    return res.status(400).json({
      code: 'INVALID_RUN_IDS',
      error: '请选择至少一条运行记录。',
    });
  }

  try {
    const deletedCount = deleteRunRecords(ids);
    res.json({ deletedCount });
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 400;
    res.status(status).json({
      code: error?.code || 'RUN_DELETE_FAILED',
      error: formatError(error),
    });
  }
});

app.get('/api/runs/:id', requireAuth(), (req, res) => {
  const run = getRunById(req.params.id);
  if (!run) {
    return res.status(404).json({
      code: 'RUN_NOT_FOUND',
      error: '运行记录不存在。',
    });
  }

  res.json(run);
});

app.delete('/api/runs/:id', requireAuth(), (req, res) => {
  const run = getRunById(req.params.id);
  if (!run) {
    return res.status(404).json({
      code: 'RUN_NOT_FOUND',
      error: '运行记录不存在。',
    });
  }

  if (run.status === 'running') {
    return res.status(409).json({
      code: 'RUN_STILL_RUNNING',
      error: '运行中的记录暂不支持删除，请等待任务完成后再试。',
    });
  }

  deleteRunRecords([req.params.id]);
  res.status(204).end();
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

app.listen(runtimePort, () => {
  console.log(`Strm Manager listening on http://localhost:${runtimePort}`);
});

function resolveDatabasePath(databasePath) {
  return path.isAbsolute(databasePath) ? databasePath : path.join(__dirname, databasePath);
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

  ensureAppSettings();
  applyAppConfig(getAppConfigPayload());
}

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
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
        error: '管理员密码需要先设置后才能继续使用。',
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
    enabled: Boolean(row.enabled),
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
    enabled: Boolean(row.enabled),
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
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createServiceRecord(service) {
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO services (name, url, token, base_url, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(service.name, service.url, service.token, service.baseUrl, service.enabled ? 1 : 0, timestamp, timestamp);
  return String(result.lastInsertRowid);
}

function updateServiceRecord(id, service) {
  db.prepare(`
    UPDATE services
    SET name = ?, url = ?, token = ?, base_url = ?, enabled = ?, updated_at = ?
    WHERE id = ?
  `).run(service.name, service.url, service.token, service.baseUrl, service.enabled ? 1 : 0, now(), id);
}

function bulkUpdateServiceEnabled(ids, enabled) {
  const services = ids.map((id) => getServiceById(id)).filter(Boolean);
  if (!services.length) {
    const error = new Error('请选择至少一个存在的 OpenList 服务。');
    error.status = 400;
    error.code = 'SERVICE_BULK_UPDATE_EMPTY';
    throw error;
  }

  const timestamp = now();
  const update = db.prepare('UPDATE services SET enabled = ?, updated_at = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const service of services) {
      update.run(enabled ? 1 : 0, timestamp, service.id);
      if (!enabled) {
        db.prepare('UPDATE tasks SET enabled = 0, updated_at = ? WHERE service_id = ?').run(timestamp, service.id);
      }
    }
  });
  tx();

  services.forEach((service) => {
    if (!enabled) {
      loadTasks(service.id).forEach((task) => stopScheduledTask(task.id));
      return;
    }
    loadTasks(service.id).forEach(scheduleTask);
  });

  return {
    updatedCount: services.length,
    skippedCount: ids.length - services.length,
  };
}

function removeServiceRecord(id) {
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
}

function findDuplicateServiceUrl(url, excludeId = null) {
  if (!url) return null;
  const row = excludeId
    ? db.prepare('SELECT id FROM services WHERE url = ? AND id != ?').get(url, excludeId)
    : db.prepare('SELECT id FROM services WHERE url = ?').get(url);
  return row ? String(row.id) : null;
}

function normalizeServicePayload(input, existing = null) {
  const name = sanitizeText(input?.name ?? existing?.name ?? '');
  const url = normalizeUrl(input?.url ?? existing?.url ?? '');
  const token = sanitizeText(input?.token ?? existing?.token ?? '');
  const baseUrl = normalizeBaseUrl(input?.baseUrl ?? input?.base_url ?? existing?.baseUrl ?? '/');
  const enabled = parseBoolean(input?.enabled ?? existing?.enabled ?? true);
  const errors = [];

  if (!url) errors.push('服务 URL 不能为空。');
  if (!token) errors.push('服务 Token 不能为空。');

  if (url) {
    try {
      new URL(url);
    } catch {
      errors.push('服务 URL 不合法。');
    }
  }

  if (url && findDuplicateServiceUrl(url, existing?.id || null)) {
    errors.push('服务 URL 已存在，请勿重复配置。');
  }

  return {
    errors,
    service: { name, url, token, baseUrl, enabled },
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

async function buildManagedFilesPayload(rootId = '', directory = '') {
  const roots = await loadManagedFileRoots();
  const selectedRoot = resolveManagedFileRoot(roots, rootId);
  const normalizedDirectory = normalizeManagedDirectory(directory);
  const parentDirectory = normalizedDirectory ? getParentManagedDirectory(normalizedDirectory) : null;

  let entries = [];
  if (selectedRoot?.exists) {
    entries = await listManagedDirectoryEntries(selectedRoot, normalizedDirectory);
  }

  return {
    roots,
    currentRootId: selectedRoot?.id || null,
    currentDirectory: normalizedDirectory,
    parentDirectory,
    entries,
  };
}

async function loadManagedFileRoots() {
  const tasks = loadTasks();
  const groupedRoots = new Map();

  for (const task of tasks) {
    const targetPath = sanitizeText(task.targetPath);
    if (!targetPath) continue;

    const resolvedPath = path.resolve(targetPath);
    if (!groupedRoots.has(resolvedPath)) {
      groupedRoots.set(resolvedPath, {
        id: hashValue(`managed-root:${resolvedPath}`),
        targetPath,
        configuredPaths: [],
        resolvedPath,
        taskIds: [],
        taskNames: [],
        exists: false,
        error: '',
      });
    }

    const root = groupedRoots.get(resolvedPath);
    if (!root.configuredPaths.includes(targetPath)) {
      root.configuredPaths.push(targetPath);
    }
    if (!root.taskIds.includes(task.id)) {
      root.taskIds.push(task.id);
    }
    if (!root.taskNames.includes(task.name)) {
      root.taskNames.push(task.name);
    }
  }

  const roots = Array.from(groupedRoots.values()).sort((left, right) =>
    left.targetPath.localeCompare(right.targetPath, 'zh-CN'),
  );

  await Promise.all(
    roots.map(async (root) => {
      try {
        const stat = await fs.promises.stat(root.resolvedPath);
        if (!stat.isDirectory()) {
          root.exists = false;
          root.error = '目标路径不是文件夹。';
          return;
        }

        root.exists = true;
      } catch (error) {
        root.exists = false;
        root.error = error?.code === 'ENOENT' ? '目录不存在。' : formatError(error);
      }
    }),
  );

  return roots;
}

function resolveManagedFileRoot(roots, rootId) {
  if (!roots.length) return null;
  if (rootId) {
    const matchedRoot = roots.find((root) => root.id === rootId);
    if (!matchedRoot) {
      const error = new Error('目标目录不存在。');
      error.status = 404;
      error.code = 'FILE_ROOT_NOT_FOUND';
      throw error;
    }
    return matchedRoot;
  }
  return roots[0];
}

async function listManagedDirectoryEntries(root, directory) {
  const absoluteDirectoryPath = resolveManagedFileAbsolutePath(root, directory);
  const stat = await fs.promises.stat(absoluteDirectoryPath);
  if (!stat.isDirectory()) {
    const error = new Error('当前路径不是文件夹。');
    error.status = 400;
    error.code = 'FILE_DIRECTORY_INVALID';
    throw error;
  }

  const entries = [];
  const dirents = await fs.promises.readdir(absoluteDirectoryPath, {
    withFileTypes: true,
  });

  dirents.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN');
  });

  for (const dirent of dirents) {
    if (!isSafePathPart(dirent.name)) continue;

    const childRelativePath = directory ? path.posix.join(directory, dirent.name) : dirent.name;
    const absolutePath = resolveManagedFileAbsolutePath(root, childRelativePath);
    const childStat = await fs.promises.stat(absolutePath);
    const normalizedRelativePath = childRelativePath.replace(/\\/g, '/');

    entries.push({
      id: hashValue(`${root.id}:${normalizedRelativePath}:${dirent.isDirectory() ? 'd' : 'f'}`),
      rootId: root.id,
      targetPath: root.targetPath,
      resolvedRootPath: root.resolvedPath,
      relativePath: normalizedRelativePath,
      name: dirent.name,
      type: dirent.isDirectory() ? 'directory' : 'file',
      size: dirent.isDirectory() ? 0 : childStat.size,
      updatedAt: childStat.mtime ? childStat.mtime.toISOString() : null,
    });
  }

  return entries;
}

function normalizeManagedDirectory(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  if (normalized.some((part) => part === '.' || part === '..')) {
    const error = new Error('目录路径不合法。');
    error.status = 400;
    error.code = 'FILE_DIRECTORY_INVALID';
    throw error;
  }

  return normalized.join('/');
}

function getParentManagedDirectory(directory) {
  if (!directory) return null;
  const parts = directory.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function resolveManagedFileAbsolutePath(root, relativePath) {
  const normalizedRelativePath = normalizeManagedDirectory(relativePath);
  const absolutePath = path.resolve(root.resolvedPath, normalizedRelativePath || '.');
  const relativeToRoot = path.relative(root.resolvedPath, absolutePath);

  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    const error = new Error('文件路径越界。');
    error.status = 400;
    error.code = 'FILE_PATH_OUT_OF_ROOT';
    throw error;
  }

  return absolutePath;
}

async function deleteManagedFileEntry(rootId, relativePath) {
  const roots = await loadManagedFileRoots();
  const root = resolveManagedFileRoot(roots, rootId);
  const normalizedRelativePath = normalizeManagedDirectory(relativePath);

  if (!normalizedRelativePath) {
    const error = new Error('不能删除根目录。');
    error.status = 400;
    error.code = 'FILE_DELETE_ROOT_FORBIDDEN';
    throw error;
  }

  const absolutePath = resolveManagedFileAbsolutePath(root, normalizedRelativePath);
  await fs.promises.rm(absolutePath, { recursive: true, force: false });
}

async function deleteManagedFileEntries(rootId, relativePaths) {
  if (!relativePaths.length) {
    const error = new Error('请至少选择一项。');
    error.status = 400;
    error.code = 'FILE_DELETE_EMPTY';
    throw error;
  }

  for (const relativePath of relativePaths) {
    await deleteManagedFileEntry(rootId, relativePath);
  }

  return relativePaths.length;
}

async function readManagedStrmFileContent(rootId, relativePath) {
  const roots = await loadManagedFileRoots();
  const root = resolveManagedFileRoot(roots, rootId);
  const normalizedRelativePath = normalizeManagedDirectory(relativePath);

  if (!normalizedRelativePath || path.extname(normalizedRelativePath).toLowerCase() !== '.strm') {
    const error = new Error('仅支持查看 .strm 文件内容。');
    error.status = 400;
    error.code = 'FILE_CONTENT_UNSUPPORTED';
    throw error;
  }

  const absolutePath = resolveManagedFileAbsolutePath(root, normalizedRelativePath);
  const stat = await fs.promises.stat(absolutePath);
  if (!stat.isFile()) {
    const error = new Error('目标不是文件。');
    error.status = 400;
    error.code = 'FILE_CONTENT_NOT_FILE';
    throw error;
  }

  if (stat.size > 1024 * 1024) {
    const error = new Error('文件过大，暂不支持在线查看。');
    error.status = 413;
    error.code = 'FILE_CONTENT_TOO_LARGE';
    throw error;
  }

  return {
    name: path.basename(normalizedRelativePath),
    relativePath: normalizedRelativePath,
    content: await fs.promises.readFile(absolutePath, 'utf8'),
    updatedAt: stat.mtime ? stat.mtime.toISOString() : null,
  };
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
  if (findDuplicateTask(serviceId, sourcePath, targetPath, existing?.id || null)) {
    errors.push('相同服务、源地址和目标地址的任务已存在，请勿重复配置。');
  }

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
      enabled,
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
  return db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(MAX_RUN_HISTORY).map(mapRunRow);
}

function loadRunsByTask(taskId) {
  return db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 20').all(taskId).map(mapRunRow);
}

function getRunById(id) {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  return row ? mapRunRow(row) : null;
}

function listRunsByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM runs WHERE id IN (${placeholders})`).all(...ids).map(mapRunRow);
}

function deleteRunRecords(ids) {
  const targetIds = Array.from(new Set(ids.map((id) => sanitizeText(id)).filter(Boolean)));
  if (!targetIds.length) return 0;

  const existingRuns = listRunsByIds(targetIds);
  if (existingRuns.some((run) => run.status === 'running')) {
    const error = new Error('运行中的记录暂不支持删除，请等待任务完成后再试。');
    error.status = 409;
    error.code = 'RUN_STILL_RUNNING';
    throw error;
  }

  const placeholders = targetIds.map(() => '?').join(', ');
  const result = db.prepare(`DELETE FROM runs WHERE id IN (${placeholders})`).run(...targetIds);
  return Number(result.changes || 0);
}

function pruneRuns() {
  db.prepare(`
    DELETE FROM runs
    WHERE id NOT IN (
      SELECT id FROM runs ORDER BY started_at DESC LIMIT ?
    )
  `).run(MAX_RUN_HISTORY);
}

function cleanupExpiredRuns() {
  if (!getLogCleanupEnabled()) {
    return 0;
  }

  const retentionDays = getLogRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    DELETE FROM runs
    WHERE status != 'running'
      AND COALESCE(completed_at, started_at) < ?
  `).run(cutoff);

  return Number(result.changes || 0);
}

function startMaintenanceJobs() {
  cleanupExpiredRuns();
  if (maintenanceJob) {
    maintenanceJob.stop();
  }

  maintenanceJob = cron.schedule('0 15 3 * * *', () => {
    try {
      cleanupExpiredRuns();
    } catch (error) {
      console.error('Failed to cleanup expired runs:', error);
    }
  }, getCronOptions());
}

function scheduleTask(task) {
  stopScheduledTask(task.id);
  if (!task.enabled || !task.cron || !cron.validate(task.cron)) return;
  const service = getServiceById(task.serviceId);
  if (!service?.enabled) return;

  const job = cron.schedule(task.cron, () => {
    startTaskRun(task.id, 'schedule').catch((error) => {
      console.error(`Scheduled task ${task.id} failed:`, error);
    });
  }, getCronOptions());

  scheduledJobs.set(task.id, job);
}

function getCronOptions() {
  return {
    timezone: getConfiguredTimezone(),
  };
}

function rescheduleTasks() {
  loadTasks().forEach(scheduleTask);
  startMaintenanceJobs();
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

  if (task.cron && !task.enabled) {
    if (triggerType === 'schedule') {
      return null;
    }

    const error = new Error('定时任务已禁用，请启用后再执行。');
    error.status = 409;
    error.code = 'TASK_DISABLED';
    throw error;
  }

  const service = getServiceById(task.serviceId);
  if (!service) {
    const error = new Error('任务对应的 OpenList 服务不存在。');
    error.status = 409;
    error.code = 'TASK_SERVICE_MISSING';
    throw error;
  }

  if (!service.enabled) {
    if (triggerType === 'schedule') {
      return null;
    }

    const error = new Error('任务所属服务已禁用，请启用服务后再执行。');
    error.status = 409;
    error.code = 'TASK_SERVICE_DISABLED';
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
    serviceName: getServiceDisplayName(service),
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
    serviceName: getServiceDisplayName(service),
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
  const fullSourcePath = buildServiceSourcePath(service.baseUrl, task.sourcePath);
  const details = [];
  const downloadExtensionSet = buildExtensionSet(task.downloadExtensions);
  const summary = {
    processedCount: 0,
    subtitleCount: 0,
    skippedCount: 0,
    failureCount: 0,
  };
  const progress = createRunProgress(run.id, details, summary);

  try {
    await fs.promises.mkdir(path.resolve(task.targetPath), { recursive: true });

    if (isMediaFile(fullSourcePath, downloadExtensionSet)) {
      await getFileInfo({ service, filePath: fullSourcePath, pathPrefix: '', progress, task, downloadExtensionSet });
    } else {
      await handleGetList({ service, dirPath: fullSourcePath, pathPrefix: '', progress, task, downloadExtensionSet });
    }

    const completedAt = now();

    if (task.notifyEnabled && task.callbackUrl && (summary.processedCount > 0 || summary.subtitleCount > 0)) {
      await triggerCallback(task.callbackUrl, {
        taskId: task.id,
        taskName: task.name,
        processedCount: summary.processedCount,
        subtitleCount: summary.subtitleCount,
        details,
        finishedAt: completedAt,
      });
      details.push(`回调通知已发送到 ${task.callbackUrl}`);
    }

    progress.flush();
    updateRunRecord(run.id, {
      completed_at: completedAt,
      status: summary.failureCount > 0 ? 'error' : 'success',
      message:
        summary.failureCount > 0
          ? `任务执行完成，但有 ${summary.failureCount} 个文件处理失败。`
          : `任务执行完成，生成 ${summary.processedCount} 个 STRM 文件，字幕 ${summary.subtitleCount} 个。`,
      details: JSON.stringify(details.slice(0, 300)),
      processed_count: summary.processedCount,
      subtitle_count: summary.subtitleCount,
      skipped_count: summary.skippedCount,
      failure_count: summary.failureCount,
    });

    updateTaskLastRunAt(task.id, completedAt);
  } catch (error) {
    progress.flush();
    updateRunRecord(run.id, {
      completed_at: now(),
      status: 'error',
      message: formatError(error),
      details: JSON.stringify(details.slice(0, 300)),
      processed_count: summary.processedCount,
      subtitle_count: summary.subtitleCount,
      skipped_count: summary.skippedCount,
      failure_count: 1,
    });
  }
}

function createRunProgress(runId, details, summary) {
  let timer = null;

  const write = () => {
    updateRunRecord(runId, {
      details: JSON.stringify(details.slice(0, 300)),
      processed_count: summary.processedCount,
      subtitle_count: summary.subtitleCount,
      skipped_count: summary.skippedCount,
      failure_count: summary.failureCount,
    });
  };

  return {
    details,
    summary,
    changed() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        write();
      }, 300);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      write();
    },
  };
}

async function getFileInfo({ service, filePath, pathPrefix, progress, task, downloadExtensionSet }) {
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
    pathPrefix,
    progress,
    task,
    downloadExtensionSet,
  });
}

async function handleGetList({ service, dirPath, pathPrefix = '', progress, task, downloadExtensionSet }) {
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
          progress,
          task,
          downloadExtensionSet,
        });
        return;
      }

      await saveRemoteItem({
        service,
        item,
        currentPath: dirPath,
        pathPrefix,
        progress,
        task,
        downloadExtensionSet,
      });
    });

    const total = Number(payload.data?.total || 0);
    if (files.length < perPage || page * perPage >= total) break;
    page += 1;
  }
}

async function saveRemoteItem({ service, item, currentPath, pathPrefix, progress, task, downloadExtensionSet }) {
  if (!item?.name || !isSafePathPart(item.name)) return;
  const saveDir = path.join(path.resolve(task.targetPath), pathPrefix);
  await fs.promises.mkdir(saveDir, { recursive: true });

  const fileName = item.name;
  const sign = item.sign || '';
  const streamUrl = buildDownloadUrl({
    domain: service.url,
    sourcePath: currentPath,
    fileName,
    sign,
  });

  if (task.requestDelaySeconds > 0) {
    await delay(task.requestDelaySeconds * 1000);
  }

  if (isSubtitleFile(fileName) && task.downloadSubtitles) {
    const subtitlePath = path.join(saveDir, fileName);

    const response = await fetch(streamUrl);
    if (!response.ok) {
      throw new Error(`字幕下载失败：${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const written = await writeOutputFile(
      subtitlePath,
      Buffer.from(arrayBuffer),
      task.overwriteExisting,
    );

    if (!written) {
      progress.summary.skippedCount += 1;
      progress.details.push(`${fileName} 字幕已存在，跳过下载`);
      progress.changed();
      return;
    }

    progress.summary.subtitleCount += 1;
    progress.details.push(`${fileName} 字幕下载成功`);
    progress.changed();
    return;
  }

  if (!isMediaFile(fileName, downloadExtensionSet)) return;

  const savePath = path.join(saveDir, fileName.replace(/\.[^.]+$/i, '.strm'));
  const written = await writeOutputFile(savePath, streamUrl, task.overwriteExisting, 'utf8');
  if (!written) {
    progress.summary.skippedCount += 1;
    progress.details.push(`${path.basename(savePath)} 已存在，跳过创建`);
    progress.changed();
    return;
  }

  progress.summary.processedCount += 1;
  progress.details.push(`${path.basename(savePath)} 创建成功`);
  progress.changed();
}

async function writeOutputFile(filePath, content, overwriteExisting, encoding = undefined) {
  try {
    await fs.promises.writeFile(filePath, content, {
      encoding,
      flag: overwriteExisting ? 'w' : 'wx',
    });
    return true;
  } catch (error) {
    if (!overwriteExisting && error?.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
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

function buildDownloadUrl({ domain, sourcePath, fileName, sign }) {
  const parts = normalizeRemotePath(sourcePath)
    .split('/')
    .filter(Boolean);

  if (parts.length > 0 && parts[parts.length - 1] === fileName) {
    parts.pop();
  }

  const encodedDir = parts.map((part) => encodeURIComponent(part)).join('/');
  const cleanDomain = domain.replace(/\/+$/, '');
  const dirSegment = encodedDir ? `/${encodedDir}` : '';
  const signQuery = sign ? `?sign=${encodeURIComponent(sign)}` : '';
  return `${cleanDomain}/d${dirSegment}/${encodeURIComponent(fileName)}${signQuery}`;
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

function getServiceDisplayName(service) {
  return service?.name || service?.url || String(service?.id || '');
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

function joinRemotePath(basePath, childName) {
  if (!basePath || basePath === '/') return `/${childName}`;
  return `${basePath.replace(/\/+$/, '')}/${childName}`;
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
    lines.push(`    enabled: ${service.enabled}`);
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
    lines.push(`    enabled: ${task.enabled}`);
    lines.push(`    notifyEnabled: ${task.notifyEnabled}`);
    lines.push(`    callbackUrl: ${JSON.stringify(task.callbackUrl)}`);
  });

  return lines.join('\n');
}

function buildBackupPayload() {
  return {
    version: packageInfo.version,
    exportedAt: now(),
    appConfig: {
      port: getConfiguredPort(),
      defaultStrmTargetPath: getConfiguredStrmTargetPath(),
      logCleanupEnabled: getLogCleanupEnabled(),
      logRetentionDays: getLogRetentionDays(),
      timezone: getConfiguredTimezone(),
    },
    services: loadServices().map((service) => ({
      id: service.id,
      name: service.name,
      url: service.url,
      token: service.token,
      baseUrl: service.baseUrl,
      enabled: service.enabled,
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
      enabled: task.enabled,
      notifyEnabled: task.notifyEnabled,
      callbackUrl: task.callbackUrl,
    })),
  };
}

function restoreBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('备份文件格式无效。');
  }

  const appConfig = payload.appConfig ? normalizeAppConfigPayload(payload.appConfig, getAppConfigPayload()) : null;
  const services = Array.isArray(payload.services) ? payload.services : [];
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];

  if (appConfig?.errors?.length) {
    throw new Error(`系统配置恢复失败：${appConfig.errors.join(' ')}`);
  }

  const normalizedServices = services.map((service) => {
    const result = normalizeServicePayload(service);
    if (result.errors.length > 0) {
      throw new Error(`服务恢复失败：${result.errors.join(' ')}`);
    }
    return {
      originalId: service?.id,
      service: result.service,
    };
  });

  const serviceIdMap = new Map();
  const serviceUrlMap = new Map();

  const tx = db.transaction(() => {
    stopAllScheduledTasks();
    db.prepare('DELETE FROM runs').run();
    db.prepare('DELETE FROM tasks').run();
    db.prepare('DELETE FROM services').run();

    if (appConfig?.config) {
      applyAppConfig(appConfig.config);
    }

    for (const item of normalizedServices) {
      const newId = createServiceRecord(item.service);
      if (item.originalId) {
        serviceIdMap.set(String(item.originalId), newId);
      }
      if (item.service.url) {
        serviceUrlMap.set(item.service.url, newId);
      }
    }

    for (const task of tasks) {
      let mappedServiceId = serviceIdMap.get(String(task.serviceId));
      if (!mappedServiceId && services.length === 1) {
        mappedServiceId = serviceUrlMap.get(normalizedServices[0]?.service.url);
      }
      if (!mappedServiceId) {
        const knownServiceIds = Array.from(serviceIdMap.keys()).join(', ') || '无';
        throw new Error(
          `任务 ${task.name || task.id || ''} 对应的服务不存在。任务 serviceId=${String(task.serviceId)}，备份服务 ID=${knownServiceIds}`,
        );
      }

      const result = normalizeTaskPayload({
        ...task,
        serviceId: mappedServiceId,
      }, null, { allowDisabledService: true });

      if (result.errors.length > 0) {
        throw new Error(`任务恢复失败：${result.errors.join(' ')}`);
      }

      createTaskRecord(result.task);
    }
  });

  tx();
  cleanupExpiredRuns();
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
