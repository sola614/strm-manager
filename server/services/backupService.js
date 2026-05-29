import { now } from '../utils/time.js';

export function createBackupService(deps) {
  const {
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
  } = deps;

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

  return {
    buildConfigYaml,
    buildBackupPayload,
    restoreBackupPayload,
  };
}
