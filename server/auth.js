import crypto from 'node:crypto';
import { hashValue } from './utils/id.js';

export function createAuthContext({ getSetting, setSetting }) {
  function shouldForcePasswordChange() {
    return getSetting('force_password_change') === '1';
  }

  function verifyPassword(password) {
    const hash = getSetting('admin_password_hash');
    return Boolean(hash) && hash === hashValue(password);
  }

  function setAdminPassword(password) {
    setSetting('admin_password_hash', hashValue(password));
    setSetting('force_password_change', '0');
  }

  function issueSession() {
    const token = cryptoRandomHex();
    setSetting('session_token_hash', hashValue(token));
    return token;
  }

  function clearSession() {
    setSetting('session_token_hash', '');
  }

  function requireAuth(options = {}) {
    return (req, res, next) => {
      const token = getSessionToken(req);
      if (!token) {
        return res.status(401).json({
          code: 'UNAUTHORIZED',
          error: '请先登录。',
        });
      }

      const tokenHash = getSetting('session_token_hash');
      if (!tokenHash || tokenHash !== hashValue(token)) {
        return res.status(401).json({
          code: 'UNAUTHORIZED',
          error: '登录状态已失效，请重新登录。',
        });
      }

      if (shouldForcePasswordChange() && !options.allowWhenPasswordChangeRequired) {
        return res.status(403).json({
          code: 'PASSWORD_CHANGE_REQUIRED',
          error: '管理员密码需要先设置后才能继续使用。',
        });
      }

      next();
    };
  }

  return {
    shouldForcePasswordChange,
    verifyPassword,
    setAdminPassword,
    issueSession,
    clearSession,
    requireAuth,
  };
}

function getSessionToken(req) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  return authorization.slice(7).trim() || null;
}

function cryptoRandomHex() {
  return crypto.randomBytes(24).toString('hex');
}
