import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { api } from '../services/api'
import AuthShowcase from '../components/AuthShowcase'
import { FiEye, FiEyeOff } from 'react-icons/fi'
import SocialAuth from '../components/SocialAuth'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')

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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Please fill in all fields'); return }
    setLoading(true)
    try {
      const res = await api.login(email, password)
      localStorage.setItem('token', res.token)
      localStorage.setItem('user', JSON.stringify(res.user))
      navigate('/user')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-left">
        <AuthShowcase
          title="Welcome back"
          subtitle="Sign in to monitor, track, and resolve."
          imageSrc="https://images.unsplash.com/photo-1589571894960-20bbe2828d0a?auto=format&fit=crop&w=1200&q=60"
          imageAlt="Police lights reflecting at night"
        />
      </div>
      <div className="auth-right">
        <motion.form className="auth-card auth-form" onSubmit={onSubmit} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h3>Login</h3>
          <div className="form-row">
            <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder=" " />
            <label htmlFor="login-email">Email</label>
          </div>
          <div className="form-row">
            <div className="password-row">
              <input id="login-password" type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder=" " />
              <label htmlFor="login-password">Password</label>
              <button type="button" className="pwd-toggle" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? 'Hide password' : 'Show password'}>
                {showPwd ? <FiEyeOff /> : <FiEye />}
              </button>
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={loading}>{loading ? 'Signing in...' : 'Login'}</button>
            <Link className="btn ghost" to="/register">Create Account</Link>
          </div>
          <SocialAuth />
        </motion.form>
      </div>
    </div>
  )
}