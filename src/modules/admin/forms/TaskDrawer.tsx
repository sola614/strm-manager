import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { OpenlistService, SyncTask, SyncTaskFormValues } from '../../../types';
import { defaultTaskForm } from '../constants';
import { formatDateTime, getServiceDisplayName } from '../utils';
import { getNextRun } from '../../../lib/cron';

const { Text } = Typography;

type CronMode = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

interface TaskDrawerProps {
  open: boolean;
  task: SyncTask | null;
  services: OpenlistService[];
  defaultTargetPath: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: SyncTaskFormValues) => Promise<void>;
}

interface CronPresetState {
  second: number;
  minute: number;
  hour: number;
  weekday: number;
  dayOfMonth: number;
}

const weekdayOptions = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
];

function normalizeCronParts(cronValue: string) {
  const parts = cronValue.trim().split(/\s+/);
  if (parts.length === 5) return ['0', ...parts];
  if (parts.length === 6) return parts;
  return ['0', '0', '*', '*', '*', '*'];
}

function detectCronMode(cronValue: string): CronMode {
  const parts = normalizeCronParts(cronValue);
  const [, , hour, dayOfMonth, month, weekday] = parts;

  if (hour === '*' && dayOfMonth === '*' && month === '*' && weekday === '*') return 'hourly';
  if (hour !== '*' && dayOfMonth === '*' && month === '*' && weekday === '*') return 'daily';
  if (hour !== '*' && dayOfMonth === '*' && month === '*' && weekday !== '*') return 'weekly';
  if (hour !== '*' && dayOfMonth !== '*' && month === '*' && weekday === '*') return 'monthly';
  return 'custom';
}

function detectPreset(cronValue: string): CronPresetState {
  const [second, minute, hour, dayOfMonth, , weekday] = normalizeCronParts(cronValue);
  return {
    second: Number(second || 0),
    minute: Number(minute === '*' ? 0 : minute || 0),
    hour: Number(hour === '*' ? 0 : hour || 0),
    dayOfMonth: Number(dayOfMonth === '*' ? 1 : dayOfMonth || 1),
    weekday: Number(weekday === '*' ? 1 : weekday || 1),
  };
}

function buildCronValue(mode: CronMode, preset: CronPresetState, customCron: string) {
  switch (mode) {
    case 'hourly':
      return `${preset.second} ${preset.minute} * * * *`;
    case 'daily':
      return `${preset.second} ${preset.minute} ${preset.hour} * * *`;
    case 'weekly':
      return `${preset.second} ${preset.minute} ${preset.hour} * * ${preset.weekday}`;
    case 'monthly':
      return `${preset.second} ${preset.minute} ${preset.hour} ${preset.dayOfMonth} * *`;
    default:
      return customCron.trim();
  }
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function buildNaturalDescription(mode: CronMode, preset: CronPresetState, cronValue: string) {
  if (!cronValue.trim()) return '仅手动执行';
  const timeText = `${pad2(preset.hour)}:${pad2(preset.minute)}:${pad2(preset.second)}`;

  switch (mode) {
    case 'hourly':
      return `将在每小时的 ${pad2(preset.minute)} 分 ${pad2(preset.second)} 秒执行`;
    case 'daily':
      return `将于每天 ${timeText} 执行`;
    case 'weekly':
      return `将于${weekdayOptions.find((item) => item.value === preset.weekday)?.label || '每周'} ${timeText} 执行`;
    case 'monthly':
      return `将于每月 ${preset.dayOfMonth} 日 ${timeText} 执行`;
    default:
      return `使用自定义 Cron：${cronValue}`;
  }
}

function TimeSelectors(props: {
  preset: CronPresetState;
  onChange: (next: CronPresetState) => void;
  includeHour?: boolean;
}) {
  const { preset, onChange, includeHour = true } = props;

  return (
    <Space align="center" wrap>
      {includeHour && (
        <>
          <InputNumber
            min={0}
            max={23}
            value={preset.hour}
            onChange={(value) => onChange({ ...preset, hour: Number(value ?? 0) })}
          />
          <Text>时</Text>
        </>
      )}
      <InputNumber
        min={0}
        max={59}
        value={preset.minute}
        onChange={(value) => onChange({ ...preset, minute: Number(value ?? 0) })}
      />
      <Text>分</Text>
      <InputNumber
        min={0}
        max={59}
        value={preset.second}
        onChange={(value) => onChange({ ...preset, second: Number(value ?? 0) })}
      />
      <Text>秒</Text>
    </Space>
  );
}

export function TaskDrawer(props: TaskDrawerProps) {
  const [form] = Form.useForm<SyncTaskFormValues>();
  const [cronMode, setCronMode] = useState<CronMode>('hourly');
  const [preset, setPreset] = useState<CronPresetState>({
    second: 0,
    minute: 0,
    hour: 0,
    weekday: 1,
    dayOfMonth: 1,
  });
  const [customCron, setCustomCron] = useState('');

  const initialValues = props.task
    ? {
        name: props.task.name,
        serviceId: props.task.serviceId,
        sourcePath: props.task.sourcePath,
        targetPath: props.task.targetPath,
        scheduleEnabled: Boolean(props.task.cron),
        cron: props.task.cron,
        maxConcurrency: props.task.maxConcurrency,
        downloadExtensions: props.task.downloadExtensions,
        downloadSubtitles: props.task.downloadSubtitles,
        requestDelaySeconds: props.task.requestDelaySeconds,
        overwriteExisting: props.task.overwriteExisting,
        notifyEnabled: props.task.notifyEnabled,
        callbackUrl: props.task.callbackUrl,
      }
    : {
        ...defaultTaskForm,
        serviceId: props.services[0]?.id || '',
        targetPath: props.defaultTargetPath,
      };

  const effectiveCron = useMemo(
    () => buildCronValue(cronMode, preset, customCron),
    [cronMode, preset, customCron],
  );

  const nextRun = getNextRun(effectiveCron);
  const naturalDescription = buildNaturalDescription(cronMode, preset, effectiveCron);

  return (
    <Drawer
      width={820}
      title={props.task ? '编辑定时任务' : '新增定时任务'}
      open={props.open}
      onClose={props.onClose}
      afterOpenChange={(opened) => {
        if (opened) {
          form.setFieldsValue(initialValues);
          const detectedMode = detectCronMode(initialValues.cron);
          setCronMode(detectedMode);
          setPreset(detectPreset(initialValues.cron || defaultTaskForm.cron));
          setCustomCron(initialValues.cron || defaultTaskForm.cron);
        }
      }}
      extra={
        <Space>
          <Button onClick={props.onClose}>取消</Button>
          <Button
            type="primary"
            loading={props.submitting}
            onClick={async () => {
              const values = await form.validateFields();
              const finalValues: SyncTaskFormValues = {
                ...values,
                cron: values.scheduleEnabled ? effectiveCron : '',
                callbackUrl: values.notifyEnabled ? values.callbackUrl || '' : '',
              };
              await props.onSubmit(finalValues);
            }}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item
          label="任务名称"
          name="name"
          rules={[{ required: true, message: '请输入任务名称' }]}
        >
          <Input placeholder="电影同步任务" />
        </Form.Item>

        <Form.Item
          label="所属 OpenList 服务"
          name="serviceId"
          rules={[{ required: true, message: '请选择 OpenList 服务' }]}
        >
          <Select
            options={props.services.map((service) => ({
              label: `${getServiceDisplayName(service)} (${service.url})`,
              value: service.id,
            }))}
          />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item shouldUpdate={(prev, next) => prev.serviceId !== next.serviceId} noStyle>
              {({ getFieldValue }) => {
                const currentService = props.services.find(
                  (service) => service.id === getFieldValue('serviceId'),
                );

                return (
                  <Form.Item
                    label="视频源目录"
                    name="sourcePath"
                    rules={[{ required: true, message: '请输入视频源目录' }]}
                  >
                    <Input
                      addonBefore={
                        <span style={{ minWidth: 56, display: 'inline-flex', justifyContent: 'center' }}>
                          {currentService?.baseUrl || '/'}
                        </span>
                      }
                      placeholder="/Movies"
                    />
                  </Form.Item>
                );
              }}
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item
              label="strm文件存放目录"
              name="targetPath"
              tooltip="如果使用 Docker 部署，请确保这个目录已经正确映射到容器内。"
              rules={[{ required: true, message: '请输入 strm 文件存放目录' }]}
            >
              <Input placeholder={props.defaultTargetPath} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="下载文件最大并发数"
              name="maxConcurrency"
              rules={[{ required: true, message: '请输入最大并发数' }]}
            >
              <InputNumber min={1} max={50} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="自定义下载后缀"
              name="downloadExtensions"
              tooltip="多个后缀用英文逗号分隔，例如 mp4,mkv"
              rules={[{ required: true, message: '请输入下载后缀' }]}
            >
              <Input placeholder="mp4,mkv" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="是否下载字幕文件" name="downloadSubtitles">
              <Radio.Group
                options={[
                  { label: '否', value: false },
                  { label: '是', value: true },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="每次下载请求延时"
              name="requestDelaySeconds"
              tooltip="每次请求完成后等待多少秒再发起下一次请求。"
              rules={[{ required: true, message: '请输入请求延时秒数' }]}
            >
              <InputNumber min={0} max={600} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="是否覆盖原文件" name="overwriteExisting">
              <Radio.Group
                options={[
                  { label: '否', value: false },
                  { label: '是', value: true },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="通知选项" name="notifyEnabled">
              <Radio.Group
                options={[
                  { label: '否', value: false },
                  { label: '是', value: true },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item shouldUpdate={(prev, next) => prev.notifyEnabled !== next.notifyEnabled} noStyle>
          {({ getFieldValue }) =>
            getFieldValue('notifyEnabled') ? (
              <Form.Item
                label="回调地址"
                name="callbackUrl"
                rules={[
                  { required: true, message: '请输入回调地址' },
                  { type: 'url', message: '请输入合法的回调地址' },
                ]}
              >
                <Input placeholder="https://example.com/callback" />
              </Form.Item>
            ) : null
          }
        </Form.Item>

        <Form.Item label="是否配置定时任务" name="scheduleEnabled">
          <Radio.Group
            options={[
              { label: '是', value: true },
              { label: '否', value: false },
            ]}
          />
        </Form.Item>

        <Form.Item shouldUpdate={(prev, next) => prev.scheduleEnabled !== next.scheduleEnabled} noStyle>
          {({ getFieldValue }) =>
            getFieldValue('scheduleEnabled') ? (
              <>
                <Form.Item label="执行频率">
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Radio.Group
                      value={cronMode}
                      onChange={(event) => setCronMode(event.target.value as CronMode)}
                      options={[
                        { label: '每小时', value: 'hourly' },
                        { label: '每天', value: 'daily' },
                        { label: '每周', value: 'weekly' },
                        { label: '每月', value: 'monthly' },
                        { label: '自定义', value: 'custom' },
                      ]}
                    />

                    {cronMode === 'hourly' && (
                      <Space align="center" wrap>
                        <Text>每小时的</Text>
                        <TimeSelectors preset={preset} onChange={setPreset} includeHour={false} />
                        <Text>执行</Text>
                      </Space>
                    )}

                    {cronMode === 'daily' && (
                      <Space align="center" wrap>
                        <Text>每天</Text>
                        <TimeSelectors preset={preset} onChange={setPreset} />
                        <Text>执行</Text>
                      </Space>
                    )}

                    {cronMode === 'weekly' && (
                      <Space align="center" wrap>
                        <Text>每周</Text>
                        <Select
                          style={{ width: 120 }}
                          value={preset.weekday}
                          onChange={(value) => setPreset((prev) => ({ ...prev, weekday: value }))}
                          options={weekdayOptions}
                        />
                        <TimeSelectors preset={preset} onChange={setPreset} />
                        <Text>执行</Text>
                      </Space>
                    )}

                    {cronMode === 'monthly' && (
                      <Space align="center" wrap>
                        <Text>每月</Text>
                        <InputNumber
                          min={1}
                          max={31}
                          value={preset.dayOfMonth}
                          onChange={(value) =>
                            setPreset((prev) => ({ ...prev, dayOfMonth: Number(value ?? 1) }))
                          }
                        />
                        <Text>日</Text>
                        <TimeSelectors preset={preset} onChange={setPreset} />
                        <Text>执行</Text>
                      </Space>
                    )}

                    {cronMode === 'custom' && (
                      <Form.Item
                        label={
                          <Space size={6}>
                            <span>Cron 表达式</span>
                            <Tooltip title="格式为：秒 分 时 日 月 周，例如 0 30 8 * * 1 表示每周一 08:30:00 执行。">
                              <InfoCircleOutlined />
                            </Tooltip>
                          </Space>
                        }
                        style={{ marginBottom: 0 }}
                      >
                        <Input
                          placeholder="0 30 8 * * 1"
                          value={customCron}
                          onChange={(event) => setCustomCron(event.target.value)}
                        />
                      </Form.Item>
                    )}
                  </Space>
                </Form.Item>

                <Alert
                  type={nextRun ? 'success' : 'warning'}
                  showIcon
                  message={nextRun ? '执行时间预览' : 'Cron 表达式无效'}
                  description={
                    <Space direction="vertical" size={2}>
                      <Text>{naturalDescription}</Text>
                      <Text>下次执行：{nextRun ? formatDateTime(nextRun) : '无法解析'}</Text>
                    </Space>
                  }
                />
              </>
            ) : (
              <Alert
                type="info"
                showIcon
                message="仅手动执行"
                description="该任务不会自动定时运行，可在任务列表中点击“立即执行”手动触发。"
              />
            )
          }
        </Form.Item>
      </Form>
    </Drawer>
  );
}
