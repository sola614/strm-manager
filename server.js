import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import packageInfo from './package.json' with { type: 'json' };
import { createAuthContext } from './server/auth.js';
import { createAppConfigManager } from './server/config.js';
import { createDatabase, createSettingsStore, createTables } from './server/db.js';
import { createAuthRouter } from './server/routes/auth.routes.js';
import { createBackupRouter } from './server/routes/backup.routes.js';
import { createConfigRouter } from './server/routes/config.routes.js';
import { createFilesRouter } from './server/routes/files.routes.js';
import { createRunsRouter } from './server/routes/runs.routes.js';
import { createServicesRouter } from './server/routes/services.routes.js';
import { createTasksRouter } from './server/routes/tasks.routes.js';
import { createBackupService } from './server/services/backupService.js';
import { createFileManager } from './server/services/fileManager.js';
import { createMaintenanceService } from './server/services/maintenance.js';
import { createTaskRunner } from './server/services/taskRunner.js';
import { createRunStore } from './server/stores/runStore.js';
import { createServiceStore } from './server/stores/serviceStore.js';
import { createTaskStore } from './server/stores/taskStore.js';
import { formatError } from './server/utils/errors.js';
import { hashValue } from './server/utils/id.js';
import { clampInteger, parseBoolean, sanitizeText } from './server/utils/validators.js';
import { createRunEventHub } from './server/ws/runEvents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = __dirname;

const ENV_PORT = clampInteger(process.env.PORT || 4173, 1, 65535);
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin';
const RESET_ADMIN_PASSWORD = process.env.RESET_ADMIN_PASSWORD || '';
const ENV_DEFAULT_STRM_TARGET_PATH = sanitizeText(process.env.STRM_TARGET_PATH) || '/media/strm';
const DATABASE_PATH = resolveDatabasePath(
  process.env.DATABASE_PATH || path.join('data', 'database.sqlite'),
);
const DIST_PATH = path.join(PROJECT_ROOT, 'dist');
const MAX_RUN_HISTORY = 200;
const DEFAULT_DOWNLOAD_EXTENSIONS = 'mp4,mkv';
const DEFAULT_SUBTITLE_EXTENSIONS = 'srt,ass';
const DEFAULT_LOG_CLEANUP_ENABLED = true;
const DEFAULT_LOG_RETENTION_DAYS = 7;
const DEFAULT_TIMEZONE = 'Asia/Shanghai';

const app = express();
const server = http.createServer(app);
const db = createDatabase(DATABASE_PATH);
const { getSetting, setSetting } = createSettingsStore(db);
const activeRuns = new Set();
let runtimePort = ENV_PORT;
let taskRunner = null;

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
  onApply: () => taskRunner?.rescheduleTasks(),
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

const auth = createAuthContext({ getSetting, setSetting });
const {
  clearSession,
  issueSession,
  requireAuth,
  setAdminPassword,
  shouldForcePasswordChange,
  verifyPassword,
} = auth;

const runStore = createRunStore({
  db,
  maxRunHistory: MAX_RUN_HISTORY,
  getLogCleanupEnabled,
  getLogRetentionDays,
});
const {
  cleanupExpiredRuns,
  createRunRecord,
  deleteRunRecords,
  getRunById,
  loadRuns,
  loadRunsByTask,
  updateRunRecord,
} = runStore;

const runEvents = createRunEventHub({
  getSetting,
  getRunById,
  hashValue,
  sanitizeText,
});
const { broadcastRunSnapshot, handleWebSocketUpgrade } = runEvents;

const maintenance = createMaintenanceService({
  cleanupExpiredRuns,
  getConfiguredTimezone,
});
const { startMaintenanceJobs } = maintenance;

let serviceStore;
let taskStore;

taskRunner = createTaskRunner({
  activeRuns,
  defaultDownloadExtensions: DEFAULT_DOWNLOAD_EXTENSIONS,
  defaultSubtitleExtensions: DEFAULT_SUBTITLE_EXTENSIONS,
  formatError,
  getConfiguredTimezone,
  getServiceById: (id) => serviceStore.getServiceById(id),
  getServiceDisplayName,
  getTaskById: (id) => taskStore.getTaskById(id),
  loadTasks: (serviceId) => taskStore.loadTasks(serviceId),
  updateTaskLastRunAt: (...args) => taskStore.updateTaskLastRunAt(...args),
  createRunRecord,
  updateRunRecord,
  broadcastRunSnapshot,
  startMaintenanceJobs,
});
const {
  buildServiceSourcePath,
  scheduleTask,
  startTaskRun,
  stopAllScheduledTasks,
  stopScheduledTask,
} = taskRunner;

taskStore = createTaskStore({
  db,
  getServiceById: (id) => serviceStore.getServiceById(id),
  scheduleTask,
  stopScheduledTask,
  defaultDownloadExtensions: DEFAULT_DOWNLOAD_EXTENSIONS,
});
const {
  bulkUpdateTaskEnabled,
  createTaskRecord,
  disableTasksByServiceId,
  getTaskById,
  loadTasks,
  normalizeTaskPayload,
  removeTaskRecord,
  updateTaskRecord,
} = taskStore;

serviceStore = createServiceStore({
  db,
  loadTasks,
  scheduleTask,
  stopScheduledTask,
});
const {
  bulkUpdateServiceEnabled,
  createServiceRecord,
  getServiceById,
  loadServices,
  normalizeServicePayload,
  removeServiceRecord,
  updateServiceRecord,
} = serviceStore;

const fileManager = createFileManager({ loadTasks, formatError });
const {
  buildManagedFilesPayload,
  deleteManagedFileEntries,
  deleteManagedFileEntry,
  readManagedStrmFileContent,
} = fileManager;

const backupService = createBackupService({
  db,
  packageInfo,
  getConfiguredPort,
  getConfiguredStrmTargetPath,
  getLogCleanupEnabled,
  getLogRetentionDays,
  getConfiguredTimezone,
  normalizeAppConfigPayload,
  getAppConfigPayload,
  applyAppConfig,
  loadServices,
  loadTasks,
  getServiceById,
  normalizeServicePayload,
  createServiceRecord,
  normalizeTaskPayload,
  createTaskRecord,
  cleanupExpiredRuns,
  scheduleTask,
  stopAllScheduledTasks,
  buildServiceSourcePath,
});
const { buildBackupPayload, restoreBackupPayload } = backupService;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

app.use('/api/auth', createAuthRouter({
  defaultAdminUsername: DEFAULT_ADMIN_USERNAME,
  requireAuth,
  shouldForcePasswordChange,
  verifyPassword,
  setAdminPassword,
  issueSession,
  clearSession,
}));

app.use('/api/config', createConfigRouter({
  requireAuth,
  getAppConfigPayload,
  normalizeAppConfigPayload,
  applyAppConfig,
  cleanupExpiredRuns,
}));

app.use('/api/services', createServicesRouter({
  db,
  requireAuth,
  loadServices,
  getServiceById,
  normalizeServicePayload,
  createServiceRecord,
  updateServiceRecord,
  bulkUpdateServiceEnabled,
  disableTasksByServiceId,
  loadTasks,
  scheduleTask,
  removeServiceRecord,
  sanitizeText,
  parseBoolean,
  formatError,
}));

app.use('/api/tasks', createTasksRouter({
  requireAuth,
  loadTasks,
  normalizeTaskPayload,
  createTaskRecord,
  getTaskById,
  scheduleTask,
  bulkUpdateTaskEnabled,
  updateTaskRecord,
  stopScheduledTask,
  activeRuns,
  removeTaskRecord,
  startTaskRun,
  loadRunsByTask,
  sanitizeText,
  parseBoolean,
  formatError,
}));

app.use('/api/files', createFilesRouter({
  requireAuth,
  buildManagedFilesPayload,
  readManagedStrmFileContent,
  deleteManagedFileEntry,
  deleteManagedFileEntries,
  sanitizeText,
  formatError,
}));

app.use('/api/runs', createRunsRouter({
  requireAuth,
  loadRuns,
  deleteRunRecords,
  getRunById,
  sanitizeText,
  formatError,
}));

app.use('/api/backup', createBackupRouter({
  requireAuth,
  upload,
  buildBackupPayload,
  restoreBackupPayload,
  formatError,
}));

if (fs.existsSync(path.join(DIST_PATH, 'index.html'))) {
  app.use(express.static(DIST_PATH));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
}

server.on('upgrade', handleWebSocketUpgrade);

server.listen(runtimePort, () => {
  console.log(`Strm Manager listening on http://localhost:${runtimePort}`);
});

function resolveDatabasePath(databasePath) {
  return path.isAbsolute(databasePath) ? databasePath : path.join(PROJECT_ROOT, databasePath);
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

function getServiceDisplayName(service) {
  return service?.name || service?.url || String(service?.id || '');
}
