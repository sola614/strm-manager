import path from 'node:path';
import { clampInteger, sanitizeText } from './utils/validators.js';

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin';
export const RESET_ADMIN_PASSWORD = process.env.RESET_ADMIN_PASSWORD || '';
export const ENV_PORT = clampInteger(process.env.PORT || 4173, 1, 65535);
export const ENV_DEFAULT_STRM_TARGET_PATH = sanitizeText(process.env.STRM_TARGET_PATH) || '/media/strm';
export const MAX_RUN_HISTORY = 200;
export const DEFAULT_DOWNLOAD_EXTENSIONS = 'mp4,mkv';
export const DEFAULT_SUBTITLE_EXTENSIONS = 'srt,ass';
export const DEFAULT_LOG_CLEANUP_ENABLED = true;
export const DEFAULT_LOG_RETENTION_DAYS = 7;
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export function resolveProjectPaths(projectRoot) {
  return {
    databasePath: resolveDatabasePath(
      projectRoot,
      process.env.DATABASE_PATH || path.join('data', 'database.sqlite'),
    ),
    distPath: path.join(projectRoot, 'dist'),
  };
}

function resolveDatabasePath(projectRoot, databasePath) {
  return path.isAbsolute(databasePath) ? databasePath : path.join(projectRoot, databasePath);
}
