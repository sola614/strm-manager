import {
  AppstoreOutlined,
  CloudServerOutlined,
  FileSyncOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { ActiveView, AppConfigFormValues, OpenlistServiceFormValues, SyncTaskFormValues } from '../../types';
import packageInfo from '../../../package.json';

export const ADMIN_VERSION = `v${packageInfo.version}`;

export const defaultServiceForm: OpenlistServiceFormValues = {
  name: '',
  url: '',
  token: '',
  baseUrl: '/',
  enabled: true,
};

export const defaultTaskForm: SyncTaskFormValues = {
  name: '',
  serviceId: '',
  sourcePath: '',
  targetPath: '',
  scheduleEnabled: true,
  cron: '0 0 * * * *',
  maxConcurrency: 5,
  downloadExtensions: 'mp4,mkv',
  downloadSubtitles: false,
  requestDelaySeconds: '5',
  overwriteExisting: false,
  notifyEnabled: false,
  callbackUrl: '',
};

export const defaultAppConfigForm: AppConfigFormValues = {
  port: 4173,
  defaultStrmTargetPath: '/media/strm',
  logCleanupEnabled: true,
  logRetentionDays: 7,
  timezone: 'Asia/Shanghai',
};

export const viewMeta: Record<
  ActiveView,
  {
    title: string;
    description: string;
    menuLabel: string;
    icon: ReactNode;
  }
> = {
  dashboard: {
    title: '仪表盘',
    description: '查看服务、任务与运行状态的整体概览。',
    menuLabel: '仪表盘',
    icon: <AppstoreOutlined />,
  },
  services: {
    title: '服务管理',
    description: '维护 OpenList 服务配置，供任务统一使用。',
    menuLabel: '服务管理',
    icon: <CloudServerOutlined />,
  },
  tasks: {
    title: '任务管理',
    description: '按服务组织 STRM 生成任务，支持定时和手动执行。',
    menuLabel: '任务管理',
    icon: <FileSyncOutlined />,
  },
  files: {
    title: '文件管理',
    description: '查看任务 STRM 文件存放目录下的所有文件夹和文件，并按目录筛选。',
    menuLabel: '文件管理',
    icon: <FolderOpenOutlined />,
  },
  runs: {
    title: '运行记录',
    description: '查看最近任务执行结果与失败信息。',
    menuLabel: '运行记录',
    icon: <ReloadOutlined />,
  },
  runDetail: {
    title: '详细日志',
    description: '查看单次任务运行的完整处理日志。',
    menuLabel: '详细日志',
    icon: <ReloadOutlined />,
  },
  backup: {
    title: '备份与恢复',
    description: '导出当前配置备份，或上传备份文件恢复服务与任务。',
    menuLabel: '备份管理',
    icon: <InboxOutlined />,
  },
  settings: {
    title: '系统配置',
    description: '维护默认输出目录、服务端口与运行日志清理策略。',
    menuLabel: '系统配置',
    icon: <SettingOutlined />,
  },
};
