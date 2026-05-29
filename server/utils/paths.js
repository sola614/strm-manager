export function normalizeRemotePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function isSafePathPart(name) {
  return Boolean(name) && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}
