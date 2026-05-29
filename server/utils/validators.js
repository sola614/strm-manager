export function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeUrl(value) {
  return sanitizeText(value).replace(/\/+$/, '');
}

export function normalizeBaseUrl(value) {
  const trimmed = sanitizeText(value) || '/';
  const normalized = trimmed.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}

export function normalizeExtensions(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .join(',');
}

export function normalizeTimezone(value) {
  return sanitizeText(value).replace(/\s+/g, '');
}

export function isValidTimezone(value) {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function clampInteger(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

export function clampFloat(value, min, max) {
  const parsed = Number.parseFloat(String(value));
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

export function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  }
  return Boolean(value);
}

export function safeParseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
