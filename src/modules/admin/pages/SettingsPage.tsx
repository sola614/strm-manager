import { InfoCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Radio, Space, Tag, Typography } from 'antd';
import { AppConfigFormValues, AppConfig } from '../../../types';

const { Paragraph, Text } = Typography;

interface SettingsPageProps {
  config: AppConfig;
  submitting: boolean;
  onSubmit: (values: AppConfigFormValues) => Promise<void>;
}

export function SettingsPage(props: SettingsPageProps) {
  const [form] = Form.useForm<AppConfigFormValues>();

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Card className="module-card" title="系统基础配置">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            port: props.config.port,
            defaultStrmTargetPath: props.config.defaultStrmTargetPath,
            logCleanupEnabled: props.config.logCleanupEnabled,
            logRetentionDays: props.config.logRetentionDays,
          }}
          onFinish={props.onSubmit}
          key={[
            props.config.port,
            props.config.defaultStrmTargetPath,
            props.config.logCleanupEnabled ? '1' : '0',
            props.config.logRetentionDays,
          ].join('-')}
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              message="关于 PORT 配置"
              description={
                <Space direction="vertical" size={2}>
                  <Text>当前服务实际监听端口为 {props.config.runtimePort}。</Text>
                  <Text>
                    修改 PORT 后会写入系统配置，但通常需要重启应用后才会按新端口启动；如果使用 Docker，还需要同步修改
                    `docker-compose.yml` 中的端口映射。
                  </Text>
                </Space>
              }
            />

            <Form.Item
              label="PORT"
              name="port"
              tooltip="应用监听端口。修改后通常需要重启应用才能生效。"
              rules={[{ required: true, message: '请输入 PORT' }]}
            >
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              label="STRM_TARGET_PATH"
              name="defaultStrmTargetPath"
              tooltip="新建任务时默认填入的 STRM 输出目录。"
              rules={[{ required: true, message: '请输入默认 STRM 输出目录' }]}
            >
              <Input placeholder="/media/strm" />
            </Form.Item>

            <Form.Item label="定时删除日志" name="logCleanupEnabled">
              <Radio.Group
                options={[
                  { label: '开启', value: true },
                  { label: '关闭', value: false },
                ]}
              />
            </Form.Item>

            <Form.Item shouldUpdate={(prev, next) => prev.logCleanupEnabled !== next.logCleanupEnabled} noStyle>
              {({ getFieldValue }) =>
                getFieldValue('logCleanupEnabled') ? (
                  <Form.Item
                    label="日志保留天数"
                    name="logRetentionDays"
                    tooltip="超过保留天数的非运行中日志会自动清除。"
                    rules={[{ required: true, message: '请输入日志保留天数' }]}
                  >
                    <InputNumber
                      min={1}
                      max={3650}
                      addonAfter="天"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                ) : null
              }
            </Form.Item>

            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              日志自动清理默认开启，默认保留 7 天。保存后，系统会立即按当前配置尝试清理一次超期日志，并在每天凌晨继续自动执行。
            </Paragraph>

            <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={props.submitting}>
              保存系统配置
            </Button>
          </Space>
        </Form>
      </Card>

      <Card className="module-card" title="部署与运行信息">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="以下配置仅展示，不支持在页面内编辑"
            description="这些值属于启动参数或部署层配置，需要在 docker-compose、PM2 或实际运行环境中修改，然后重启应用。"
          />

          <Descriptions column={1} bordered size="middle">
            <Descriptions.Item label="DATABASE_PATH">{props.config.databasePath || '-'}</Descriptions.Item>
            <Descriptions.Item label="NODE_ENV">
              <Tag color="blue">{props.config.nodeEnv || '-'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="RESET_ADMIN_PASSWORD">
              {props.config.resetAdminPasswordEnabled ? (
                <Tag color="warning">已开启</Tag>
              ) : (
                <Tag>未开启</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>

          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            `DATABASE_PATH` 影响数据库文件位置，在线修改可能导致数据迁移和权限问题；`RESET_ADMIN_PASSWORD`
            是一次性重置开关，建议只在忘记密码时临时打开，完成登录重置后立即关闭。
          </Paragraph>
        </Space>
      </Card>
    </Space>
  );
}
