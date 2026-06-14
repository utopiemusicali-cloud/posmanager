import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Button, Typography, Space, Avatar, Tag } from 'antd'
import {
  DashboardOutlined,
  FileTextOutlined,
  TeamOutlined,
  InboxOutlined,
  FundOutlined,
  ShoppingCartOutlined,
  LogoutOutlined,
  UserOutlined,
  SettingOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store/auth'

const { Sider, Content } = Layout
const { Text } = Typography

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { username, role, logout } = useAuthStore()

  const isAdmin = role === 'admin' || role === 'superadmin'

  const menuItems = [
    {
      key: 'discogs',
      label: 'DISCOGS',
      type: 'group' as const,
      children: [
        { key: '/inventory', icon: <InboxOutlined />, label: 'Inventario' },
        { key: '/discogs-orders', icon: <ShoppingCartOutlined />, label: 'Ordini Discogs' },
      ],
    },
    {
      key: 'gestionale',
      label: 'GESTIONALE',
      type: 'group' as const,
      children: [
        { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
        { key: '/receipt', icon: <FileTextOutlined />, label: 'Nuova Ricevuta' },
        { key: '/customers', icon: <TeamOutlined />, label: 'Rubrica Clienti' },
        { key: '/cost-centers', icon: <FundOutlined />, label: 'Centro Costi' },
        ...(isAdmin ? [
          { key: '/users', icon: <UsergroupAddOutlined />, label: 'Utenti' },
          { key: '/settings', icon: <SettingOutlined />, label: 'Impostazioni' },
        ] : []),
      ],
    },
  ]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{ background: '#34495e', overflow: 'auto', height: '100vh', position: 'fixed', left: 0, top: 0, bottom: 0 }}
      >
        {/* Logo / Titolo */}
        <div style={{ padding: '20px 16px 8px', textAlign: 'center' }}>
          <Text strong style={{ color: 'white', fontSize: 18, display: 'block' }}>
            POSMANAGER
          </Text>
          <Text style={{ color: '#bdc3c7', fontSize: 11 }}>Oblique Strategies</Text>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ background: '#34495e', border: 'none', color: 'white' }}
          theme="dark"
        />

        {/* Footer sidebar */}
        <div style={{ position: 'absolute', bottom: 0, width: '100%', padding: '16px' }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <Avatar icon={<UserOutlined />} size="small" style={{ background: '#8e44ad' }} />
              <div>
                <Text style={{ color: '#bdc3c7', fontSize: 12, display: 'block' }}>{username}</Text>
                {role && <Tag color={role === 'admin' || role === 'superadmin' ? 'purple' : 'default'} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>{role}</Tag>}
              </div>
            </Space>
            <Button
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              style={{ width: '100%', background: '#95a5a6', border: 'none', color: 'white' }}
            >
              Esci
            </Button>
          </Space>
        </div>
      </Sider>

      <Layout style={{ marginLeft: 220 }}>
        <Content style={{ padding: '24px', background: '#f0f2f5', minHeight: '100vh' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
