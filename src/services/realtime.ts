import { io, Socket } from 'socket.io-client'

function getSocketBaseUrl() {
  try {
    const raw = (import.meta.env.VITE_API_URL as string) || (import.meta.env.VITE_API_BASE_URL as string) || (typeof window !== 'undefined' ? localStorage.getItem('apiResolved') || '' : '')
    const base = raw.trim() ? raw.trim() : 'https://smart-police-complaint-system.onrender.com/api'
    return base.replace(/\/api$/, '')
  } catch {
    return 'https://smart-police-complaint-system.onrender.com'
  }
}

export type SocketRole = 'user' | 'police'

export function connectRealtime(role: SocketRole, token: string): Socket {
  const base = getSocketBaseUrl()
  const socket = io(base, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    query: { role, token },
  })
  return socket
}