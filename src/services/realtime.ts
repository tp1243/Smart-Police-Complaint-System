import { io, Socket } from 'socket.io-client'
import { API_URL } from './api'

function getSocketBaseUrl() {
  // Derive Socket.IO base from API_URL; e.g., https://smart-police-complaint-system.onrender.com/api -> https://smart-police-complaint-system.onrender.com
  try {
    if (!API_URL) return 'https://smart-police-complaint-system.onrender.com'
    return API_URL.replace(/\/api$/, '')
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