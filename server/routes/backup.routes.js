import express from 'express';

export function createBackupRouter(deps) {
  const {
    requireAuth,
    upload,
    buildBackupPayload,
    restoreBackupPayload,
    formatError,
  } = deps;

  const router = express.Router();

  router.get('/export', requireAuth(), (_req, res) => {
    res.json(buildBackupPayload());
  });

  router.post('/import', requireAuth(), upload.single('file'), (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        throw new Error('请上传备份文件。');
      }
      const payload = JSON.parse(req.file.buffer.toString('utf8'));
      const summary = restoreBackupPayload(payload);
      res.json(summary);
    } catch (error) {
      res.status(400).json({
        code: 'INVALID_BACKUP',
        error: formatError(error),
      });
    }
  });

  return router;
}
