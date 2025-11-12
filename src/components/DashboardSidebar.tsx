import { FiHome, FiAlertCircle, FiList, FiMap, FiBell, FiUser, FiHelpCircle, FiLogOut } from 'react-icons/fi'

type Props = {
  active: string
  onChange: (key: string) => void
}

const items = [
  { key: 'overview', label: 'Dashboard Overview', icon: FiHome },
  { key: 'new', label: 'Report New Complaint', icon: FiAlertCircle },
  { key: 'my', label: 'My Complaints', icon: FiList },
  { key: 'track', label: 'Track Complaint (Map View)', icon: FiMap },
  { key: 'notifications', label: 'Notifications / Updates', icon: FiBell },
  { key: 'profile', label: 'Profile Settings', icon: FiUser },
  { key: 'support', label: 'Help & Support', icon: FiHelpCircle },
]

export default function DashboardSidebar({ active, onChange }: Props) {
  return (
    <aside className="dash-sidebar">
      <nav>
        {items.map(it => {
          const Icon = it.icon
          return (
            <button key={it.key} className={`side-item ${active === it.key ? 'active' : ''}`} onClick={() => onChange(it.key)}>
              <Icon />
              <span>{it.label}</span>
            </button>
          )
        })}
        <div className="spacer" />
        <a className="side-item" href="/" title="Logout redirects to home">
          <FiLogOut />
          <span>Logout</span>
        </a>
      </nav>
    </aside>
  )
}