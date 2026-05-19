import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { TaskRun } from '../../../types';
import { formatDateTime, statusColor } from '../utils';

const { Text } = Typography;

interface RunDetailPageProps {
  run: TaskRun | null;
  onBack: () => void;
  onRefresh: () => void;
}

export function RunDetailPage(props: RunDetailPageProps) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={props.onBack}>
          返回运行记录
        </Button>
        <Button icon={<ReloadOutlined />} onClick={props.onRefresh}>
          刷新
        </Button>
      </Space>

      <Card className="module-card" title="运行概览">
        {props.run ? (
          <Descriptions column={2} size="middle">
            <Descriptions.Item label="任务名称">{props.run.taskName}</Descriptions.Item>
            <Descriptions.Item label="服务">{props.run.serviceName}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusColor(props.run.status)}>{props.run.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="触发方式">
              {props.run.triggerType === 'manual' ? '手动触发' : '定时触发'}
            </Descriptions.Item>
            <Descriptions.Item label="开始时间">{formatDateTime(props.run.startedAt)}</Descriptions.Item>
            <Descriptions.Item label="结束时间">{formatDateTime(props.run.completedAt)}</Descriptions.Item>
            <Descriptions.Item label="STRM 数量">{props.run.processedCount}</Descriptions.Item>
            <Descriptions.Item label="字幕数量">{props.run.subtitleCount}</Descriptions.Item>
            <Descriptions.Item label="跳过数量">{props.run.skippedCount}</Descriptions.Item>
            <Descriptions.Item label="失败数量">{props.run.failureCount}</Descriptions.Item>
            <Descriptions.Item label="日志说明" span={2}>
              {props.run.message}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Text type="secondary">未选择运行记录。</Text>
        )}
      </Card>

      <Card className="module-card run-detail-log-card" title="详细日志">
        {props.run ? (
          props.run.details.length > 0 ? (
            <Space direction="vertical" size={6} className="run-detail-log-list">
              {props.run.details.map((detail, index) => (
                <Text key={`${props.run?.id}-${index}`}>- {detail}</Text>
              ))}
            </Space>
          ) : (
            <Text type="secondary">当前运行记录暂无详细日志。</Text>
          )
        ) : (
          <Text type="secondary">请返回运行记录选择一条日志。</Text>
        )}
      </Card>
    </Space>
  );
}
