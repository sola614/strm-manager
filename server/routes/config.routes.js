import express from 'express';

export function createConfigRouter(deps) {
  const {
    requireAuth,
    getAppConfigPayload,
    normalizeAppConfigPayload,
    applyAppConfig,
    cleanupExpiredRuns,
  } = deps;

  const router = express.Router();

  router.get('/', requireAuth({ allowWhenPasswordChangeRequired: true }), (_req, res) => {
    res.json(getAppConfigPayload());
  });

  router.put('/', requireAuth(), (req, res) => {
    const { config, errors } = normalizeAppConfigPayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        code: 'INVALID_CONFIG',
        error: errors.join(' '),
      });
    }

    applyAppConfig(config);
    if (config.logCleanupEnabled) {
      cleanupExpiredRuns();
    }

    res.json(getAppConfigPayload());
  });

  return router;
}
