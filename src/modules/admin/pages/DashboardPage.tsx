import { CloudServerOutlined, FileSyncOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, List, Row, Space, Statistic, Tabs, Tag, Typography } from 'antd';
import { ActiveView, OpenlistService, SyncTask, TaskRun } from '../../../types';
import { formatDateTime, getServiceDisplayName, statusColor } from '../utils';

const { Text } = Typography;

const runStatusMeta: Array<{
  status: TaskRun['status'];
  label: string;
  color: string;
}> = [
  { status: 'success', label: '成功', color: '#52c41a' },
  { status: 'error', label: '失败', color: '#ff4d4f' },
  { status: 'running', label: '运行中', color: '#1677ff' },
  { status: 'skipped', label: '跳过', color: '#8c8c8c' },
];

interface DashboardPageProps {
  services: OpenlistService[];
  tasks: SyncTask[];
  runs: TaskRun[];
  actionsDisabled: boolean;
  onCreateService: () => void;
  onCreateTask: () => void;
  onEditService: (service: OpenlistService) => void;
  onRefreshRuns: () => void;
  onSwitchView: (view: ActiveView) => void;
  onViewRunDetail: (run: TaskRun) => void;
}

export function DashboardPage(props: DashboardPageProps) {
  const {
    services,
    tasks,
    runs,
    actionsDisabled,
    onCreateService,
    onCreateTask,
    onEditService,
    onRefreshRuns,
    onSwitchView,
    onViewRunDetail,
  } = props;

  const allSuccessRuns = runs.filter((run) => run.status === 'success');
  const allErrorRuns = runs.filter((run) => run.status === 'error');
  const successRuns = allSuccessRuns.slice(0, 6);
  const errorRuns = allErrorRuns.slice(0, 6);
  const statusSummary = buildStatusSummary(runs);
  const trendDays = buildRunTrend(runs);
  const maxTrendTotal = Math.max(1, ...trendDays.map((day) => day.total));

  const renderRunList = (items: TaskRun[]) => (
    <List
      dataSource={items}
      locale={{ emptyText: '暂无运行记录' }}
      renderItem={(run) => (
        <List.Item className="dashboard-run-item" onClick={() => onViewRunDetail(run)}>
          <List.Item.Meta
            title={
              <Space>
                <Text strong>{run.taskName}</Text>
                <Tag color={statusColor(run.status)}>{run.status}</Tag>
              </Space>
            }
            description={
              <Space direction="vertical" size={0}>
                <Text type="secondary">
                  {run.serviceName} · {run.triggerType === 'manual' ? '手动' : '定时'}
                </Text>
                <Text type="secondary">
                  {formatDateTime(run.startedAt)} → {formatDateTime(run.completedAt)}
                </Text>
                <Text>{run.message}</Text>
              </Space>
            }
          />
        </List.Item>
      )}
    />
  );

  return (
    <Space direction="vertical" size={20} className="dashboard-page">
      <Row gutter={[20, 20]} className="dashboard-equal-row">
        <Col xs={24} md={12} xl={6}>
          <Card className="metric-card">
            <Statistic title="OpenList 服务" value={services.length} prefix={<CloudServerOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="metric-card">
            <Statistic title="定时任务" value={tasks.length} prefix={<FileSyncOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="metric-card">
            <Statistic
              title="最近执行过任务"
              value={tasks.filter((task) => task.lastRunAt).length}
              prefix={<PlayCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="metric-card">
            <Statistic title="最近运行记录" value={runs.length} prefix={<ReloadOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[20, 20]} className="dashboard-equal-row">
        <Col xs={24} xl={10}>
          <Card className="module-card dashboard-chart-card" title="运行状态分布">
            <div className="dashboard-status-chart">
              <div className="status-donut" style={{ background: buildDonutGradient(statusSummary) }}>
                <div className="status-donut-core">
                  <Text strong>{runs.length}</Text>
                  <Text type="secondary">总记录</Text>
                </div>
              </div>
              <div className="status-legend">
                {statusSummary.map((item) => (
                  <div className="status-legend-item" key={item.status}>
                    <span className="status-swatch" style={{ background: item.color }} />
                    <Text>{item.label}</Text>
                    <Text type="secondary">{item.count}</Text>
                    <Text type="secondary">{item.percent}%</Text>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card className="module-card dashboard-chart-card" title="近 7 天运行趋势">
            <div className="run-trend-chart">
              {trendDays.map((day) => (
                <div className="trend-column" key={day.key}>
                  <div className="trend-bar-wrap">
                    <div
                      className="trend-bar"
                      style={{ height: day.total ? `${Math.max((day.total / maxTrendTotal) * 100, 8)}%` : 0 }}
                    >
                      {runStatusMeta.map((meta) =>
                        day.counts[meta.status] > 0 ? (
                          <span
                            className="trend-segment"
                            key={meta.status}
                            style={{
                              background: meta.color,
                              height: `${(day.counts[meta.status] / day.total) * 100}%`,
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                  <Text className="trend-count">{day.total}</Text>
                  <Text type="secondary" className="trend-label">
                    {day.label}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[20, 20]} className="dashboard-main-row dashboard-equal-row">
        <Col xs={24} xl={12}>
          <Card
            className="module-card dashboard-list-card"
            title="OpenList 服务"
            extra={
              <Space>
                <Button type="link" onClick={() => onSwitchView('services')}>
                  查看全部
                </Button>
                <Button type="primary" onClick={onCreateService} disabled={actionsDisabled}>
                  新增服务
                </Button>
              </Space>
            }
          >
            <List
              dataSource={services}
              locale={{ emptyText: '还没有配置任何 OpenList 服务' }}
              renderItem={(service) => (
                <List.Item
                  actions={[
                    <Button key="edit" type="link" disabled={actionsDisabled} onClick={() => onEditService(service)}>
                      编辑
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={getServiceDisplayName(service)}
                    description={
                      <Space direction="vertical" size={0}>
                        <Text>{service.url}</Text>
                        <Text type="secondary">Base URL: {service.baseUrl}</Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card
            className="module-card dashboard-list-card"
            title="最近任务运行"
            extra={
              <Space>
                <Button type="link" onClick={() => onSwitchView('runs')}>
                  查看全部
                </Button>
                <Button onClick={onRefreshRuns}>刷新</Button>
              </Space>
            }
          >
            <Tabs
              className="dashboard-run-tabs"
              items={[
                {
                  key: 'success',
                  label: `Success (${allSuccessRuns.length})`,
                  children: renderRunList(successRuns),
                },
                {
                  key: 'error',
                  label: `Error (${allErrorRuns.length})`,
                  children: renderRunList(errorRuns),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card
        className="module-card dashboard-actions-card"
        title="快速操作"
        extra={
          <Button type="link" onClick={() => onSwitchView('tasks')}>
            前往任务管理
          </Button>
        }
      >
        <Space wrap>
          <Button type="primary" onClick={onCreateService} disabled={actionsDisabled}>
            新增 OpenList 服务
          </Button>
          <Button onClick={onCreateTask} disabled={actionsDisabled}>
            新增定时任务
          </Button>
        </Space>
      </Card>
    </Space>
  );
}

function buildStatusSummary(runs: TaskRun[]) {
  const total = runs.length;
  return runStatusMeta.map((meta) => {
    const count = runs.filter((run) => run.status === meta.status).length;
    return {
      ...meta,
      count,
      percent: total ? Math.round((count / total) * 100) : 0,
    };
  });
}

function buildDonutGradient(summary: ReturnType<typeof buildStatusSummary>) {
  const total = summary.reduce((sum, item) => sum + item.count, 0);
  if (!total) return '#eef2f8';

  let cursor = 0;
  const segments = summary
    .filter((item) => item.count > 0)
    .map((item) => {
      const start = cursor;
      const end = cursor + (item.count / total) * 100;
      cursor = end;
      return `${item.color} ${start}% ${end}%`;
    });

  return `conic-gradient(${segments.join(', ')})`;
}

function buildRunTrend(runs: TaskRun[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + index);
    return {
      key: formatDateKey(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      total: 0,
      counts: createEmptyStatusCounts(),
    };
  });

  const dayMap = new Map(days.map((day) => [day.key, day]));

  runs.forEach((run) => {
    const startedAt = new Date(run.startedAt);
    if (Number.isNaN(startedAt.getTime())) return;

    startedAt.setHours(0, 0, 0, 0);
    const day = dayMap.get(formatDateKey(startedAt));
    if (!day) return;

    day.counts[run.status] += 1;
    day.total += 1;
  });

  return days;
}

function createEmptyStatusCounts(): Record<TaskRun['status'], number> {
  return {
    running: 0,
    success: 0,
    error: 0,
    skipped: 0,
  };
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
