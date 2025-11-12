import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardNavbar from '../components/DashboardNavbar'
import DashboardSidebar from '../components/DashboardSidebar'
import ProfileSettings from './ProfileSettings'
import Analytics from '../components/Analytics'
import { complaintsApi } from '../services/complaints'
import { api, supportApi,  type ProfileUser } from '../services/api'
import { notificationsApi } from '../services/notifications'
import { connectRealtime } from '../services/realtime'
import { FiHelpCircle, FiMessageCircle, FiFileText, FiStar, FiPhone, FiBookOpen, FiSearch, FiChevronDown, FiChevronUp, FiThumbsUp, FiThumbsDown, FiLink, FiPaperclip, FiSend, FiX, FiFilter, FiBell, FiCheck, FiRefreshCw, FiCamera, FiVideo } from 'react-icons/fi'
import { AnimatePresence, motion } from 'framer-motion'
import jsPDF from 'jspdf'
import type { Complaint, ComplaintStatus, NotificationItem } from '../types'
import { useNotificationSound } from '../components/useNotificationSound'
import '../notifications.css'

export default function UserDashboard() {
  const navigate = useNavigate()
  const [section, setSection] = useState('overview')
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [stats, setStats] = useState<Record<string, number>>({ Pending: 0, 'In Progress': 0, Solved: 0, 'Under Review': 0 })
  const [profile, setProfile] = useState<ProfileUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const notify = useNotificationSound({ volume: 0.85, cooldownMs: 3000 })
  const firstPoll = useRef(true)
  const statusMapRef = useRef<Record<string, string>>({})

  useEffect(() => {
    const onEnable = () => { notify.setEnabled(true); notify.prime() }
    const onDisable = () => { notify.setEnabled(false) }
    window.addEventListener('spcs:enable-sound', onEnable)
    window.addEventListener('spcs:disable-sound', onDisable)
    return () => {
      window.removeEventListener('spcs:enable-sound', onEnable)
      window.removeEventListener('spcs:disable-sound', onDisable)
    }
  }, [notify])

  const token = localStorage.getItem('token') || ''
  const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null } })()

  useEffect(() => {
    if (!user || !token) { navigate('/login'); return }
    ;(async () => {
      try {
        const p = await api.profile(token)
        setProfile(p.user)
        const list = await complaintsApi.listMine(token)
        setComplaints(list.complaints)
        statusMapRef.current = Object.fromEntries(list.complaints.map(c => [String(c._id || ''), String(c.status || '')]))
        const s = await complaintsApi.stats(token)
        setStats(s.stats)
        setLoading(false)
      } catch (err: any) {
        setError(err.message || 'Failed to load dashboard')
        setLoading(false)
      }
    })()
  }, [token])

  // Poll for status changes and play a notification when a complaint status updates
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const list = await complaintsApi.listMine(token)
        const nextMap = Object.fromEntries(list.complaints.map(c => [String(c._id || ''), String(c.status || '')]))
        let changed = false
        for (const [cid, st] of Object.entries(nextMap)) {
          if (statusMapRef.current[cid] && statusMapRef.current[cid] !== st) { changed = true; break }
        }
        setComplaints(list.complaints)
        statusMapRef.current = nextMap
        if (!firstPoll.current && changed) notify.play()
        if (firstPoll.current) firstPoll.current = false
      } catch {
        // ignore transient poll errors
      }
    }, 30000)
    return () => clearInterval(id)
  }, [token, notify])

  const username = profile?.username || user?.username || 'User'

  function handleLogout() {
    localStorage.removeItem('token'); localStorage.removeItem('user'); navigate('/login')
  }

  function handleSearch(q: string) {
    const norm = q.trim().toLowerCase()
    const filtered = complaints.filter(c =>
      c.title.toLowerCase().includes(norm) ||
      (c._id || '').toLowerCase().includes(norm) ||
      (c.status || '').toLowerCase().includes(norm)
    )
    setSection('my')
    setComplaints(filtered)
  }

  async function submitComplaint(payload: Complaint) {
    const res = await complaintsApi.create(payload, token)
    setComplaints(prev => [res.complaint, ...prev])
    const s = await complaintsApi.stats(token)
    setStats(s.stats)
    setRefreshSignal(v => v + 1)
    setSection('my')
  }

  const content = useMemo(() => {
    if (loading) return <div className="panel"><div className="muted">Loading dashboard…</div></div>
    if (error) return <div className="panel error">{error}</div>

    switch (section) {
      case 'overview':
        return (<>
          <Overview stats={stats} complaints={complaints} />
          <Analytics token={token} refreshSignal={refreshSignal} />
        </>)
      case 'new':
        return <ComplaintForm onSubmit={submitComplaint} />
      case 'my':
        return <ComplaintsTable items={complaints} />
      case 'track':
        return <MapView items={complaints} />
      case 'notifications':
        return <NotificationsPanel token={token} />
      case 'support':
        return <SupportPanel token={token} profile={profile} />
      case 'profile':
        return <ProfileSettings />
      default:
        return <Overview stats={stats} complaints={complaints} />
    }
  }, [section, loading, error, stats, complaints, profile])


  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    <div className={`dashboard ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <DashboardNavbar token={token} username={username} onSearch={handleSearch} onLogout={handleLogout} onToggleSidebar={() => setSidebarOpen(prev => !prev)} sidebarOpen={sidebarOpen} />
      {/* Mobile-only hamburger placed after navbar, aligned left */}
      <button className="mobile-hamburger" aria-label={sidebarOpen ? 'Close menu' : 'Open menu'} onClick={() => setSidebarOpen(prev => !prev)}>
        {sidebarOpen ? 'Close Menu' : 'Menu'}
      </button>
      <div className="dash-body">
        <DashboardSidebar active={section} onChange={(key) => { setSection(key); setSidebarOpen(false); }} />
        {/* Mobile overlay to close sidebar when open */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />}
        <main className="dash-main">
          {content}
        </main>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  )
}

function Overview({ stats, complaints }: { stats: Record<string, number>; complaints: Complaint[] }) {
  return (
    <div>
      <div className="grid stats">
        <StatCard label="Total Complaints Filed" value={complaints.length} />
        <StatCard label="Complaints Solved" value={stats['Solved'] || 0} />
        <StatCard label="Pending Complaints" value={stats['Pending'] || 0} />
        <StatCard label="Under Review" value={stats['Under Review'] || 0} />
      </div>
      <div className="panel">
        <div className="muted">Quick actions: Use the sidebar to submit or track a complaint.</div>
      </div>
    </div>
  )
}

function ComplaintsTable({ items }: { items: Complaint[] }) {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [q, setQ] = useState<string>('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest')
  const filtered = items
    .filter(c => (!statusFilter || c.status === statusFilter))
    .filter(c => !q || (c.title || '').toLowerCase().includes(q.toLowerCase()) || (c.description || '').toLowerCase().includes(q.toLowerCase()) || (c._id || '').includes(q))
    .sort((a, b) => {
      const da = new Date(a.createdAt || 0).getTime()
      const db = new Date(b.createdAt || 0).getTime()
      return sortBy === 'newest' ? db - da : da - db
    })
  if (items.length === 0) return <div className="panel"><div className="muted">No complaints yet.</div></div>
  return (
    <>
      <div>
        <div className="panel" style={{ marginBottom: 10 }}>
          <div className="table-toolbar">
            <FiSearch />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, ID, or description" />
          </div>
          <div className="filters">
            <span className={`pill ${statusFilter === '' ? 'active' : ''}`} onClick={() => setStatusFilter('')}>All</span>
            <span className={`pill ${statusFilter === 'Pending' ? 'active' : ''}`} onClick={() => setStatusFilter('Pending')}>Pending</span>
            <span className={`pill ${statusFilter === 'Under Review' ? 'active' : ''}`} onClick={() => setStatusFilter('Under Review')}>Under Review</span>
            <span className={`pill ${statusFilter === 'In Progress' ? 'active' : ''}`} onClick={() => setStatusFilter('In Progress')}>In Progress</span>
            <span className={`pill ${statusFilter === 'Solved' ? 'active' : ''}`} onClick={() => setStatusFilter('Solved')}>Solved</span>
            <div className="sort">
              <FiFilter />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="sort-select">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>
        </div>
        <div className="table">
          <div className="thead">
            <div>ID</div><div>Title</div><div>Filed</div><div>Status</div><div>Station</div><div>Actions</div>
          </div>
          {filtered.map((c) => {
            const distance = typeof c.nearestDistanceKm === 'number' ? `${c.nearestDistanceKm.toFixed(1)} km` : ''
            const filed = new Date(c.createdAt || '').toLocaleDateString()
            const station = c.station ? `${c.station}${distance ? ` (${distance})` : ''}` : '-'
            return (
              <div className="trow" key={c._id}>
                <div title={c._id}>{c._id?.slice(-6)}</div>
                <div className="title-cell" title={c.title}>
                  {c.photoUrl ? (
                    <img className="thumb" src={c.photoUrl} alt="complaint photo" />
                  ) : (
                    <span className="thumb placeholder" aria-hidden />
                  )}
                  <span className="title-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                </div>
                <div>{filed}</div>
                <div><StatusBadge status={(c.status as ComplaintStatus) || 'Pending'} /></div>
                <div title={station}>{station}</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <DetailsModalButton complaint={c} />
                  <DownloadPdfButton complaint={c} />
                </div>
              </div>
            )
          })}
        </div>
        {/* Mobile cards view for complaints */}
        <div className="complaints-cards">
          {filtered.map((c) => {
            const distance = typeof c.nearestDistanceKm === 'number' ? `${c.nearestDistanceKm.toFixed(1)} km` : ''
            const filed = new Date(c.createdAt || '').toLocaleDateString()
            const station = c.station ? `${c.station}${distance ? ` (${distance})` : ''}` : '-'
            return (
              <div className="card complaint-card" key={c._id}>
                <div className="head">
                  <div className="meta">
                    <span title={c._id}>#{c._id?.slice(-6)}</span>
                    <span>{filed}</span>
                    <span title={station}>{station}</span>
                  </div>
                  <StatusBadge status={(c.status as ComplaintStatus) || 'Pending'} />
                </div>
                <div className="title-row" title={c.title}>
                  {c.photoUrl ? (
                    <img className="thumb" src={c.photoUrl} alt="complaint photo" />
                  ) : (
                    <span className="thumb placeholder" aria-hidden />
                  )}
                  <span className="title-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                </div>
                <div className="actions">
                  <DetailsModalButton complaint={c} />
                  <DownloadPdfButton complaint={c} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

function StatusBadge({ status }: { status: ComplaintStatus }) {
  return <span className={`badge ${status.replace(/\s/g, '-').toLowerCase()}`}>{status}</span>
}

function DetailsModalButton({ complaint }: { complaint: Complaint }) {
  const [open, setOpen] = useState(false)
  function renderDescription(text: string) {
    const lines = (text || '').split(/\r?\n/).filter(l => l.trim().length > 0)
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const linkify = (line: string) => line.split(urlRegex).map((chunk, idx) => {
      const isUrl = /^https?:\/\//.test(chunk)
      return isUrl ? <a key={idx} href={chunk} target="_blank" rel="noopener noreferrer">{chunk}</a> : <span key={idx}>{chunk}</span>
    })
    const nodes: React.ReactNode[] = []
    let list: string[] = []
    for (const l of lines) {
      if (/^[-*•]\s+/.test(l.trim())) {
        list.push(l.trim().replace(/^[-*•]\s+/, ''))
      } else {
        if (list.length) {
          nodes.push(<ul className="desc-list">{list.map((i, k) => <li key={`li-${k}`}>{linkify(i)}</li>)}</ul>)
          list = []
        }
        nodes.push(<p className="desc-paragraph">{linkify(l)}</p>)
      }
    }
    if (list.length) nodes.push(<ul className="desc-list">{list.map((i, k) => <li key={`li-${k}`}>{linkify(i)}</li>)}</ul>)
    return nodes
  }
  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>View Details</button>
      {open && (
        <div className="modal">
          <div className="modal-body">
            <h3>{complaint.title}</h3>
            <p><b>Type:</b> {complaint.type}</p>
            <div className="modal-desc">
              <div className="modal-desc-title">Description</div>
              {complaint.description?.trim() ? renderDescription(complaint.description) : <div className="muted">No description provided.</div>}
            </div>
            <Timeline status={(complaint.status as ComplaintStatus) || 'Pending'} />
            {complaint.photoUrl && <img src={complaint.photoUrl} alt="evidence" style={{ maxWidth: '100%', borderRadius: 8 }} />}
            {complaint.location?.address && <p><b>Location:</b> {complaint.location.address}</p>}
            <p><b>Routed Station:</b> {complaint.station || 'Unassigned'}{typeof complaint.nearestDistanceKm === 'number' ? ` (${complaint.nearestDistanceKm.toFixed(1)} km)` : ''}</p>
            <div className="actions">
              <button className="btn" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Timeline({ status }: { status: ComplaintStatus }) {
  const stages: ComplaintStatus[] = ['Pending', 'Under Review', 'In Progress', 'Solved']
  const idx = stages.indexOf(status)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
      {stages.map((s, i) => (
        <span key={s} className={`badge ${s.replace(/\s/g,'-').toLowerCase()}`} style={{ opacity: i <= idx ? 1 : 0.5 }}>{s}</span>
      ))}
    </div>
  )
}

function DownloadPdfButton({ complaint }: { complaint: Complaint }) {
  function download() {
    const doc = new jsPDF()
    doc.text('Smart Police Complaint System', 14, 16)
    doc.text(`Complaint ID: ${complaint._id || '-'}`, 14, 26)
    doc.text(`Title: ${complaint.title}`, 14, 36)
    doc.text(`Type: ${complaint.type}`, 14, 46)
    doc.text(`Status: ${complaint.status || 'Pending'}`, 14, 56)
    doc.text(`Station: ${complaint.station || 'Unassigned'}`, 14, 66)
    if (typeof complaint.nearestDistanceKm === 'number') doc.text(`Nearest distance: ${complaint.nearestDistanceKm.toFixed(1)} km`, 14, 76)
    doc.text('Description:', 14, 86)
    doc.text(complaint.description || '', 14, 96)
    doc.save(`complaint_${complaint._id || 'report'}.pdf`)
  }
  return <button className="btn sm" onClick={download}>Download PDF</button>
}

function ComplaintForm({ onSubmit }: { onSubmit: (payload: Complaint) => Promise<void> }) {
  const [form, setForm] = useState<Complaint>(() => {
    const d = localStorage.getItem('complaintDraft')
    if (d) {
      try {
        const parsed = JSON.parse(d)
        const cleaned: Complaint = {
          ...parsed,
          // Always start with lat/lng unset; user must click "Use my location"
          location: {
            ...(parsed.location || {}),
            lat: undefined,
            lng: undefined,
          },
        }
        return cleaned
      } catch {
        // Fallback to empty form if stored draft is malformed
        return { title: '', type: '', description: '', contact: '', location: { address: '' } } as any
      }
    }
    return { title: '', type: '', description: '', contact: '', location: { address: '' } } as any
  })
  const [fileName, setFileName] = useState('')
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState('')
  const [errors, setErrors] = useState<{ title?: string; type?: string; description?: string; contact?: string }>({})
  const [submitError, setSubmitError] = useState('')
  useEffect(() => { localStorage.setItem('complaintDraft', JSON.stringify(form)) }, [form])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    // Guard against very large files to avoid 413 on server
    const MAX_SIZE = 4 * 1024 * 1024 // 4MB
    if (f.size > MAX_SIZE) {
      setSubmitError('Image too large. Please select a file under 4MB.')
      e.target.value = ''
      return
    }
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = () => setForm(prev => ({ ...prev, photoUrl: String(reader.result) }))
    reader.readAsDataURL(f)
  }

  // Camera capture state and helpers
  const [cameraActive, setCameraActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Stop camera on component unmount to release device
  useEffect(() => {
    return () => {
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [])

  async function getFirstVideoInputId() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cam = devices.find(d => d.kind === 'videoinput')
      return cam?.deviceId || null
    } catch {
      return null
    }
  }

  async function openCamera() {
    setSubmitError('')
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not supported in this browser.')
      }
      // Stop any previous stream before starting a new one
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      streamRef.current = null

      // Choose a specific camera if available to avoid ambiguous default
      const firstId = await getFirstVideoInputId()
      const constraints: MediaStreamConstraints = firstId
        ? { video: { deviceId: { exact: firstId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
        : { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }

      let stream: MediaStream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      setCameraActive(true)
      if (videoRef.current) {
        const v = videoRef.current
        v.srcObject = stream
        v.setAttribute('playsinline', 'true')
        v.muted = true
        // Wait until the video can play and a frame is available
        await new Promise<void>((resolve) => {
          const onPlaying = () => { v.removeEventListener('playing', onPlaying); resolve() }
          v.addEventListener('playing', onPlaying)
          setTimeout(() => resolve(), 800)
        })
        await v.play().catch(() => {})
        // If dimensions are still 0, attempt a small delay to allow a frame
        if (!v.videoWidth || !v.videoHeight) {
          await new Promise(r => setTimeout(r, 300))
        }
      }

    } catch (err: any) {
      setSubmitError(err?.message ? String(err.message) : 'Camera permission denied or unavailable.')
    }
  }

  function stopCamera() {
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
    streamRef.current = null
    if (videoRef.current) { try { videoRef.current.pause() } catch {}; videoRef.current.srcObject = null }
    setCameraActive(false)
  }

  function estimateDataUrlSize(dataUrl: string) {
    const b64 = dataUrl.split(',')[1] || ''
    return Math.ceil((b64.length * 3) / 4)
  }

  async function takePhoto() {
    setSubmitError('')
    const video = videoRef.current
    const canvas = canvasRef.current
    const stream = streamRef.current
    if (!canvas || !stream) { setSubmitError('Camera not active. Open camera first.'); return }
    const track = stream.getVideoTracks()[0]
    const MAX_SIZE = 4 * 1024 * 1024 // 4MB

    // Try ImageCapture first for better reliability
    try {
      // @ts-ignore - ImageCapture may not be typed in TS DOM lib
      if (typeof ImageCapture !== 'undefined' && track) {
        // @ts-ignore
        const imageCapture = new ImageCapture(track)
        let bitmap: ImageBitmap | null = null
        try {
          const blob: Blob = await imageCapture.takePhoto()
          bitmap = await createImageBitmap(blob)
        } catch {
          // If takePhoto fails, try grabbing a frame
          // @ts-ignore
          bitmap = await imageCapture.grabFrame().catch(() => null)
        }
        if (!bitmap) throw new Error('No camera frame available')
        const targetWidth = Math.min(bitmap.width || 1280, 1280)
        const targetHeight = Math.round((bitmap.height || 720) * (targetWidth / (bitmap.width || 1280)))
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas unavailable')
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
        let quality = 0.8
        let url = canvas.toDataURL('image/jpeg', quality)
        while (estimateDataUrlSize(url) > MAX_SIZE && quality > 0.4) { quality -= 0.2; url = canvas.toDataURL('image/jpeg', quality) }
        if (estimateDataUrlSize(url) > MAX_SIZE) { setSubmitError('Captured image too large. Try again.'); return }
  // removed setCapturedDataUrl (unused)
        setForm(prev => ({ ...prev, photoUrl: url }))
        setFileName(`camera_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
        return
      }
    } catch (err) {
      // Fallback to canvas draw from <video>
      console.warn('ImageCapture failed, falling back to video canvas:', err)
    }

    // Fallback: draw current video frame
    if (!video) { setSubmitError('Camera preview not ready.'); return }
    // Wait for a frame to be available
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const onCanPlay = () => { video.removeEventListener('canplay', onCanPlay); resolve() }
        video.addEventListener('canplay', onCanPlay)
        setTimeout(() => resolve(), 500)
      })
    }
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) { setSubmitError('No camera frame available. Try again.'); return }
    const targetWidth = Math.min(vw, 1280)
    const targetHeight = Math.round(vh * (targetWidth / vw))
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) { setSubmitError('Canvas unavailable'); return }
    // Wait one animation frame to ensure the latest frame is rendered
    await new Promise(requestAnimationFrame)
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
    let quality = 0.8
    let url = canvas.toDataURL('image/jpeg', quality)
    while (estimateDataUrlSize(url) > MAX_SIZE && quality > 0.4) { quality -= 0.2; url = canvas.toDataURL('image/jpeg', quality) }
    if (estimateDataUrlSize(url) > MAX_SIZE) { setSubmitError('Captured image too large. Try again.'); return }
  // removed setCapturedDataUrl (unused)
    setForm(prev => ({ ...prev, photoUrl: url }))
    setFileName(`camera_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
  }

  const [locating, setLocating] = useState(false);
  const [locStatus, setLocStatus] = useState<'idle' | 'searching' | 'accurate' | 'inaccurate' | 'denied' | 'timeout' | 'unavailable' | 'outdated'>('idle');
  const [currAccuracy, setCurrAccuracy] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [visualLoc, setVisualLoc] = useState<{ lat: number; lng: number } | null>(null);
  const samplesRef = useRef<Array<{ lat: number; lng: number; accuracy: number; timestamp: number }>>([]);
  // Persist last good location to improve reliability when GPS is flaky
  const lastGoodStored = (() => { try { return JSON.parse(localStorage.getItem('lastGoodLoc') || 'null') } catch { return null } })();
  const lastGoodRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(lastGoodStored);

  // Rough bounds and landmarks to validate Ghansoli positions and avoid creek misplacement
  const GHANSOLI_BOUNDS = { latMin: 19.08, latMax: 19.15, lngMin: 72.96, lngMax: 73.05 };
  const CREEK_BOUNDS = { latMin: 19.07, latMax: 19.11, lngMin: 72.97, lngMax: 73.01 };
  const GHANSOLI_LANDMARKS = [
    { name: 'Ghansoli Railway Station', lat: 19.1039, lng: 73.0006 },
    { name: 'Ghansoli Depot', lat: 19.1125, lng: 73.0030 },
    { name: 'IKEA Navi Mumbai', lat: 19.1185, lng: 72.9960 },
  ];

  const isInsideBounds = (lat: number, lng: number, b: { latMin: number; latMax: number; lngMin: number; lngMax: number }) =>
    lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;

  const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371000; // meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const nearestLandmark = (lat: number, lng: number) => {
    let best = { name: '', lat: 0, lng: 0 } as { name: string; lat: number; lng: number };
    let bestDist = Infinity;
    for (const lm of GHANSOLI_LANDMARKS) {
      const d = haversine(lat, lng, lm.lat, lm.lng);
      if (d < bestDist) { bestDist = d; best = lm; }
    }
    return { landmark: best, distance: bestDist };
  };

  const computeSmoothed = () => {
    const samples = samplesRef.current.slice(-5);
    if (samples.length === 0) return null as null | { lat: number; lng: number };
    let wsum = 0, lat = 0, lng = 0;
    for (const s of samples) {
      const w = 1 / Math.max(s.accuracy, 1);
      lat += s.lat * w;
      lng += s.lng * w;
      wsum += w;
    }
    return { lat: lat / wsum, lng: lng / wsum };
  };

  const applyPosition = (position: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = position.coords;
    const timestamp = position.timestamp || Date.now();
    // Simple outlier rejection to avoid big jumps into creek/water with poor accuracy
    if (samplesRef.current.length > 0) {
      const prev = samplesRef.current[samplesRef.current.length - 1];
      const jump = haversine(prev.lat, prev.lng, latitude, longitude);
      if (jump > 300 && (accuracy || 9999) > 50) {
        // Ignore this sample as an outlier
        setCurrAccuracy(accuracy || null);
        setLastUpdate(timestamp);
        return;
      }
    }
    samplesRef.current.push({ lat: latitude, lng: longitude, accuracy, timestamp });
    if (samplesRef.current.length > 20) samplesRef.current.shift();
    const smoothed = computeSmoothed();
    const next = smoothed || { lat: latitude, lng: longitude };

    // Update form with smoothed coords only (address remains manual)
    setForm(prev => ({ ...prev, location: { ...(prev.location || {}), lat: next.lat, lng: next.lng } }));
    setCurrAccuracy(accuracy || null);
    setLastUpdate(timestamp);

    // Validate against bounds and landmarks
    const withinGhansoli = isInsideBounds(next.lat, next.lng, GHANSOLI_BOUNDS);
    const nearLm = nearestLandmark(next.lat, next.lng);
    const isOutdated = Date.now() - timestamp > 60_000; // 1 minute considered outdated
    if (isOutdated) setLocStatus('outdated');
    else if (accuracy && accuracy <= 10 && withinGhansoli) setLocStatus('accurate');
    else setLocStatus('inaccurate');

    // Visual correction to avoid creek misplacement when reading is inaccurate but near Ghansoli landmarks
    const inCreek = isInsideBounds(next.lat, next.lng, CREEK_BOUNDS);
    if (inCreek && nearLm.distance < 1500 && (accuracy || 9999) > 10) {
      setVisualLoc({ lat: nearLm.landmark.lat, lng: nearLm.landmark.lng });
    } else {
      setVisualLoc({ lat: next.lat, lng: next.lng });
    }

    // Save last good location for future fallback
    if ((accuracy || 9999) <= 25 && withinGhansoli) {
      const lg = { lat: next.lat, lng: next.lng, timestamp };
      lastGoodRef.current = lg;
      try { localStorage.setItem('lastGoodLoc', JSON.stringify(lg)); } catch {}
    }
  };

  const handleUseLocation = () => {
    setLocating(true);
    setLocStatus('searching');

    const options = {
      enableHighAccuracy: true,
      timeout: 30000, // 30 seconds high-accuracy attempt
      maximumAge: 0,
    };

    let bestPosition: GeolocationPosition | null = null;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        applyPosition(position);
        if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
          bestPosition = position;
        }
        // Stop when we reach <= 10m accuracy
        if (position.coords.accuracy <= 10) {
          navigator.geolocation.clearWatch(watchId);
          setLocating(false);
          setLocStatus('accurate');
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        navigator.geolocation.clearWatch(watchId);
        setLocating(false);
        if (error.code === 1) {
          setLocStatus('denied');
          alert('Location permission denied. Please allow access to capture coordinates.');
        } else if (error.code === 2) {
          setLocStatus('unavailable');
          alert('GPS signal unavailable. Trying network-based location.');
          // Try a network-based fallback
          navigator.geolocation.getCurrentPosition(
            (pos) => { applyPosition(pos); },
            (err) => { console.error('Network fallback failed:', err); setLocStatus('unavailable'); },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
          );
        } else if (error.code === 3) {
          setLocStatus('timeout');
          alert('GPS timeout. Trying network-based location.');
          navigator.geolocation.getCurrentPosition(
            (pos) => { applyPosition(pos); },
            (err) => { console.error('Network fallback failed:', err); setLocStatus('unavailable'); },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
          );
        } else {
          setLocStatus('unavailable');
          alert('Error getting location. Please ensure location services are enabled and permissions are granted.');
        }
      },
      options
    );

    // Hard stop after 30 seconds; fallback to last good or network-based coarse location if needed
    setTimeout(() => {
      navigator.geolocation.clearWatch(watchId);
      if (bestPosition) {
        applyPosition(bestPosition);
        setLocating(false);
        setLocStatus((bestPosition.coords.accuracy || 9999) <= 10 ? 'accurate' : 'inaccurate');
      } else {
        // Try last good known location first
        if (lastGoodRef.current) {
          const { lat, lng, timestamp: ts } = lastGoodRef.current;
          setForm(prev => ({ ...prev, location: { ...(prev.location || {}), lat, lng } }));
          setLastUpdate(ts);
          setCurrAccuracy(null);
          setLocating(false);
          setLocStatus('inaccurate');
        } else {
          setLocStatus('timeout');
          navigator.geolocation.getCurrentPosition(
            (pos) => { applyPosition(pos); setLocating(false); },
            (err) => { console.error('Network fallback failed:', err); setLocating(false); setLocStatus('unavailable'); },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
          );
        }
      }
    }, 30000);
  };
  

  function validate() {
    const next: { [k: string]: string } = {}
    if (!form.title || form.title.trim().length < 3) next.title = 'Title must be at least 3 characters'
    if (!form.type) next.type = 'Type is required'
    if (!form.description || form.description.trim().length < 10) next.description = 'Description must be at least 10 characters'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    setSubmitError('')
    setOk('')
    if (!validate()) return
    setSaving(true)
    try {
      await onSubmit(form)
      setOk('Complaint submitted successfully')
      localStorage.removeItem('complaintDraft')
      // Fully clear the form after successful submission
      setForm({ title: '', type: '', description: '', contact: '', category: '', photoUrl: '', location: { address: '' } } as any)
      setFileName('')
      setErrors({})
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit complaint. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="panel form" onSubmit={e => { e.preventDefault(); submit() }}>
      {submitError && <div className="form-error">{submitError}</div>}
      <div className="grid two">
        <label>
          Title
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          {errors.title && <small className="muted" style={{ color: '#fecaca' }}>{errors.title}</small>}
        </label>
        <label>
          Type
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="">Select…</option>
            <option>Robbery</option>
            <option>Fraud</option>
            <option>Harassment</option>
            <option>Accident</option>
          </select>
          {errors.type && <small className="muted" style={{ color: '#fecaca' }}>{errors.type}</small>}
        </label>
      </div>
      <label>
        Description
        <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} />
        {errors.description && <small className="muted" style={{ color: '#fecaca' }}>{errors.description}</small>}
      </label>
      <div className="grid two">
        <label>Date<input type="date" value={(form as any).date || ''} onChange={e => setForm({ ...form, ...(form as any), date: e.target.value } as any)} /></label>
        <label>Time<input type="time" value={(form as any).time || ''} onChange={e => setForm({ ...form, ...(form as any), time: e.target.value } as any)} /></label>
      </div>
      <div className="grid two">
        <label>Category<input value={form.category || ''} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
        <label>Contact<input value={form.contact || ''} onChange={e => setForm({ ...form, contact: e.target.value })} /></label>
      </div>
      <label>
        Location Address
        <input value={form.location?.address || ''} onChange={e => setForm({ ...form, location: { ...(form.location || {}), address: e.target.value } })} />
      </label>
      <div className="grid two">
        <label>
          Latitude
          <input value={typeof form.location?.lat === 'number' ? Number(form.location?.lat).toFixed(6) : 'null'} readOnly />
        </label>
        <label>
          Longitude
          <input value={typeof form.location?.lng === 'number' ? Number(form.location?.lng).toFixed(6) : 'null'} readOnly />
        </label>
      </div>
      {/* Location status and preview */}
      <div className="grid two" style={{ alignItems: 'start', marginTop: 8 }}>
        <div>
          <div className="muted" style={{ marginBottom: 6 }}>
            Status: {locStatus}
            {currAccuracy != null && <span> · Accuracy ± {Math.round(currAccuracy)}m</span>}
            {lastUpdate != null && <span> · Updated {new Date(lastUpdate).toLocaleTimeString()}</span>}
          </div>
          {locStatus === 'inaccurate' && (
            <small className="muted">Reading may be affected by creek/indoor conditions. We apply smoothing and landmark verification</small>
          )}
        </div>
        {visualLoc && (
          <div>
            <iframe
              title="your-location"
              src={`https://maps.google.com/maps?q=${visualLoc.lat},${visualLoc.lng}&z=16&output=embed`}
              style={{ width: '100%', height: 180, border: 0, borderRadius: 10 }}
            />
          </div>
        )}
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn sm" onClick={handleUseLocation} disabled={locating}>
          {locating ? 'Locating…' : 'Use my location'}
        </button>
      </div>
      <div className="file-row">
        <label className="file">
          <span className="file-label">Upload Photo</span>
          <input type="file" accept="image/*" onChange={handleFile} />
        </label>
        {fileName && <span className="file-name" title={fileName}>{fileName}</span>}
        {/* Camera capture control beside upload */}
        <div className="camera-control" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!cameraActive ? (
            <button type="button" className="btn sm ghost" onClick={openCamera} title="Open camera"><FiCamera /> Click Photo</button>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: 240, height: 160, borderRadius: 8, background: '#000', border: '1px solid #24324a', objectFit: 'cover' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn sm" onClick={takePhoto}><FiCamera /> Capture</button>
                <button type="button" className="btn sm ghost" onClick={stopCamera}><FiVideo /> Close</button>
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
        {form.photoUrl && (
          <img src={form.photoUrl} alt="image preview" className="preview-thumb" />
        )}
        {!cameraActive && submitError && (
          <span className="form-error" role="alert" style={{ marginLeft: 8 }}>{submitError}</span>
        )}
      </div>
      <div className="actions">
        <button className="btn primary" type="submit" disabled={saving}>Submit</button>
        {ok && <span className="muted" style={{ marginLeft: 12 }}>{ok}</span>}
      </div>
    </form>
  )
}

function MapView({ items }: { items: Complaint[] }) {
  // Prefer coordinates for accurate visualization, but keep address fallback to maintain existing functionality
  const withLoc = items.filter(i => (
    typeof i.location?.lat === 'number' && typeof i.location?.lng === 'number'
  ) || i.location?.address)
  const [selectedId, setSelectedId] = useState<string>(withLoc[0]?._id || '')
  if (withLoc.length === 0) return <div className="panel"><div className="muted">No complaints with coordinates or address. Use "Use my location" to capture precise coordinates.</div></div>
  const sel = withLoc.find(c => c._id === selectedId) || withLoc[0]
  const hasCoords = typeof sel.location?.lat === 'number' && typeof sel.location?.lng === 'number'
  const url = hasCoords
    ? `https://maps.google.com/maps?q=${sel.location!.lat},${sel.location!.lng}&z=12&output=embed`
    : `https://maps.google.com/maps?q=${encodeURIComponent(sel.location!.address || '')}&z=12&output=embed`
  return (
    <div className="panel">
      <div className="muted">Pins shown for first location; switch to Google Maps API later with your key for interactive maps.</div>
      <iframe title="map" src={url} style={{ width: '100%', minHeight: 360, border: 0, borderRadius: 12 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 16 }}>
        {withLoc.map(c => {
          const cardHasCoords = typeof c.location?.lat === 'number' && typeof c.location?.lng === 'number'
          const cardUrl = cardHasCoords
            ? `https://maps.google.com/maps?q=${c.location!.lat},${c.location!.lng}&z=13&output=embed`
            : `https://maps.google.com/maps?q=${encodeURIComponent(c.location!.address || '')}&z=13&output=embed`
          const openUrl = cardHasCoords
            ? `https://maps.google.com/?q=${c.location!.lat},${c.location!.lng}`
            : `https://maps.google.com/?q=${encodeURIComponent(c.location!.address || '')}`
          return (
            <div key={c._id} className="card" style={{ padding: 16 }}>
              <div className="card-header">
                <h3 className="card-title" title={c.title} style={{ fontSize: '1.05rem' }}>{c.title}</h3>
                <StatusBadge status={(c.status as ComplaintStatus) || 'Pending'} />
              </div>
              <div className="card-subtitle" style={{ marginBottom: 10 }}>
                {cardHasCoords ? `${Number(c.location!.lat).toFixed(6)}, ${Number(c.location!.lng).toFixed(6)}` : (c.location?.address || 'No address')}
              </div>
              <iframe title={`map-${c._id}`} src={cardUrl} loading="lazy" style={{ width: '100%', height: 160, border: 0, borderRadius: 10 }} />
              <div className="actions" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn ghost" onClick={() => { setSelectedId(c._id!); const top = document.querySelector('.panel iframe'); if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>Focus on map</button>
                <a className="btn primary" href={openUrl} target="_blank" rel="noopener noreferrer">Open in Maps</a>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}



function NotificationsPanel({ token }: { token: string }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [q, setQ] = useState<string>('')
  const sound = useNotificationSound({ volume: 0.85, cooldownMs: 2500 })

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await notificationsApi.list(token)
        if (active) setNotifications(res.notifications)
      } catch (err: any) {
        if (active) setError(err.message || 'Failed to load notifications')
      } finally {
        if (active) setLoading(false)
      }
    })()
    const id = setInterval(() => {
      notificationsApi.list(token).then((res) => setNotifications(res.notifications)).catch(() => {})
    }, 10000)
    const socket = connectRealtime('user', token)
    socket.on('user:notification', (payload: { message: string; complaintId?: string; type?: string; createdAt?: string }) => {
      setNotifications((prev) => [
        {
          _id: String(Date.now()),
          message: payload.message,
          type: payload.type || 'info',
          read: false,
          createdAt: payload.createdAt || new Date().toISOString(),
          complaintId: payload.complaintId || undefined,
        },
        ...prev,
      ])
      sound.play()
    })
    return () => { active = false; clearInterval(id); socket.disconnect() }
  }, [token, sound])

  const unreadCount = notifications.filter(n => !n.read).length

  async function markRead(id: string) {
    try {
      const r = await notificationsApi.markRead(token, id)
      setNotifications(prev => prev.map(n => n._id === id ? r.notification : n))
    } catch (err: any) {
      setError(err.message || 'Failed to mark as read')
    }
  }

  async function markAllRead() {
    try {
      const r = await notificationsApi.markAllRead(token)
      setNotifications(r.notifications)
    } catch (err: any) {
      setError(err.message || 'Failed to clear notifications')
    }
  }

  const filtered = notifications.filter(n => {
    const okFilter = filter === 'all' ? true : !n.read
    const okQuery = q.trim() === '' ? true : (n.message.toLowerCase().includes(q.trim().toLowerCase()))
    return okFilter && okQuery
  })

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><FiBell /> Notifications & Updates</h3>
          <span className="badge" title="Unread count">{unreadCount} Unread</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" onClick={() => { setLoading(true); notificationsApi.list(token).then(r => { setNotifications(r.notifications); setLoading(false) }).catch(() => setLoading(false)) }}><FiRefreshCw /> Refresh</button>
          <button className="btn" onClick={markAllRead}><FiCheck /> Mark all read</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <div className="search modern" aria-label="Search notifications" style={{ flex: 1 }}>
          <FiSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search updates" />
          {q && <button className="clear-btn" onClick={() => setQ('')} title="Clear"><FiX /></button>}
        </div>
        <div className="filters" style={{ display: 'flex', gap: 8 }}>
          <span className={`pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</span>
          <span className={`pill ${filter === 'unread' ? 'active' : ''}`} onClick={() => setFilter('unread')}>Unread</span>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading ? (
        <div className="muted">Loading notifications…</div>
      ) : (
        <div className="notif-list">
          {filtered.map(n => (
            <div key={n._id} className={`notif-item ${n.read ? '' : 'unread'}`}>
              <div className="left">
                <div className="title">{n.type ? n.type.toUpperCase() : 'UPDATE'}</div>
                <div>{n.message}</div>
                <div className="meta">{new Date(n.createdAt || '').toLocaleString()}</div>
              </div>
              <div className="right">
                {!n.read && <button className="btn sm" onClick={() => markRead(n._id)}><FiCheck /> Mark read</button>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="muted">No notifications to show.</div>}
        </div>
      )}
    </div>
  )
}

function SupportPanel({ token, profile }: { token: string; profile: ProfileUser | null }) {
  const [tab, setTab] = useState<'faq' | 'ticket' | 'chat' | 'contact' | 'feedback' | 'guides'>('faq')
  return (
    <div className="panel support-panel">
      <div className="support-header">
        <h2>Help & Support</h2>
        <p className="muted">Find answers, raise tickets, chat, or contact support.</p>
      </div>
      <div className="tabs compact">
        <button className={`tab ${tab === 'faq' ? 'active' : ''}`} onClick={() => setTab('faq')}><FiHelpCircle /> <span>FAQs</span></button>
        <button className={`tab ${tab === 'ticket' ? 'active' : ''}`} onClick={() => setTab('ticket')}><FiFileText /> <span>Support Ticket</span></button>
        <button className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}><FiMessageCircle /> <span>Live Chat</span></button>
        <button className={`tab ${tab === 'contact' ? 'active' : ''}`} onClick={() => setTab('contact')}><FiPhone /> <span>Contact</span></button>
        <button className={`tab ${tab === 'feedback' ? 'active' : ''}`} onClick={() => setTab('feedback')}><FiStar /> <span>Feedback</span></button>
        <button className={`tab ${tab === 'guides' ? 'active' : ''}`} onClick={() => setTab('guides')}><FiBookOpen /> <span>Guidelines</span></button>
      </div>
      <div className="tab-body">
        {tab === 'faq' && <FaqSection token={token} />}
        {tab === 'ticket' && <TicketFormSupport token={token} profile={profile} />}
        {tab === 'chat' && <LiveChatWidget token={token} />}
        {tab === 'contact' && <ContactSupport profile={profile} />}
        {tab === 'feedback' && <FeedbackSection profile={profile} />}
        {tab === 'guides' && <GuidesResources />}
      </div>
    </div>
  )
}

function FaqSection({ token }: { token: string }) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [faqs, setFaqs] = useState<Array<{ _id: string; question: string; answer: string; category: string; helpfulCount: number; notHelpfulCount: number }>>([])
  const [openIds, setOpenIds] = useState<string[]>([])
  const [votingId, setVotingId] = useState<string | null>(null)
  const [votedMap, setVotedMap] = useState<Record<string, boolean>>({})
  const [sort, setSort] = useState<'relevance' | 'helpful' | 'category'>('relevance')
  const categories = ['All', 'Account Issues', 'Complaint Process', 'Technical Help']
  const suggestions = ['Account', 'Complaint', 'Technical', 'Ticket', 'Profile']

  useEffect(() => {
    let active = true
    supportApi.faqsList(q, category).then((res) => { if (active) setFaqs(res.faqs) }).catch(() => {})
    supportApi.faqVotes(token).then((res) => {
      if (!active) return
      const vm: Record<string, boolean> = {}
      res.votes.forEach(v => { vm[v.faqId] = true })
      setVotedMap(vm)
    }).catch(() => {})
    return () => { active = false }
  }, [q, category, token])

  function toggle(id: string) { setOpenIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]) }
  function expandAll() { setOpenIds(faqs.map(f => f._id)) }
  function collapseAll() { setOpenIds([]) }

  const items = useMemo(() => {
    let arr = [...faqs]
    if (sort === 'helpful') arr.sort((a, b) => (b.helpfulCount - a.helpfulCount))
    if (sort === 'category') arr.sort((a, b) => a.category.localeCompare(b.category))
    return arr
  }, [faqs, sort])

  function copyLink(id: string) {
    const url = `${window.location.origin}/#faq-${id}`
    navigator.clipboard?.writeText(url).catch(() => {})
  }

  async function vote(id: string, helpful: boolean) {
    try {
      setVotingId(id)
      const res = await supportApi.faqVote(token, id, helpful)
      const updated = res?.faq
      setFaqs(prev => prev.map(f => {
        if (f._id !== id) return f
        if (updated) return { ...f, helpfulCount: updated.helpfulCount, notHelpfulCount: updated.notHelpfulCount }
        return { ...f, helpfulCount: f.helpfulCount + (helpful ? 1 : 0), notHelpfulCount: f.notHelpfulCount + (!helpful ? 1 : 0) }
      }))
      setVotedMap(prev => ({ ...prev, [id]: true }))
    } catch (e) {
      // If already voted, mark as such and do not change counts
      const msg = (e instanceof Error && typeof e.message === 'string') ? e.message.toLowerCase() : ''
      if (msg.includes('already voted')) {
        setVotedMap(prev => ({ ...prev, [id]: true }))
      } else {
        // graceful fallback: optimistic increment and lock out further votes
        setFaqs(prev => prev.map(f => f._id === id ? { ...f, helpfulCount: f.helpfulCount + (helpful ? 1 : 0), notHelpfulCount: f.notHelpfulCount + (!helpful ? 1 : 0) } : f))
        setVotedMap(prev => ({ ...prev, [id]: true }))
      }
    } finally {
      setTimeout(() => setVotingId(null), 400)
    }
  }

  return (
    <div>
      <div className="faq-search">
        <div className="search">
          <FiSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions…" />
        </div>
        <div className="faq-toolbar">
          <div className="results-count">{items.length} results</div>
          <div className="sort">
            <FiFilter />
            <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="sort-select">
              <option value="relevance">Relevance</option>
              <option value="helpful">Most Helpful</option>
              <option value="category">Category</option>
            </select>
          </div>
          <div className="expand">
            <button className="btn sm" onClick={expandAll}><FiChevronDown /> Expand all</button>
            <button className="btn sm ghost" onClick={collapseAll}><FiChevronUp /> Collapse all</button>
          </div>
        </div>
      </div>
      <div className="faq-filters">
        {categories.map(c => (
          <button key={c} className={`pill ${category === '' && c === 'All' ? 'active' : category === c ? 'active' : ''}`} onClick={() => setCategory(c === 'All' ? '' : c)}>{c}</button>
        ))}
        <button className="pill ghost" onClick={() => { setQ(''); setCategory(''); }}>Clear</button>
        <div className="suggestions">
          {suggestions.map(s => (
            <button key={s} className="chip" onClick={() => setQ(s)}>{s}</button>
          ))}
        </div>
      </div>
      <div className="accordion">
        {items.map(f => (
          <div className={`accordion-item ${openIds.includes(f._id) ? 'open' : ''}`} key={f._id} id={`faq-${f._id}`}>
            <button className="accordion-header" onClick={() => toggle(f._id)}>
              <span className="question">{f.question}</span>
              <div className="accordion-meta">
                <span className="badge">{f.category}</span>
                <span className="helpful">{f.helpfulCount} found helpful</span>
                <FiChevronDown />
              </div>
            </button>
            <AnimatePresence initial={false}>
              {openIds.includes(f._id) && (
                <motion.div className="accordion-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <p>{f.answer}</p>
                  <div className="faq-actions">
                    <div className="vote-group" aria-label="Was this helpful?">
                      <button className="vote" disabled={votingId === f._id || !!votedMap[f._id]} onClick={() => vote(f._id, true)}><FiThumbsUp /> Helpful <span className="count">{f.helpfulCount}</span></button>
                      <button className="vote ghost" disabled={votingId === f._id || !!votedMap[f._id]} onClick={() => vote(f._id, false)}><FiThumbsDown /> Not helpful <span className="count">{f.notHelpfulCount}</span></button>
                    </div>
                    {!!votedMap[f._id] && <div className="muted" style={{ fontSize: 12 }}>You have already voted for this question.</div>}
                    <button className="btn sm ghost" onClick={() => copyLink(f._id)}><FiLink /> Copy link</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
        {items.length === 0 && <div className="muted">No FAQs found. Try different keywords.</div>}
      </div>
    </div>
  )
}

function TicketFormSupport({ token, profile }: { token: string; profile: ProfileUser | null }) {
  const [email, setEmail] = useState<string>(profile?.email || '')
  const [phone, setPhone] = useState<string>('')
  const [complaintId, setComplaintId] = useState<string>('')
  const [category, setCategory] = useState<string>('App Bug')
  const [description, setDescription] = useState<string>('')
  const [screenshotData, setScreenshotData] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<{ number: string } | null>(null)

  function onFile(e: any) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setScreenshotData(String(reader.result))
    reader.readAsDataURL(file)
  }

  async function submit(e: any) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await supportApi.createTicket(token, { email, phone, complaintId, category, description, screenshotData })
      setSuccess({ number: r.ticket.ticketNumber })
    } catch (err: any) {
      alert(err.message || 'Failed to submit ticket')
    } finally { setSaving(false) }
  }

  return (
    <div className="ticket-form">
      <form onSubmit={submit} className="form-card">
        <div className="grid two">
          <label>Full Name
            <input value={profile?.username || ''} readOnly />
          </label>
          <label>Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
        </div>
        <div className="grid two">
          <label>Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </label>
          <label>Complaint ID
            <input value={complaintId} onChange={(e) => setComplaintId(e.target.value)} placeholder="Optional if related" />
          </label>
        </div>
        <div className="grid two">
          <label>Issue Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option>App Bug</option>
              <option>Login Issue</option>
              <option>Complaint Update</option>
              <option>Other</option>
            </select>
          </label>
          <label>Upload Screenshot
            <div className="file-input">
              <FiPaperclip />
              <input type="file" accept="image/*" onChange={onFile} />
            </div>
          </label>
        </div>
        <label>Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={5} placeholder="Describe your issue in detail" />
        </label>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={saving}>Submit Ticket</button>
        </div>
      </form>
      {success && (
        <div className="modal">
          <div className="modal-body">
            <h3>Ticket Submitted</h3>
            <p>Your ticket number is <b>{success.number}</b>.</p>
            <p>We sent a confirmation and will get back soon.</p>
            <div className="actions">
              <a className="btn" href="#" onClick={(e) => { e.preventDefault(); setSuccess(null) }}>Close</a>
              <a className="btn ghost" href="#" onClick={(e) => { e.preventDefault(); setSuccess(null) }}>Track Ticket</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LiveChatWidget({ token }: { token: string }) {
  const [open, setOpen] = useState(true)
  const [messages, setMessages] = useState<Array<{ _id?: string; role: 'user' | 'assistant' | 'agent'; content: string; createdAt?: string }>>([])
  const [text, setText] = useState('')
  useEffect(() => { supportApi.chatList(token).then((r) => setMessages(r.messages)).catch(() => {}) }, [token])

  async function send() {
    const m = text.trim(); if (!m) return
    setText('')
    try {
      const r = await supportApi.chatSend(token, m, true)
      setMessages(prev => [...prev, ...r.messages])
    } catch {}
  }

  return (
    <div>
      <div className="chat-widget">
        <div className="chat-header">
          <span>Live Support</span>
          <button className="btn sm ghost" onClick={() => setOpen(v => !v)}>{open ? <FiX /> : 'Open'}</button>
        </div>
        {open && (
          <div className="chat-body">
            <div className="chat-thread">
              {messages.map((m, i) => (
                <div key={m._id || i} className={`bubble ${m.role}`}>{m.content}</div>
              ))}
            </div>
            <div className="chat-input">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your message…" />
              <button className="btn" onClick={send}><FiSend /> Send</button>
            </div>
          </div>
        )}
      </div>
      <button className="chat-floating-button" title="Support Chat" onClick={() => setOpen(true)}><FiMessageCircle /></button>
    </div>
  )
}

function ContactSupport({ profile }: { profile: ProfileUser | null }) {
  const [city, setCity] = useState<string>('')
  const [info, setInfo] = useState<{ helplines: Array<{ label: string; number: string }>; email: string; hours: string; links: Record<string, string>; station: { address: string; mapUrl: string } } | null>(null)
  useEffect(() => {
    const guessedCity = (profile?.address || '').split(',').map(s => s.trim())[0] || ''
    setCity(guessedCity)
  }, [profile])
  useEffect(() => { supportApi.supportContact(city).then(setInfo).catch(() => {}) }, [city])
  return (
    <div className="contact-grid">
      <div className="card">
        <div className="label">Helplines</div>
        <div className="list small">
          {info?.helplines.map(h => (
            <div className="row" key={h.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{h.label}</span>
              <a className="btn accent" href={`tel:${h.number}`}>Call {h.number}</a>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="label">Support Email</div>
        <div className="email-row">
          <p style={{ margin: 0 }}><a href={`mailto:${info?.email}`}>{info?.email}</a></p>
          <button className="btn sm ghost" onClick={() => navigator.clipboard.writeText(info?.email || '')}>Copy</button>
        </div>
        <div className="muted">Hours: {info?.hours}</div>
        {info?.links && (
          <div className="chips" style={{ marginTop: 8 }}>
            {Object.entries(info.links).map(([k, v]) => (
              <a key={k} className="chip" href={v} target="_blank" rel="noreferrer">{k}</a>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <div className="label">Nearest Police Station</div>
        <p>{info?.station.address}</p>
        {info?.station.mapUrl && <iframe title="map" src={info.station.mapUrl} style={{ width: '100%', minHeight: 220, border: 0, borderRadius: 10 }} />}
        <div className="city-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>City
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Enter city" />
          </label>
        </div>
      </div>
    </div>
  )
}

function FeedbackSection({ profile }: { profile: ProfileUser | null }) {
  const [rating, setRating] = useState<number>(0)
  const [text, setText] = useState<string>('')
  const [anonymous, setAnonymous] = useState<boolean>(false)
  const [stats, setStats] = useState<{ average: number; count: number }>({ average: 0, count: 0 })
  const [list, setList] = useState<Array<{ id: string; username: string; text: string; rating: number; createdAt: string }>>([])
  const [showOverall, setShowOverall] = useState<boolean>(false)
  useEffect(() => { supportApi.feedbackStats().then(setStats).catch(() => {}) }, [])
  useEffect(() => { supportApi.feedbackList().then((r) => setList(r.feedbacks)).catch(() => {}) }, [])
  async function submit() {
    if (!rating) { alert('Please select a rating'); return }
    await supportApi.feedbackSubmit({ rating, text, anonymous, userId: anonymous ? null : profile?.id || null })
    const s = await supportApi.feedbackStats(); setStats(s)
    const r = await supportApi.feedbackList().catch(() => null); if (r) setList(r.feedbacks)
  }
  const labels = ['Very Poor','Poor','Okay','Good','Excellent']
  const label = rating ? labels[rating-1] : 'Select a rating'
  const labelColor = rating <= 2 ? 'var(--sp-danger)' : rating === 3 ? '#f59e0b' : 'var(--sp-success)'
  return (
    <div className="feedback-card">
      <div className="feedback-header">
        <h3>Share Feedback</h3>
        <div className="muted">Help us improve your experience</div>
      </div>
      <div className="rating-row">
        <div className="rating-stars">
          {[1,2,3,4,5].map(n => (
            <button key={n} className={`star ${rating >= n ? 'filled' : ''}`} onClick={() => setRating(n)} aria-label={`${n} star`}>★</button>
          ))}
        </div>
        <div className="rating-label" style={{ color: labelColor }}>{label}</div>
      </div>
      <div className="desc-field">
        <div className="desc-header">
          <span className="label">Feedback (optional)</span>
          <span className="char-count">{text.length} / 500</span>
        </div>
        <textarea
          className="feedback-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={500}
          placeholder="Share details respectfully. Be specific and constructive."
        />
        <div className="hint muted">Avoid sensitive personal data. Focus on the experience.</div>
      </div>
      <div className="toggle-row">
        <label className="switch">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          <span className="knob"></span>
          <span className="label">Submit anonymously</span>
        </label>
        <label className="switch">
          <input type="checkbox" checked={showOverall} onChange={(e) => setShowOverall(e.target.checked)} />
          <span className="knob"></span>
          <span className="label">Show overall average</span>
        </label>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={submit} disabled={!rating}>Send Feedback</button>
        <button className="btn ghost" onClick={() => { setRating(0); setText(''); setAnonymous(false) }}>Reset</button>
      </div>
      {showOverall && (
        <div className="feedback-stats" aria-live="polite">
          <div className="meter"><div className="bar" style={{ width: `${Math.round((stats.average/5)*100)}%` }}></div></div>
          <div className="avg-stars" aria-label={`Average ${stats.average.toFixed(1)} out of 5`}>
            {[1,2,3,4,5].map(n => (
              <span key={n} className={`a-star ${stats.average >= n ? 'filled' : ''}`}>★</span>
            ))}
          </div>
          <div className="muted">Avg {stats.average.toFixed(1)} · {stats.count} submissions</div>
        </div>
      )}
      <div className="feedback-list">
        <div className="list-header">
          <h4>Recent Feedback</h4>
          <div className="muted">{list.length} entries</div>
        </div>
        <ul className="list" aria-live="polite">
          {list.map((item) => (
            <li key={item.id} className="feedback-item">
              <div className="item-head">
                <div className="avatar" aria-hidden>{(item.username || 'U')[0].toUpperCase()}</div>
                <div className="user">
                  <div className="name">{item.username}</div>
                  <div className="date muted">{new Date(item.createdAt).toLocaleDateString()}</div>
                </div>
                <div className="rating-badge" title={`Rated ${item.rating} out of 5`}>
                  <FiStar /> <span>{item.rating}/5</span>
                </div>
              </div>
              {item.text && <div className="text">{item.text}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function GuidesResources() {
  const guides = [
    { title: 'How to File a Complaint', desc: 'Step-by-step guide to submit a complaint correctly.', href: '#', icon: <FiFileText />, category: 'Reporting', read: '4 min' },
    { title: 'Cybercrime Awareness', desc: 'Learn common cyber threats and prevention.', href: '#', icon: <FiBookOpen />, category: 'Awareness', read: '6 min' },
    { title: 'How Police Handle Reports', desc: 'Understand the review and investigation process.', href: '#', icon: <FiHelpCircle />, category: 'Process', read: '5 min' },
  ]
  const [cat, setCat] = useState<string>('All')
  const categories = ['All', 'Reporting', 'Awareness', 'Process']
  const items = guides.filter(g => cat === 'All' ? true : g.category === cat)
  return (
    <div>
      <div className="guides-header">
        <h3>Guidelines & Resources</h3>
        <p className="muted">Browse best practices, cyber awareness, and process insights.</p>
      </div>
      <div className="guide-filters">
        {categories.map(c => (
          <button key={c} className={`pill ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div className="guides-grid">
        {items.map((g, i) => (
          <a key={i} className="guide-card" href={g.href} target="_blank" rel="noreferrer">
            <div className="icon">{g.icon}</div>
            <div className="content">
              <div className="title">{g.title}</div>
              <div className="muted">{g.desc}</div>
              <div className="guide-meta">
                <span className="badge">{g.category}</span>
                <span className="read">{g.read}</span>
              </div>
              <div className="guide-actions">
                <span className="btn sm">Read Guide</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}