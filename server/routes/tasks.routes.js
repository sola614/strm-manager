import express from 'express';

export function createTasksRouter(deps) {
  const {
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
  } = deps;

  const router = express.Router();

  router.get('/', requireAuth(), (req, res) => {
    const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId.trim() : '';
    res.json(loadTasks(serviceId || null));
  });

  router.post('/', requireAuth(), (req, res) => {
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

  router.post('/bulk-enabled', requireAuth(), (req, res) => {
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

  router.put('/:id', requireAuth(), (req, res) => {
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

  router.delete('/:id', requireAuth(), (req, res) => {
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

  router.post('/:id/trigger', requireAuth(), async (req, res) => {
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

  router.get('/:id/runs', requireAuth(), (req, res) => {
    res.json(loadRunsByTask(req.params.id));
  });

  return router;
}
