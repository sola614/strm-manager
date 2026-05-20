import { LockOutlined } from '@ant-design/icons';
import { Button, Card, Input, Space, Spin, Typography } from 'antd';
import type { ChangeEvent } from 'react';

const { Title, Paragraph, Text } = Typography;

interface LoginPageProps {
  loadingOnly?: boolean;
  version?: string;
  setupMode?: boolean;
  password?: string;
  newPassword?: string;
  confirmPassword?: string;
  loading?: boolean;
  onPasswordChange?: (value: string) => void;
  onNewPasswordChange?: (value: string) => void;
  onConfirmPasswordChange?: (value: string) => void;
  onSubmit?: () => void;
}

export function LoginPage(props: LoginPageProps) {
  if (props.loadingOnly) {
    return (
      <div className="login-shell">
        <Space direction="vertical" align="center" size={16}>
          <Spin size="large" />
          <Text type="secondary">正在加载管理面板...</Text>
        </Space>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <Card className="login-card" bordered={false}>
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <div>
            <Text className="eyebrow">管理员后台</Text>
            <Title level={2} style={{ marginTop: 8, marginBottom: 8 }}>
              {props.setupMode ? '设置管理员密码' : '登录管理面板'}
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {props.setupMode
                ? '请设置新的管理员密码，完成后将进入管理面板。'
                : '请输入管理员密码进入管理面板。'}
            </Paragraph>
          </div>

          {props.setupMode ? (
            <>
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="新管理员密码，至少 8 个字符"
                value={props.newPassword}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  props.onNewPasswordChange?.(event.target.value)
                }
                onPressEnter={props.onSubmit}
              />
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="再次输入新密码"
                value={props.confirmPassword}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  props.onConfirmPasswordChange?.(event.target.value)
                }
                onPressEnter={props.onSubmit}
              />
            </>
          ) : (
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              placeholder="请输入管理员密码"
              value={props.password}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                props.onPasswordChange?.(event.target.value)
              }
              onPressEnter={props.onSubmit}
            />
          )}

          <Button type="primary" size="large" block loading={props.loading} onClick={props.onSubmit}>
            {props.setupMode ? '确认设置' : '登录'}
          </Button>

          <Text type="secondary">{props.version}</Text>
        </Space>
      </Card>
    </div>
  );
}
