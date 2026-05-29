import { App as AntdApp, ConfigProvider, Modal } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bulkDeleteRuns,
  bulkDeleteManagedFiles,
  bulkUpdateServicesEnabled,
  bulkUpdateTasksEnabled,
  changePassword,
  createService,
  createTask,
  deleteManagedFile,
  deleteRun,
  deleteService,
  deleteTask,
  exportBackup,
  getAppConfig,
  getCurrentUser,
  getManagedFileContent,
  getManagedFiles,
  getRun,
  getRuns,
  getServices,
  getSetupRequired,
  getStoredToken,
  getTaskRuns,
  getTasks,
  login,
  logout,
  restoreBackup,
  setStoredToken,
  setupPassword as setupInitialPassword,
  triggerTaskRun,
  updateAppConfig,
  updateService,
  updateTask,
} from './lib/api';
import { ADMIN_VERSION, defaultAppConfigForm, defaultServiceForm, defaultTaskForm, viewMeta } from './modules/admin/constants';
import { PasswordModal } from './modules/admin/forms/PasswordModal';
import { ServiceDrawer } from './modules/admin/forms/ServiceDrawer';
import { TaskDrawer } from './modules/admin/forms/TaskDrawer';
import { AdminShell } from './modules/admin/layout/AdminShell';
import { BackupPage } from './modules/admin/pages/BackupPage';
import { DashboardPage } from './modules/admin/pages/DashboardPage';
import { FilesPage } from './modules/admin/pages/FilesPage';
import { LoginPage } from './modules/admin/pages/LoginPage';
import { RunDetailPage } from './modules/admin/pages/RunDetailPage';
import { RunsPage } from './modules/admin/pages/RunsPage';
import { ServicesPage } from './modules/admin/pages/ServicesPage';
import { SettingsPage } from './modules/admin/pages/SettingsPage';
import { TasksPage } from './modules/admin/pages/TasksPage';
import { getServiceDisplayName } from './modules/admin/utils';
import type {
  ActiveView,
  AppConfig,
  AuthResponse,
  ManagedFileEntry,
  ManagedFileContent,
  ManagedFileRoot,
  OpenlistService,
  SessionUser,
  SyncTask,
  TaskRun,
} from './types';

const validViews: ActiveView[] = ['dashboard', 'services', 'tasks', 'files', 'runs', 'runDetail', 'backup', 'settings'];

function getViewFromLocation(): ActiveView {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().split('?')[0];
  return validViews.includes(raw as ActiveView) ? (raw as ActiveView) : 'dashboard';
}

function getRunIdFromLocation() {
  if (typeof window === 'undefined') return '';
  const query = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(query).get('id') || '';
}

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#5b8def',
          borderRadius: 16,
          fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          colorBgLayout: '#f4f6fb',
        },
      }}
    >
      <AntdApp>
        <AdminApp />
      </AntdApp>
    </ConfigProvider>
  );
}

function AdminApp() {
  const { message } = AntdApp.useApp();
  const previousViewRef = useRef<ActiveView | null>(null);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [services, setServices] = useState<OpenlistService[]>([]);
  const [tasks, setTasks] = useState<SyncTask[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [managedFileRoots, setManagedFileRoots] = useState<ManagedFileRoot[]>([]);
  const [managedFileEntries, setManagedFileEntries] = useState<ManagedFileEntry[]>([]);

  const [activeView, setActiveView] = useState<ActiveView>(() => getViewFromLocation());
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [fileRootFilter, setFileRootFilter] = useState<string>('');
  const [fileCurrentDirectory, setFileCurrentDirectory] = useState<string>('');
  const [fileParentDirectory, setFileParentDirectory] = useState<string | null>(null);
  const [runServiceFilter, setRunServiceFilter] = useState<string>('all');
  const [runTaskFilter, setRunTaskFilter] = useState<string>('all');
  const [loginPassword, setLoginPassword] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [defaultStrmTargetPath, setDefaultStrmTargetPath] = useState('/media/strm');
  const [appConfig, setAppConfig] = useState<AppConfig>({
    ...defaultAppConfigForm,
    runtimePort: defaultAppConfigForm.port,
    databasePath: '',
    nodeEnv: '',
    resetAdminPasswordEnabled: false,
  });

  const [loginLoading, setLoginLoading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [serviceDrawerOpen, setServiceDrawerOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [submittingService, setSubmittingService] = useState(false);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [latestLogModalOpen, setLatestLogModalOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [managedFilesLoading, setManagedFilesLoading] = useState(false);
  const [managedFileContentLoading, setManagedFileContentLoading] = useState(false);
  const [bulkDeletingFiles, setBulkDeletingFiles] = useState(false);
  const [bulkUpdatingServices, setBulkUpdatingServices] = useState(false);
  const [bulkUpdatingTasks, setBulkUpdatingTasks] = useState(false);
  const [bulkDeletingRuns, setBulkDeletingRuns] = useState(false);
  const [deletingManagedFileIds, setDeletingManagedFileIds] = useState<string[]>([]);
  const [deletingRunIds, setDeletingRunIds] = useState<string[]>([]);

  const [editingService, setEditingService] = useState<OpenlistService | null>(null);
  const [editingTask, setEditingTask] = useState<SyncTask | null>(null);
  const [logTask, setLogTask] = useState<SyncTask | null>(null);
  const [latestRunLog, setLatestRunLog] = useState<TaskRun | null>(null);
  const [managedFileContent, setManagedFileContent] = useState<ManagedFileContent | null>(null);
  const [selectedRun, setSelectedRun] = useState<TaskRun | null>(null);
  const [selectedRunId, setSelectedRunId] = useState(() => getRunIdFromLocation());

  const filteredTasks = useMemo(() => {
    if (serviceFilter === 'all') return tasks;
    return tasks.filter((task) => task.serviceId === serviceFilter);
  }, [serviceFilter, tasks]);

  const hasRunningRuns = runs.some((run) => run.status === 'running');

  useEffect(() => {
    initializeAuthState().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveView(getViewFromLocation());
      setSelectedRunId(getRunIdFromLocation());
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (!user || activeView !== 'runDetail' || !selectedRunId) return;
    if (selectedRun?.id === selectedRunId) return;

    getRun(selectedRunId)
      .then((run) => {
        setSelectedRun(run);
        setRunServiceFilter(run.serviceId);
        setRunTaskFilter(run.taskId);
      })
      .catch((error) => {
        setSelectedRun(null);
        message.error(formatError(error, '加载详细日志失败。'));
      });
  }, [activeView, message, selectedRun?.id, selectedRunId, user]);

  useEffect(() => {
    if (!user) {
      previousViewRef.current = null;
      return;
    }

    const previousView = previousViewRef.current;
    previousViewRef.current = activeView;

    if (!previousView || previousView === activeView) {
      return;
    }

    const refreshCurrentView = async () => {
      try {
        switch (activeView) {
          case 'dashboard':
            await Promise.all([refreshConfig(), refreshServices(), refreshTasks(), refreshRuns(), refreshManagedFiles()]);
            break;
          case 'services':
            await Promise.all([refreshServices(), refreshTasks()]);
            break;
          case 'tasks':
            await Promise.all([refreshServices(), refreshTasks()]);
            break;
          case 'files':
            await Promise.all([refreshTasks(), refreshManagedFiles()]);
            break;
          case 'runs':
            await Promise.all([refreshServices(), refreshRunsAndTasks()]);
            break;
          case 'backup':
            await Promise.all([refreshConfig(), refreshServices(), refreshTasks()]);
            break;
          case 'settings':
            await refreshConfig();
            break;
          default:
            break;
        }
      } catch (error) {
        console.error(`Failed to refresh data for view ${activeView}:`, error);
      }
    };

    refreshCurrentView();
  }, [activeView, user]);

  useEffect(() => {
    if (!user || (!hasRunningRuns && selectedRun?.status !== 'running')) return;

    let cancelled = false;
    const pollRuns = async () => {
      try {
        const [nextRuns, nextTasks, nextSelectedRun] = await Promise.all([
          getRuns(),
          getTasks(),
          activeView === 'runDetail' && selectedRunId ? getRun(selectedRunId) : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setRuns(nextRuns);
          setTasks(nextTasks);
          if (nextSelectedRun) {
            setSelectedRun(nextSelectedRun);
          }
        }
      } catch (error) {
        console.error('Failed to refresh running task state:', error);
      }
    };

    const timer = window.setInterval(pollRuns, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeView, hasRunningRuns, selectedRun?.status, selectedRunId, user]);

  useEffect(() => {
    if (selectedRun) {
      const updatedRun = runs.find((run) => run.id === selectedRun.id);
      if (updatedRun && updatedRun !== selectedRun) {
        setSelectedRun(updatedRun);
      }
    }

    if (latestRunLog) {
      const updatedLatestRun = runs.find((run) => run.id === latestRunLog.id);
      if (updatedLatestRun && updatedLatestRun !== latestRunLog) {
        setLatestRunLog(updatedLatestRun);
      }
      return;
    }

    if (latestLogModalOpen && logTask) {
      const latestTaskRun = runs.find((run) => run.taskId === logTask.id);
      if (latestTaskRun) {
        setLatestRunLog(latestTaskRun);
      }
    }
  }, [latestLogModalOpen, latestRunLog, logTask, runs, selectedRun]);

  function changeView(view: ActiveView) {
    setActiveView(view);
    const nextHash = `#/${view}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = `/${view}`;
    }
  }

  async function bootstrap() {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      await Promise.all([refreshConfig(), refreshServices(), refreshTasks(), refreshRuns(), refreshManagedFiles()]);
    } catch (error) {
      setStoredToken(null);
      setUser(null);
      message.error(formatError(error, '登录状态已失效，请重新登录。'));
    }
  }

  async function initializeAuthState() {
    const setupState = await getSetupRequired();
    setSetupRequired(setupState.required);
    if (setupState.required) {
      setStoredToken(null);
      setUser(null);
      return;
    }

    const token = getStoredToken();
    if (!token) return;

    await bootstrap();
  }

  function openRunDetail(run: TaskRun | null) {
    if (run) {
      setSelectedRun(run);
      setSelectedRunId(run.id);
      setRunServiceFilter(run.serviceId);
      setRunTaskFilter(run.taskId);
    }

    setLatestLogModalOpen(false);
    const nextHash = run ? `#/runDetail?id=${encodeURIComponent(run.id)}` : '#/runDetail';
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      setActiveView('runDetail');
    }
  }

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
    setManagedFilesLoading(true);
    try {
      const payload = await getManagedFiles(nextRootId, nextDirectory);
      setManagedFileRoots(payload.roots);
      setManagedFileEntries(payload.entries);
      setFileRootFilter(payload.currentRootId || '');
      setFileCurrentDirectory(payload.currentDirectory || '');
      setFileParentDirectory(payload.parentDirectory);

      return payload;
    } finally {
      setManagedFilesLoading(false);
    }
  }

  async function refreshRunsAndTasks() {
    const [nextRuns, nextTasks] = await Promise.all([getRuns(), getTasks()]);
    setRuns(nextRuns);
    setTasks(nextTasks);
    return nextRuns;
  }

  function clearDeletedRuns(runIds: string[]) {
    if (!runIds.length) return;

    setRuns((currentRuns) => currentRuns.filter((run) => !runIds.includes(run.id)));

    if (selectedRun && runIds.includes(selectedRun.id)) {
      setSelectedRun(null);
      setSelectedRunId('');
      if (activeView === 'runDetail') {
        changeView('runs');
      }
    }

    if (latestRunLog && runIds.includes(latestRunLog.id)) {
      setLatestRunLog(null);
    }
  }

  function handleAuthSuccess(result: AuthResponse) {
    setStoredToken(result.token);
    setUser({
      username: result.username,
      mustChangePassword: result.mustChangePassword,
    });
  }

  async function handleLogin() {
    if (!loginPassword.trim()) {
      message.warning('请输入管理员密码。');
      return;
    }

    setLoginLoading(true);
    try {
      const result = await login(loginPassword.trim());
      handleAuthSuccess(result);
      setLoginPassword('');
      if (result.mustChangePassword) {
        setSetupRequired(true);
        setStoredToken(null);
        setUser(null);
        message.success('请先设置新的管理员密码。');
        return;
      }

      await Promise.all([refreshConfig(), refreshServices(), refreshTasks(), refreshRuns(), refreshManagedFiles()]);
      message.success('登录成功。');
    } catch (error) {
      message.error(formatError(error, '登录失败。'));
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Ignore logout failures.
    }

    setStoredToken(null);
    setUser(null);
    setServices([]);
    setTasks([]);
    setRuns([]);
    setManagedFileRoots([]);
    setManagedFileEntries([]);
    setServiceFilter('all');
    setFileRootFilter('');
    setFileCurrentDirectory('');
    setFileParentDirectory(null);
    setRunServiceFilter('all');
    setRunTaskFilter('all');
    changeView('dashboard');
    message.success('已退出登录。');
  }

  async function handlePasswordChange(newPassword: string) {
    setChangingPassword(true);
    try {
      const result = await changePassword(newPassword);
      handleAuthSuccess(result);
      setPasswordOpen(false);
      await Promise.all([refreshConfig(), refreshServices(), refreshTasks(), refreshRuns(), refreshManagedFiles()]);
      message.success('密码修改成功。');
    } catch (error) {
      message.error(formatError(error, '密码修改失败。'));
      throw error;
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleExportBackup() {
    try {
      setExporting(true);
      const backup = await exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `strm-manager-backup-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
      message.success('备份文件已导出。');
    } catch (error) {
      message.error(formatError(error, '导出备份失败。'));
    } finally {
      setExporting(false);
    }
  }

  async function handleRestoreBackup(file: File) {
    try {
      setRestoring(true);
      const result = await restoreBackup(file);
      await Promise.all([refreshConfig(), refreshServices(), refreshTasks(), refreshRuns(), refreshManagedFiles()]);
      setEditingService(null);
      setEditingTask(null);
      setServiceDrawerOpen(false);
      setTaskDrawerOpen(false);
      message.success(`恢复完成：服务 ${result.restoredServices} 个，任务 ${result.restoredTasks} 个。`);
    } catch (error) {
      message.error(formatError(error, '恢复备份失败。'));
      throw error;
    } finally {
      setRestoring(false);
    }
  }

  async function handleAppConfigSubmit(values: typeof defaultAppConfigForm) {
    setSavingConfig(true);
    try {
      const result = await updateAppConfig(values);
      setAppConfig(result);
      setDefaultStrmTargetPath(result.defaultStrmTargetPath || '/media/strm');
      if (result.runtimePort !== result.port) {
        message.success('系统配置已保存，PORT 修改将在重启应用后生效。');
      } else {
        message.success('系统配置已保存。');
      }
    } catch (error) {
      message.error(formatError(error, '保存系统配置失败。'));
      throw error;
    } finally {
      setSavingConfig(false);
    }
  }

  function openCreateService() {
    setEditingService(null);
    setServiceDrawerOpen(true);
  }

  function openEditService(service: OpenlistService) {
    setEditingService(service);
    setServiceDrawerOpen(true);
  }

  async function submitService(values: typeof defaultServiceForm) {
    setSubmittingService(true);
    try {
      if (editingService) {
        if (editingService.enabled && !values.enabled) {
          const taskCount = tasks.filter((task) => task.serviceId === editingService.id).length;
          const confirmed = await new Promise<boolean>((resolve) => {
            Modal.confirm({
              title: '禁用 OpenList 服务',
              content: `禁用服务后，将同步禁用其关联的 ${taskCount} 个任务。确认继续？`,
              okText: '确认禁用',
              cancelText: '取消',
              okButtonProps: { danger: true },
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });

          if (!confirmed) return;
        }

        await updateService(editingService.id, values);
        message.success('OpenList 服务已更新。');
      } else {
        await createService(values);
        message.success('OpenList 服务已创建。');
      }

      await Promise.all([refreshServices(), refreshTasks(), refreshRuns(), refreshManagedFiles()]);
      setServiceDrawerOpen(false);
      setEditingService(null);
    } catch (error) {
      message.error(formatError(error, '保存 OpenList 服务失败。'));
      throw error;
    } finally {
      setSubmittingService(false);
    }
  }

  async function removeService(service: OpenlistService) {
    try {
      await deleteService(service.id);
      await Promise.all([refreshServices(), refreshManagedFiles()]);
      message.success(`服务 ${getServiceDisplayName(service)} 已删除。`);
    } catch (error) {
      message.error(formatError(error, '删除 OpenList 服务失败。'));
    }
  }

  async function handleInitialPasswordSetup() {
    const nextPassword = setupPassword.trim();
    if (nextPassword.length < 8) {
      message.warning('新密码至少需要 8 个字符。');
      return;
    }

    if (nextPassword !== setupConfirmPassword.trim()) {
      message.warning('两次输入的新密码不一致。');
      return;
    }

    setChangingPassword(true);
    try {
      const result = await setupInitialPassword(nextPassword);
      setSetupRequired(false);
      handleAuthSuccess(result);
      await Promise.all([refreshConfig(), refreshServices(), refreshTasks(), refreshRuns(), refreshManagedFiles()]);
      message.success('管理员密码设置成功。');
    } catch (error) {
      message.error(formatError(error, '设置管理员密码失败。'));
      throw error;
    } finally {
      setChangingPassword(false);
    }
    setSetupPassword('');
    setSetupConfirmPassword('');
  }

  async function toggleServiceEnabled(service: OpenlistService, enabled: boolean) {
    if (service.enabled === enabled) return;

    try {
      await updateService(service.id, {
        name: service.name,
        url: service.url,
        token: service.token,
        baseUrl: service.baseUrl,
        enabled,
      });
      await Promise.all([refreshServices(), refreshTasks(), refreshRuns()]);
      message.success(enabled ? '服务已启用。' : '服务已禁用。');
    } catch (error) {
      message.error(formatError(error, '更新服务状态失败。'));
    }
  }

  async function handleBulkUpdateServicesEnabled(serviceIds: string[], enabled: boolean) {
    if (!serviceIds.length) {
      message.warning('请先勾选需要修改状态的服务。');
      return;
    }

    setBulkUpdatingServices(true);
    try {
      const result = await bulkUpdateServicesEnabled(serviceIds, enabled);
      await Promise.all([refreshServices(), refreshTasks(), refreshRuns()]);
      message.success(`已${enabled ? '启用' : '禁用'} ${result.updatedCount} 个服务。`);
    } catch (error) {
      message.error(formatError(error, '批量修改服务状态失败。'));
    } finally {
      setBulkUpdatingServices(false);
    }
  }

  function openCreateTask() {
    if (!services.length) {
      message.warning('请先新增 OpenList 服务。');
      changeView('services');
      return;
    }

    if (!services.some((service) => service.enabled)) {
      message.warning('请先启用至少一个 OpenList 服务。');
      changeView('services');
      return;
    }

    setEditingTask(null);
    setTaskDrawerOpen(true);
  }

  function openEditTask(task: SyncTask) {
    setEditingTask(task);
    setTaskDrawerOpen(true);
  }

  async function openTaskLog(task: SyncTask) {
    try {
      setLogTask(task);
      setLatestRunLog(null);
      setLogLoading(true);
      setLatestLogModalOpen(true);
      const logs = await getTaskRuns(task.id);
      setLatestRunLog(logs[0] || null);
    } catch (error) {
      message.error(formatError(error, '加载任务日志失败。'));
    } finally {
      setLogLoading(false);
    }
  }

  async function submitTask(values: typeof defaultTaskForm) {
    setSubmittingTask(true);
    try {
      if (editingTask) {
        await updateTask(editingTask.id, values);
        message.success('定时任务已更新。');
      } else {
        await createTask(values);
        message.success('定时任务已创建。');
      }

      await Promise.all([refreshTasks(), refreshManagedFiles()]);
      setTaskDrawerOpen(false);
      setEditingTask(null);
    } catch (error) {
      message.error(formatError(error, '保存定时任务失败。'));
      throw error;
    } finally {
      setSubmittingTask(false);
    }
  }

  async function removeTask(task: SyncTask) {
    try {
      await deleteTask(task.id);
      await Promise.all([refreshTasks(), refreshRuns(), refreshManagedFiles()]);
      message.success(`任务 ${task.name} 已删除。`);
    } catch (error) {
      message.error(formatError(error, '删除定时任务失败。'));
    }
  }

  async function toggleTaskEnabled(task: SyncTask, enabled: boolean) {
    if (task.enabled === enabled) return;

    try {
      await updateTask(task.id, {
        name: task.name,
        serviceId: task.serviceId,
        sourcePath: task.sourcePath,
        targetPath: task.targetPath,
        scheduleEnabled: Boolean(task.cron),
        cron: task.cron,
        maxConcurrency: task.maxConcurrency,
        downloadExtensions: task.downloadExtensions,
        downloadSubtitles: task.downloadSubtitles,
        requestDelaySeconds: task.requestDelaySeconds,
        overwriteExisting: task.overwriteExisting,
        enabled,
        notifyEnabled: task.notifyEnabled,
        callbackUrl: task.callbackUrl,
      });
      await Promise.all([refreshTasks(), refreshRuns()]);
      message.success(enabled ? '任务已启用。' : '任务已禁用。');
    } catch (error) {
      message.error(formatError(error, '更新任务状态失败。'));
    }
  }

  async function handleBulkUpdateTasksEnabled(taskIds: string[], enabled: boolean) {
    if (!taskIds.length) {
      message.warning('请先勾选已配置定时的任务。');
      return;
    }

    setBulkUpdatingTasks(true);
    try {
      const result = await bulkUpdateTasksEnabled(taskIds, enabled);
      await refreshTasks();
      message.success(`已${enabled ? '启用' : '禁用'} ${result.updatedCount} 个任务。`);
    } catch (error) {
      message.error(formatError(error, '批量修改任务状态失败。'));
    } finally {
      setBulkUpdatingTasks(false);
    }
  }

  async function triggerTask(task: SyncTask) {
    try {
      await triggerTaskRun(task.id);
      await refreshRuns();
      message.success(`任务 ${task.name} 已开始执行。`);
    } catch (error) {
      message.error(formatError(error, '任务触发失败。'));
    }
  }

  function openManagedDirectory(relativePath: string) {
    void refreshManagedFiles(fileRootFilter, relativePath);
  }

  function openManagedParentDirectory() {
    if (!fileParentDirectory && fileParentDirectory !== '') return;
    void refreshManagedFiles(fileRootFilter, fileParentDirectory || '');
  }

  async function handleDeleteManagedFile(entry: ManagedFileEntry) {
    if (!fileRootFilter) return;

    setDeletingManagedFileIds((current) => Array.from(new Set([...current, entry.id])));
    try {
      await deleteManagedFile(fileRootFilter, entry.relativePath);
      await refreshManagedFiles(fileRootFilter, fileCurrentDirectory);
      message.success(`${entry.type === 'directory' ? '文件夹' : '文件'} ${entry.name} 已删除。`);
    } catch (error) {
      message.error(formatError(error, '删除文件失败。'));
    } finally {
      setDeletingManagedFileIds((current) => current.filter((id) => id !== entry.id));
    }
  }

  async function handleBulkDeleteManagedFiles(entries: ManagedFileEntry[]) {
    if (!fileRootFilter || !entries.length) {
      message.warning('请先勾选需要删除的文件或文件夹。');
      return;
    }

    setBulkDeletingFiles(true);
    setDeletingManagedFileIds((current) => Array.from(new Set([...current, ...entries.map((entry) => entry.id)])));
    try {
      const result = await bulkDeleteManagedFiles(
        fileRootFilter,
        entries.map((entry) => entry.relativePath),
      );
      await refreshManagedFiles(fileRootFilter, fileCurrentDirectory);
      message.success(`已删除 ${result.deletedCount} 项。`);
    } catch (error) {
      message.error(formatError(error, '批量删除文件失败。'));
    } finally {
      setBulkDeletingFiles(false);
      setDeletingManagedFileIds((current) => current.filter((id) => !entries.some((entry) => entry.id === id)));
    }
  }

  async function handleViewManagedFileContent(entry: ManagedFileEntry) {
    if (!fileRootFilter) return;

    setManagedFileContentLoading(true);
    try {
      const content = await getManagedFileContent(fileRootFilter, entry.relativePath);
      setManagedFileContent(content);
    } catch (error) {
      message.error(formatError(error, '读取文件内容失败。'));
    } finally {
      setManagedFileContentLoading(false);
    }
  }

  async function handleDeleteRun(run: TaskRun) {
    setDeletingRunIds((current) => Array.from(new Set([...current, run.id])));
    try {
      await deleteRun(run.id);
      clearDeletedRuns([run.id]);
      message.success(`运行记录 ${run.taskName} 已删除。`);
    } catch (error) {
      message.error(formatError(error, '删除运行记录失败。'));
    } finally {
      setDeletingRunIds((current) => current.filter((id) => id !== run.id));
    }
  }

  async function handleBulkDeleteRuns(ids: string[]) {
    if (!ids.length) {
      message.warning('请先勾选需要删除的运行记录。');
      return;
    }

    setBulkDeletingRuns(true);
    setDeletingRunIds((current) => Array.from(new Set([...current, ...ids])));
    try {
      const result = await bulkDeleteRuns(ids);
      clearDeletedRuns(ids);
      message.success(`已删除 ${result.deletedCount} 条运行记录。`);
    } catch (error) {
      message.error(formatError(error, '批量删除运行记录失败。'));
    } finally {
      setBulkDeletingRuns(false);
      setDeletingRunIds((current) => current.filter((id) => !ids.includes(id)));
    }
  }

  if (loading) {
    return <LoginPage loadingOnly />;
  }

  if (setupRequired || !user) {
    return (
      <LoginPage
        version={ADMIN_VERSION}
        setupMode={setupRequired}
        password={loginPassword}
        newPassword={setupPassword}
        confirmPassword={setupConfirmPassword}
        loading={loginLoading || changingPassword}
        onPasswordChange={setLoginPassword}
        onNewPasswordChange={setSetupPassword}
        onConfirmPasswordChange={setSetupConfirmPassword}
        onSubmit={setupRequired ? handleInitialPasswordSetup : handleLogin}
      />
    );
  }

  const viewInfo = viewMeta[activeView];
  const actionsDisabled = false;

  let pageContent = null;

  if (activeView === 'dashboard') {
    pageContent = (
      <DashboardPage
        services={services}
        tasks={tasks}
        runs={runs}
        actionsDisabled={actionsDisabled}
        onCreateService={openCreateService}
        onCreateTask={openCreateTask}
        onEditService={openEditService}
        onRefreshRuns={refreshRuns}
        onSwitchView={changeView}
      />
    );
  } else if (activeView === 'services') {
    pageContent = (
      <ServicesPage
        services={services}
        tasks={tasks}
        actionsDisabled={actionsDisabled}
        bulkUpdating={bulkUpdatingServices}
        onCreateService={openCreateService}
        onEditService={openEditService}
        onDeleteService={removeService}
        onToggleServiceEnabled={toggleServiceEnabled}
        onBulkUpdateServicesEnabled={handleBulkUpdateServicesEnabled}
        onRefresh={refreshServices}
      />
    );
  } else if (activeView === 'tasks') {
    pageContent = (
      <TasksPage
        services={services}
        tasks={filteredTasks}
        serviceFilter={serviceFilter}
        actionsDisabled={actionsDisabled}
        logModalOpen={latestLogModalOpen}
        logTask={logTask}
        latestRunLog={latestRunLog}
        logLoading={logLoading}
        bulkUpdating={bulkUpdatingTasks}
        onFilterChange={setServiceFilter}
        onCreateTask={openCreateTask}
        onEditTask={openEditTask}
        onDeleteTask={removeTask}
        onTriggerTask={triggerTask}
        onToggleTaskEnabled={toggleTaskEnabled}
        onBulkUpdateTasksEnabled={handleBulkUpdateTasksEnabled}
        onOpenLog={openTaskLog}
        onCloseLog={() => setLatestLogModalOpen(false)}
        onViewRunDetail={openRunDetail}
        onRefresh={refreshTasks}
      />
    );
  } else if (activeView === 'files') {
    pageContent = (
      <FilesPage
        roots={managedFileRoots}
        entries={managedFileEntries}
        rootFilter={fileRootFilter}
        currentDirectory={fileCurrentDirectory}
        parentDirectory={fileParentDirectory}
        loading={managedFilesLoading}
        deletingIds={deletingManagedFileIds}
        bulkDeleting={bulkDeletingFiles}
        fileContent={managedFileContent}
        fileContentLoading={managedFileContentLoading}
        onFilterChange={(value) => {
          void refreshManagedFiles(value, '');
        }}
        onOpenDirectory={openManagedDirectory}
        onGoParent={openManagedParentDirectory}
        onDeleteEntry={handleDeleteManagedFile}
        onBulkDeleteEntries={handleBulkDeleteManagedFiles}
        onViewFileContent={handleViewManagedFileContent}
        onCloseFileContent={() => setManagedFileContent(null)}
        onRefresh={refreshManagedFiles}
      />
    );
  } else if (activeView === 'runs') {
    pageContent = (
      <RunsPage
        runs={runs}
        services={services}
        tasks={tasks}
        serviceFilter={runServiceFilter}
        taskFilter={runTaskFilter}
        selectedRun={selectedRun}
        deletingRunIds={deletingRunIds}
        bulkDeleting={bulkDeletingRuns}
        onServiceFilterChange={(value) => {
          setRunServiceFilter(value);
          setRunTaskFilter('all');
        }}
        onTaskFilterChange={setRunTaskFilter}
        onRefresh={refreshRunsAndTasks}
        onViewRunDetail={openRunDetail}
        onDeleteRun={handleDeleteRun}
        onBulkDeleteRuns={handleBulkDeleteRuns}
      />
    );
  } else if (activeView === 'runDetail') {
    pageContent = (
      <RunDetailPage
        run={selectedRun}
        onBack={() => changeView('runs')}
        onRefresh={refreshRunsAndTasks}
        onRunUpdate={(run) => {
          setSelectedRun(run);
          setRuns((currentRuns) => currentRuns.map((item) => (item.id === run.id ? run : item)));
        }}
      />
    );
  } else if (activeView === 'settings') {
    pageContent = <SettingsPage config={appConfig} submitting={savingConfig} onSubmit={handleAppConfigSubmit} />;
  } else {
    pageContent = (
      <BackupPage
        services={services}
        tasks={tasks}
        exporting={exporting}
        restoring={restoring}
        onExport={handleExportBackup}
        onRestore={handleRestoreBackup}
      />
    );
  }

  return (
    <>
      <AdminShell
        version={ADMIN_VERSION}
        activeView={activeView}
        pageTitle={viewInfo.title}
        pageDescription={viewInfo.description}
        username={user.username}
        onChangeView={changeView}
        onOpenPassword={() => setPasswordOpen(true)}
        onLogout={handleLogout}
      >
        {pageContent}
      </AdminShell>

      <ServiceDrawer
        open={serviceDrawerOpen}
        service={editingService}
        submitting={submittingService}
        onClose={() => {
          setServiceDrawerOpen(false);
          setEditingService(null);
        }}
        onSubmit={submitService}
      />

      <TaskDrawer
        open={taskDrawerOpen}
        task={editingTask}
        services={services}
        defaultTargetPath={defaultStrmTargetPath}
        submitting={submittingTask}
        onClose={() => {
          setTaskDrawerOpen(false);
          setEditingTask(null);
        }}
        onSubmit={submitTask}
      />

      <PasswordModal
        open={passwordOpen}
        required={false}
        loading={changingPassword}
        onClose={() => setPasswordOpen(false)}
        onSubmit={handlePasswordChange}
      />
    </>
  );
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
