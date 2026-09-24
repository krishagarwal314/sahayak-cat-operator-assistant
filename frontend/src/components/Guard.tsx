import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { CabGuard, siren, type GuardState } from '../lib/cabGuard'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import { Pictogram } from './Pictogram'

export const ALARM = {
  hi: 'जागिए! आपकी आँखें बंद हो रही हैं। मशीन रोकिए और आराम कीजिए।',
  en: 'Wake up! Your eyes are closing. Stop the machine and rest.',
}
export const AWAKE = {
  hi: 'ठीक है। ध्यान से चलाइए। थकान हो तो आराम कीजिए।',
  en: 'All right. Drive carefully, and rest if you feel tired.',
}
export const YAWN = {
  hi: 'आप उबासी ले रहे हैं। थोड़ा आराम कर लीजिए।',
  en: 'You are yawning. Take a short rest.',
}

interface GuardApi {
  state: GuardState
  active: boolean
  video: HTMLVideoElement | null
  start: () => void
  stop: () => void
}
const Ctx = createContext<GuardApi | null>(null)
export const useGuard = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useGuard outside GuardProvider')
  return ctx
}

const OFF: GuardState = { status: 'off', eyesClosed: 0, closedSeconds: 0, perclos: 0, blinksPerMin: 0, yawns: 0, eyePoints: [] }

/** Keeps the cab guard running across every screen once it is switched on. */
export function GuardProvider({ children }: { children: React.ReactNode }) {
  const { lang } = useLang()
  const { machineId } = useSession()
  const { speak } = useVoiceOut()
  const [state, setState] = useState<GuardState>(OFF)
  const [alarm, setAlarm] = useState(false)
  const guard = useRef<CabGuard | null>(null)
  const stopSiren = useRef<() => void>(() => undefined)
  const langRef = useRef(lang)
  langRef.current = lang

  const onDrowsy = useCallback((s: GuardState) => {
    setAlarm(true)
    stopSiren.current = siren(2.5)
    window.setTimeout(() => void speak(ALARM[langRef.current], langRef.current, 'guard-alarm'), 1200)
    void api.fatigue({ machine_id: machineId ?? 'EXC001', kind: 'drowsy', seconds: s.closedSeconds, perclos: s.perclos })
  }, [machineId, speak])

  const onYawn = useCallback(() => {
    void speak(YAWN[langRef.current], langRef.current, 'guard-yawn')
    void api.fatigue({ machine_id: machineId ?? 'EXC001', kind: 'yawn' })
  }, [machineId, speak])

  const start = useCallback(() => {
    if (guard.current) return
    guard.current = new CabGuard(setState, onDrowsy, onYawn)
    void guard.current.start()
  }, [onDrowsy, onYawn])

  const stop = useCallback(() => {
    guard.current?.stop()
    guard.current = null
    setState(OFF)
  }, [])

  useEffect(() => () => guard.current?.stop(), [])

  const acknowledge = () => {
    stopSiren.current()
    setAlarm(false)
    guard.current?.rearm()
    void speak(AWAKE[lang], lang, 'guard-awake')
  }

  const active = state.status !== 'off'
  return (
    <Ctx.Provider value={{ state, active, video: guard.current?.video ?? null, start, stop }}>
      {children}
      {active && <GuardBubble />}
      {alarm && createPortal(
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-8 bg-crit p-6 text-center animate-pulse">
          <Pictogram name="alert" className="h-32 w-32 text-white" />
          <p className={`text-6xl font-black text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{lang === 'hi' ? 'जागिए!' : 'WAKE UP!'}</p>
          <p className={`max-w-md text-2xl font-bold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{ALARM[lang]}</p>
          <button onClick={acknowledge}
            className={`h-24 w-full max-w-sm rounded-3xl bg-white text-3xl font-extrabold text-crit shadow-2xl active:scale-95 ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {lang === 'hi' ? 'मैं जाग गया' : "I'm awake"}
          </button>
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  )
}

/** A small live camera circle in the corner while the guard is watching. */
function GuardBubble() {
  const { state, video } = useGuard()
  const location = useLocation()
  const navigate = useNavigate()
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && video?.srcObject) {
      ref.current.srcObject = video.srcObject
      void ref.current.play().catch(() => undefined)
    }
  }, [video, state.status])
  if (location.pathname === '/guard') return null
  const ring = state.status === 'drowsy' || state.status === 'closing' ? 'ring-crit' : state.status === 'awake' ? 'ring-ok' : 'ring-cat'
  return (
    <button onClick={() => navigate('/guard')} aria-label="cab guard"
      className={`fixed right-3 top-20 z-50 h-20 w-20 overflow-hidden rounded-full bg-black ring-4 ${ring} shadow-2xl`}>
      <video ref={ref} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
      <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[10px] font-bold text-white">
        {state.status === 'awake' ? '● LIVE' : state.status === 'loading' ? '…' : '●'}
      </span>
    </button>
  )
}
