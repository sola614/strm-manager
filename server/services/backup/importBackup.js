export function createBackupImporter(deps) {
  const {
    db,
    normalizeAppConfigPayload,
    getAppConfigPayload,
    applyAppConfig,
    normalizeServicePayload,
    createServiceRecord,
    normalizeTaskPayload,
    createTaskRecord,
    cleanupExpiredRuns,
    loadTasks,
    scheduleTask,
    stopAllScheduledTasks,
  } = deps;

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

    const normalizedServices = normalizeBackupServices(services);
    const serviceIdMap = new Map();
    const serviceUrlMap = new Map();

    const tx = db.transaction(() => {
      stopAllScheduledTasks();
      db.prepare('DELETE FROM run_logs').run();
      db.prepare('DELETE FROM runs').run();
      db.prepare('DELETE FROM tasks').run();
      db.prepare('DELETE FROM services').run();

      if (appConfig?.config) {
        applyAppConfig(appConfig.config);
      }

      restoreServices(normalizedServices, serviceIdMap, serviceUrlMap);
      restoreTasks(tasks, services, normalizedServices, serviceIdMap, serviceUrlMap);
    });

    tx();
    cleanupExpiredRuns();
    loadTasks().forEach(scheduleTask);

    return {
      restoredServices: normalizedServices.length,
      restoredTasks: tasks.length,
    };
  }

  function normalizeBackupServices(services) {
    return services.map((service) => {
      const result = normalizeServicePayload(service);
      if (result.errors.length > 0) {
        throw new Error(`服务恢复失败：${result.errors.join(' ')}`);
      }
      return {
        originalId: service?.id,
        service: result.service,
      };
    });
  }

  function restoreServices(normalizedServices, serviceIdMap, serviceUrlMap) {
    for (const item of normalizedServices) {
      const newId = createServiceRecord(item.service);
      if (item.originalId) {
        serviceIdMap.set(String(item.originalId), newId);
      }
      if (item.service.url) {
        serviceUrlMap.set(item.service.url, newId);
      }
    }
  }

  function restoreTasks(tasks, services, normalizedServices, serviceIdMap, serviceUrlMap) {
    for (const task of tasks) {
      const mappedServiceId = resolveTaskServiceId(task, services, normalizedServices, serviceIdMap, serviceUrlMap);
      const result = normalizeTaskPayload({
        ...task,
        serviceId: mappedServiceId,
      }, null, { allowDisabledService: true });

      if (result.errors.length > 0) {
        throw new Error(`任务恢复失败：${result.errors.join(' ')}`);
      }

      createTaskRecord(result.task);
    }
  }

  function resolveTaskServiceId(task, services, normalizedServices, serviceIdMap, serviceUrlMap) {
    let mappedServiceId = serviceIdMap.get(String(task.serviceId));
    if (!mappedServiceId && services.length === 1) {
      mappedServiceId = serviceUrlMap.get(normalizedServices[0]?.service.url);
    }
    if (mappedServiceId) return mappedServiceId;

    const knownServiceIds = Array.from(serviceIdMap.keys()).join(', ') || '无';
    throw new Error(
      `任务 ${task.name || task.id || ''} 对应的服务不存在。任务 serviceId=${String(task.serviceId)}，备份服务 ID=${knownServiceIds}`,
    );
  }

  return {
    restoreBackupPayload,
  };
}
