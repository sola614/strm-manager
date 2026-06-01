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

export function normalizeDelaySecondsExpression(value, min, max, fallback = '5') {
  const raw = String(value ?? fallback).trim().replace(/\s+/g, '');
  const expression = raw || String(fallback);
  const singleMatch = expression.match(/^\d+(?:\.\d+)?$/);
  const rangeMatch = expression.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);

  if (!singleMatch && !rangeMatch) {
    return {
      value: String(fallback),
      error: '请求延时仅支持单个秒数或范围，例如 5 或 5-10。',
    };
  }

  const numbers = rangeMatch
    ? [Number(rangeMatch[1]), Number(rangeMatch[2])]
    : [Number(expression)];

  if (numbers.some((number) => number < min || number > max)) {
    return {
      value: expression,
      error: `请求延时必须在 ${min} 到 ${max} 秒之间。`,
    };
  }

  if (rangeMatch && numbers[0] > numbers[1]) {
    return {
      value: expression,
      error: '请求延时范围的开始值不能大于结束值。',
    };
  }

  return {
    value: expression,
    error: null,
  };
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
