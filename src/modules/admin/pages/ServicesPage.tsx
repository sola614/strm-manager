import { ExportOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useState } from 'react';
import type { OpenlistService, SyncTask } from '../../../types';
import { formatDateTime, getServiceDisplayName, getStoredPageSize, setStoredPageSize } from '../utils';

const { Link, Text } = Typography;

interface ServicesPageProps {
  services: OpenlistService[];
  tasks: SyncTask[];
  actionsDisabled: boolean;
  onCreateService: () => void;
  onEditService: (service: OpenlistService) => void;
  onDeleteService: (service: OpenlistService) => void;
  onToggleServiceEnabled: (service: OpenlistService, enabled: boolean) => void;
  onRefresh: () => void;
}

export function ServicesPage(props: ServicesPageProps) {
  const [pageSize, setPageSize] = useState(() => getStoredPageSize('services'));

  function changeServiceEnabled(service: OpenlistService, enabled: boolean) {
    if (enabled || !service.enabled) {
      props.onToggleServiceEnabled(service, enabled);
      return;
    }

    const taskCount = props.tasks.filter((task) => task.serviceId === service.id).length;
    Modal.confirm({
      title: '禁用 OpenList 服务',
      content: `禁用服务后，将同步禁用其关联的 ${taskCount} 个任务。确认继续？`,
      okText: '确认禁用',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => props.onToggleServiceEnabled(service, false),
    });
  }

  const columns: ColumnsType<OpenlistService> = [
    {
      title: '服务名称',
      dataIndex: 'name',
      key: 'name',
      render: (_value: string, record: OpenlistService) => (
        <Space direction="vertical" size={0}>
          <Text strong>{getServiceDisplayName(record)}</Text>
          <Text type="secondary">#{record.id}</Text>
        </Space>
      ),
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      render: (value: string) => (
        <Link href={value} target="_blank" rel="noreferrer">
          <Space size={6}>
            <span>{value}</span>
            <ExportOutlined />
          </Space>
        </Link>
      ),
    },
    {
      title: 'Base URL',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: '状态',
      key: 'enabled',
      render: (_value: unknown, record: OpenlistService) => (
        <Select
          size="small"
          value={record.enabled}
          style={{ width: 96 }}
          disabled={props.actionsDisabled}
          onChange={(enabled) => changeServiceEnabled(record, enabled)}
          options={[
            { label: '已启用', value: true },
            { label: '已禁用', value: false },
          ]}
        />
      ),
    },
    {
      title: '关联任务数',
      key: 'taskCount',
      render: (_value: unknown, record: OpenlistService) =>
        props.tasks.filter((task) => task.serviceId === record.id).length,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_value: unknown, record: OpenlistService) => (
        <Space>
          <Button size="small" disabled={props.actionsDisabled} onClick={() => props.onEditService(record)}>
            编辑
          </Button>
          <Popconfirm
            title="删除 OpenList 服务"
            description="删除前请确保没有关联的定时任务。"
            onConfirm={() => props.onDeleteService(record)}
          >
            <Button size="small" danger disabled={props.actionsDisabled}>
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
      setStoredPageSize('services', size);
    },
  };

  return (
    <Card
      className="module-card"
      title="OpenList 服务管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={props.onRefresh}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={props.actionsDisabled}
            onClick={props.onCreateService}
          >
            新增服务
          </Button>
        </Space>
      }
    >
      <Table rowKey="id" columns={columns} dataSource={props.services} pagination={pagination} />
    </Card>
  );
}
