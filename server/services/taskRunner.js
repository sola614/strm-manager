import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { generateId } from '../utils/id.js';
import { isSafePathPart } from '../utils/paths.js';
import { delay, now } from '../utils/time.js';
import {
  buildApiUrl,
  buildDownloadUrl,
  buildExtensionSet,
  buildServiceSourcePath,
  hasExtension,
} from './openlistUrl.js';

export function createTaskRunner(options) {
  const {
    activeRuns,
    defaultDownloadExtensions,
    defaultSubtitleExtensions,
    formatError,
    getConfiguredTimezone,
    getServiceById,
    getServiceDisplayName,
    getTaskById,
    loadTasks,
    updateTaskLastRunAt,
    createRunRecord,
    updateRunRecord,
    appendRunLog,
    broadcastRunSnapshot,
    startMaintenanceJobs,
  } = options;

  const scheduledJobs = new Map();

  function updateRunRecordAndBroadcast(runId, values) {
    updateRunRecord(runId, values);
    broadcastRunSnapshot(runId);
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
    broadcastRunSnapshot(run.id);
    activeRuns.add(task.id);

    executeTaskRun(task, service, run).finally(() => {
      activeRuns.delete(task.id);
    });

    return run;
  }

  function recordSkippedRun(task, service, message) {
    const run = {
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
    };
    createRunRecord(run);
    broadcastRunSnapshot(run.id);
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
        progress.addDetail(`回调通知已发送到 ${task.callbackUrl}`);
      }

      progress.flush();
      updateRunRecordAndBroadcast(run.id, {
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
      updateRunRecordAndBroadcast(run.id, {
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
      updateRunRecordAndBroadcast(runId, {
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
      addDetail(message) {
        details.push(message);
        appendRunLog(runId, message);
        this.changed();
      },
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
        progress.addDetail(`${fileName} 字幕已存在，跳过下载`);
        return;
      }

      progress.summary.subtitleCount += 1;
      progress.addDetail(`${fileName} 字幕下载成功`);
      return;
    }

    if (!isMediaFile(fileName, downloadExtensionSet)) return;

    const savePath = path.join(saveDir, fileName.replace(/\.[^.]+$/i, '.strm'));
    const written = await writeOutputFile(savePath, streamUrl, task.overwriteExisting, 'utf8');
    if (!written) {
      progress.summary.skippedCount += 1;
      progress.addDetail(`${path.basename(savePath)} 已存在，跳过创建`);
      return;
    }

    progress.summary.processedCount += 1;
    progress.addDetail(`${path.basename(savePath)} 创建成功`);
  }

  return {
    scheduleTask,
    rescheduleTasks,
    stopScheduledTask,
    startTaskRun,
    stopAllScheduledTasks() {
      Array.from(scheduledJobs.keys()).forEach((taskId) => {
        stopScheduledTask(taskId);
      });
    },
    buildServiceSourcePath,
  };

  function isMediaFile(fileName, extensionSet = buildExtensionSet(defaultDownloadExtensions)) {
    return hasExtension(fileName, extensionSet);
  }

  function isSubtitleFile(fileName) {
    return hasExtension(fileName, buildExtensionSet(defaultSubtitleExtensions));
  }
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
