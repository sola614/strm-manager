export interface OpenlistService {
  id: string;
  name: string;
  url: string;
  token: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenlistServiceFormValues {
  name: string;
  url: string;
  token: string;
  baseUrl: string;
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
  requestDelaySeconds: number;
  overwriteExisting: boolean;
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
  cron: string;
  maxConcurrency: number;
  downloadExtensions: string;
  downloadSubtitles: boolean;
  requestDelaySeconds: number;
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
  defaultStrmTargetPath: string;
}

export type ActiveView = 'dashboard' | 'services' | 'tasks' | 'runs' | 'backup';

export interface BackupPayload {
  version: string;
  exportedAt: string;
  services: Array<{
    id: string;
    name: string;
    url: string;
    token: string;
    baseUrl: string;
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
    requestDelaySeconds: number;
    overwriteExisting: boolean;
    notifyEnabled: boolean;
    callbackUrl: string;
  }>;
}
