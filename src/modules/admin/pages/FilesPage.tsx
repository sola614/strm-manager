import { ArrowUpOutlined, DeleteOutlined, FileOutlined, FolderOpenOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useMemo, useState } from 'react';
import type { ManagedFileEntry, ManagedFileRoot } from '../../../types';
import { formatDateTime, getStoredPageSize, setStoredPageSize } from '../utils';

const { Paragraph, Text, Link } = Typography;

interface FilesPageProps {
  roots: ManagedFileRoot[];
  entries: ManagedFileEntry[];
  rootFilter: string;
  currentDirectory: string;
  parentDirectory: string | null;
  loading: boolean;
  deletingIds: string[];
  bulkDeleting: boolean;
  onFilterChange: (value: string) => void;
  onOpenDirectory: (relativePath: string) => void;
  onGoParent: () => void;
  onDeleteEntry: (entry: ManagedFileEntry) => void;
  onBulkDeleteEntries: (entries: ManagedFileEntry[]) => void;
  onRefresh: () => void;
}

function formatSize(size: number) {
  if (size <= 0) return '-';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function FilesPage(props: FilesPageProps) {
  const [pageSize, setPageSize] = useState(() => getStoredPageSize('files'));
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const selectedRoot = useMemo(
    () => props.roots.find((root) => root.id === props.rootFilter) || null,
    [props.rootFilter, props.roots],
  );

  const selectedEntries = useMemo(
    () => props.entries.filter((entry) => selectedRowKeys.includes(entry.id)),
    [props.entries, selectedRowKeys],
  );

  const columns: ColumnsType<ManagedFileEntry> = [
    {
      title: '名称',
      key: 'name',
      render: (_value: unknown, record: ManagedFileEntry) => (
        <Space size={8}>
          {record.type === 'directory' ? <FolderOpenOutlined /> : <FileOutlined />}
          <Space direction="vertical" size={0}>
            {record.type === 'directory' ? (
              <Link onClick={() => props.onOpenDirectory(record.relativePath)}>{record.name}</Link>
            ) : (
              <Text strong>{record.name}</Text>
            )}
            <Text type="secondary">{record.relativePath || '/'}</Text>
          </Space>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (value: ManagedFileEntry['type']) => (
        <Tag color={value === 'directory' ? 'blue' : 'default'}>{value === 'directory' ? '文件夹' : '文件'}</Tag>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (value: number, record: ManagedFileEntry) => (record.type === 'directory' ? '-' : formatSize(value)),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_value: unknown, record: ManagedFileEntry) => (
        <Space>
          {record.type === 'directory' ? (
            <Button size="small" onClick={() => props.onOpenDirectory(record.relativePath)}>
              进入
            </Button>
          ) : null}
          <Popconfirm
            title={`删除${record.type === 'directory' ? '文件夹' : '文件'}`}
            description={`确认删除 ${record.name} 吗？`}
            onConfirm={() => props.onDeleteEntry(record)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={props.deletingIds.includes(record.id)}
            >
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
      setStoredPageSize('files', size);
    },
  };

  return (
    <Card
      className="module-card"
      title="文件管理"
      extra={
        <Space>
          <Select
            value={props.rootFilter}
            style={{ width: 360 }}
            onChange={(value) => {
              setSelectedRowKeys([]);
              props.onFilterChange(value);
            }}
            options={props.roots.map((root) => ({
              label: root.targetPath,
              value: root.id,
            }))}
          />
          <Button
            icon={<ArrowUpOutlined />}
            disabled={props.parentDirectory === null}
            onClick={() => {
              setSelectedRowKeys([]);
              props.onGoParent();
            }}
          >
            上级目录
          </Button>
          <Popconfirm
            title="批量删除"
            description={`确认删除选中的 ${selectedEntries.length} 项吗？`}
            disabled={!selectedEntries.length}
            onConfirm={() => {
              props.onBulkDeleteEntries(selectedEntries);
              setSelectedRowKeys([]);
            }}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!selectedEntries.length}
              loading={props.bulkDeleting}
            >
              批量删除
            </Button>
          </Popconfirm>
          <Button
            icon={<ReloadOutlined />}
            loading={props.loading}
            onClick={() => {
              setSelectedRowKeys([]);
              props.onRefresh();
            }}
          >
            刷新
          </Button>
        </Space>
      }
    >
      {selectedRoot && !selectedRoot.exists ? (
        <Empty
          description={
            <Space direction="vertical" size={2}>
              <Text>{selectedRoot.targetPath}</Text>
              <Text type="secondary">{selectedRoot.error || '目录不存在或暂时无法访问。'}</Text>
            </Space>
          }
        />
      ) : null}

      {selectedRoot ? (
        <Space direction="vertical" size={8} style={{ display: 'flex', marginBottom: 16 }}>
          <Text>根目录：{selectedRoot.targetPath}</Text>
          <Text type="secondary">当前目录：{props.currentDirectory || '/'}</Text>
          <Text type="secondary">实际路径：{selectedRoot.resolvedPath}</Text>
          <Text type="secondary">关联任务：{selectedRoot.taskNames.join('、') || '-'}</Text>
          {selectedRoot.configuredPaths.length > 1 ? (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              同路径任务配置：{selectedRoot.configuredPaths.join('、')}
            </Paragraph>
          ) : null}
        </Space>
      ) : null}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={props.entries}
        loading={props.loading}
        pagination={pagination}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        locale={{
          emptyText: selectedRoot && !selectedRoot.exists ? '当前目录不可用' : '当前目录暂无文件数据',
        }}
      />
    </Card>
  );
}
