import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { Key } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { OpenlistService, SyncTask, TaskRun } from '../../../types';
import { formatDateTime, getServiceDisplayName, getStoredPageSize, setStoredPageSize, statusColor } from '../utils';

interface RunsPageProps {
  runs: TaskRun[];
  services: OpenlistService[];
  tasks: SyncTask[];
  serviceFilter: string;
  taskFilter: string;
  selectedRun: TaskRun | null;
  deletingRunIds: string[];
  bulkDeleting: boolean;
  onServiceFilterChange: (value: string) => void;
  onTaskFilterChange: (value: string) => void;
  onRefresh: () => void;
  onViewRunDetail: (run: TaskRun | null) => void;
  onDeleteRun: (run: TaskRun) => void;
  onBulkDeleteRuns: (ids: string[]) => void;
}

export function RunsPage(props: RunsPageProps) {
  const [pageSize, setPageSize] = useState(() => getStoredPageSize('runs'));
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  const filteredRuns = useMemo(
    () =>
      props.runs.filter((run) => {
        const matchService = props.serviceFilter === 'all' || run.serviceId === props.serviceFilter;
        const matchTask = props.taskFilter === 'all' || run.taskId === props.taskFilter;
        return matchService && matchTask;
      }),
    [props.runs, props.serviceFilter, props.taskFilter],
  );

  const visibleTasks = useMemo(
    () =>
      props.serviceFilter === 'all'
        ? props.tasks
        : props.tasks.filter((task) => task.serviceId === props.serviceFilter),
    [props.serviceFilter, props.tasks],
  );

  useEffect(() => {
    const visibleRunIds = new Set(filteredRuns.map((run) => run.id));
    setSelectedRowKeys((current) => {
      const next = current.filter((key) => visibleRunIds.has(String(key)));
      if (next.length === current.length && next.every((key, index) => key === current[index])) {
        return current;
      }
      return next;
    });
  }, [filteredRuns]);

  const columns: ColumnsType<TaskRun> = [
    {
      title: '任务名称',
      dataIndex: 'taskName',
      key: 'taskName',
      render: (_value: string, record: TaskRun) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => props.onViewRunDetail(record)}>
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
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_value: unknown, record: TaskRun) => (
        <Popconfirm
          title="删除运行记录"
          description={record.status === 'running' ? '运行中的记录暂不支持删除。' : '删除后将无法恢复该条运行日志。'}
          onConfirm={() => props.onDeleteRun(record)}
          okButtonProps={{ danger: true }}
          disabled={record.status === 'running'}
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={props.deletingRunIds.includes(record.id)}
            disabled={record.status === 'running'}
          >
            删除
          </Button>
        </Popconfirm>
      ),
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

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: Key[]) => setSelectedRowKeys(keys),
    getCheckboxProps: (record: TaskRun) => ({
      disabled: record.status === 'running',
    }),
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
                  label: getServiceDisplayName(service),
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
            <Popconfirm
              title="批量删除运行记录"
              description="删除后不可恢复，确认删除当前勾选的运行记录吗？"
              onConfirm={() => props.onBulkDeleteRuns(selectedRowKeys.map(String))}
              okButtonProps={{ danger: true }}
              disabled={!selectedRowKeys.length}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={props.bulkDeleting}
                disabled={!selectedRowKeys.length}
              >
                批量删除
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredRuns}
          pagination={pagination}
          rowSelection={rowSelection}
          rowClassName={(record) => (record.id === props.selectedRun?.id ? 'ant-table-row-selected' : '')}
        />
      </Card>
    </>
  );
}
