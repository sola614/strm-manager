import { CloudServerOutlined, FileSyncOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, List, Row, Space, Statistic, Tag, Typography } from 'antd';
import { OpenlistService, SyncTask, TaskRun, ActiveView } from '../../../types';
import { formatDateTime, getServiceDisplayName, statusColor } from '../utils';

const { Text } = Typography;

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
  } = props;

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Row gutter={[20, 20]}>
        <Col xs={24} md={12} xl={6}>
          <Card className="metric-card">
            <Statistic
              title="OpenList 服务"
              value={services.length}
              prefix={<CloudServerOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="metric-card">
            <Statistic
              title="定时任务"
              value={tasks.length}
              prefix={<FileSyncOutlined />}
            />
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
            <Statistic
              title="最近运行记录"
              value={runs.length}
              prefix={<ReloadOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card
            className="module-card"
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
                    <Button
                      key="edit"
                      type="link"
                      disabled={actionsDisabled}
                      onClick={() => onEditService(service)}
                    >
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
            className="module-card"
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
            <List
              dataSource={runs.slice(0, 6)}
              locale={{ emptyText: '暂无运行记录' }}
              renderItem={(run) => (
                <List.Item>
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
          </Card>
        </Col>
      </Row>

      <Card
        className="module-card"
        title="快速操作"
        extra={<Button type="link" onClick={() => onSwitchView('tasks')}>前往任务管理</Button>}
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
