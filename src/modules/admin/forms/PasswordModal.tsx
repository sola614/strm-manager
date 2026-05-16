import { Form, Input, Modal } from 'antd';

interface PasswordModalProps {
  open: boolean;
  required: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (newPassword: string) => Promise<void>;
}

export function PasswordModal(props: PasswordModalProps) {
  const [form] = Form.useForm<{ newPassword: string; confirmPassword: string }>();

  return (
    <Modal
      title="修改管理员密码"
      open={props.open}
      closable={!props.required}
      maskClosable={!props.required}
      cancelButtonProps={{ style: { display: props.required ? 'none' : undefined } }}
      onCancel={props.onClose}
      onOk={async () => {
        const values = await form.validateFields();
        if (values.newPassword !== values.confirmPassword) {
          throw new Error('两次输入的新密码不一致。');
        }
        await props.onSubmit(values.newPassword);
        form.resetFields();
      }}
      okText="确认修改"
      confirmLoading={props.loading}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="新密码"
          name="newPassword"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, message: '至少 8 个字符' },
          ]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          label="确认新密码"
          name="confirmPassword"
          rules={[{ required: true, message: '请再次输入新密码' }]}
        >
          <Input.Password />
        </Form.Item>
      </Form>
    </Modal>
  );
}
