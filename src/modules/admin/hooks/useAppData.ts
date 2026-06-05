import { useCallback, useState } from 'react';
import {
  getAppConfig,
  getManagedFiles,
  getRun,
  getRuns,
  getServices,
  getTasks,
} from '../../../lib/api';
import { defaultAppConfigForm } from '../constants';
import type { AppConfig, ManagedFileEntry, ManagedFileRoot, OpenlistService, SyncTask, TaskRun } from '../../../types';

export function useAppData() {
  const [services, setServices] = useState<OpenlistService[]>([]);
  const [tasks, setTasks] = useState<SyncTask[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [managedFileRoots, setManagedFileRoots] = useState<ManagedFileRoot[]>([]);
  const [managedFileEntries, setManagedFileEntries] = useState<ManagedFileEntry[]>([]);
  const [defaultStrmTargetPath, setDefaultStrmTargetPath] = useState('/media/strm');
  const [appConfig, setAppConfig] = useState<AppConfig>({
    ...defaultAppConfigForm,
    runtimePort: defaultAppConfigForm.port,
    databasePath: '',
    nodeEnv: '',
    resetAdminPasswordEnabled: false,
  });

  const [fileRootFilter, setFileRootFilter] = useState('');
  const [fileCurrentDirectory, setFileCurrentDirectory] = useState('');
  const [fileParentDirectory, setFileParentDirectory] = useState<string | null>(null);

  async function refreshConfig() {
    const config = await getAppConfig();
    setAppConfig(config);
    setDefaultStrmTargetPath(config.defaultStrmTargetPath || '/media/strm');
    return config;
  }

  async function refreshServices() {
    const items = await getServices();
    setServices(items);
    return items;
  }

  async function refreshTasks() {
    const items = await getTasks();
    setTasks(items);
    return items;
  }

  async function refreshRuns() {
    const items = await getRuns();
    setRuns(items);
    return items;
  }

  async function refreshManagedFiles(nextRootId = fileRootFilter, nextDirectory = fileCurrentDirectory) {
    const payload = await getManagedFiles(nextRootId, nextDirectory);
    setManagedFileRoots(payload.roots);
    setManagedFileEntries(payload.entries);
    setFileRootFilter(payload.currentRootId || '');
    setFileCurrentDirectory(payload.currentDirectory || '');
    setFileParentDirectory(payload.parentDirectory);
    return payload;
  }

  async function refreshRunsAndTasks() {
    const [nextRuns, nextTasks] = await Promise.all([getRuns(), getTasks()]);
    setRuns(nextRuns);
    setTasks(nextTasks);
    return nextRuns;
  }

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshConfig(), refreshServices(), refreshTasks(), refreshRuns(), refreshManagedFiles()]);
  }, [fileRootFilter, fileCurrentDirectory]);

  async function refreshSelectedRun(selectedRunId: string) {
    if (!selectedRunId) return null;
    const run = await getRun(selectedRunId);
    setRuns((currentRuns) => {
      const runExists = currentRuns.some((item) => item.id === run.id);
      if (!runExists) return [run, ...currentRuns];
      return currentRuns.map((item) => (item.id === run.id ? run : item));
    });
    return run;
  }

  function filterOutRuns(runIds: string[]) {
    if (!runIds.length) return;
    setRuns((currentRuns) => currentRuns.filter((run) => !runIds.includes(run.id)));
  }

  function resetData() {
    setServices([]);
    setTasks([]);
    setRuns([]);
    setManagedFileRoots([]);
    setManagedFileEntries([]);
    setFileRootFilter('');
    setFileCurrentDirectory('');
    setFileParentDirectory(null);
  }

  return {
    // Data state
    services,
    setServices,
    tasks,
    setTasks,
    runs,
    setRuns,
    managedFileRoots,
    managedFileEntries,
    defaultStrmTargetPath,
    setDefaultStrmTargetPath,
    appConfig,
    setAppConfig,

    // File navigation state
    fileRootFilter,
    setFileRootFilter,
    fileCurrentDirectory,
    setFileCurrentDirectory,
    fileParentDirectory,

    // Refresh functions
    refreshConfig,
    refreshServices,
    refreshTasks,
    refreshRuns,
    refreshManagedFiles,
    refreshRunsAndTasks,
    refreshAll,
    refreshSelectedRun,
    filterOutRuns,
    resetData,
  };
}
