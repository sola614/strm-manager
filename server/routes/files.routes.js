import express from 'express';

export function createFilesRouter(deps) {
  const {
    requireAuth,
    buildManagedFilesPayload,
    readManagedStrmFileContent,
    deleteManagedFileEntry,
    deleteManagedFileEntries,
    sanitizeText,
    formatError,
  } = deps;

  const router = express.Router();

  router.get('/', requireAuth(), async (req, res) => {
    try {
      const rootId = sanitizeText(req.query.rootId);
      const directory = sanitizeText(req.query.directory);
      res.json(await buildManagedFilesPayload(rootId, directory));
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 500;
      res.status(status).json({
        code: error?.code || 'FILES_LOAD_FAILED',
        error: formatError(error),
      });
    }
  });

  router.get('/content', requireAuth(), async (req, res) => {
    try {
      const rootId = sanitizeText(req.query.rootId);
      const relativePath = sanitizeText(req.query.relativePath);
      res.json(await readManagedStrmFileContent(rootId, relativePath));
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 400;
      res.status(status).json({
        code: error?.code || 'FILE_CONTENT_LOAD_FAILED',
        error: formatError(error),
      });
    }
  });

  router.delete('/', requireAuth(), async (req, res) => {
    try {
      const rootId = sanitizeText(req.body?.rootId);
      const relativePath = sanitizeText(req.body?.relativePath);
      await deleteManagedFileEntry(rootId, relativePath);
      res.status(204).end();
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 400;
      res.status(status).json({
        code: error?.code || 'FILE_DELETE_FAILED',
        error: formatError(error),
      });
    }
  });

  router.post('/bulk-delete', requireAuth(), async (req, res) => {
    try {
      const rootId = sanitizeText(req.body?.rootId);
      const relativePaths = Array.isArray(req.body?.relativePaths)
        ? Array.from(new Set(req.body.relativePaths.map((item) => sanitizeText(item)).filter(Boolean)))
        : [];

      const deletedCount = await deleteManagedFileEntries(rootId, relativePaths);
      res.json({ deletedCount });
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 400;
      res.status(status).json({
        code: error?.code || 'FILES_BULK_DELETE_FAILED',
        error: formatError(error),
      });
    }
  });

  return router;
}
