import { createAuthRouter } from './auth.routes.js';
import { createBackupRouter } from './backup.routes.js';
import { createConfigRouter } from './config.routes.js';
import { createFilesRouter } from './files.routes.js';
import { createRunsRouter } from './runs.routes.js';
import { createServicesRouter } from './services.routes.js';
import { createTasksRouter } from './tasks.routes.js';

export function mountApiRoutes(app, context) {
  const {
    activeRuns,
    appConfig,
    auth,
    backupService,
    databasePath,
    db,
    defaultAdminUsername,
    fileManager,
    formatError,
    parseBoolean,
    runStore,
    sanitizeText,
    serviceStore,
    taskRunner,
    taskStore,
    upload,
  } = context;

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      databasePath,
      runningTasks: Array.from(activeRuns),
    });
  });

  app.use('/api/auth', createAuthRouter({
    defaultAdminUsername,
    requireAuth: auth.requireAuth,
    shouldForcePasswordChange: auth.shouldForcePasswordChange,
    verifyPassword: auth.verifyPassword,
    setAdminPassword: auth.setAdminPassword,
    issueSession: auth.issueSession,
    clearSession: auth.clearSession,
  }));

  app.use('/api/config', createConfigRouter({
    requireAuth: auth.requireAuth,
    getAppConfigPayload: appConfig.getAppConfigPayload,
    normalizeAppConfigPayload: appConfig.normalizeAppConfigPayload,
    applyAppConfig: appConfig.applyAppConfig,
    cleanupExpiredRuns: runStore.cleanupExpiredRuns,
  }));

  app.use('/api/services', createServicesRouter({
    db,
    requireAuth: auth.requireAuth,
    loadServices: serviceStore.loadServices,
    getServiceById: serviceStore.getServiceById,
    normalizeServicePayload: serviceStore.normalizeServicePayload,
    createServiceRecord: serviceStore.createServiceRecord,
    updateServiceRecord: serviceStore.updateServiceRecord,
    bulkUpdateServiceEnabled: serviceStore.bulkUpdateServiceEnabled,
    disableTasksByServiceId: taskStore.disableTasksByServiceId,
    loadTasks: taskStore.loadTasks,
    scheduleTask: taskRunner.scheduleTask,
    removeServiceRecord: serviceStore.removeServiceRecord,
    sanitizeText,
    parseBoolean,
    formatError,
  }));

  app.use('/api/tasks', createTasksRouter({
    requireAuth: auth.requireAuth,
    loadTasks: taskStore.loadTasks,
    normalizeTaskPayload: taskStore.normalizeTaskPayload,
    createTaskRecord: taskStore.createTaskRecord,
    getTaskById: taskStore.getTaskById,
    scheduleTask: taskRunner.scheduleTask,
    bulkUpdateTaskEnabled: taskStore.bulkUpdateTaskEnabled,
    updateTaskRecord: taskStore.updateTaskRecord,
    stopScheduledTask: taskRunner.stopScheduledTask,
    activeRuns,
    removeTaskRecord: taskStore.removeTaskRecord,
    startTaskRun: taskRunner.startTaskRun,
    loadRunsByTask: runStore.loadRunsByTask,
    sanitizeText,
    parseBoolean,
    formatError,
  }));

  app.use('/api/files', createFilesRouter({
    requireAuth: auth.requireAuth,
    buildManagedFilesPayload: fileManager.buildManagedFilesPayload,
    readManagedStrmFileContent: fileManager.readManagedStrmFileContent,
    deleteManagedFileEntry: fileManager.deleteManagedFileEntry,
    deleteManagedFileEntries: fileManager.deleteManagedFileEntries,
    sanitizeText,
    formatError,
  }));

  app.use('/api/runs', createRunsRouter({
    requireAuth: auth.requireAuth,
    loadRuns: runStore.loadRuns,
    deleteRunRecords: runStore.deleteRunRecords,
    getRunById: runStore.getRunById,
    sanitizeText,
    formatError,
  }));

  app.use('/api/backup', createBackupRouter({
    requireAuth: auth.requireAuth,
    upload,
    buildBackupPayload: backupService.buildBackupPayload,
    restoreBackupPayload: backupService.restoreBackupPayload,
    formatError,
  }));
}
