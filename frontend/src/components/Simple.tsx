/**
 * Building blocks of the simple, picture-first interface.
 *
 * Rules every screen follows:
 *   pictures first, one to three big words second
 *   one main action per screen
 *   every tap target at least 64px, usable with gloves
 *   status is colour AND a symbol, never colour alone
 *   the screen tells you where you are when it opens
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import { useVoice } from '../lib/useVoice'
import type { AskResult } from '../lib/types'
import { MachineIcon } from './MachineIcon'
import { INTENT_ICON, Pictogram } from './Pictogram'

// ------------------------------------------------------------------ status
export const TONE = {
  ok: { bg: 'bg-ok/15', ring: 'ring-ok/50', border: 'border-ok/50', text: 'text-ok', solid: 'bg-ok', icon: 'check' },
  warn: { bg: 'bg-warn/15', ring: 'ring-warn/50', border: 'border-warn/60', text: 'text-warn', solid: 'bg-warn', icon: 'alert' },
  crit: { bg: 'bg-crit/15', ring: 'ring-crit/60', border: 'border-crit/70', text: 'text-crit', solid: 'bg-crit', icon: 'cross' },
} as const

export function toneOf(status?: string) {
  if (status === 'crit' || status === 'critical') return TONE.crit
  if (status === 'warn' || status === 'warning') return TONE.warn
  return TONE.ok
}

/** Small speaker that replays something aloud. */
export function SpeakButton({ onClick, active = false, label, size = 'md' }: {
  onClick: () => void; active?: boolean; label?: string; size?: 'md' | 'lg'
}) {
  const box = size === 'lg' ? 'h-16 w-16' : 'h-12 w-12'
  return (
    <button onClick={onClick} aria-label={label ?? 'listen'}
      className={`grid ${box} shrink-0 place-items-center rounded-2xl transition-all active:scale-95
        ${active ? 'bg-cat text-ink-900 shadow-glow' : 'bg-ink-700 text-cat hover:bg-ink-600'}`}>
      <Pictogram name={active ? 'pause' : 'speaker'} className={size === 'lg' ? 'h-9 w-9' : 'h-7 w-7'} />
    </button>
  )
}

/** A screen's heading: picture, a few big words, and a replay-the-intro speaker. */
export function PageHeader({ icon, title, onReplay, speaking }: {
  icon: React.ReactNode; title: string; onReplay: () => void; speaking: boolean
}) {
  const { lang } = useLang()
  const { blocked } = useVoiceOut()
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-cat/15 text-cat">{icon}</div>
        <h1 className={`min-w-0 flex-1 text-[26px] font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {title}
        </h1>
        <div className="relative">
          {blocked && <span className="absolute inset-0 rounded-2xl bg-cat/50 animate-pulsering" />}
          <SpeakButton onClick={onReplay} active={speaking || blocked} />
        </div>
      </div>
      {blocked && (
        <button onClick={onReplay}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-cat py-3 text-lg font-extrabold text-ink-900 animate-risein ${lang === 'hi' ? 'lang-hi' : ''}`}>
          <Pictogram name="speaker" className="h-7 w-7" />{lang === 'hi' ? 'आवाज़ के लिए दबाइए' : 'Tap to hear'}
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ navigation
const TABS = [
  { to: '/work', icon: 'clipboard', hi: 'काम', en: 'Work' },
  { to: '/machine', icon: 'machine', hi: 'मशीन', en: 'Machine' },
  { to: '/learn', icon: 'book', hi: 'सीखें', en: 'Learn' },
  { to: '/safety', icon: 'shield', hi: 'सुरक्षा', en: 'Safety' },
] as const

function BottomNav({ family }: { family: string }) {
  const { lang } = useLang()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line-soft bg-ink-900/95 backdrop-blur-lg"
         style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto grid max-w-3xl grid-cols-5 items-end px-2">
        {TABS.slice(0, 2).map((tab) => <Tab key={tab.to} tab={tab} family={family} lang={lang} />)}
        <div />{/* space under the floating mic */}
        {TABS.slice(2).map((tab) => <Tab key={tab.to} tab={tab} family={family} lang={lang} />)}
      </div>
    </nav>
  )
}

function Tab({ tab, family, lang }: { tab: (typeof TABS)[number]; family: string; lang: 'hi' | 'en' }) {
  return (
    <NavLink to={tab.to}
      className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 transition-colors
        ${isActive ? 'text-cat' : 'text-mute hover:text-slate-200'}`}>
      {({ isActive }) => (<>
        <span className={`grid h-11 w-14 place-items-center rounded-2xl ${isActive ? 'bg-cat/15' : ''}`}>
          {tab.icon === 'machine'
            ? <MachineIcon family={family} className="h-8 w-10" />
            : <Pictogram name={tab.icon} className="h-8 w-8" />}
        </span>
        <span className={`text-[13px] font-bold ${lang === 'hi' ? 'lang-hi leading-none' : ''}`}>
          {lang === 'hi' ? tab.hi : tab.en}
        </span>
      </>)}
    </NavLink>
  )
}

// ------------------------------------------------------------------ top bar
function TopBar() {
  const { lang, setLang } = useLang()
  const { operator, logout } = useSession()
  const navigate = useNavigate()
  if (!operator) return null
  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-ink-900/90 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-cat text-sm font-extrabold text-ink-900">
          {operator.avatar_initials}
        </div>
        <div className={`min-w-0 flex-1 truncate text-lg font-bold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {lang === 'hi' ? operator.name_hi : operator.name_en}
        </div>
        <button onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
          className="h-11 rounded-xl border border-line bg-ink-800 px-3 text-sm font-bold text-slate-200">
          {lang === 'hi' ? 'EN' : 'हिं'}
        </button>
        <button onClick={() => navigate('/pro/cockpit')} title="Supervisor view"
          className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-ink-800 text-mute hover:text-white">
          <Pictogram name="chart" className="h-6 w-6" />
        </button>
        <button onClick={() => { logout(); navigate('/login') }} aria-label="sign out"
          className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-ink-800 text-mute hover:text-white">
          <Pictogram name="logout" className="h-6 w-6" />
        </button>
      </div>
    </header>
  )
}

// ------------------------------------------------------------------ answers
interface AnswerApi {
  /** Ask by intent (a tapped tile or button) - the router skips classification. */
  askIntent: (intent: string, label: string) => Promise<void>
  show: (result: AskResult) => void
  busy: boolean
}
const AnswerContext = createContext<AnswerApi | null>(null)

/** Tiles, buttons and the mic all answer through the same sheet and voice. */
export function useAnswer(): AnswerApi {
  const ctx = useContext(AnswerContext)
  if (!ctx) throw new Error('useAnswer must be used inside SimpleShell')
  return ctx
}

// ------------------------------------------------------------------ voice dock
/**
 * The mic lives on every screen, in the same place, bigger than anything else.
 * Hold it and talk. The answer comes back as a picture, a few big words, and
 * the voice reading it.
 */
function VoiceDock({ machineId, answer, setAnswer, error, setError, onResult }: {
  machineId: string
  answer: AskResult | null
  setAnswer: (a: AskResult | null) => void
  error: string
  setError: (e: string) => void
  onResult: (r: AskResult) => void
}) {
  const { lang } = useLang()
  const navigate = useNavigate()
  const { speak, speakingId, stop } = useVoiceOut()

  const voice = useVoice({ machineId, lang, speak: true, onResult, onError: setError })

  const card = answer?.reply.card
  const icon = answer ? (INTENT_ICON[answer.route.intent] ?? 'help') : 'mic'
  const severity = toneOf(answer?.reply.severity)
  const heard = answer?.transcript ?? answer?.route.text

  return (<>
    {/* answer sheet */}
    {(answer || error) && (
      <div className="fixed inset-x-0 bottom-[92px] z-40 px-3 animate-risein">
        <div className={`mx-auto max-w-3xl rounded-3xl border bg-ink-800 p-4 shadow-panel ring-2 ${severity.ring}`}>
          {error ? (
            <div className="flex items-center gap-3">
              <Pictogram name="alert" className="h-10 w-10 shrink-0 text-warn" />
              <p className={`flex-1 text-base text-slate-100 ${lang === 'hi' ? 'lang-hi' : ''}`}>{error}</p>
              <button onClick={() => setError('')} className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-700 text-mute">
                <Pictogram name="cross" className="h-7 w-7" />
              </button>
            </div>
          ) : answer && (<>
            {heard && (
              <p className={`mb-2 truncate text-sm text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
                <Pictogram name="mic" className="mr-1 inline h-4 w-4" />“{heard}”
              </p>
            )}
            <div className="flex items-start gap-3">
              <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl ${severity.bg} ${severity.text}`}>
                <Pictogram name={icon} className="h-10 w-10" />
              </div>
              <p className={`max-h-40 flex-1 overflow-y-auto text-lg font-semibold leading-snug text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                {answer.reply.text[lang]}
              </p>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => (speakingId === 'answer' ? stop()
                  : void speak(answer.reply.speech[lang] ?? answer.reply.text[lang], lang, 'answer', true))}
                className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink-700 text-base font-bold text-slate-100">
                <Pictogram name={speakingId === 'answer' ? 'pause' : 'repeat'} className="h-7 w-7 text-cat" />
                {lang === 'hi' ? 'फिर सुनें' : 'Again'}
              </button>
              {card?.type === 'guide' && (
                <button onClick={() => { setAnswer(null); navigate(`/guide/${card.guide_id}`) }}
                  className="flex h-14 flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-ok text-base font-extrabold text-ink-900">
                  <Pictogram name="book" className="h-7 w-7" />
                  {lang === 'hi' ? 'तस्वीरों से देखें' : 'Show me'}
                </button>
              )}
              <button onClick={() => { stop(); setAnswer(null) }}
                className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-700 text-mute" aria-label="close">
                <Pictogram name="cross" className="h-7 w-7" />
              </button>
            </div>
          </>)}
        </div>
      </div>
    )}

    {/* the mic itself */}
    <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="relative">
        {voice.state === 'recording' && (
          <span className="absolute inset-0 rounded-full bg-crit/40 animate-pulsering" />
        )}
        <button
          onPointerDown={(e) => { e.preventDefault(); if (voice.state === 'idle') { stop(); setAnswer(null); void voice.start() } }}
          onPointerUp={(e) => { e.preventDefault(); if (voice.state === 'recording') void voice.stop() }}
          onPointerLeave={() => { if (voice.state === 'recording') void voice.stop() }}
          disabled={voice.state === 'processing'}
          aria-label={lang === 'hi' ? 'दबाकर बोलिए' : 'Hold to talk'}
          className={`relative grid h-[84px] w-[84px] place-items-center rounded-full border-4 border-ink-900 transition-all
            ${voice.state === 'recording' ? 'scale-110 bg-crit text-white'
              : voice.state === 'processing' ? 'bg-ink-600 text-mute'
              : 'bg-cat text-ink-900 shadow-[0_10px_30px_-8px_rgba(255,205,17,0.9)] active:scale-95'}`}>
          {voice.state === 'processing'
            ? <span className="h-9 w-9 animate-spin rounded-full border-4 border-mute/30 border-t-mute" />
            : <Pictogram name="mic" className="h-11 w-11" />}
        </button>
      </div>
      <p className={`mt-1 text-center text-[11px] font-bold ${voice.state === 'recording' ? 'text-crit' : 'text-mute'}`}>
        {voice.state === 'recording' ? (lang === 'hi' ? 'बोलिए…' : 'Speak…')
          : voice.state === 'processing' ? (lang === 'hi' ? 'सुन रहा हूँ' : 'Thinking')
          : (lang === 'hi' ? 'दबाकर बोलें' : 'Hold & talk')}
      </p>
    </div>
  </>)
}

// ------------------------------------------------------------------ shell
export function SimpleShell({ children }: { children: React.ReactNode }) {
  const { machineId, selectMachine } = useSession()
  const { lang } = useLang()
  const navigate = useNavigate()
  const { playInline } = useVoiceOut()
  const [family, setFamily] = useState('excavator')
  const [answer, setAnswer] = useState<AskResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!machineId) return
    api.machine(machineId).then((d) => setFamily(d.machine.family)).catch(() => undefined)
  }, [machineId])

  const show = useCallback((result: AskResult) => {
    setError('')
    setAnswer(result)
    const text = result.reply.text[lang]
    void playInline(result.audio?.base64, result.speech_fallback_text ?? text, lang, 'answer')
    // "लोडर चुनो" - switch the machine and take the operator to it.
    const target = result.switched_machine
      ?? (result.route.intent === 'SWITCH_MACHINE' ? result.reply.data?.machine_id : null)
    if (target) void selectMachine(target).then(() => navigate('/machine/about'))
  }, [lang, navigate, playInline, selectMachine])

  const askIntent = useCallback(async (intent: string, label: string) => {
    setBusy(true)
    try {
      const result = await api.ask({
        machine_id: machineId ?? 'EXC001', intent, language: lang, speak: true, slow: true,
      })
      show({ ...result, transcript: label })
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }, [lang, machineId, show])

  return (
    <AnswerContext.Provider value={{ askIntent, show, busy }}>
      <div className="min-h-screen pb-44">
        <TopBar />
        <main className="mx-auto max-w-3xl px-4 pt-5">{children}</main>
        <VoiceDock machineId={machineId ?? 'EXC001'} answer={answer} setAnswer={setAnswer}
                   error={error} setError={setError} onResult={show} />
        <BottomNav family={family} />
      </div>
    </AnswerContext.Provider>
  )
}
