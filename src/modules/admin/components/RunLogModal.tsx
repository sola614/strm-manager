import { Divider, Modal, Space, Tag, Typography } from 'antd';
import { ReactNode } from 'react';
import { TaskRun } from '../../../types';
import { formatDateTime, statusColor } from '../utils';

const { Paragraph, Text } = Typography;

interface RunLogModalProps {
  open: boolean;
  title: string;
  run: TaskRun | null;
  loading?: boolean;
  onClose: () => void;
  footerExtra?: ReactNode;
}

export function RunLogModal(props: RunLogModalProps) {
  const footer = props.footerExtra ? [props.footerExtra] : undefined;

  return (
    <Modal
      open={props.open}
      title={props.title}
      footer={footer}
      onCancel={props.onClose}
    >
      {props.loading ? (
        <Text>正在加载日志...</Text>
      ) : props.run ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space>
            <Tag color={statusColor(props.run.status)}>{props.run.status}</Tag>
            <Text type="secondary">
              {props.run.triggerType === 'manual' ? '手动触发' : '定时触发'}
            </Text>
          </Space>
          <Text>开始时间：{formatDateTime(props.run.startedAt)}</Text>
          <Text>结束时间：{formatDateTime(props.run.completedAt)}</Text>
          <Text>STRM 数量：{props.run.processedCount}</Text>
          <Text>字幕数量：{props.run.subtitleCount}</Text>
          <Text>失败数量：{props.run.failureCount}</Text>
          <Paragraph style={{ marginBottom: 0 }}>日志说明：{props.run.message}</Paragraph>
          {props.run.details.length > 0 && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {props.run.details.map((detail, index) => (
                  <Text key={`${props.run?.id}-${index}`}>- {detail}</Text>
                ))}
              </Space>
            </>
          )}
        </Space>
      ) : (
        <Text type="secondary">当前没有可展示的运行日志。</Text>
      )}
    </Modal>
  );
}
