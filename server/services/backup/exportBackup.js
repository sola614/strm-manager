import { now } from '../../utils/time.js';

export function createBackupExporter(deps) {
  const {
    packageInfo,
    getConfiguredPort,
    getConfiguredStrmTargetPath,
    getLogCleanupEnabled,
    getLogRetentionDays,
    getConfiguredTimezone,
    loadServices,
    loadTasks,
  } = deps;

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

  return {
    buildBackupPayload,
  };
}
