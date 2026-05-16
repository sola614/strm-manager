import { OpenlistService, TaskRun } from '../../types';

const PAGE_SIZE_KEY_PREFIX = 'strm-manager.page-size.';

export function formatDateTime(value: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function statusColor(status: TaskRun['status']) {
  switch (status) {
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    default:
      return 'default';
  }
}

export function getServiceName(services: OpenlistService[], serviceId: string) {
  return services.find((service) => service.id === serviceId)?.name || serviceId;
}

export function buildDisplaySourcePath(baseUrl: string, sourcePath: string) {
  const normalizedBase = normalizePath(baseUrl || '/');
  const normalizedSource = normalizePath(sourcePath || '/');

  if (normalizedBase === '/' || normalizedBase === normalizedSource) {
    return normalizedSource;
  }

  if (normalizedSource === '/') {
    return normalizedBase;
  }

  return normalizePath(`${normalizedBase}/${normalizedSource}`);
}

export function getStoredPageSize(key: string, fallback = 20) {
  try {
    const raw = window.localStorage.getItem(`${PAGE_SIZE_KEY_PREFIX}${key}`);
    const parsed = Number(raw);
    return [20, 50, 100].includes(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function setStoredPageSize(key: string, value: number) {
  try {
    window.localStorage.setItem(`${PAGE_SIZE_KEY_PREFIX}${key}`, String(value));
  } catch {
    // Ignore localStorage write errors.
  }
}

function normalizePath(value: string) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .trim();

  if (!normalized) {
    return '/';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}
