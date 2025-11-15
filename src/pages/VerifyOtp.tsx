import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../services/api'
import AuthHeader from '../components/AuthHeader'

type VerifyState = {
  email: string
  phone?: string
  purpose: 'login' | 'register'
  token?: string
  user?: { id: string; username: string; email: string }
}

export default function VerifyOtp() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state || {}) as VerifyState
  const [otpSessionId, setOtpSessionId] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const maskedPhone = useMemo(() => {
    const p = state.phone || ''
    if (!p) return ''
    const digits = p.replace(/\D/g, '')
    const last4 = digits.slice(-4)
    return `••••••${last4}`
  }, [state.phone])

  // Always show OTP page regardless of device; remove auto-redirect behavior.

  useEffect(() => {
    if (!state.email || !state.purpose) {
      navigate('/login')
      return
    }
    // Send OTP automatically when arriving to this page
    ;(async () => {
      try {
        const res = await api.sendOtp(state.email, state.purpose, state.phone)
        setOtpSessionId(res.sessionId)
      } catch (err: any) {
        setOtpError(err.message || 'Failed to send OTP')
      }
    })()
  }, [])

  const handleResend = async () => {
    setOtpError('')
    try {
      const res = await api.sendOtp(state.email, state.purpose, state.phone)
      setOtpSessionId(res.sessionId)
    } catch (err: any) {
      setOtpError(err.message || 'Failed to resend OTP')
    }
  }

  const handleVerify = async () => {
    setOtpError('')
    if (!otpSessionId) { setOtpError('OTP session missing'); return }
    if (!otpCode || otpCode.length < 6) { setOtpError('Enter 6-digit OTP'); return }
    setOtpLoading(true)
    try {
      const res = await api.verifyOtp(otpSessionId, otpCode)
      if (res.success) {
        if (state.token && state.user) {
          localStorage.setItem('token', state.token)
          localStorage.setItem('user', JSON.stringify(state.user))
        }
        navigate('/user')
      } else {
        setOtpError('Invalid OTP')
      }
    } catch (err: any) {
      setOtpError(err.message || 'Failed to verify OTP')
    } finally {
      setOtpLoading(false)
    }
  }

  return (
    <>
      <AuthHeader variant="login" />
      <div className="auth-layout user-auth">
        <div className="auth-right" style={{ width: '100%' }}>
          <motion.div className="otp-container" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="otp-card">
              <h4>{state.purpose === 'register' ? 'Verify Your Registration' : 'Verify Your Login'}</h4>
              {state.purpose === 'login' && (
                <p className="muted">We sent an OTP to your registered mobile number {maskedPhone ? `(${maskedPhone})` : ''}.</p>
              )}
              {state.purpose === 'register' && state.phone && (
                <p className="muted">We sent an OTP to {state.phone}.</p>
              )}
              <div className="otp-input-row">
                <input className="otp-input" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))} placeholder="Enter 6-digit code" />
              </div>
              {otpError && <div className="form-error small">{otpError}</div>}
              <div className="form-actions" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn primary" onClick={handleVerify} disabled={otpLoading}>{otpLoading ? 'Verifying...' : 'Verify OTP'}</button>
                <button type="button" className="btn ghost" onClick={handleResend} disabled={otpLoading}>Resend</button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  )
}