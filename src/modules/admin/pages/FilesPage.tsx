import {
  ArrowUpOutlined,
  DeleteOutlined,
  FileOutlined,
  FolderFilled,
  HomeFilled,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Button, Card, Empty, Popconfirm, Select, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useMemo, useState } from 'react';
import type { ManagedFileEntry, ManagedFileRoot } from '../../../types';
import { getStoredPageSize, setStoredPageSize } from '../utils';

const { Paragraph, Text } = Typography;

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

function normalizeDisplayPath(value: string) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .trim();

  if (!normalized || normalized === '/') return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function formatFileTime(value: string | null) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
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

  const breadcrumbItems = useMemo(() => {
    if (!selectedRoot) return [];

    const rootSegments = normalizeDisplayPath(selectedRoot.targetPath).split('/').filter(Boolean);
    const directorySegments = normalizeDisplayPath(props.currentDirectory).split('/').filter(Boolean);

    return [
      ...rootSegments.map((segment, index) => ({
        label: segment,
        path: index === rootSegments.length - 1 ? '' : null,
      })),
      ...directorySegments.map((segment, index) => ({
        label: segment,
        path: directorySegments.slice(0, index + 1).join('/'),
      })),
    ];
  }, [props.currentDirectory, selectedRoot]);

  const columns: ColumnsType<ManagedFileEntry> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      },
      defaultSortOrder: 'ascend',
      render: (_value: unknown, record: ManagedFileEntry) => (
        <button
          type="button"
          className={`file-name-cell ${record.type === 'directory' ? 'file-name-cell--folder' : ''}`}
          onClick={() => {
            if (record.type === 'directory') {
              setSelectedRowKeys([]);
              props.onOpenDirectory(record.relativePath);
            }
          }}
          disabled={record.type !== 'directory'}
        >
          <span className="file-entry-icon" aria-hidden="true">
            {record.type === 'directory' ? <FolderFilled /> : <FileOutlined />}
          </span>
          <span className="file-entry-name">{record.name}</span>
        </button>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 180,
      align: 'left',
      render: (value: number, record: ManagedFileEntry) => (record.type === 'directory' ? '-' : formatSize(value)),
    },
    {
      title: '最后修改',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 220,
      render: (value: string | null) => formatFileTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 96,
      align: 'right',
      render: (_value: unknown, record: ManagedFileEntry) => (
        <Popconfirm
          title={`删除${record.type === 'directory' ? '文件夹' : '文件'}`}
          description={`确认删除 ${record.name} 吗？`}
          onConfirm={() => props.onDeleteEntry(record)}
        >
          <Tooltip title="删除">
            <Button
              className="file-row-action"
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              loading={props.deletingIds.includes(record.id)}
            />
          </Tooltip>
        </Popconfirm>
      ),
    },
  ];

  const pagination: TablePaginationConfig | false =
    props.entries.length > pageSize
      ? {
          pageSize,
          pageSizeOptions: ['20', '50', '100'],
          showSizeChanger: true,
          onShowSizeChange: (_current, size) => {
            setPageSize(size);
            setStoredPageSize('files', size);
          },
        }
      : false;

  return (
    <Card
      className="module-card files-card"
      title="文件管理"
      extra={
        <Space wrap>
          <Select
            value={props.rootFilter}
            className="files-root-select"
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
        <Space direction="vertical" size={10} className="files-context">
          <Space size={24} wrap className="files-meta">
            <Text type="secondary">实际路径：{selectedRoot.resolvedPath}</Text>
            <Text type="secondary">关联任务：{selectedRoot.taskNames.join('、') || '-'}</Text>
          </Space>
          <div className="files-breadcrumb" aria-label="当前路径">
            <button
              type="button"
              className="files-breadcrumb-home"
              onClick={() => {
                setSelectedRowKeys([]);
                props.onOpenDirectory('');
              }}
              aria-label="返回根目录"
            >
              <HomeFilled />
            </button>
            {breadcrumbItems.map((item, index) => {
              const targetPath = item.path;

              return (
                <span className="files-breadcrumb-item" key={`${item.label}-${index}`}>
                  <RightOutlined className="files-breadcrumb-separator" />
                  {targetPath !== null ? (
                    <button
                      type="button"
                      className="files-breadcrumb-link"
                      onClick={() => {
                        setSelectedRowKeys([]);
                        props.onOpenDirectory(targetPath);
                      }}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </span>
              );
            })}
          </div>
       
          {selectedRoot.configuredPaths.length > 1 ? (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              同路径任务配置：{selectedRoot.configuredPaths.join('、')}
            </Paragraph>
          ) : null}
        </Space>
      ) : null}

      <Table
        className="files-table"
        rowKey="id"
        columns={columns}
        dataSource={props.entries}
        loading={props.loading}
        pagination={pagination}
        size="middle"
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
