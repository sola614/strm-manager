import path from 'node:path';
import { normalizeRemotePath } from '../utils/paths.js';

export function buildDownloadUrl({ domain, sourcePath, fileName, sign }) {
  const parts = normalizeRemotePath(sourcePath)
    .split('/')
    .filter(Boolean);

  if (parts.length > 0 && parts[parts.length - 1] === fileName) {
    parts.pop();
  }

  const encodedDir = parts.map((part) => encodeURIComponent(part)).join('/');
  const cleanDomain = domain.replace(/\/+$/, '');
  const dirSegment = encodedDir ? `/${encodedDir}` : '';
  const signQuery = sign ? `?sign=${encodeURIComponent(sign)}` : '';
  return `${cleanDomain}/d${dirSegment}/${encodeURIComponent(fileName)}${signQuery}`;
}

export function buildApiUrl(domain, pathname) {
  return `${domain.replace(/\/+$/, '')}${pathname}`;
}

export function buildServiceSourcePath(baseUrl, sourcePath) {
  const normalizedBase = normalizeRemotePath(baseUrl || '/');
  const normalizedSource = normalizeRemotePath(sourcePath || '/');

  if (normalizedBase === '/' || normalizedBase === normalizedSource) {
    return normalizedSource;
  }

  if (normalizedSource === '/') {
    return normalizedBase;
  }

  return normalizeRemotePath(`${normalizedBase}/${normalizedSource}`);
}

export function buildExtensionSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
  );
}

export function hasExtension(fileName, extensionSet) {
  const extension = path.extname(fileName || '').replace('.', '').toLowerCase();
  return extensionSet.has(extension);
}
