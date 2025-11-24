import { useEffect, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { Chart, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend } from 'chart.js'
import { policeApi } from '../../services/police'

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend)

type Props = { token: string; station?: string }

export default function PoliceOverview({ token, station }: Props) {
  const [barData, setBarData] = useState<any>({ labels: ['Pending','In Progress','Solved'], datasets: [{ label: 'Complaints', backgroundColor: '#38bdf8', data: [0,0,0] }] })
  const [lineData, setLineData] = useState<any>({ labels: [], datasets: [{ label: 'Trend', borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', data: [] }] })
  const [firCount, setFirCount] = useState<number>(0)
  const [nonFirCount, setNonFirCount] = useState<number>(0)
  const [heatPoints, setHeatPoints] = useState<Array<{ lat: number; lng: number }>>([])
  const [heatBounds, setHeatBounds] = useState<{ minLat: number; maxLat: number; minLng: number; maxLng: number } | null>(null)

  useEffect(() => {
    let active = true
    function compute(complaints: any[]) {
      const scoped = station ? complaints.filter((c) => (c.station || '').trim() === station) : complaints
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
      const fir = scoped.filter((c) => String(c.category || '').trim().toLowerCase() === 'fir').length
      const nonFir = scoped.filter((c) => String(c.category || '').trim().toLowerCase() === 'non-fir').length
      setFirCount(fir)
      setNonFirCount(nonFir)
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
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
    canvas.width = Math.max(600, Math.floor(rect.width * dpr))
    canvas.height = Math.max(260, Math.floor(rect.height * dpr))
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (dpr > 1) ctx.scale(dpr, dpr)
    const w = rect.width
    const h = rect.height
    const z = 12
    const t = 256
    function toRad(d: number) { return (d * Math.PI) / 180 }
    const centerLat = heatBounds ? (heatBounds.minLat + heatBounds.maxLat) / 2 : 19.033
    const centerLng = heatBounds ? (heatBounds.minLng + heatBounds.maxLng) / 2 : 73.029
    const n = t * Math.pow(2, z)
    function worldXY(lat: number, lng: number) {
      const x = ((lng + 180) / 360) * n
      const y = ((1 - Math.log(Math.tan(toRad(lat)) + 1 / Math.cos(toRad(lat))) / Math.PI) / 2) * n
      return { x, y }
    }
    const cxy = worldXY(centerLat, centerLng)
    const topLeftX = cxy.x - w / 2
    const topLeftY = cxy.y - h / 2
    const startTileX = Math.floor(topLeftX / t)
    const startTileY = Math.floor(topLeftY / t)
    const endTileX = Math.floor((topLeftX + w) / t)
    const endTileY = Math.floor((topLeftY + h) / t)
    const tiles: Array<{ img: HTMLImageElement; x: number; y: number }> = []
    const loads: Promise<void>[] = []
    for (let tx = startTileX; tx <= endTileX; tx++) {
      for (let ty = startTileY; ty <= endTileY; ty++) {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`
        const px = tx * t - topLeftX
        const py = ty * t - topLeftY
        tiles.push({ img, x: px, y: py })
        loads.push(new Promise((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve() }))
      }
    }
    Promise.all(loads).then(() => {
      for (const ti of tiles) ctx.drawImage(ti.img, ti.x, ti.y, 256, 256)
      if (!heatPoints || heatPoints.length === 0) return
      function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
        const R = 6371
        const dLat = toRad(lat2 - lat1)
        const dLng = toRad(lng2 - lng1)
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
      }
      const intensities = heatPoints.map(p => {
        let c = 0
        for (const q of heatPoints) {
          if (haversineKm(p.lat, p.lng, q.lat, q.lng) <= 0.8) c++
        }
        return c
      })
      for (let i = 0; i < heatPoints.length; i++) {
        const p = heatPoints[i]
        const wxy = worldXY(p.lat, p.lng)
        const cx = wxy.x - topLeftX
        const cy = wxy.y - topLeftY
        const val = intensities[i]
        let color = 'rgba(34,197,94,0.35)'
        if (val >= 6) color = 'rgba(239,68,68,0.40)'
        else if (val >= 3) color = 'rgba(234,179,8,0.38)'
        const r = Math.max(28, Math.min(Math.max(w, h) * 0.06, 40))
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      }
    })
  }, [heatPoints, heatBounds])


  return (
    <div className="panel">
      <div className="grid two" style={{ alignItems: 'stretch' }}>
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 12 }}>
          <div className="card" style={{ background: 'linear-gradient(135deg,#1f2937 0%,#111827 100%)', border: '1px solid #374151', minHeight: 100 }}>
            <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#ef4444', display: 'inline-block' }}></span>
              FIR
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: '#ef4444' }}>{firCount}</div>
              <div className="muted">cases</div>
            </div>
          </div>
          <div className="card" style={{ background: 'linear-gradient(135deg,#1f2937 0%,#0b3a2a 100%)', border: '1px solid #1e3a2f', minHeight: 100 }}>
            <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#10b981', display: 'inline-block' }}></span>
              Non-FIR
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: '#10b981' }}>{nonFirCount}</div>
              <div className="muted">cases</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="label">Heat Map</div>
          <div style={{ position: 'relative', width: '100%', minHeight: 220, borderRadius: 10, overflow: 'hidden', background: '#0b1220', border: '1px solid #1f2a44' }}>
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