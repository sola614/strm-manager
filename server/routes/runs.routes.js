import express from 'express';

export function createRunsRouter(deps) {
  const {
    requireAuth,
    loadRuns,
    deleteRunRecords,
    getRunById,
    sanitizeText,
    formatError,
  } = deps;

  const router = express.Router();

  router.get('/', requireAuth(), (_req, res) => {
    res.json(loadRuns());
  });

  router.post('/bulk-delete', requireAuth(), (req, res) => {
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

  router.get('/:id', requireAuth(), (req, res) => {
    const run = getRunById(req.params.id);
    if (!run) {
      return res.status(404).json({
        code: 'RUN_NOT_FOUND',
        error: '运行记录不存在。',
      });
    }

    res.json(run);
  });

  router.delete('/:id', requireAuth(), (req, res) => {
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

  return router;
}
