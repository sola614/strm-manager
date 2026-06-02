import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getStoredToken } from '../../../lib/api';
import { TaskRun } from '../../../types';
import { formatDateTime, statusColor } from '../utils';

const { Text } = Typography;

interface RunDetailPageProps {
  run: TaskRun | null;
  onBack: () => void;
  onRefresh: () => void;
  onRunUpdate: (run: TaskRun) => void;
}

export function RunDetailPage(props: RunDetailPageProps) {
  const [wsConnected, setWsConnected] = useState(false);
  const onRunUpdateRef = useRef(props.onRunUpdate);
  const logListRef = useRef<HTMLDivElement | null>(null);
  const previousRunStatusRef = useRef<TaskRun['status'] | null>(null);

  useEffect(() => {
    onRunUpdateRef.current = props.onRunUpdate;
  }, [props.onRunUpdate]);

  const websocketUrl = useMemo(() => {
    if (!props.run?.id || props.run.status !== 'running' || typeof window === 'undefined') return '';

    const token = getStoredToken();
    if (!token) return '';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(`${protocol}//${window.location.host}/ws/runs`);
    url.searchParams.set('token', token);
    return url.toString();
  }, [props.run?.id, props.run?.status]);

  useEffect(() => {
    if (!websocketUrl || !props.run?.id) {
      setWsConnected(false);
      return;
    }

    const ws = new WebSocket(websocketUrl);
    const runId = props.run.id;

    ws.addEventListener('open', () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ type: 'subscribeRun', runId }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'runSnapshot' && payload.run?.id === runId) {
          onRunUpdateRef.current(payload.run);
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    });

    ws.addEventListener('close', () => setWsConnected(false));
    ws.addEventListener('error', () => setWsConnected(false));

    return () => {
      ws.close();
    };
  }, [props.run?.id, websocketUrl]);

  useLayoutEffect(() => {
    const wasRunning = previousRunStatusRef.current === 'running';
    const isRunning = props.run?.status === 'running';
    previousRunStatusRef.current = props.run?.status || null;

    if (!isRunning && !wasRunning) return;

    const logList = logListRef.current;
    if (!logList) return;

    logList.scrollTop = logList.scrollHeight;
  }, [props.run]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={props.onBack}>
          返回运行记录
        </Button>
        <Button icon={<ReloadOutlined />} onClick={props.onRefresh}>
          刷新
        </Button>
        {props.run?.status === 'running' ? (
          <Tag color={wsConnected ? 'processing' : 'default'}>
            {wsConnected ? '实时日志已连接' : '实时日志未连接'}
          </Tag>
        ) : null}
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
        <div ref={logListRef} className="run-detail-log-list">
          {props.run ? (
            props.run.details.length > 0 ? (
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
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
        </div>
      </Card>
    </Space>
  );
}
