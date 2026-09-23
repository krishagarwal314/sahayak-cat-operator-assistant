import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, setToken, getToken, ApiError } from './api'
import type { Operator } from './types'

const MACHINE_KEY = 'sahayak.machine'

interface SessionValue {
  operator: Operator | null
  machineId: string | null
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  adopt: (token: string, operator: Operator) => void
  logout: () => void
  selectMachine: (machineId: string) => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(null)
  const [machineId, setMachineId] = useState<string | null>(() => localStorage.getItem(MACHINE_KEY))
  const [ready, setReady] = useState(false)

  // Restore the session on reload so a refresh mid-demo does not sign you out.
  useEffect(() => {
    let cancelled = false
    async function restore() {
      if (!getToken()) {
        setReady(true)
        return
      }
      try {
        const me = await api.me()
        if (cancelled) return
        setOperator(me.operator)
        if (me.session?.machine_id) {
          setMachineId(me.session.machine_id)
          localStorage.setItem(MACHINE_KEY, me.session.machine_id)
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setToken(null)
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password)
    setToken(res.token)
    setOperator(res.operator)
  }, [])

  /** Take over a session issued by face or tap login. */
  const adopt = useCallback((token: string, op: Operator) => {
    setToken(token)
    setOperator(op)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    localStorage.removeItem(MACHINE_KEY)
    setOperator(null)
    setMachineId(null)
  }, [])

  const selectMachine = useCallback(async (id: string) => {
    await api.selectMachine(id)
    localStorage.setItem(MACHINE_KEY, id)
    setMachineId(id)
  }, [])

  const value = useMemo(
    () => ({ operator, machineId, ready, login, adopt, logout, selectMachine }),
    [operator, machineId, ready, login, adopt, logout, selectMachine],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
