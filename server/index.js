import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Server as SocketIOServer } from 'socket.io'
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { Strategy as GitHubStrategy } from 'passport-github2'
// Apple strategy is optional and more complex; we stub configuration when envs are present
import AppleStrategy from 'passport-apple'
import twilio from 'twilio'
////////////
const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ limit: '10mb', extended: true }))
app.use(passport.initialize())

const { PORT = 5175, MONGO_URL, JWT_SECRET, FRONTEND_URL = 'https://smart-police-complaint-system.vercel.app', TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, NODE_ENV } = process.env
const TWILIO_ENABLED = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER)
const twilioClient = TWILIO_ENABLED ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null
// Simple in-memory OTP store (sessionId -> { phone, email, code, expiresAt })
const OTP_STORE = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [sid, entry] of OTP_STORE.entries()) {
    if (entry.expiresAt <= now) OTP_STORE.delete(sid)
  }
}, 60_000)
if (!MONGO_URL) {
  console.error('Missing MONGO_URL in .env')
  process.exit(1)
}
if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET in .env')
  process.exit(1)
}

mongoose
  .connect(MONGO_URL)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => { console.error('MongoDB connection error:', err); process.exit(1) })

// User schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: { type: String },
  address: { type: String },
  avatarUrl: { type: String },
  googleId: { type: String },
  githubId: { type: String },
  appleId: { type: String },
}, { timestamps: true })

const User = mongoose.model('User', userSchema)

function createToken(user) {
  return jwt.sign({ id: user._id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' })
}

// Police officer schema and helpers
const policeOfficerSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  name: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  station: { type: String, required: true, trim: true },
  rank: { type: String, trim: true },
  phone: { type: String, trim: true },
  city: { type: String, trim: true },
  status: { type: String, enum: ['Active','Offline','On Duty'], default: 'Active' },
  avatarUrl: { type: String },
  badgeUrl: { type: String },
  lastLoginAt: { type: Date },
  lastLoginIp: { type: String },
  lastLoginAgent: { type: String },
  loginHistory: [{
    at: { type: Date, default: Date.now },
    ip: { type: String },
    userAgent: { type: String },
  }],
  tokenVersion: { type: Number, default: 1 },
  twoFactorEnabled: { type: Boolean, default: false },
}, { timestamps: true })
const PoliceOfficer = mongoose.model('PoliceOfficer', policeOfficerSchema)

function createPoliceToken(officer) {
  return jwt.sign({ id: officer._id, username: officer.username, email: officer.email, role: 'police', station: officer.station, ver: officer.tokenVersion }, JWT_SECRET, { expiresIn: '7d' })
}

// Police station schema (Navi Mumbai)
const policeStationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true },
  address: { type: String, trim: true },
  zone: { type: String, trim: true },
  division: { type: String, trim: true },
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
}, { timestamps: true })
policeStationSchema.index({ name: 1 }, { unique: true })
const PoliceStation = mongoose.model('PoliceStation', policeStationSchema)

// Seed Navi Mumbai police stations with approximate coordinates if empty
const NAVI_MUMBAI_STATION_SEED = [
  { name: 'Vashi', lat: 19.0634, lng: 72.9981 },
  { name: 'Turbhe', lat: 19.0556, lng: 73.0169 },
  { name: 'Rabale', lat: 19.1544, lng: 73.0360 },
  { name: 'Koparkhairane', lat: 19.1036, lng: 73.0074 },
  { name: 'Ghansoli', lat: 19.1200, lng: 73.0088 },
  { name: 'Digha', lat: 19.1690, lng: 73.0074 },
  { name: 'Nerul', lat: 19.0330, lng: 73.0194 },
  { name: 'Sanpada', lat: 19.0657, lng: 73.0025 },
  { name: 'CBD Belapur', lat: 19.0029, lng: 73.0186 },
  { name: 'APMC', lat: 19.0609, lng: 72.9989 },
  { name: 'Kharghar', lat: 19.0312, lng: 73.0629 },
  { name: 'Kamothe', lat: 19.0122, lng: 73.0957 },
  { name: 'Kalamboli', lat: 19.0128, lng: 73.0997 },
  { name: 'Taloja', lat: 19.0830, lng: 73.1165 },
  { name: 'Khandeshwar', lat: 19.0094, lng: 73.1037 },
  { name: 'Panvel City', lat: 18.9896, lng: 73.1198 },
  { name: 'Panvel Taluka', lat: 18.9500, lng: 73.1500 },
]

async function seedPoliceStationsIfEmpty() {
  try {
    const count = await PoliceStation.countDocuments({})
    if (count === 0) {
      await PoliceStation.insertMany(NAVI_MUMBAI_STATION_SEED.map(s => ({ name: s.name, lat: s.lat, lng: s.lng })))
      console.log('Seeded Navi Mumbai police stations:', NAVI_MUMBAI_STATION_SEED.length)
    }
  } catch (err) {
    console.error('Failed to seed police stations:', err)
  }
}

async function ensureOAuthUser(provider, profile) {
  const providerIdField = `${provider}Id`
  const providerId = profile.id
  const email = (profile.emails && profile.emails[0] && profile.emails[0].value) ? profile.emails[0].value.toLowerCase() : `${provider}-${providerId}@spcs-oauth.local`
  const username = profile.displayName || profile.username || `${provider}_${providerId}`

  let user = await User.findOne({ [providerIdField]: providerId })
  if (!user) {
    user = await User.findOne({ email })
  }
  if (user) {
    if (!user[providerIdField]) {
      user[providerIdField] = providerId
      await user.save()
    }
    return user
  }
  const hashed = await bcrypt.hash('oauth', 10)
  const newUser = await User.create({ username, email, password: hashed, [providerIdField]: providerId })
  return newUser
}

// Provider availability endpoint
app.get('/api/oauth/providers', (req, res) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = process.env
  res.json({
    google: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    github: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET),
    apple: !!(APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY),
  })
})

// Passport strategies (conditionally configured)
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: '/api/auth/google/callback',
  }, async (_accessToken, _refreshToken, profile, done) => {
    try { const user = await ensureOAuthUser('google', profile); done(null, user) } catch (err) { done(err) }
  }))
}

const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env
if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
    clientID: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    callbackURL: '/api/auth/github/callback',
    scope: ['user:email'],
  }, async (_accessToken, _refreshToken, profile, done) => {
    try { const user = await ensureOAuthUser('github', profile); done(null, user) } catch (err) { done(err) }
  }))
}

const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = process.env
if (APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY) {
  passport.use(new AppleStrategy({
    clientID: APPLE_CLIENT_ID,
    teamID: APPLE_TEAM_ID,
    keyID: APPLE_KEY_ID,
    privateKeyString: APPLE_PRIVATE_KEY,
    callbackURL: '/api/auth/apple/callback',
  }, async (_accessToken, _refreshToken, idToken, profile, done) => {
    try {
      const p = profile || { id: idToken.sub, emails: [{ value: idToken.email }] }
      const user = await ensureOAuthUser('apple', p)
      done(null, user)
    } catch (err) { done(err) }
  }))
}

function redirectWithToken(res, user) {
  const token = createToken(user)
  const compactUser = encodeURIComponent(JSON.stringify({ id: user._id, username: user.username, email: user.email }))
  const url = `${FRONTEND_URL}/login?token=${token}&user=${compactUser}`
  return res.redirect(url)
}

// OAuth routes
app.get('/api/auth/google', (req, res, next) => {
  if (!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)) return res.status(501).json({ error: 'Google OAuth not configured' })
  next()
}, passport.authenticate('google', { scope: ['profile', 'email'], session: false }))
app.get('/api/auth/google/callback', passport.authenticate('google', { session: false, failureRedirect: '/api/oauth/fail' }), (req, res) => {
  redirectWithToken(res, req.user)
})

app.get('/api/auth/github', (req, res, next) => {
  if (!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET)) return res.status(501).json({ error: 'GitHub OAuth not configured' })
  next()
}, passport.authenticate('github', { scope: ['user:email'], session: false }))
app.get('/api/auth/github/callback', passport.authenticate('github', { session: false, failureRedirect: '/api/oauth/fail' }), (req, res) => {
  redirectWithToken(res, req.user)
})

app.get('/api/auth/apple', (req, res, next) => {
  if (!(APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY)) return res.status(501).json({ error: 'Apple Sign In not configured' })
  next()
}, passport.authenticate('apple', { session: false }))
app.post('/api/auth/apple/callback', passport.authenticate('apple', { session: false, failureRedirect: '/api/oauth/fail' }), (req, res) => {
  redirectWithToken(res, req.user)
})

app.get('/api/oauth/fail', (req, res) => res.status(401).send('OAuth failed'))

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, phone } = req.body
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' })
    }
    const existing = await User.findOne({ email })
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' })
    }
    const hashed = await bcrypt.hash(password, 10)
    // Normalize phone to E.164 if IND +91 provided; do basic validation
    let normalizedPhone = undefined
    if (phone && typeof phone === 'string') {
      const trimmed = phone.trim()
      // If the phone starts with 0, remove leading zeros
      const digits = trimmed.replace(/\D/g, '')
      if (digits.startsWith('91')) normalizedPhone = `+${digits}`
      else if (trimmed.startsWith('+')) normalizedPhone = trimmed
      else if (digits.length >= 10) normalizedPhone = `+91${digits.slice(-10)}`
    }
    const user = await User.create({ username, email, password: hashed, phone: normalizedPhone })
    const token = createToken(user)
    return res.json({ token, user: { id: user._id, username: user.username, email: user.email } })
  } catch (err) {
    console.error('Register error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const token = createToken(user)
    return res.json({ token, user: { id: user._id, username: user.username, email: user.email } })
  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// 2FA: Send OTP via Twilio (mobile only UI will call this after login/register)
app.post('/api/auth/2fa/send-otp', async (req, res) => {
  try {
    const { phone: phoneArg, email, purpose = 'login' } = req.body || {}
    if (!email) {
      return res.status(400).json({ error: 'Email required' })
    }
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    const phone = phoneArg && typeof phoneArg === 'string' ? phoneArg : user.phone
    if (!phone || !String(phone).startsWith('+')) {
      return res.status(400).json({ error: 'No registered phone found; please add a valid +E.164 phone' })
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36)
    const expiresAt = Date.now() + 5 * 60 * 1000
    OTP_STORE.set(sessionId, { phone, email, code, purpose, expiresAt })
    if (!TWILIO_ENABLED) {
      if (NODE_ENV === 'development') {
        console.warn(`[DEV] Twilio not configured. OTP for ${phone}: ${code}`)
        return res.json({ sessionId, expiresIn: 300, simulated: true })
      }
      return res.status(503).json({ error: 'OTP service unavailable' })
    }
    try {
      await twilioClient.messages.create({ to: phone, from: TWILIO_PHONE_NUMBER, body: `Your SPCS verification code is ${code}. It expires in 5 minutes.` })
    } catch (twErr) {
      console.error('Twilio send error:', twErr)
      return res.status(500).json({ error: 'Failed to send OTP' })
    }
    return res.json({ sessionId, expiresIn: 300 })
  } catch (err) {
    console.error('Send OTP error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// 2FA: Verify OTP code
app.post('/api/auth/2fa/verify-otp', async (req, res) => {
  try {
    const { sessionId, code } = req.body || {}
    if (!sessionId || !code) {
      return res.status(400).json({ error: 'sessionId and code required' })
    }
    const entry = OTP_STORE.get(sessionId)
    if (!entry) {
      return res.status(400).json({ error: 'Invalid or expired session' })
    }
    if (entry.expiresAt <= Date.now()) {
      OTP_STORE.delete(sessionId)
      return res.status(400).json({ error: 'OTP expired' })
    }
    if (String(entry.code) !== String(code)) {
      return res.status(400).json({ error: 'Invalid OTP code' })
    }
    OTP_STORE.delete(sessionId)
    return res.json({ success: true })
  } catch (err) {
    console.error('Verify OTP error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Police auth routes
app.post('/api/police/register', async (req, res) => {
  try {
    const { username, email, password, station } = req.body
    if (!username || !email || !password || !station) {
      return res.status(400).json({ error: 'All fields are required' })
    }
    const existing = await PoliceOfficer.findOne({ email })
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' })
    }
    const hashed = await bcrypt.hash(password, 10)
    const officer = await PoliceOfficer.create({ username, email, password: hashed, station })
    const token = createPoliceToken(officer)
    return res.json({ token, officer: { id: officer._id, username: officer.username, email: officer.email, station: officer.station } })
  } catch (err) {
    console.error('Police register error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/police/login', async (req, res) => {
  try {
    const { email, password, station } = req.body
    if (!email || !password || !station) {
      return res.status(400).json({ error: 'Email, password, and station required' })
    }
    const officer = await PoliceOfficer.findOne({ email })
    if (!officer) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (officer.station !== station) {
      return res.status(401).json({ error: 'Station mismatch' })
    }
    const match = await bcrypt.compare(password, officer.password)
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    // Track last login and device info
    const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip || req.socket?.remoteAddress || '').trim()
    const ua = req.headers['user-agent'] || ''
    officer.lastLoginAt = new Date()
    officer.lastLoginIp = ip
    officer.lastLoginAgent = ua
    officer.loginHistory = officer.loginHistory || []
    officer.loginHistory.push({ at: new Date(), ip, userAgent: ua })
    await officer.save()
    const token = createPoliceToken(officer)
    return res.json({ token, officer: { id: officer._id, username: officer.username, name: officer.name, email: officer.email, station: officer.station, rank: officer.rank, status: officer.status, avatarUrl: officer.avatarUrl, lastLoginAt: officer.lastLoginAt, lastLoginIp: officer.lastLoginIp, lastLoginAgent: officer.lastLoginAgent } })
  } catch (err) {
    console.error('Police login error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

app.get('/api/profile', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).select('username email phone address avatarUrl')
  if (!user) return res.status(404).json({ error: 'Not found' })
  return res.json({ user: { id: user._id, username: user.username, email: user.email, phone: user.phone, address: user.address, avatarUrl: user.avatarUrl } })
})

app.get('/api/health', (req, res) => res.json({ ok: true }))

// Geo helpers
function isValidCoord(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
function toRad(d) { return (d * Math.PI) / 180 }
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371 // Earth radius (km)
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// ========================
// Complaints & Notifications
// ========================

// Complaint schema
const complaintSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  category: { type: String, trim: true },
  contact: { type: String, trim: true },
  photoUrl: { type: String },
  location: {
    lat: { type: Number },
    lng: { type: Number },
    address: { type: String, trim: true },
  },
  status: { type: String, enum: ['Pending', 'In Progress', 'Solved', 'Under Review'], default: 'Pending' },
  // Police-specific fields
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceOfficer' },
  assignedOfficer: { type: String, trim: true },
  assignedAt: { type: Date },
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceOfficer' },
  lastUpdatedAt: { type: Date },
  station: { type: String, trim: true }, // Police station jurisdiction
  stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceStation' },
  nearestDistanceKm: { type: Number },
}, { timestamps: true })

const Complaint = mongoose.model('Complaint', complaintSchema)

// Notification schema
const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  complaintId: { type: mongoose.Schema.Types.ObjectId, ref: 'Complaint' },
  type: { type: String, trim: true },
  message: { type: String, required: true, trim: true },
  read: { type: Boolean, default: false },
}, { timestamps: true })

const Notification = mongoose.model('Notification', notificationSchema)

// Police notifications (station-scoped)
const policeNotificationSchema = new mongoose.Schema({
  station: { type: String, required: true, trim: true },
  complaintId: { type: mongoose.Schema.Types.ObjectId, ref: 'Complaint' },
  message: { type: String, required: true, trim: true },
  read: { type: Boolean, default: false },
}, { timestamps: true })
const PoliceNotification = mongoose.model('PoliceNotification', policeNotificationSchema)

// Public aggregated system stats
app.get('/api/stats', async (req, res) => {
  try {
    const [totalComplaints, casesSolved, complaintsPending, activeUsers] = await Promise.all([
      Complaint.countDocuments({}),
      Complaint.countDocuments({ status: 'Solved' }),
      Complaint.countDocuments({ status: 'Pending' }),
      User.countDocuments({}),
    ])
    return res.json({
      stats: {
        totalComplaints,
        casesSolved,
        activeOfficers: activeUsers,
        complaintsPending,
      },
    })
  } catch (err) {
    console.error('Public stats error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Create complaint
app.post('/api/complaints', authMiddleware, async (req, res) => {
  try {
    const { title, type, description, category, contact, photoUrl, location, station } = req.body
    if (!title || !type || !description) return res.status(400).json({ error: 'Title, type and description are required' })

    // Determine nearest station by geolocation when not provided
    const userLocation = location
    let stationResolved = station || 'Unassigned'
    let stationId = undefined
    let nearestDistanceKm = undefined
    if (!station && userLocation && isValidCoord(userLocation?.lat, userLocation?.lng)) {
      const stations = await PoliceStation.find({}).select('name lat lng')
      if (stations && stations.length > 0) {
        let min = Number.POSITIVE_INFINITY
        let chosen = null
        for (const s of stations) {
          if (!isValidCoord(s.lat, s.lng)) continue
          const d = haversineKm(userLocation.lat, userLocation.lng, s.lat, s.lng)
          if (d < min - 1e-9 || (Math.abs(d - min) < 1e-9 && chosen && s.name < chosen.name)) {
            min = d
            chosen = s
          }
        }
        if (chosen) { stationResolved = chosen.name; stationId = chosen._id; nearestDistanceKm = min }
      }
    }

    const complaint = await Complaint.create({
      userId: req.user.id,
      title,
      type,
      description,
      category,
      contact,
      photoUrl,
      location,
      station: stationResolved,
      stationId,
      nearestDistanceKm,
    })

    // User notification
    {
      const routedMsg = (stationResolved && stationResolved !== 'Unassigned')
        ? `Your complaint "${complaint.title}" was sent to ${stationResolved} Police Station${typeof nearestDistanceKm === 'number' ? ` (${nearestDistanceKm.toFixed(1)} km away)` : ''}.`
        : `Complaint "${complaint.title}" submitted and pending review.`
      await Notification.create({
        userId: req.user.id,
        complaintId: complaint._id,
        type: 'complaint_created',
        message: routedMsg,
      })
      // Emit real-time notification to the user
      const io = req.app.get('io')
      io?.to(`user:${req.user.id}`).emit('user:notification', {
        type: 'complaint_created',
        complaintId: String(complaint._id),
        message: routedMsg,
        createdAt: new Date().toISOString(),
      })
    }

    // Police station notification
    if (stationResolved && stationResolved !== 'Unassigned') {
      await PoliceNotification.create({
        station: stationResolved,
        complaintId: complaint._id,
        message: `New complaint raised: ${complaint.title}`,
      })
      // Emit real-time notification to the police station room
      const io = req.app.get('io')
      io?.to(`station:${stationResolved}`).emit('police:new_complaint', {
        complaintId: String(complaint._id),
        title: complaint.title,
        station: stationResolved,
        createdAt: new Date().toISOString(),
        message: `New complaint raised: ${complaint.title}`,
      })
    }

    return res.status(201).json({ complaint })
  } catch (err) {
    console.error('Create complaint error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// List complaints for current user
app.get('/api/complaints', authMiddleware, async (req, res) => {
  try {
    const complaints = await Complaint.find({ userId: req.user.id }).sort({ createdAt: -1 })
    return res.json({ complaints })
  } catch (err) {
    console.error('List complaints error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Stats for current user
app.get('/api/complaints/stats', authMiddleware, async (req, res) => {
  try {
    // Guard against invalid IDs in tokens
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.json({ stats: { Pending: 0, 'In Progress': 0, Solved: 0, 'Under Review': 0 } })
    }

    // Count by status using Mongoose casting (robust against type mismatches)
    const statuses = ['Pending', 'In Progress', 'Solved', 'Under Review']
    const results = await Promise.all(
      statuses.map((s) => Complaint.countDocuments({ userId: req.user.id, status: s }))
    )
    const stats = {
      Pending: results[0] || 0,
      'In Progress': results[1] || 0,
      Solved: results[2] || 0,
      'Under Review': results[3] || 0,
    }
    return res.json({ stats })
  } catch (err) {
    console.error('Stats error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Get complaint details
app.get('/api/complaints/:id', authMiddleware, async (req, res) => {
  try {
    const c = await Complaint.findOne({ _id: req.params.id, userId: req.user.id })
    if (!c) return res.status(404).json({ error: 'Not found' })
    return res.json({ complaint: c })
  } catch (err) {
    console.error('Get complaint error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Update complaint (limited fields by owner)
app.put('/api/complaints/:id', authMiddleware, async (req, res) => {
  try {
    const allowed = ['title', 'type', 'description', 'category', 'contact', 'photoUrl', 'location']
    const updates = {}
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k]
    const updated = await Complaint.findOneAndUpdate({ _id: req.params.id, userId: req.user.id }, updates, { new: true })
    if (!updated) return res.status(404).json({ error: 'Not found' })
    return res.json({ complaint: updated })
  } catch (err) {
    console.error('Update complaint error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Notifications
app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const items = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 })
    return res.json({ notifications: items })
  } catch (err) {
    console.error('Notifications list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user.id }, { read: true }, { new: true })
    if (!n) return res.status(404).json({ error: 'Not found' })
    return res.json({ notification: n })
  } catch (err) {
    console.error('Notifications mark read error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id, read: false }, { read: true })
    const items = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 })
    return res.json({ notifications: items })
  } catch (err) {
    console.error('Notifications read-all error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Update profile
app.put('/api/profile', authMiddleware, async (req, res) => {
  try {
    const allowed = ['username', 'email', 'phone', 'address', 'avatarUrl']
    const updates = {}
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k]
    const u = await User.findByIdAndUpdate(req.user.id, updates, { new: true }).select('username email phone address avatarUrl')
    return res.json({ user: { id: u._id, username: u.username, email: u.email, phone: u.phone, address: u.address, avatarUrl: u.avatarUrl } })
  } catch (err) {
    console.error('Profile update error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Change password
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Missing fields' })
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ error: 'Not found' })
    const ok = await bcrypt.compare(currentPassword, user.password)
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' })
    const hashed = await bcrypt.hash(newPassword, 10)
    user.password = hashed
    await user.save()
    return res.json({ ok: true })
  } catch (err) {
    console.error('Change password error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Delete account
app.delete('/api/profile', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body || {}
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ error: 'Not found' })
    const ok = await bcrypt.compare(password || '', user.password)
    if (!ok) return res.status(400).json({ error: 'Password is incorrect' })
    await User.deleteOne({ _id: req.user.id })
    // Optionally: cascade delete complaints/notifications belonging to user
    await Complaint.deleteMany({ userId: req.user.id })
    await Notification.deleteMany({ userId: req.user.id })
    return res.json({ ok: true })
  } catch (err) {
    console.error('Delete account error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// ========================
// Police-specific routes
// ========================

// Police authentication middleware
function policeAuthMiddleware(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.role !== 'police') {
      return res.status(403).json({ error: 'Police access required' })
    }
    // Verify token version and attach fresh officer info
    PoliceOfficer.findById(payload.id).then((officer) => {
      if (!officer) return res.status(401).json({ error: 'Invalid officer' })
      if (typeof payload.ver !== 'number' || officer.tokenVersion !== payload.ver) {
        return res.status(401).json({ error: 'Session expired. Please login again.' })
      }
      req.officer = { ...payload, station: officer.station }
      next()
    }).catch(() => {
      return res.status(401).json({ error: 'Invalid token' })
    })
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

// Police get all complaints (for their station or all stations)
app.get('/api/police/complaints', policeAuthMiddleware, async (req, res) => {
  try {
    const { station } = req.officer
    const { status, page = 1, limit = 50 } = req.query
    
    let query = {}
    if (station && station !== 'All Stations') {
      query = { station }
    }
    if (status) {
      query.status = status
    }
    
    const complaints = await Complaint.find(query)
      .populate('userId', 'username email phone')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
    
    const total = await Complaint.countDocuments(query)
    
    return res.json({ 
      complaints,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    })
  } catch (err) {
    console.error('Police list complaints error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Police assign complaint to themselves
app.post('/api/police/complaints/:id/assign', policeAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const { id: officerId, username: officerName } = req.officer
    
    const complaint = await Complaint.findById(id)
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' })
    }
    
    // Add assignment info to complaint
    complaint.assignedTo = officerId
    complaint.assignedOfficer = officerName
    complaint.status = 'In Progress'
    complaint.assignedAt = new Date()
    
    await complaint.save()
    
    // Create notification for user
    await Notification.create({
      userId: complaint.userId,
      complaintId: complaint._id,
      type: 'complaint_assigned',
      message: `Your complaint "${complaint.title}" has been assigned to Officer ${officerName} and is now in progress.`,
    })

    // Emit real-time notification to the user
    {
      const io = req.app.get('io')
      io?.to(`user:${complaint.userId}`).emit('user:notification', {
        type: 'complaint_assigned',
        complaintId: String(complaint._id),
        message: `Your complaint "${complaint.title}" has been assigned to Officer ${officerName} and is now in progress.`,
        createdAt: new Date().toISOString(),
      })
    }
    
    return res.json({ complaint })
  } catch (err) {
    console.error('Police assign complaint error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Police update complaint status
app.put('/api/police/complaints/:id/status', policeAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body
    const { id: officerId, username: officerName } = req.officer
    
    if (!status || !['Pending', 'In Progress', 'Solved', 'Under Review'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }
    
    const complaint = await Complaint.findById(id)
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' })
    }
    
    // Update complaint status
    complaint.status = status
    complaint.lastUpdatedBy = officerId
    complaint.lastUpdatedAt = new Date()
    
    await complaint.save()
    
    // Create notification for user
    await Notification.create({
      userId: complaint.userId,
      complaintId: complaint._id,
      type: 'status_updated',
      message: `Status of your complaint "${complaint.title}" has been updated to ${status} by Officer ${officerName}.`,
    })

    // Emit real-time status update to the user
    {
      const io = req.app.get('io')
      io?.to(`user:${complaint.userId}`).emit('user:notification', {
        type: 'status_updated',
        complaintId: String(complaint._id),
        message: `Status of your complaint "${complaint.title}" has been updated to ${status} by Officer ${officerName}.`,
        status,
        createdAt: new Date().toISOString(),
      })
    }
    
    return res.json({ complaint })
  } catch (err) {
    console.error('Police update status error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Police get complaint statistics
app.get('/api/police/stats', policeAuthMiddleware, async (req, res) => {
  try {
    const { station } = req.officer;
    let query = {};
    if (station) {
        query = { station: station };
    }

    const [total, pending, inProgress, solved, underReview] = await Promise.all([
        Complaint.countDocuments(query),
        Complaint.countDocuments({ ...query, status: 'Pending' }),
        Complaint.countDocuments({ ...query, status: 'In Progress' }),
        Complaint.countDocuments({ ...query, status: 'Solved' }),
        Complaint.countDocuments({ ...query, status: 'Under Review' })
    ]);

    res.json({
        stats: {
            totalComplaints: total,
            pending,
            inProgress,
            solved,
            underReview
        }
    });
  } catch (err) {
      console.error('Police stats error:', err);
      res.status(500).json({ error: 'Failed to get police stats' });
  }
});

// Police Chat
app.get('/api/police/chat/messages', policeAuthMiddleware, async (req, res) => {
  try {
    const messages = await ChatMessage.find({
      $or: [{ sender: req.officer.id }, { receiver: req.officer.id }],
      isPolice: true,
    }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    console.error('Police chat list error:', error);
    res.status(500).json({ error: 'Failed to fetch police chat messages' });
  }
});

app.post('/api/police/chat/send', policeAuthMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    const chatMessage = new ChatMessage({
      sender: req.officer.id,
      receiver: 'admin', // Or some other logic for police chat
      message,
      isPolice: true,
    });
    await chatMessage.save();

    const userMsg = await ChatMessage.create({ userId: req.user.id, role: 'user', content: String(message).trim(), isPolice: true });

    // Simple echo for now, replace with real AI/agent logic if needed
    const reply = `Echo: ${message}`;
    const aiMsg = await ChatMessage.create({ userId: req.user.id, role: 'assistant', content: reply, isPolice: true });

    res.json({ userMsg, aiMsg });
  } catch (err) {
    console.error('Police chat send error:', err);
    res.status(500).json({ error: 'Failed to send police chat message' });
  }
});

// Police Alerts
app.get('/api/police/alerts', policeAuthMiddleware, async (req, res) => {
  res.json({ message: 'Police alerts placeholder' });
});

// Police Notifications (station-scoped)
app.get('/api/police/notifications', policeAuthMiddleware, async (req, res) => {
  try {
    const { station } = req.officer
    const notifications = await PoliceNotification.find({ station }).sort({ createdAt: -1 }).limit(200)
    return res.json({ notifications })
  } catch (err) {
    console.error('Police notifications list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/police/notifications/:id/read', policeAuthMiddleware, async (req, res) => {
  try {
    const { station } = req.officer
    const n = await PoliceNotification.findOneAndUpdate({ _id: req.params.id, station }, { read: true }, { new: true })
    if (!n) return res.status(404).json({ error: 'Not found' })
    return res.json({ notification: n })
  } catch (err) {
    console.error('Police notifications mark read error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.put('/api/police/notifications/read-all', policeAuthMiddleware, async (req, res) => {
  try {
    const { station } = req.officer
    await PoliceNotification.updateMany({ station }, { $set: { read: true } })
    const notifications = await PoliceNotification.find({ station }).sort({ createdAt: -1 }).limit(200)
    return res.json({ notifications })
  } catch (err) {
    console.error('Police notifications clear error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Police Stations
app.get('/api/police/stations', policeAuthMiddleware, async (req, res) => {
  try {
    const stations = await PoliceStation.find({}).sort({ name: 1 })
    return res.json({ stations })
  } catch (err) {
    console.error('Police stations list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/police/stations/bulk', policeAuthMiddleware, async (req, res) => {
  try {
    const input = Array.isArray(req.body) ? req.body : (req.body.stations || [])
    if (!Array.isArray(input) || input.length === 0) return res.status(400).json({ error: 'No stations provided' })
    const ops = []
    for (const s of input) {
      const { name, code, address, zone, division, lat, lng } = s || {}
      if (!name || !isValidCoord(lat, lng)) continue
      ops.push({
        updateOne: {
          filter: { name },
          update: { $set: { name, code, address, zone, division, lat, lng } },
          upsert: true,
        },
      })
    }
    if (ops.length === 0) return res.status(400).json({ error: 'No valid stations to upsert' })
    const result = await PoliceStation.bulkWrite(ops)
    return res.json({ ok: true, upserts: result.upsertedCount, modified: result.modifiedCount })
  } catch (err) {
    console.error('Police stations bulk error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Police Profile
app.get('/api/police/profile', policeAuthMiddleware, async (req, res) => {
  try {
    const officer = await PoliceOfficer.findById(req.officer.id).select('-password');
    if (!officer) return res.status(404).json({ error: 'Officer not found' });
    res.json(officer);
  } catch (err) {
    console.error('Get police profile error:', err);
    res.status(500).json({ error: 'Failed to fetch police profile' });
  }
});

// Update police profile: name, rank, phone, city, avatarUrl, status
app.put('/api/police/profile', policeAuthMiddleware, async (req, res) => {
  try {
    const allowed = ['name', 'rank', 'phone', 'city', 'avatarUrl', 'status']
    const updates = {}
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key]
    }
    const officer = await PoliceOfficer.findByIdAndUpdate(req.officer.id, { $set: updates }, { new: true }).select('-password')
    if (!officer) return res.status(404).json({ error: 'Officer not found' })
    res.json(officer)
  } catch (err) {
    console.error('Update police profile error:', err)
    res.status(500).json({ error: 'Failed to update police profile' })
  }
})

// Change password (police)
app.post('/api/police/auth/change-password', policeAuthMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' })
    const officer = await PoliceOfficer.findById(req.officer.id)
    if (!officer) return res.status(404).json({ error: 'Officer not found' })
    const match = await bcrypt.compare(currentPassword, officer.password)
    if (!match) return res.status(401).json({ error: 'Current password incorrect' })
    const hashed = await bcrypt.hash(newPassword, 10)
    officer.password = hashed
    await officer.save()
    res.json({ ok: true })
  } catch (err) {
    console.error('Police change-password error:', err)
    res.status(500).json({ error: 'Failed to change password' })
  }
})

// Logout of all devices (increment tokenVersion)
app.post('/api/police/logout-all', policeAuthMiddleware, async (req, res) => {
  try {
    const officer = await PoliceOfficer.findById(req.officer.id)
    if (!officer) return res.status(404).json({ error: 'Officer not found' })
    officer.tokenVersion = (officer.tokenVersion || 1) + 1
    await officer.save()
    res.json({ ok: true })
  } catch (err) {
    console.error('Police logout-all error:', err)
    res.status(500).json({ error: 'Failed to logout from all devices' })
  }
})

// Enable/Disable 2FA (stub toggle)
app.post('/api/police/auth/2fa/enable', policeAuthMiddleware, async (req, res) => {
  try {
    const { enable } = req.body
    const officer = await PoliceOfficer.findByIdAndUpdate(req.officer.id, { $set: { twoFactorEnabled: !!enable } }, { new: true }).select('-password')
    if (!officer) return res.status(404).json({ error: 'Officer not found' })
    res.json({ ok: true, twoFactorEnabled: officer.twoFactorEnabled })
  } catch (err) {
    console.error('Police 2FA toggle error:', err)
    res.status(500).json({ error: 'Failed to update 2FA setting' })
  }
})

// Station update request model and route
const stationUpdateRequestSchema = new mongoose.Schema({
  officerId: { type: mongoose.Schema.Types.ObjectId, ref: 'PoliceOfficer', required: true },
  stationName: { type: String, required: true },
  message: { type: String },
  status: { type: String, enum: ['Pending', 'Reviewed'], default: 'Pending' },
}, { timestamps: true })
const StationUpdateRequest = mongoose.model('StationUpdateRequest', stationUpdateRequestSchema)

app.post('/api/police/stations/request-update', policeAuthMiddleware, async (req, res) => {
  try {
    const { stationName, message } = req.body
    if (!stationName) return res.status(400).json({ error: 'stationName required' })
    const reqDoc = await StationUpdateRequest.create({ officerId: req.officer.id, stationName, message })
    res.json({ ok: true, requestId: reqDoc._id })
  } catch (err) {
    console.error('Police station update request error:', err)
    res.status(500).json({ error: 'Failed to submit update request' })
  }
})

// Police Officers
app.get('/api/police/officers', policeAuthMiddleware, async (req, res) => {
  try {
    const officers = await PoliceOfficer.find({ station: req.officer.station }).select('-password');
    res.json(officers);
  } catch (err) {
    console.error('Get police officers error:', err);
    res.status(500).json({ error: 'Failed to fetch police officers' });
  }
});

// ========================
// Help & Support: FAQs, Tickets, Chat, Feedback, Contact
// ========================

// FAQ schema
const faqSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  answer: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  tags: [{ type: String }],
  helpfulCount: { type: Number, default: 0 },
  notHelpfulCount: { type: Number, default: 0 },
}, { timestamps: true })
const Faq = mongoose.model('Faq', faqSchema)

// Track per-user votes to enforce single vote per FAQ
const faqVoteSchema = new mongoose.Schema({
  faqId: { type: mongoose.Schema.Types.ObjectId, ref: 'Faq', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  helpful: { type: Boolean, required: true },
}, { timestamps: true })
faqVoteSchema.index({ faqId: 1, userId: 1 }, { unique: true })
const FaqVote = mongoose.model('FaqVote', faqVoteSchema)

app.get('/api/faqs', async (req, res) => {
  try {
    const { q = '', category = '' } = req.query
    const query = {}
    if (String(q).trim()) {
      const regex = new RegExp(String(q).trim(), 'i')
      Object.assign(query, { $or: [{ question: regex }, { answer: regex }, { tags: regex }] })
    }
    if (String(category).trim()) {
      Object.assign(query, { category: String(category).trim() })
    }

    // Seed defaults when DB is empty
    const total = await Faq.countDocuments({})
    if (total === 0) {
      const seed = [
        { question: 'How can I file a complaint?', answer: 'Go to Report New Complaint in the dashboard and fill the form.', category: 'Complaint Process', tags: ['complaint','file','report'] },
        { question: 'Can I track my complaint status?', answer: 'Use Track Complaint (Map View) or My Complaints to see status updates.', category: 'Complaint Process', tags: ['track','status','map'] },
        { question: 'How do I reset my password?', answer: 'Open Profile Settings and use Change Password option.', category: 'Account Issues', tags: ['account','password','reset'] },
        { question: 'What if I submitted the wrong details?', answer: 'Edit your complaint from My Complaints or contact support for corrections.', category: 'Complaint Process', tags: ['edit','details','corrections'] },
        { question: 'Is my data secure?', answer: 'We use secure storage and encryption; only authorized staff can access your case.', category: 'Technical Help', tags: ['security','data','encryption'] },
        { question: 'How to attach evidence or screenshots?', answer: 'In the complaint form, use the Attach Screenshot option to upload proof.', category: 'Technical Help', tags: ['evidence','screenshot','attach'] },
      ]
      await Faq.insertMany(seed)
    }

    const items = await Faq.find(query).sort({ createdAt: -1 }).limit(200)
    return res.json({ faqs: items })
  } catch (err) {
    console.error('FAQs error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/faqs/:id/vote', authMiddleware, async (req, res) => {
  try {
    const { helpful } = req.body
    if (typeof helpful !== 'boolean') return res.status(400).json({ error: 'Invalid vote' })
    const faq = await Faq.findById(req.params.id)
    if (!faq) return res.status(404).json({ error: 'FAQ not found' })

    // Attempt to record vote; unique index prevents duplicates
    try {
      await FaqVote.create({ faqId: faq._id, userId: req.user.id, helpful })
    } catch (e) {
      if (e && e.code === 11000) {
        const existing = await FaqVote.findOne({ faqId: faq._id, userId: req.user.id })
        return res.status(400).json({ error: 'Already voted', vote: existing })
      }
      throw e
    }

    if (helpful) faq.helpfulCount += 1
    else faq.notHelpfulCount += 1
    await faq.save()
    return res.json({ ok: true, faq, vote: { faqId: faq._id, userId: req.user.id, helpful } })
  } catch (err) {
    console.error('FAQ vote error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Return current user's votes to drive UI disabling state
app.get('/api/faqs/votes', authMiddleware, async (req, res) => {
  try {
    const rows = await FaqVote.find({ userId: req.user.id }).select('faqId helpful')
    return res.json({ votes: rows.map(r => ({ faqId: String(r.faqId), helpful: !!r.helpful })) })
  } catch (err) {
    console.error('FAQ votes list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Support Ticket schema
const supportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticketNumber: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  phone: { type: String },
  complaintId: { type: mongoose.Schema.Types.ObjectId, ref: 'Complaint' },
  category: { type: String, required: true },
  description: { type: String, required: true },
  screenshotData: { type: String },
  status: { type: String, enum: ['Open', 'In Progress', 'Resolved'], default: 'Open' },
}, { timestamps: true })
const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema)

function genTicketNumber() {
  const year = new Date().getFullYear()
  const rand = Math.floor(10000 + Math.random() * 90000)
  return `TCKT-${year}-${rand}`
}

app.post('/api/support-tickets', authMiddleware, async (req, res) => {
  try {
    const { email, phone, complaintId, category, description, screenshotData } = req.body
    if (!email || !category || !description) return res.status(400).json({ error: 'Missing required fields' })
    const ticketNumber = genTicketNumber()
    const t = await SupportTicket.create({ userId: req.user.id, ticketNumber, email, phone, complaintId, category, description, screenshotData })
    return res.json({ ok: true, ticket: t })
  } catch (err) {
    console.error('Create support ticket error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/support-tickets', authMiddleware, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user.id }).sort({ createdAt: -1 })
    return res.json({ tickets })
  } catch (err) {
    console.error('List support tickets error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Chat schema
const chatMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant', 'agent'], required: true },
  content: { type: String, required: true },
  isPolice: { type: Boolean, default: false },
}, { timestamps: true })
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema)

app.get('/api/chat/messages', authMiddleware, async (req, res) => {
  try {
    const msgs = await ChatMessage.find({ userId: req.user.id }).sort({ createdAt: 1 })
    return res.json({ messages: msgs })
  } catch (err) {
    console.error('Chat list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/chat/send', authMiddleware, async (req, res) => {
  try {
    const { message, useAI = true } = req.body
    if (!message || String(message).trim().length === 0) return res.status(400).json({ error: 'Message required' })
    const userMsg = await ChatMessage.create({ userId: req.user.id, role: 'user', content: String(message).trim() })

    let reply = 'Support agent will respond during working hours.'
    if (useAI) {
      const { GEMINI_API_KEY } = process.env
      if (GEMINI_API_KEY) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`
        const payload = {
          contents: [{ role: 'user', parts: [{ text: `You are a helpful support assistant for Smart Police Complaints System. Answer concisely.\nUser question: ${String(message).trim()}` }] }],
        }
        const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (r.ok) {
          const data = await r.json()
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'I can help with complaint tracking, registration and support.'
          reply = text
        } else {
          console.warn('Gemini API failed:', await r.text())
        }
      }
    }
    const aiMsg = await ChatMessage.create({ userId: req.user.id, role: useAI ? 'assistant' : 'agent', content: reply })
    return res.json({ messages: [userMsg, aiMsg] })
  } catch (err) {
    console.error('Chat send error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Feedback schema
const feedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rating: { type: Number, min: 1, max: 5, required: true },
  text: { type: String },
  anonymous: { type: Boolean, default: false },
}, { timestamps: true })
const Feedback = mongoose.model('Feedback', feedbackSchema)

app.post('/api/feedback', async (req, res) => {
  try {
    const { rating, text = '', anonymous = true, userId = null } = req.body
    if (!rating) return res.status(400).json({ error: 'Rating required' })
    const doc = await Feedback.create({ userId, rating, text, anonymous })
    return res.json({ ok: true, feedback: doc })
  } catch (err) {
    console.error('Feedback error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/feedback/stats', async (req, res) => {
  try {
    const [agg] = await Feedback.aggregate([
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $count: {} } } },
    ])
    return res.json({ average: agg?.avg || 0, count: agg?.count || 0 })
  } catch (err) {
    console.error('Feedback stats error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// List recent feedback with username (or Anonymous)
app.get('/api/feedback', async (req, res) => {
  try {
    const items = await Feedback.find({}).sort({ createdAt: -1 }).limit(50).populate('userId', 'username')
    const feedbacks = items.map((f) => ({
      id: f._id,
      username: f.anonymous ? 'Anonymous' : (f.userId && f.userId.username ? f.userId.username : 'User'),
      text: f.text || '',
      rating: f.rating,
      createdAt: f.createdAt,
    }))
    return res.json({ feedbacks })
  } catch (err) {
    console.error('Feedback list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Contact support details (static, with optional city)
app.get('/api/support/contact', (req, res) => {
  const { city = '' } = req.query
  const base = {
    helplines: [
      { label: 'Emergency', number: '100' },
      { label: 'Cyber Cell', number: '1930' },
      { label: "Women’s Helpline", number: '1091' },
    ],
    email: 'support@smartpolice.in',
    hours: '24x7 for emergencies; 9am–6pm for general support',
    links: { feedback: '/feedback', twitter: 'https://twitter.com', facebook: 'https://facebook.com' },
  }
  const stations = {
    Pune: { address: 'Shivajinagar Police HQ, Pune, MH', mapUrl: 'https://maps.google.com/maps?q=Pune%20Police%20Headquarters&z=12&output=embed' },
    Mumbai: { address: 'Mumbai Police HQ, Mumbai, MH', mapUrl: 'https://maps.google.com/maps?q=Mumbai%20Police%20Headquarters&z=12&output=embed' },
  }
  const station = stations[String(city)] || { address: 'Central Police Station', mapUrl: 'https://maps.google.com/maps?q=Police%20Station&z=12&output=embed' }
  res.json({ ...base, station })
})

const server = app.listen(PORT, () => {
  console.log(`SPCS server running on http://localhost:${PORT}`)
  // Best-effort seeding on startup
  seedPoliceStationsIfEmpty()
})

// Socket.IO setup for real-time notifications
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})
app.set('io', io)

io.on('connection', (socket) => {
  const { role, token } = socket.handshake.query
  try {
    const payload = jwt.verify(String(token || ''), JWT_SECRET)
    if (role === 'user') {
      const userId = payload?.id
      if (userId) socket.join(`user:${userId}`)
    } else if (role === 'police') {
      const station = payload?.station || 'All Stations'
      socket.join(`station:${station}`)
    }
  } catch (err) {
    socket.disconnect()
  }
})