import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PoliceNavbar from '../components/police/PoliceNavbar'
import PoliceSidebar from '../components/police/PoliceSidebar'
import PoliceOverview from './police/PoliceOverview'
import PoliceComplaints from './police/PoliceComplaints'
import PoliceMap from './police/PoliceMap'
import PoliceReports from './police/PoliceReports'
import PoliceChat from './police/PoliceChat'
import PoliceAlerts from './police/PoliceAlerts'
import PoliceOfficers from './police/PoliceOfficers'
import PoliceSettings from './police/PoliceSettings'
import PoliceNotifications from './police/PoliceNotifications'

export default function PoliceDashboard() {
  const navigate = useNavigate()
  const [section, setSection] = useState<string>('overview')
  const [officer, setOfficer] = useState<{ id?: string; username: string; station?: string; email?: string } | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('policeToken')
    const userStr = localStorage.getItem('policeUser')
    if (!token || !userStr) { navigate('/police/login'); return }
    try {
      const u = JSON.parse(userStr)
      setOfficer({ id: u.id, username: u.username, station: u.station, email: u.email })
    } catch { navigate('/police/login') }
  }, [])

  function logout() {
    localStorage.removeItem('policeToken')
    localStorage.removeItem('policeUser')
    navigate('/police/login')
  }

  const username = officer?.username || 'Officer'
  const token = localStorage.getItem('policeToken') || ''

  const content = useMemo(() => {
    switch (section) {
      case 'overview':
        return <PoliceOverview token={token} />
      case 'active':
      case 'pending':
      case 'completed':
        return <PoliceComplaints token={token} filter={section} officer={officer || undefined} />
      case 'map':
        return <PoliceMap token={token} />
      case 'analytics':
        return <PoliceReports token={token} />
      case 'chat':
        return <PoliceChat token={token} officer={officer || undefined} />
      case 'alerts':
        return <PoliceAlerts token={token} />
      case 'notifications':
        return <PoliceNotifications token={token} />
      case 'officers':
        return <PoliceOfficers token={token} />
      case 'settings':
        return <PoliceSettings token={token} />
      case 'help':
        return (
          <div className="panel">
            <div className="muted">For help, contact system admin or see documentation.</div>
          </div>
        )
      default:
        return <PoliceOverview token={token} />
    }
  }, [section, token, officer])

  function handleSearch(q: string) {
    setSection('active')
    // The PoliceComplaints component handles its own search internally.
    // Here we only switch to the Active Complaints view.
  }

  return (
    <div className="dashboard">
      <PoliceNavbar token={token} username={username} onSearch={handleSearch} onLogout={logout} />
      <div className="dash-body">
        <PoliceSidebar active={section} onChange={setSection} onLogout={logout} />
        <main className="dash-main">
          {content}
        </main>
      </div>
    </div>
  )
}