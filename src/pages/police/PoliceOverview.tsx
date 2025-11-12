import { useEffect, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { Chart, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend } from 'chart.js'
import { request } from '../../services/api'

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend)

type Props = { token: string }

export default function PoliceOverview({ token }: Props) {
  const [stats, setStats] = useState<{ totalComplaints: number; casesSolved: number; complaintsPending: number; activeOfficers: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    request<{ stats: any }>('/stats', { method: 'GET' })
      .then((res) => { if (active) setStats(res.stats) })
      .catch((err) => setError(err.message || 'Failed to load stats'))
    return () => { active = false }
  }, [token])

  const barData = {
    labels: ['Pending', 'In Progress', 'Solved'],
    datasets: [{ label: 'Complaints', backgroundColor: '#38bdf8', data: [stats?.complaintsPending || 0, Math.max((stats?.totalComplaints || 0) - (stats?.complaintsPending || 0) - (stats?.casesSolved || 0), 0), stats?.casesSolved || 0] }],
  }
  const lineData = {
    labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    datasets: [{ label: 'Trend', borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', data: [12, 14, 9, 16, 20, 18, 22] }],
  }

  return (
    <div className="panel">
      <div className="grid two" style={{ alignItems: 'stretch' }}>
        <div className="card">
          <div className="label">Key Stats</div>
          {error && <div className="form-error">{error}</div>}
          <div className="stats-grid">
            <div className="stat">
              <div className="value">{stats?.totalComplaints ?? 0}</div>
              <div className="muted">Total Complaints</div>
            </div>
            <div className="stat">
              <div className="value">{Math.max((stats?.totalComplaints || 0) - (stats?.complaintsPending || 0) - (stats?.casesSolved || 0), 0)}</div>
              <div className="muted">Active Cases</div>
            </div>
            <div className="stat">
              <div className="value">{stats?.casesSolved ?? 0}</div>
              <div className="muted">Resolved Cases</div>
            </div>
            <div className="stat">
              <div className="value">—</div>
              <div className="muted">Avg Resolution Time</div>
            </div>
            <div className="stat">
              <div className="value">{0}</div>
              <div className="muted">Emergency Alerts</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="label">Mini Map</div>
          <iframe title="map" src="https://maps.google.com/maps?q=Navi%20Mumbai&t=&z=11&ie=UTF8&iwloc=&output=embed" style={{ width: '100%', minHeight: 220, border: 0, borderRadius: 10 }} />
          <div className="muted" style={{ marginTop: 8 }}>Latest complaint pins preview. Switch to interactive map later.</div>
        </div>
      </div>
      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="label">Distribution</div>
          <Bar data={barData} options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }} />
        </div>
        <div className="card">
          <div className="label">Real-time Trend</div>
          <Line data={lineData} options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }} />
        </div>
      </div>
    </div>
  )
}