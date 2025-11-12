import { useEffect, useMemo, useRef, useState } from 'react'
import { FiSearch } from 'react-icons/fi'
import type { ComplaintStatus } from '../../types'
import { policeApi } from '../../services/police'
import { useNotificationSound } from '../../components/useNotificationSound'

type Props = { token: string; filter?: 'active' | 'pending' | 'completed'; officer?: { id?: string; username: string; station?: string } }

type ComplaintRow = {
  _id?: string
  title: string
  type: string
  status?: ComplaintStatus
  createdAt?: string
  location?: { lat?: number; lng?: number; address?: string }
  assignedOfficerName?: string
  photoUrl?: string
}

export default function PoliceComplaints({ token, filter, officer }: Props) {
  const [items, setItems] = useState<ComplaintRow[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | ''>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest')
  const notify = useNotificationSound({ volume: 0.85, cooldownMs: 3000 })
  const firstPoll = useRef(true)
  const itemsRef = useRef<ComplaintRow[]>([])
  useEffect(() => { itemsRef.current = items }, [items])

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

  useEffect(() => {
    let active = true
    setLoading(true)
    policeApi.listComplaints(token).then((res) => {
      if (!active) return
      let rows = res.complaints
      if (filter === 'active') rows = rows.filter((c: any) => c.status === 'In Progress' || c.status === 'Under Review')
      if (filter === 'pending') rows = rows.filter((c: any) => c.status === 'Pending')
      if (filter === 'completed') rows = rows.filter((c: any) => c.status === 'Solved')
      setItems(rows)
      setLoading(false)
    }).catch((err) => { setError(err.message || 'Failed to load complaints'); setLoading(false) })
    return () => { active = false }
  }, [token, filter])

  // Poll for new complaints and play a notification when new IDs appear
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await policeApi.listComplaints(token)
        let rows = res.complaints
        if (filter === 'active') rows = rows.filter((c: any) => c.status === 'In Progress' || c.status === 'Under Review')
        if (filter === 'pending') rows = rows.filter((c: any) => c.status === 'Pending')
        if (filter === 'completed') rows = rows.filter((c: any) => c.status === 'Solved')
        const oldIds = new Set(itemsRef.current.map(c => c._id))
        const newIds = new Set(rows.map((c: any) => c._id))
        let hasNew = false
        for (const id of newIds) { if (!oldIds.has(id)) { hasNew = true; break } }
        setItems(rows)
        itemsRef.current = rows
        if (!firstPoll.current && hasNew) notify.play()
        if (firstPoll.current) firstPoll.current = false
      } catch (err) {
        // ignore transient poll errors
      }
    }, 30000)
    return () => clearInterval(id)
  }, [token, filter, notify])

  const statuses: ComplaintStatus[] = ['Pending', 'Under Review', 'In Progress', 'Solved']
  const types = useMemo(() => {
    const defaultTypes = ['Robbery','Fraud','Harassment','Accident','Assault','Theft']
    const uniq = Array.from(new Set(items.map(i => i.type).filter(Boolean))) as string[]
    return Array.from(new Set([...defaultTypes, ...uniq])).sort((a, b) => a.localeCompare(b))
  }, [items])

  const filtered = useMemo(() => {
    const norm = q.trim().toLowerCase()
    const f = items.filter(c =>
      (!statusFilter || c.status === statusFilter) &&
      (!typeFilter || c.type === typeFilter) &&
      (
        norm === '' ||
        c.title.toLowerCase().includes(norm) ||
        (c._id || '').toLowerCase().includes(norm) ||
        (c.status || '').toLowerCase().includes(norm)
      )
    )
    return f.sort((a, b) => {
      const da = new Date(a.createdAt || 0).getTime()
      const db = new Date(b.createdAt || 0).getTime()
      return sortBy === 'newest' ? db - da : da - db
    })
  }, [items, q, statusFilter, typeFilter, sortBy])

  async function assignToMe(id?: string) {
    if (!id || !officer) return
    try {
      const res = await policeApi.assignComplaint(token, id)
      setItems(prev => prev.map(it => it._id === id ? { ...it, assignedOfficerName: res.complaint.assignedOfficerName } : it))
    } catch (err: any) {
      setError(err.message || 'Assign failed')
    }
  }

  async function updateStatus(id?: string, status?: ComplaintStatus) {
    if (!id || !status) return
    try {
      const res = await policeApi.updateComplaintStatus(token, id, status)
      setItems(prev => prev.map(it => it._id === id ? { ...it, status: res.complaint.status } : it))
    } catch (err: any) {
      setError(err.message || 'Update failed')
    }
  }

  return (
    <div className="panel">
      <div className="table-toolbar">
        <div className="search" aria-label="Search complaints">
          <FiSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, ID, status" />
        </div>
        <div className="filters">
          <span className={`pill ${statusFilter === '' ? 'active' : ''}`} onClick={() => setStatusFilter('')}>All Status</span>
          {statuses.map(s => (
            <span key={s} className={`pill ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>{s}</span>
          ))}
        </div>
        <div className="sort">
          <span className="muted">Type</span>
          <select className="sort-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {types.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="sort">
          <span className="muted">Sort</span>
          <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest')}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      {loading ? <div className="muted">Loading complaints…</div> : (
        <div className="table">
          <div className="thead">
            <div>ID</div>
            <div>Title</div>
            <div>Date</div>
            <div>Status</div>
            <div>Assigned</div>
            <div>Actions</div>
          </div>
          {filtered.map((c) => (
            <div className="trow" key={c._id}>
              <div>{c._id?.slice(-6)}</div>
              <div className="title-cell" title={c.title}>
                {c.photoUrl ? (
                  <img className="thumb" src={c.photoUrl} alt="complaint photo" />
                ) : (
                  <span className="thumb placeholder" aria-hidden />
                )}
                <span className="title-text">{c.title}</span>
              </div>
              <div>{new Date(c.createdAt || '').toLocaleDateString()}</div>
              <div>{c.status ? <span className={`badge ${c.status.replace(/\s/g, '-').toLowerCase()}`}>{c.status}</span> : '-'}</div>
              <div>{c.assignedOfficerName || '-'}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm ghost" onClick={() => assignToMe(c._id)} disabled={!officer || c.assignedOfficerName === officer?.username}>Assign to me</button>
                <select value={c.status || 'Pending'} onChange={(e) => updateStatus(c._id, e.target.value as ComplaintStatus)} className="sort-select" style={{ paddingRight: 24 }}>
                  <option>Pending</option>
                  <option>Under Review</option>
                  <option>In Progress</option>
                  <option>Solved</option>
                </select>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="muted" style={{ padding: 10 }}>No complaints match filters.</div>}
        </div>
      )}
    </div>
  )
}