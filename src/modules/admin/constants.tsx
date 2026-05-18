import {
  AppstoreOutlined,
  CloudServerOutlined,
  FileSyncOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { ActiveView, OpenlistServiceFormValues, SyncTaskFormValues } from '../../types';

export const ADMIN_VERSION = 'v1.0.0';

export const defaultServiceForm: OpenlistServiceFormValues = {
  name: '',
  url: '',
  token: '',
  baseUrl: '/',
};

export const defaultTaskForm: SyncTaskFormValues = {
  name: '',
  serviceId: '',
  sourcePath: '',
  targetPath: 'D:\\media\\strm',
  cron: '0 0 * * * *',
  maxConcurrency: 5,
  downloadExtensions: 'mp4,mkv',
  downloadSubtitles: false,
  requestDelaySeconds: 5,
  overwriteExisting: false,
  notifyEnabled: false,
  callbackUrl: '',
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
    title: '仪表板',
    description: '查看服务、任务与运行状态的整体概览。',
    menuLabel: '仪表板',
    icon: <AppstoreOutlined />,
  },
  services: {
    title: 'OpenList 服务管理',
    description: '先维护 OpenList 服务，再在已有服务下创建定时任务。',
    menuLabel: '服务管理',
    icon: <CloudServerOutlined />,
  },
  tasks: {
    title: '定时任务管理',
    description: '按服务组织 STRM 生成任务，支持定时和手动执行。',
    menuLabel: '任务管理',
    icon: <FileSyncOutlined />,
  },
  runs: {
    title: '运行记录',
    description: '查看最近任务执行结果与失败信息。',
    menuLabel: '运行记录',
    icon: <ReloadOutlined />,
  },
  backup: {
    title: '备份与恢复',
    description: '导出当前配置备份，或上传备份文件恢复服务与任务。',
    menuLabel: '备份管理',
    icon: <InboxOutlined />,
  },
};
