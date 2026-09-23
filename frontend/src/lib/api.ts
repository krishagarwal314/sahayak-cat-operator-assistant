import type {
  AskResult, Briefing, MachineCard, MachineDetail, Operator,
  SafetyReport, Suggestion, Task, Telemetry, TrainingModule, Instructor,
} from './types'

const TOKEN_KEY = 'sahayak.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const res = await fetch(path, { ...init, headers })
  if (res.status === 401) {
    setToken(null)
    throw new ApiError(401, 'Session expired')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? detail
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return res.json() as Promise<T>
  return res.blob() as unknown as Promise<T>
}

const json = (body: unknown) => ({ body: JSON.stringify(body) })

export const api = {
  // ---- auth ----
  login: (username: string, password: string) =>
    request<{ token: string; expires_in: number; operator: Operator }>(
      '/api/auth/login', { method: 'POST', ...json({ username, password }) }),
  me: () => request<{ operator: Operator; session: { machine_id: string } | null }>('/api/auth/me'),
  demoAccounts: () =>
    request<{ username: string; password: string; name_en: string; name_hi: string; role: string }[]>(
      '/api/auth/demo-accounts'),

  // ---- tasks ----
  briefing: () => request<Briefing>('/api/tasks/briefing'),
  tasks: (machineId?: string) =>
    request<Task[]>(`/api/tasks${machineId ? `?machine_id=${machineId}` : ''}`),
  setTaskStatus: (taskId: string, status: Task['status']) =>
    request<Task>(`/api/tasks/${taskId}/status`, { method: 'POST', ...json({ status }) }),

  // ---- machines ----
  machines: () => request<MachineCard[]>('/api/machines'),
  selectMachine: (machineId: string) =>
    request<{ machine: any; suggestions: Suggestion[] }>(
      '/api/machines/select', { method: 'POST', ...json({ machine_id: machineId }) }),
  machine: (machineId: string) => request<MachineDetail>(`/api/machines/${machineId}`),
  telemetry: (machineId: string) => request<Telemetry>(`/api/machines/${machineId}/telemetry`),
  series: (machineId: string, sensor: string, points = 24) =>
    request<{ points: { minute: number; value: number }[] }>(
      `/api/machines/${machineId}/series/${sensor}?points=${points}`),

  // ---- assistant ----
  ask: (body: { machine_id: string; text?: string; intent?: string; language: string; speak?: boolean }) =>
    request<AskResult>('/api/assistant/ask', { method: 'POST', ...json(body) }),
  suggestions: (machineId: string) =>
    request<Suggestion[]>(`/api/assistant/suggestions?machine_id=${machineId}`),
  analytics: () => request<{
    turns: number; by_stage: Record<string, number>; by_intent: Record<string, number>
    avg_route_ms: number; llm_calls: number; resolved_locally_pct: number
  }>('/api/assistant/analytics'),
  intents: (machineId?: string) =>
    request<{ count: number; intents: any[] }>(
      `/api/assistant/intents${machineId ? `?machine_id=${machineId}` : ''}`),

  // ---- voice ----
  voiceAsk: (audio: Blob, machineId: string, language: string, speak = true) => {
    const form = new FormData()
    form.append('audio', audio, 'query.webm')
    form.append('machine_id', machineId)
    form.append('language', language)
    form.append('speak', String(speak))
    return request<AskResult>('/api/voice/ask', { method: 'POST', body: form })
  },
  transcribe: (audio: Blob, language: string) => {
    const form = new FormData()
    form.append('audio', audio, 'query.webm')
    form.append('language', language)
    return request<{ text: string; latency_ms: number }>('/api/voice/transcribe', { method: 'POST', body: form })
  },
  speak: (text: string, language: string) =>
    request<Blob>('/api/voice/speak', { method: 'POST', ...json({ text, language }) }),

  // ---- safety ----
  safety: (machineId: string) => request<SafetyReport>(`/api/safety/${machineId}`),
  logIncident: (body: { machine_id: string; description: string; category?: string; severity?: string; language?: string }) =>
    request<{ incident: any; confirmation: { hi: string; en: string } }>(
      '/api/safety/incident', { method: 'POST', ...json(body) }),
  setSeatbelt: (machineId: string, fastened: boolean) =>
    request<any>('/api/safety/seatbelt', { method: 'POST', ...json({ machine_id: machineId, fastened }) }),

  // ---- training ----
  training: (machineId?: string) =>
    request<{ modules: TrainingModule[]; instructors: Instructor[]; bookings: any[]; skill_scores: Record<string, number> }>(
      `/api/training${machineId ? `?machine_id=${machineId}` : ''}`),
  book: (instructorId: string, slot: string, moduleId?: string) =>
    request<{ booking: any; confirmation: { hi: string; en: string } }>(
      '/api/training/book', { method: 'POST', ...json({ instructor_id: instructorId, slot, module_id: moduleId }) }),

  // ---- system ----
  systemModels: () => request<any>('/api/system/models'),
  routerInfo: () => request<any>('/api/system/router'),
  warm: () => request<any>('/api/system/warm', { method: 'POST' }),
  reset: () => request<any>('/api/system/reset', { method: 'POST' }),
}
