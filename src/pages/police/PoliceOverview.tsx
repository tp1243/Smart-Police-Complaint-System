import { useEffect, useState } from 'react'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { Chart, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, ArcElement } from 'chart.js'
import { policeApi } from '../../services/police'

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, ArcElement)

type Props = { token: string; station?: string }

export default function PoliceOverview({ token, station }: Props) {
  const [barData, setBarData] = useState<any>({ labels: ['Pending','In Progress','Solved'], datasets: [{ label: 'Complaints', backgroundColor: '#38bdf8', data: [0,0,0] }] })
  const [lineData, setLineData] = useState<any>({ labels: [], datasets: [{ label: 'Trend', borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', data: [] }] })
  const [firData, setFirData] = useState<any>({ labels: ['FIR','Non-FIR'], datasets: [{ data: [0,0], backgroundColor: ['#ef4444','#3b82f6'] }] })
  const [heatPoints, setHeatPoints] = useState<Array<{ lat: number; lng: number }>>([])
  const [heatBounds, setHeatBounds] = useState<{ minLat: number; maxLat: number; minLng: number; maxLng: number } | null>(null)

  useEffect(() => {
    let active = true
    function compute(complaints: any[]) {
      const scoped = station ? complaints.filter((c) => (c.station || '').trim() === station) : complaints
      const total = scoped.length
      const solved = scoped.filter((c) => (c.status || '') === 'Solved').length
      const pending = scoped.filter((c) => (c.status || '') === 'Pending').length
      const inProgress = scoped.filter((c) => ['In Progress','Under Review'].includes(c.status || '')).length
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
      const firSet = new Set(['Robbery','Assault','Theft','Accident'])
      const fir = scoped.filter((c) => String(c.category || '').toLowerCase() === 'fir' || firSet.has(String(c.type || ''))).length
      const nonFir = Math.max(total - fir, 0)
      setFirData({ labels: ['FIR','Non-FIR'], datasets: [{ data: [fir, nonFir], backgroundColor: ['#ef4444','#3b82f6'] }] })
      const pts = scoped.map((c) => c.location || {}).filter((loc) => typeof loc.lat === 'number' && typeof loc.lng === 'number') as Array<{ lat: number; lng: number }>
      setHeatPoints(pts)
      if (pts.length > 0) {
        let minLat = pts[0].lat, maxLat = pts[0].lat, minLng = pts[0].lng, maxLng = pts[0].lng
        for (const p of pts) { if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng }
        setHeatBounds({ minLat, maxLat, minLng, maxLng })
      } else {
        setHeatBounds(null)
      }
    }
    policeApi.listComplaints(token, { fields: 'summary', limit: 200 })
      .then((res) => { if (!active) return; compute(res.complaints || []) })
      .catch(() => {})
    const id = setInterval(() => {
      policeApi.listComplaints(token, { fields: 'summary', limit: 200 }).then((res) => compute(res.complaints || [])).catch(() => {})
    }, 12000)
    const onStatus = () => {
      policeApi.listComplaints(token, { fields: 'summary', limit: 200 }).then((res) => compute(res.complaints || [])).catch(() => {})
    }
    window.addEventListener('spcs:complaint-status-updated', onStatus)
    return () => { active = false; clearInterval(id); window.removeEventListener('spcs:complaint-status-updated', onStatus) }
  }, [token, station])

  useEffect(() => {
    const canvas = document.getElementById('heat-canvas') as HTMLCanvasElement | null
    if (!canvas || !heatBounds) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const hb = heatBounds
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)
    if (!heatPoints || heatPoints.length === 0) return
    const latSpan = hb.maxLat - hb.minLat || 1
    const lngSpan = hb.maxLng - hb.minLng || 1
    function toXY(lat: number, lng: number) {
      const x = ((lng - hb.minLng) / lngSpan) * w
      const y = ((hb.maxLat - lat) / latSpan) * h
      return { x, y }
    }
    for (const p of heatPoints) {
      const { x, y } = toXY(p.lat, p.lng)
      const radius = Math.max(Math.min(w, h) * 0.06, 18)
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
      g.addColorStop(0, 'rgba(239, 68, 68, 0.75)')
      g.addColorStop(0.6, 'rgba(239, 68, 68, 0.25)')
      g.addColorStop(1, 'rgba(239, 68, 68, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [heatPoints, heatBounds])


  return (
    <div className="panel">
      <div className="grid two" style={{ alignItems: 'stretch' }}>
        <div className="card">
          <div className="label">FIR vs Non-FIR</div>
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, alignItems: 'center' }}>
            <Doughnut data={firData} options={{ plugins: { legend: { position: 'bottom' } } }} />
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="stat">
                <div className="value" style={{ color: '#ef4444' }}>{firData.datasets[0].data[0] || 0}</div>
                <div className="muted">FIR</div>
              </div>
              <div className="stat">
                <div className="value" style={{ color: '#3b82f6' }}>{firData.datasets[0].data[1] || 0}</div>
                <div className="muted">Non-FIR</div>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="label">Heat Map</div>
          <div style={{ position: 'relative', width: '100%', minHeight: 220, borderRadius: 10, overflow: 'hidden', background: 'linear-gradient(180deg,#0f172a 0%,#111827 100%)', border: '1px solid #1f2a44' }}>
            <canvas id="heat-canvas" width={600} height={260} style={{ width: '100%', height: 220, display: 'block' }} />
          </div>
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