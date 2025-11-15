import { useEffect, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { Chart, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend } from 'chart.js'
import { policeApi } from '../../services/police'

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend)

type Props = { token: string; station?: string }

export default function PoliceOverview({ token, station }: Props) {
  const [stats, setStats] = useState<{ totalComplaints: number; casesSolved: number; complaintsPending: number; activeOfficers: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [barData, setBarData] = useState<any>({ labels: ['Pending','In Progress','Solved'], datasets: [{ label: 'Complaints', backgroundColor: '#38bdf8', data: [0,0,0] }] })
  const [lineData, setLineData] = useState<any>({ labels: [], datasets: [{ label: 'Trend', borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', data: [] }] })

  useEffect(() => {
    let active = true
    function compute(complaints: any[]) {
      const scoped = station ? complaints.filter((c) => (c.station || '').trim() === station) : complaints
      const total = scoped.length
      const solved = scoped.filter((c) => (c.status || '') === 'Solved').length
      const pending = scoped.filter((c) => (c.status || '') === 'Pending').length
      const inProgress = scoped.filter((c) => ['In Progress','Under Review'].includes(c.status || '')).length
      setStats({ totalComplaints: total, casesSolved: solved, complaintsPending: pending, activeOfficers: 0 })
      setBarData({ labels: ['Pending','In Progress','Solved'], datasets: [{ label: 'Complaints', backgroundColor: '#38bdf8', data: [pending, inProgress, solved] }] })
      const days = [...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d
      })
      const labels = days.map((d) => d.toLocaleDateString(undefined, { weekday: 'short' }))
      const counts = days.map((d) => {
        const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
        return scoped.filter((c) => {
          const cd = new Date(c.createdAt || c.updatedAt || Date.now())
          const ck = new Date(cd.getFullYear(), cd.getMonth(), cd.getDate()).getTime()
          return ck === key
        }).length
      })
      setLineData({ labels, datasets: [{ label: 'Trend', borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', data: counts }] })
    }
    policeApi.listComplaints(token)
      .then((res) => { if (!active) return; compute(res.complaints || []) })
      .catch((err) => setError(err.message || 'Failed to load stats'))
    const id = setInterval(() => {
      policeApi.listComplaints(token).then((res) => compute(res.complaints || [])).catch(() => {})
    }, 12000)
    return () => { active = false; clearInterval(id) }
  }, [token, station])


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