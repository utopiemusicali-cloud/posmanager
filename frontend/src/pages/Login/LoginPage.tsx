import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, Typography, Alert } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { login } from '@/api/endpoints/auth'
import { useAuthStore } from '@/store/auth'

const { Title, Text } = Typography

export default function LoginPage() {
  const navigate = useNavigate()
  const { login: storeLogin } = useAuthStore()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    setError(null)
    try {
      const data = await login(values.username, values.password)
      storeLogin(data.access_token, values.username)
      navigate('/dashboard')
    } catch {
      setError('Username o password errati')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      }}
    >
      <Card style={{ width: 380, borderRadius: 12 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ margin: 0, color: '#8e44ad' }}>
            POSMANAGER
          </Title>
          <Text type="secondary">Oblique Strategies</Text>
        </div>

        {error && <Alert message={error} type="error" style={{ marginBottom: 16 }} />}

        <Form onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: 'Inserisci username' }]}>
            <Input prefix={<UserOutlined />} placeholder="Username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: 'Inserisci password' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Accedi
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
