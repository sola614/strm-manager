import express from 'express';

export function createAuthRouter(deps) {
  const {
    defaultAdminUsername,
    requireAuth,
    shouldForcePasswordChange,
    verifyPassword,
    setAdminPassword,
    issueSession,
    clearSession,
  } = deps;

  const router = express.Router();

  router.get('/setup-required', (_req, res) => {
    res.json({
      required: shouldForcePasswordChange(),
    });
  });

  router.post('/setup-password', (req, res) => {
    if (!shouldForcePasswordChange()) {
      return res.status(409).json({
        code: 'SETUP_NOT_REQUIRED',
        error: '当前不需要设置管理员密码。',
      });
    }

    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';
    if (newPassword.length < 8) {
      return res.status(400).json({
        code: 'INVALID_PASSWORD',
        error: '新密码至少需要 8 个字符。',
      });
    }

    setAdminPassword(newPassword);

    const token = issueSession();
    res.json({
      token,
      username: defaultAdminUsername,
      mustChangePassword: false,
    });
  });

  router.post('/login', (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password || !verifyPassword(password)) {
      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        error: '账号或密码不正确。',
      });
    }

    const token = issueSession();
    res.json({
      token,
      username: defaultAdminUsername,
      mustChangePassword: shouldForcePasswordChange(),
    });
  });

  router.get('/me', requireAuth({ allowWhenPasswordChangeRequired: true }), (_req, res) => {
    res.json({
      username: defaultAdminUsername,
      mustChangePassword: shouldForcePasswordChange(),
    });
  });

  router.post('/logout', requireAuth({ allowWhenPasswordChangeRequired: true }), (_req, res) => {
    clearSession();
    res.status(204).end();
  });

  router.put('/password', requireAuth({ allowWhenPasswordChangeRequired: true }), (req, res) => {
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';
    if (newPassword.length < 8) {
      return res.status(400).json({
        code: 'INVALID_PASSWORD',
        error: '新密码至少需要 8 个字符。',
      });
    }

    setAdminPassword(newPassword);

    const token = issueSession();
    res.json({
      token,
      username: defaultAdminUsername,
      mustChangePassword: false,
    });
  });

  return router;
}
