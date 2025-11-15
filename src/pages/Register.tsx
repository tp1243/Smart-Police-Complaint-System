import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { api } from '../services/api'
import AuthShowcase from '../components/AuthShowcase'
import { FiEye, FiEyeOff } from 'react-icons/fi'
import SocialAuth from '../components/SocialAuth'
import AuthHeader from '../components/AuthHeader'

export default function Register() {
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  
  const [phone, setPhone] = useState('')
  

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const token = params.get('token')
    const userStr = params.get('user')
    if (token) {
      localStorage.setItem('token', token)
      if (userStr) {
        try { localStorage.setItem('user', userStr) } catch {}
      }
      navigate('/user')
    }
  }, [location.search])

  // No mobile check here; we always route to VerifyOtp and that page
  // decides whether to immediately redirect on desktop.

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username || !email || !password) { setError('Please fill in all fields'); return }
    if (!phone) { setError('Please enter your mobile number'); return }
    setLoading(true)
    try {
      const normalizedPhone = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '').slice(-10)}`
      const res = await api.register(username, email, password, normalizedPhone)
      navigate('/verify-otp', { state: { email, phone: normalizedPhone, purpose: 'register', token: res.token, user: res.user } })
    } catch (err: any) {
      setError(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  // OTP handling moved to dedicated VerifyOtp page

  return (
    <>
      <AuthHeader variant="register" />
      <div className="auth-layout user-auth">
      <div className="auth-left">
        <AuthShowcase title="Create your account" subtitle="Join SPCS to submit and track complaints." />
      </div>
      <div className="auth-right">
        <motion.form className="auth-card auth-form" onSubmit={onSubmit} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h3>Create Account</h3>
          <div className="form-row">
            <input id="register-username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder=" " />
            <label htmlFor="register-username">Username</label>
          </div>
          <div className="form-row">
            <input id="register-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder=" " />
            <label htmlFor="register-email">Email</label>
          </div>
          <div className="form-row phone-row">
            <div className="country-prefix">IND +91</div>
            <input id="register-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" />
          </div>
          <div className="form-row">
            <div className="password-row">
              <input id="register-password" type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder=" " />
              <label htmlFor="register-password">Password</label>
              <button type="button" className="pwd-toggle" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? 'Hide password' : 'Show password'}>
                {showPwd ? <FiEyeOff /> : <FiEye />}
              </button>
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={loading}>{loading ? 'Creating...' : 'Register'}</button>
            <Link className="btn ghost" to="/login">Already have an account</Link>
          </div>
          <SocialAuth />
        </motion.form>

        
      </div>
      </div>
    </>
  )
}