import express from 'express';

export function createServicesRouter(deps) {
  const {
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
  } = deps;

  const router = express.Router();

  router.get('/', requireAuth(), (_req, res) => {
    res.json(loadServices());
  });

  router.post('/', requireAuth(), (req, res) => {
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

  router.post('/bulk-enabled', requireAuth(), (req, res) => {
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

  router.put('/:id', requireAuth(), (req, res) => {
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

  router.delete('/:id', requireAuth(), (req, res) => {
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

  return router;
}
