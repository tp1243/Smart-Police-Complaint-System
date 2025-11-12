import { io, Socket } from 'socket.io-client'
import { API_URL } from './api'

function getSocketBaseUrl() {
  // Derive Socket.IO base from API_URL; e.g., http://localhost:5175/api -> http://localhost:5175
  try {
    if (!API_URL) return 'http://localhost:5175'
    return API_URL.replace(/\/api$/, '')
  } catch {
    return 'http://localhost:5175'
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