import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useMemo, useState } from 'react';
import {
  changePassword,
  createService,
  createTask,
  deleteService,
  deleteTask,
  exportBackup,
  getCurrentUser,
  getRuns,
  getServices,
  getStoredToken,
  getTaskRuns,
  getTasks,
  login,
  logout,
  restoreBackup,
  setStoredToken,
  triggerTaskRun,
  updateService,
  updateTask,
} from './lib/api';
import { PasswordModal } from './modules/admin/forms/PasswordModal';
import { ServiceDrawer } from './modules/admin/forms/ServiceDrawer';
import { TaskDrawer } from './modules/admin/forms/TaskDrawer';
import { ADMIN_VERSION, defaultServiceForm, defaultTaskForm, viewMeta } from './modules/admin/constants';
import { AdminShell } from './modules/admin/layout/AdminShell';
import { DashboardPage } from './modules/admin/pages/DashboardPage';
import { BackupPage } from './modules/admin/pages/BackupPage';
import { LoginPage } from './modules/admin/pages/LoginPage';
import { RunsPage } from './modules/admin/pages/RunsPage';
import { ServicesPage } from './modules/admin/pages/ServicesPage';
import { TasksPage } from './modules/admin/pages/TasksPage';
import { ActiveView, AuthResponse, OpenlistService, SessionUser, SyncTask, TaskRun } from './types';

const validViews: ActiveView[] = ['dashboard', 'services', 'tasks', 'runs', 'backup'];

function getViewFromLocation(): ActiveView {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return validViews.includes(raw as ActiveView) ? (raw as ActiveView) : 'dashboard';
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

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [services, setServices] = useState<OpenlistService[]>([]);
  const [tasks, setTasks] = useState<SyncTask[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>(() => getViewFromLocation());
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [runServiceFilter, setRunServiceFilter] = useState<string>('all');
  const [runTaskFilter, setRunTaskFilter] = useState<string>('all');
  const [loginPassword, setLoginPassword] = useState('');

  const [loginLoading, setLoginLoading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [serviceDrawerOpen, setServiceDrawerOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [submittingService, setSubmittingService] = useState(false);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [latestLogModalOpen, setLatestLogModalOpen] = useState(false);
  const [runLogModalOpen, setRunLogModalOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);

  const [editingService, setEditingService] = useState<OpenlistService | null>(null);
  const [editingTask, setEditingTask] = useState<SyncTask | null>(null);
  const [logTask, setLogTask] = useState<SyncTask | null>(null);
  const [latestRunLog, setLatestRunLog] = useState<TaskRun | null>(null);
  const [selectedRun, setSelectedRun] = useState<TaskRun | null>(null);

  const filteredTasks = useMemo(() => {
    if (serviceFilter === 'all') return tasks;
    return tasks.filter((task) => task.serviceId === serviceFilter);
  }, [serviceFilter, tasks]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    bootstrap().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveView(getViewFromLocation());
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

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
      await Promise.all([refreshServices(), refreshTasks(), refreshRuns()]);
    } catch (error) {
      setStoredToken(null);
      setUser(null);
      message.error(formatError(error, '登录状态已失效，请重新登录。'));
    }
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
      await Promise.all([refreshServices(), refreshTasks(), refreshRuns()]);
      message.success(result.mustChangePassword ? '请先修改默认密码。' : '登录成功。');
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
    setServiceFilter('all');
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
      await Promise.all([refreshServices(), refreshTasks(), refreshRuns()]);
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
        await updateService(editingService.id, values);
        message.success('OpenList 服务已更新。');
      } else {
        await createService(values);
        message.success('OpenList 服务已创建。');
      }

      await refreshServices();
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
      await refreshServices();
      message.success(`服务 ${service.name} 已删除。`);
    } catch (error) {
      message.error(formatError(error, '删除 OpenList 服务失败。'));
    }
  }

  function openCreateTask() {
    if (!services.length) {
      message.warning('请先新增 OpenList 服务。');
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

  function viewTaskHistory(task: SyncTask) {
    setLatestLogModalOpen(false);
    setRunServiceFilter(task.serviceId);
    setRunTaskFilter(task.id);
    changeView('runs');
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

      await refreshTasks();
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
      await Promise.all([refreshTasks(), refreshRuns()]);
      message.success(`任务 ${task.name} 已删除。`);
    } catch (error) {
      message.error(formatError(error, '删除定时任务失败。'));
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

  if (loading) {
    return <LoginPage loadingOnly />;
  }

  if (!user) {
    return (
      <LoginPage
        version={ADMIN_VERSION}
        password={loginPassword}
        loading={loginLoading}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
      />
    );
  }

  const mustChangePassword = user.mustChangePassword;
  const viewInfo = viewMeta[activeView];
  const actionsDisabled = mustChangePassword;

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
        onCreateService={openCreateService}
        onEditService={openEditService}
        onDeleteService={removeService}
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
        onFilterChange={setServiceFilter}
        onCreateTask={openCreateTask}
        onEditTask={openEditTask}
        onDeleteTask={removeTask}
        onTriggerTask={triggerTask}
        onOpenLog={openTaskLog}
        onCloseLog={() => setLatestLogModalOpen(false)}
        onViewTaskHistory={viewTaskHistory}
        onRefresh={refreshTasks}
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
        logModalOpen={runLogModalOpen}
        onServiceFilterChange={(value) => {
          setRunServiceFilter(value);
          setRunTaskFilter('all');
        }}
        onTaskFilterChange={setRunTaskFilter}
        onRefresh={refreshRuns}
        onOpenLog={(run) => {
          setSelectedRun(run);
          setRunLogModalOpen(true);
        }}
        onCloseLog={() => setRunLogModalOpen(false)}
      />
    );
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
        submitting={submittingTask}
        onClose={() => {
          setTaskDrawerOpen(false);
          setEditingTask(null);
        }}
        onSubmit={submitTask}
      />

      <PasswordModal
        open={passwordOpen || mustChangePassword}
        required={mustChangePassword}
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
