export interface OpenlistService {
  id: string;
  name: string;
  url: string;
  token: string;
  baseUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OpenlistServiceFormValues {
  name: string;
  url: string;
  token: string;
  baseUrl: string;
  enabled: boolean;
}

export interface SyncTask {
  id: string;
  name: string;
  serviceId: string;
  sourcePath: string;
  targetPath: string;
  cron: string;
  maxConcurrency: number;
  downloadExtensions: string;
  downloadSubtitles: boolean;
  requestDelaySeconds: string;
  overwriteExisting: boolean;
  enabled: boolean;
  notifyEnabled: boolean;
  callbackUrl: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
}

export interface SyncTaskFormValues {
  name: string;
  serviceId: string;
  sourcePath: string;
  targetPath: string;
  scheduleEnabled: boolean;
  cron: string;
  maxConcurrency: number;
  downloadExtensions: string;
  downloadSubtitles: boolean;
  requestDelaySeconds: string;
  overwriteExisting: boolean;
  notifyEnabled: boolean;
  callbackUrl: string;
}

export type TaskRunStatus = 'running' | 'success' | 'error' | 'skipped';
export type TaskTriggerType = 'manual' | 'schedule';

export interface TaskRun {
  id: string;
  taskId: string;
  taskName: string;
  serviceId: string;
  serviceName: string;
  triggerType: TaskTriggerType;
  startedAt: string;
  completedAt: string | null;
  status: TaskRunStatus;
  message: string;
  details: string[];
  processedCount: number;
  subtitleCount: number;
  skippedCount: number;
  failureCount: number;
}

export interface AuthResponse {
  token: string;
  username: string;
  mustChangePassword: boolean;
}

export interface SessionUser {
  username: string;
  mustChangePassword: boolean;
}

export interface AppConfig {
  port: number;
  runtimePort: number;
  defaultStrmTargetPath: string;
  logCleanupEnabled: boolean;
  logRetentionDays: number;
  timezone: string;
  databasePath: string;
  nodeEnv: string;
  resetAdminPasswordEnabled: boolean;
}

export interface AppConfigFormValues {
  port: number;
  defaultStrmTargetPath: string;
  logCleanupEnabled: boolean;
  logRetentionDays: number;
  timezone: string;
}

export type ActiveView = 'dashboard' | 'services' | 'tasks' | 'files' | 'runs' | 'runDetail' | 'backup' | 'settings';

export interface ManagedFileRoot {
  id: string;
  targetPath: string;
  configuredPaths: string[];
  resolvedPath: string;
  taskIds: string[];
  taskNames: string[];
  exists: boolean;
  error: string;
}

export type ManagedFileEntryType = 'directory' | 'file';

export interface ManagedFileEntry {
  id: string;
  rootId: string;
  targetPath: string;
  resolvedRootPath: string;
  relativePath: string;
  name: string;
  type: ManagedFileEntryType;
  size: number;
  updatedAt: string | null;
}

export interface ManagedFileContent {
  name: string;
  relativePath: string;
  content: string;
  updatedAt: string | null;
}

export interface ManagedFilesPayload {
  roots: ManagedFileRoot[];
  currentRootId: string | null;
  currentDirectory: string;
  parentDirectory: string | null;
  entries: ManagedFileEntry[];
}

export interface BackupPayload {
  version: string;
  exportedAt: string;
  services: Array<{
    id: string;
    name: string;
    url: string;
    token: string;
    baseUrl: string;
    enabled: boolean;
  }>;
  tasks: Array<{
    id: string;
    name: string;
    serviceId: string;
    sourcePath: string;
    targetPath: string;
    cron: string;
    maxConcurrency: number;
    downloadExtensions: string;
    downloadSubtitles: boolean;
    requestDelaySeconds: string;
    overwriteExisting: boolean;
    enabled: boolean;
    notifyEnabled: boolean;
    callbackUrl: string;
  }>;
}
