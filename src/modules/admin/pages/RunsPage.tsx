import { ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useState } from 'react';
import { OpenlistService, SyncTask, TaskRun } from '../../../types';
import { formatDateTime, getStoredPageSize, setStoredPageSize, statusColor } from '../utils';
import { RunLogModal } from '../components/RunLogModal';

interface RunsPageProps {
  runs: TaskRun[];
  services: OpenlistService[];
  tasks: SyncTask[];
  serviceFilter: string;
  taskFilter: string;
  selectedRun: TaskRun | null;
  logModalOpen: boolean;
  onServiceFilterChange: (value: string) => void;
  onTaskFilterChange: (value: string) => void;
  onRefresh: () => void;
  onOpenLog: (run: TaskRun) => void;
  onCloseLog: () => void;
}

export function RunsPage(props: RunsPageProps) {
  const [pageSize, setPageSize] = useState(() => getStoredPageSize('runs'));

  const filteredRuns = props.runs.filter((run) => {
    const matchService = props.serviceFilter === 'all' || run.serviceId === props.serviceFilter;
    const matchTask = props.taskFilter === 'all' || run.taskId === props.taskFilter;
    return matchService && matchTask;
  });

  const visibleTasks =
    props.serviceFilter === 'all'
      ? props.tasks
      : props.tasks.filter((task) => task.serviceId === props.serviceFilter);

  const columns: ColumnsType<TaskRun> = [
    {
      title: '任务名称',
      dataIndex: 'taskName',
      key: 'taskName',
      render: (_value: string, record: TaskRun) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => props.onOpenLog(record)}>
          {record.taskName}
        </Button>
      ),
    },
    {
      title: '服务',
      dataIndex: 'serviceName',
      key: 'serviceName',
    },
    {
      title: '触发方式',
      dataIndex: 'triggerType',
      key: 'triggerType',
      render: (value: TaskRun['triggerType']) => (value === 'manual' ? '手动' : '定时'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: TaskRun['status']) => <Tag color={statusColor(value)}>{value}</Tag>,
    },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      key: 'startedAt',
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '结束时间',
      dataIndex: 'completedAt',
      key: 'completedAt',
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: 'STRM 数',
      dataIndex: 'processedCount',
      key: 'processedCount',
    },
    {
      title: '字幕数',
      dataIndex: 'subtitleCount',
      key: 'subtitleCount',
    },
    {
      title: '失败数',
      dataIndex: 'failureCount',
      key: 'failureCount',
    },
    {
      title: '说明',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
    },
  ];

  const pagination: TablePaginationConfig = {
    pageSize,
    pageSizeOptions: ['20', '50', '100'],
    showSizeChanger: true,
    onShowSizeChange: (_current, size) => {
      setPageSize(size);
      setStoredPageSize('runs', size);
    },
  };

  return (
    <>
      <Card
        className="module-card"
        title="任务运行记录"
        extra={
          <Space>
            <Select
              value={props.serviceFilter}
              style={{ width: 220 }}
              onChange={props.onServiceFilterChange}
              options={[
                { label: '全部服务', value: 'all' },
                ...props.services.map((service) => ({
                  label: service.name,
                  value: service.id,
                })),
              ]}
            />
            <Select
              value={props.taskFilter}
              style={{ width: 240 }}
              onChange={props.onTaskFilterChange}
              options={[
                { label: '全部任务', value: 'all' },
                ...visibleTasks.map((task) => ({
                  label: task.name,
                  value: task.id,
                })),
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={props.onRefresh}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table rowKey="id" columns={columns} dataSource={filteredRuns} pagination={pagination} />
      </Card>

      <RunLogModal
        open={props.logModalOpen}
        title={props.selectedRun ? `运行日志详情 - ${props.selectedRun.taskName}` : '运行日志详情'}
        run={props.selectedRun}
        onClose={props.onCloseLog}
      />
    </>
  );
}
