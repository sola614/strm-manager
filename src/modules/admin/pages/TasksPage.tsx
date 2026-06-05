import { ClearOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Popconfirm, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useState } from 'react';
import { OpenlistService, SyncTask, TaskRun } from '../../../types';
import { getNextRun } from '../../../lib/cron';
import {
  buildDisplaySourcePath,
  formatDateTime,
  getServiceDisplayName,
  getServiceName,
  getStoredPageSize,
  setStoredPageSize,
} from '../utils';
import { RunLogModal } from '../components/RunLogModal';

const { Text } = Typography;

interface TasksPageProps {
  services: OpenlistService[];
  tasks: SyncTask[];
  serviceFilter: string;
  logModalOpen: boolean;
  logTask: SyncTask | null;
  latestRunLog: TaskRun | null;
  logLoading: boolean;
  bulkUpdating: boolean;
  onFilterChange: (value: string) => void;
  onResetFilters: () => void;
  onCreateTask: () => void;
  onEditTask: (task: SyncTask) => void;
  onDeleteTask: (task: SyncTask) => void;
  onTriggerTask: (task: SyncTask) => void;
  onToggleTaskEnabled: (task: SyncTask, enabled: boolean) => void;
  onBulkUpdateTasksEnabled: (taskIds: string[], enabled: boolean) => void;
  onOpenLog: (task: SyncTask) => void;
  onCloseLog: () => void;
  onViewRunDetail: (run: TaskRun | null) => void;
  onRefresh: () => void;
}

export function TasksPage(props: TasksPageProps) {
  const [pageSize, setPageSize] = useState(() => getStoredPageSize('tasks'));
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  function canRunTask(task: SyncTask) {
    const service = props.services.find((item) => item.id === task.serviceId);
    return (!task.cron || task.enabled) && service?.enabled !== false;
  }

  const selectedScheduledTaskIds = props.tasks
    .filter((task) => selectedRowKeys.includes(task.id) && Boolean(task.cron))
    .map((task) => task.id);

  const columns: ColumnsType<SyncTask> = [
    {
      title: '任务',
      key: 'task',
      render: (_value: unknown, record: SyncTask) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.name}</Text>
          <Text type="secondary">#{record.id}</Text>
        </Space>
      ),
    },
    {
      title: '所属服务',
      dataIndex: 'serviceId',
      key: 'serviceId',
      render: (value: string) => getServiceName(props.services, value),
    },
    {
      title: '视频源目录',
      key: 'sourcePath',
      render: (_value: unknown, record: SyncTask) => {
        const service = props.services.find((item) => item.id === record.serviceId);
        return buildDisplaySourcePath(service?.baseUrl || '/', record.sourcePath);
      },
    },
    {
      title: 'strm文件存放目录',
      dataIndex: 'targetPath',
      key: 'targetPath',
      ellipsis: true,
    },
    {
      title: '状态',
      key: 'enabled',
      render: (_value: unknown, record: SyncTask) =>
        record.cron ? (
          <Select
            size="small"
            value={record.enabled}
            style={{ width: 96 }}
            onChange={(enabled) => props.onToggleTaskEnabled(record, enabled)}
            options={[
              { label: '已启用', value: true },
              { label: '已禁用', value: false },
            ]}
          />
        ) : (
          <Text type="secondary">仅手动</Text>
        ),
    },
    {
      title: 'Cron',
      dataIndex: 'cron',
      key: 'cron',
      render: (value: string) => value || '仅手动',
    },
    {
      title: '下次执行',
      key: 'nextRun',
      render: (_value: unknown, record: SyncTask) =>
        canRunTask(record) && record.cron ? getNextRun(record.cron) || '-' : '-',
    },
    {
      title: '最近运行',
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 340,
      render: (_value: unknown, record: SyncTask) => (
        <Space wrap>
          <Button size="small" onClick={() => props.onEditTask(record)}>
            编辑
          </Button>
          <Button size="small" onClick={() => props.onOpenLog(record)}>
            日志
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={!canRunTask(record)}
            onClick={() => props.onTriggerTask(record)}
          >
            立即执行
          </Button>
          <Popconfirm title="删除定时任务" onConfirm={() => props.onDeleteTask(record)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pagination: TablePaginationConfig = {
    pageSize,
    pageSizeOptions: ['20', '50', '100'],
    showSizeChanger: true,
    onShowSizeChange: (_current, size) => {
      setPageSize(size);
      setStoredPageSize('tasks', size);
    },
  };

  return (
    <>
      <Card
        className="module-card"
        title="定时任务管理"
        extra={
          <Space>
            <Select
              value={props.serviceFilter}
              style={{ width: 260 }}
              onChange={(value) => {
                setSelectedRowKeys([]);
                props.onFilterChange(value);
              }}
              options={[
                { label: '全部服务', value: 'all' },
                ...props.services.map((service) => ({
                  label: getServiceDisplayName(service),
                  value: service.id,
                })),
              ]}
            />
            <Button
              icon={<ClearOutlined />}
              onClick={() => {
                setSelectedRowKeys([]);
                props.onResetFilters();
              }}
            >
              重置
            </Button>
            <Button
              disabled={!selectedScheduledTaskIds.length}
              loading={props.bulkUpdating}
              onClick={() => {
                props.onBulkUpdateTasksEnabled(selectedScheduledTaskIds, true);
                setSelectedRowKeys([]);
              }}
            >
              批量启用
            </Button>
            <Button
              disabled={!selectedScheduledTaskIds.length}
              loading={props.bulkUpdating}
              onClick={() => {
                props.onBulkUpdateTasksEnabled(selectedScheduledTaskIds, false);
                setSelectedRowKeys([]);
              }}
            >
              批量禁用
            </Button>
            <Button icon={<ReloadOutlined />} onClick={props.onRefresh}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={props.onCreateTask}
            >
              新增任务
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={props.tasks}
          pagination={pagination}
          rowSelection={{
            selectedRowKeys,
            getCheckboxProps: (record) => ({
              disabled: !record.cron,
            }),
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
        />
      </Card>

      <RunLogModal
        open={props.logModalOpen}
        title={props.logTask ? `最新运行日志 - ${props.logTask.name}` : '最新运行日志'}
        run={props.latestRunLog}
        loading={props.logLoading}
        onClose={props.onCloseLog}
        footerExtra={
          props.latestRunLog ? (
            <Button type="primary" onClick={() => props.onViewRunDetail(props.latestRunLog)}>
              查看详细日志
            </Button>
          ) : undefined
        }
      />
    </>
  );
}
