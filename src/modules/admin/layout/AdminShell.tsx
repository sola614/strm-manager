import { DownOutlined, KeyOutlined, LogoutOutlined } from '@ant-design/icons';
import { Avatar, Dropdown, Layout, type MenuProps, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { ActiveView } from '../../../types';
import { viewMeta } from '../constants';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

interface AdminShellProps {
  version: string;
  activeView: ActiveView;
  pageTitle: string;
  pageDescription: string;
  username: string;
  children: ReactNode;
  onChangeView: (view: ActiveView) => void;
  onOpenPassword: () => void;
  onLogout: () => void;
}

export function AdminShell(props: AdminShellProps) {
  const { version, activeView, pageTitle, pageDescription, username, children, onChangeView, onOpenPassword, onLogout } =
    props;

  const userMenu: MenuProps = {
    items: [
      {
        key: 'password',
        icon: <KeyOutlined />,
        label: '修改密码',
        onClick: onOpenPassword,
      },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: <span style={{ color: '#ff4d4f' }}>退出登录</span>,
        onClick: onLogout,
      },
    ],
  };

  const navigationViews: ActiveView[] = ['dashboard', 'services', 'tasks', 'files', 'runs', 'backup', 'settings'];

  return (
    <Layout className="admin-layout">
      <Sider theme="light" width={284} className="admin-sider">
        <div className="brand-panel">
          <div className="brand-mark">A</div>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              STRM 文件生成管理系统
            </Title>
            <Text type="secondary">{version}</Text>
          </div>
        </div>

        <div className="nav-group">
          {navigationViews.map((viewKey) => {
            const meta = viewMeta[viewKey];
            const active = activeView === viewKey || (activeView === 'runDetail' && viewKey === 'runs');
            return (
              <button
                key={viewKey}
                type="button"
                className={`nav-button ${active ? 'nav-button--active' : ''}`}
                onClick={() => onChangeView(viewKey)}
              >
                <span className="nav-icon">{meta.icon}</span>
                <span>{meta.menuLabel}</span>
              </button>
            );
          })}
        </div>
      </Sider>

      <Layout>
        <Header className="admin-header">
          <div className="header-copy">
            <Title level={3} style={{ margin: 0 }}>
              {pageTitle}
            </Title>
            <Text type="secondary">{pageDescription}</Text>
          </div>

          <Dropdown menu={userMenu} trigger={['click']}>
            <button type="button" className="user-trigger">
              <Space size={10}>
                <Avatar size={36} style={{ background: '#dfe8ff', color: '#4b6bfb' }}>
                  {username.slice(0, 1).toUpperCase()}
                </Avatar>
                <span>{username}</span>
                <DownOutlined style={{ fontSize: 12 }} />
              </Space>
            </button>
          </Dropdown>
        </Header>

        <Content className="admin-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
