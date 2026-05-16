import { Button, Drawer, Form, Input, Space } from 'antd';
import { OpenlistService, OpenlistServiceFormValues } from '../../../types';
import { defaultServiceForm } from '../constants';

interface ServiceDrawerProps {
  open: boolean;
  service: OpenlistService | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: OpenlistServiceFormValues) => Promise<void>;
}

export function ServiceDrawer(props: ServiceDrawerProps) {
  const [form] = Form.useForm<OpenlistServiceFormValues>();

  const initialValues = props.service
    ? {
        name: props.service.name,
        url: props.service.url,
        token: props.service.token,
        baseUrl: props.service.baseUrl,
      }
    : defaultServiceForm;

  return (
    <Drawer
      width={520}
      title={props.service ? '编辑 OpenList 服务' : '新增 OpenList 服务'}
      open={props.open}
      onClose={props.onClose}
      afterOpenChange={(opened) => {
        if (opened) {
          form.setFieldsValue(initialValues);
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
              await props.onSubmit(values);
            }}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item
          label="服务名称"
          name="name"
          rules={[{ required: true, message: '请输入服务名称' }]}
        >
          <Input placeholder="主 OpenList 服务" />
        </Form.Item>

        <Form.Item
          label="URL"
          name="url"
          rules={[{ required: true, message: '请输入 OpenList URL' }]}
        >
          <Input placeholder="https://alist.example.com" />
        </Form.Item>

        <Form.Item
          label="Token"
          name="token"
          rules={[{ required: true, message: '请输入 Token' }]}
        >
          <Input.Password placeholder="输入 OpenList Token" />
        </Form.Item>

        <Form.Item
          label="Base URL"
          name="baseUrl"
          tooltip="播放链接拼接路径，默认 /"
          rules={[{ required: true, message: '请输入 Base URL' }]}
        >
          <Input placeholder="/" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
