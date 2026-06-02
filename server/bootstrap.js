import express from 'express';
import cors from 'cors';
import http from 'node:http';
import multer from 'multer';
import packageInfo from '../package.json' with { type: 'json' };
import { createAuthContext } from './auth.js';
import { createAppConfigManager } from './config.js';
import { createDatabase, createSettingsStore, createTables } from './db.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_DOWNLOAD_EXTENSIONS,
  DEFAULT_LOG_CLEANUP_ENABLED,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_SUBTITLE_EXTENSIONS,
  DEFAULT_TIMEZONE,
  ENV_DEFAULT_STRM_TARGET_PATH,
  ENV_PORT,
  MAX_RUN_HISTORY,
  RESET_ADMIN_PASSWORD,
  resolveProjectPaths,
} from './constants.js';
import { mountApiRoutes } from './routes/index.js';
import { createBackupService } from './services/backupService.js';
import { createFileManager } from './services/fileManager.js';
import { createMaintenanceService } from './services/maintenance.js';
import { createTaskRunner } from './services/taskRunner.js';
import { mountStaticFiles } from './static.js';
import { createRunStore } from './stores/runStore.js';
import { createServiceStore } from './stores/serviceStore.js';
import { createTaskStore } from './stores/taskStore.js';
import { formatError } from './utils/errors.js';
import { hashValue } from './utils/id.js';
import { parseBoolean, sanitizeText } from './utils/validators.js';
import { createRunEventHub } from './ws/runEvents.js';

export function createServer(projectRoot) {
  const { databasePath, distPath } = resolveProjectPaths(projectRoot);
  const app = express();
  const server = http.createServer(app);
  const db = createDatabase(databasePath);
  const { getSetting, setSetting } = createSettingsStore(db);
  createTables(db);
  const activeRuns = new Set();
  let runtimePort = ENV_PORT;
  let taskRunner = null;

  const appConfig = createAppConfigManager({
    getSetting,
    setSetting,
    envPort: ENV_PORT,
    envDefaultStrmTargetPath: ENV_DEFAULT_STRM_TARGET_PATH,
    databasePath,
    resetAdminPassword: RESET_ADMIN_PASSWORD,
    defaultLogCleanupEnabled: DEFAULT_LOG_CLEANUP_ENABLED,
    defaultLogRetentionDays: DEFAULT_LOG_RETENTION_DAYS,
    defaultTimezone: DEFAULT_TIMEZONE,
    getRuntimePort: () => runtimePort,
    onApply: () => taskRunner?.rescheduleTasks(),
  });

  const auth = createAuthContext({ getSetting, setSetting });
  const runStore = createRunStore({
    db,
    maxRunHistory: MAX_RUN_HISTORY,
    getLogCleanupEnabled: appConfig.getLogCleanupEnabled,
    getLogRetentionDays: appConfig.getLogRetentionDays,
  });
  const runEvents = createRunEventHub({
    getSetting,
    getRunById: runStore.getRunById,
    hashValue,
    sanitizeText,
  });
  const maintenance = createMaintenanceService({
    cleanupExpiredRuns: runStore.cleanupExpiredRuns,
    getConfiguredTimezone: appConfig.getConfiguredTimezone,
  });

  let serviceStore;
  let taskStore;
  taskRunner = createTaskRunner({
    activeRuns,
    defaultDownloadExtensions: DEFAULT_DOWNLOAD_EXTENSIONS,
    defaultSubtitleExtensions: DEFAULT_SUBTITLE_EXTENSIONS,
    formatError,
    getConfiguredTimezone: appConfig.getConfiguredTimezone,
    getServiceById: (id) => serviceStore.getServiceById(id),
    getServiceDisplayName,
    getTaskById: (id) => taskStore.getTaskById(id),
    loadTasks: (serviceId) => taskStore.loadTasks(serviceId),
    updateTaskLastRunAt: (...args) => taskStore.updateTaskLastRunAt(...args),
    createRunRecord: runStore.createRunRecord,
    updateRunRecord: runStore.updateRunRecord,
    appendRunLog: runStore.appendRunLog,
    broadcastRunSnapshot: runEvents.broadcastRunSnapshot,
    broadcastRunPatch: runEvents.broadcastRunPatch,
    startMaintenanceJobs: maintenance.startMaintenanceJobs,
  });

  taskStore = createTaskStore({
    db,
    getServiceById: (id) => serviceStore.getServiceById(id),
    scheduleTask: taskRunner.scheduleTask,
    stopScheduledTask: taskRunner.stopScheduledTask,
    defaultDownloadExtensions: DEFAULT_DOWNLOAD_EXTENSIONS,
  });
  serviceStore = createServiceStore({
    db,
    loadTasks: taskStore.loadTasks,
    scheduleTask: taskRunner.scheduleTask,
    stopScheduledTask: taskRunner.stopScheduledTask,
  });

  const fileManager = createFileManager({ loadTasks: taskStore.loadTasks, formatError });
  const backupService = createBackupService({
    db,
    packageInfo,
    getConfiguredPort: appConfig.getConfiguredPort,
    getConfiguredStrmTargetPath: appConfig.getConfiguredStrmTargetPath,
    getLogCleanupEnabled: appConfig.getLogCleanupEnabled,
    getLogRetentionDays: appConfig.getLogRetentionDays,
    getConfiguredTimezone: appConfig.getConfiguredTimezone,
    normalizeAppConfigPayload: appConfig.normalizeAppConfigPayload,
    getAppConfigPayload: appConfig.getAppConfigPayload,
    applyAppConfig: appConfig.applyAppConfig,
    loadServices: serviceStore.loadServices,
    loadTasks: taskStore.loadTasks,
    getServiceById: serviceStore.getServiceById,
    normalizeServicePayload: serviceStore.normalizeServicePayload,
    createServiceRecord: serviceStore.createServiceRecord,
    normalizeTaskPayload: taskStore.normalizeTaskPayload,
    createTaskRecord: taskStore.createTaskRecord,
    cleanupExpiredRuns: runStore.cleanupExpiredRuns,
    scheduleTask: taskRunner.scheduleTask,
    stopAllScheduledTasks: taskRunner.stopAllScheduledTasks,
    buildServiceSourcePath: taskRunner.buildServiceSourcePath,
  });

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  initializeSettings({ getSetting, setSetting, appConfig });
  runtimePort = appConfig.getConfiguredPort();
  maintenance.startMaintenanceJobs();
  taskStore.loadTasks().forEach(taskRunner.scheduleTask);

  mountApiRoutes(app, {
    activeRuns,
    auth,
    backupService,
    databasePath,
    db,
    fileManager,
    formatError,
    parseBoolean,
    runStore,
    sanitizeText,
    serviceStore,
    taskRunner,
    taskStore,
    upload: multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }),
    appConfig,
    defaultAdminUsername: DEFAULT_ADMIN_USERNAME,
  });
  mountStaticFiles(app, distPath);
  server.on('upgrade', runEvents.handleWebSocketUpgrade);

  return {
    app,
    server,
    port: runtimePort,
  };
}

function initializeSettings({ getSetting, setSetting, appConfig }) {
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

  appConfig.ensureAppSettings();
  appConfig.applyAppConfig(appConfig.getAppConfigPayload());
}

function getServiceDisplayName(service) {
  return service?.name || service?.url || String(service?.id || '');
}
