import { DownloadOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Space, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { OpenlistService, SyncTask } from '../../../types';

const { Paragraph, Text } = Typography;

interface BackupPageProps {
  services: OpenlistService[];
  tasks: SyncTask[];
  exporting: boolean;
  restoring: boolean;
  onExport: () => void;
  onRestore: (file: File) => Promise<void>;
}

export function BackupPage(props: BackupPageProps) {
  const uploadProps: UploadProps = {
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      await props.onRestore(file);
      return false;
    },
  };

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Card className="module-card" title="配置备份">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Paragraph style={{ marginBottom: 0 }}>
            当前系统中共有 <Text strong>{props.services.length}</Text> 个 OpenList 服务和{' '}
            <Text strong>{props.tasks.length}</Text> 个定时任务。你可以导出完整配置作为备份文件。
          </Paragraph>

          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={props.exporting}
            onClick={props.onExport}
          >
            导出配置备份
          </Button>
        </Space>
      </Card>

      <Card className="module-card" title="配置恢复">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="恢复会覆盖当前配置"
            description="上传备份文件后，现有服务和任务将被新的备份内容替换，请先确认备份文件来源可靠。"
          />

          <Upload.Dragger {...uploadProps} disabled={props.restoring}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽备份文件到这里上传恢复</p>
            <p className="ant-upload-hint">支持上传由“导出配置备份”生成的 JSON 备份文件。</p>
          </Upload.Dragger>

          <Button icon={<UploadOutlined />} loading={props.restoring}>
            {props.restoring ? '恢复中...' : '等待上传恢复'}
          </Button>
        </Space>
      </Card>
    </Space>
  );
}
