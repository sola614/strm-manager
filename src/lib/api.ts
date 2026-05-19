import {
  AuthResponse,
  AppConfig,
  BackupPayload,
  OpenlistService,
  OpenlistServiceFormValues,
  SessionUser,
  SyncTask,
  SyncTaskFormValues,
  TaskRun,
} from '../types';

const TOKEN_KEY = 'strm-manager.token';

export function getStoredToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

function buildHeaders(initHeaders?: HeadersInit, includeJson = false) {
  const headers = new Headers(initHeaders);
  const token = getStoredToken();

  if (includeJson && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const body = await response.json();
      message = body?.error || body?.message || message;
    } catch {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

async function requestJson<T>(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await fetch(input, {
    ...init,
    headers: buildHeaders(init.headers),
  });

  return parseResponse<T>(response);
}

export function login(password: string) {
  return requestJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    headers: buildHeaders(undefined, true),
    body: JSON.stringify({ password }),
  });
}

export function getCurrentUser() {
  return requestJson<SessionUser>('/api/auth/me');
}

export function getAppConfig() {
  return requestJson<AppConfig>('/api/config');
}

export function logout() {
  return requestJson<void>('/api/auth/logout', {
    method: 'POST',
  });
}

export function changePassword(newPassword: string) {
  return requestJson<AuthResponse>('/api/auth/password', {
    method: 'PUT',
    headers: buildHeaders(undefined, true),
    body: JSON.stringify({ newPassword }),
  });
}

export function getServices() {
  return requestJson<OpenlistService[]>('/api/services');
}

export function createService(values: OpenlistServiceFormValues) {
  return requestJson<OpenlistService>('/api/services', {
    method: 'POST',
    headers: buildHeaders(undefined, true),
    body: JSON.stringify(values),
  });
}

export function updateService(id: string, values: OpenlistServiceFormValues) {
  return requestJson<OpenlistService>(`/api/services/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: buildHeaders(undefined, true),
    body: JSON.stringify(values),
  });
}

export function deleteService(id: string) {
  return requestJson<void>(`/api/services/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function getTasks(serviceId?: string) {
  const endpoint = new URL('/api/tasks', window.location.origin);
  if (serviceId) {
    endpoint.searchParams.set('serviceId', serviceId);
  }
  return requestJson<SyncTask[]>(endpoint);
}

export function createTask(values: SyncTaskFormValues) {
  return requestJson<SyncTask>('/api/tasks', {
    method: 'POST',
    headers: buildHeaders(undefined, true),
    body: JSON.stringify(values),
  });
}

export function updateTask(id: string, values: SyncTaskFormValues) {
  return requestJson<SyncTask>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: buildHeaders(undefined, true),
    body: JSON.stringify(values),
  });
}

export function deleteTask(id: string) {
  return requestJson<void>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function triggerTaskRun(id: string) {
  return requestJson<TaskRun>(`/api/tasks/${encodeURIComponent(id)}/trigger`, {
    method: 'POST',
  });
}

export function getRuns() {
  return requestJson<TaskRun[]>('/api/runs');
}

export function getTaskRuns(taskId: string) {
  return requestJson<TaskRun[]>(`/api/tasks/${encodeURIComponent(taskId)}/runs`);
}

export function exportBackup() {
  return requestJson<BackupPayload>('/api/backup/export');
}

export function restoreBackup(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  return requestJson<{ restoredServices: number; restoredTasks: number }>('/api/backup/import', {
    method: 'POST',
    headers: buildHeaders(),
    body: formData,
  });
}
