import { LockOutlined } from '@ant-design/icons';
import { Button, Card, Input, Space, Spin, Typography } from 'antd';
import type { ChangeEvent } from 'react';

const { Title, Paragraph, Text } = Typography;

interface LoginPageProps {
  loadingOnly?: boolean;
  version?: string;
  password?: string;
  loading?: boolean;
  onPasswordChange?: (value: string) => void;
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
              登录管理面板
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              默认用户名为 <strong>admin</strong>，默认密码为 <strong>admin</strong>。
              首次登录后系统会强制跳转修改密码。
            </Paragraph>
          </div>

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

          <Button type="primary" size="large" block loading={props.loading} onClick={props.onSubmit}>
            登录
          </Button>

          <Text type="secondary">{props.version}</Text>
        </Space>
      </Card>
    </div>
  );
}
