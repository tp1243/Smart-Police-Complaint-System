import { request } from './api'
import type { Complaint } from '../types'

export const complaintsApi = {
  async create(payload: Complaint, token: string) {
    return request<{ complaint: Complaint }>(('/complaints'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
  },
  async listMine(token: string) {
    return request<{ complaints: Complaint[] }>('/complaints', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  async getById(token: string, id: string) {
    return request<{ complaint: Complaint }>(`/complaints/${id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  async update(token: string, id: string, payload: Partial<Complaint>) {
    return request<{ complaint: Complaint }>(`/complaints/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
  },
  async stats(token: string) {
    return request<{ stats: Record<string, number> }>(`/complaints/stats`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
  },
}