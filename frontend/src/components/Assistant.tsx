import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSpeech } from '../lib/useSpeech'
import { useVoice } from '../lib/useVoice'
import type { AskResult, Suggestion } from '../lib/types'
import { MicButton } from './MicButton'
import { Spinner, tone } from './ui'

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  result?: AskResult
}

const STAGE_LABEL: Record<string, { hi: string; en: string; tint: string }> = {
  quick_action: { hi: 'बटन', en: 'Quick action', tint: 'text-sky-300' },
  rules: { hi: 'नियम', en: 'Rules', tint: 'text-ok' },
  embeddings: { hi: 'अर्थ-मिलान', en: 'Embeddings', tint: 'text-cat' },
  classifier: { hi: 'वर्गीकारक', en: 'Classifier', tint: 'text-violet-300' },
  fallback: { hi: 'स्पष्ट करें', en: 'Clarify', tint: 'text-warn' },
}

/** The "how this was answered" strip - routing made visible instead of magic. */
function RouteBadge({ result, open, onToggle }: { result: AskResult; open: boolean; onToggle: () => void }) {
  const { lang } = useLang()
  const stage = STAGE_LABEL[result.route.stage] ?? STAGE_LABEL.fallback
  const timings = result.timings

  return (
    <div className="mt-2.5">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg bg-ink-900/50 px-2.5 py-1.5 text-left transition-colors hover:bg-ink-900/80"
        aria-expanded={open}
      >
        <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${stage.tint}`}>
          {lang === 'hi' ? stage.hi : stage.en}
        </span>
        <span className="truncate font-mono text-[10px] text-mute">{result.route.intent}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-mute">
          {result.route.total_ms.toFixed(1)}ms
          {timings?.stt_ms ? ` · stt ${Math.round(timings.stt_ms)}` : ''}
          {timings?.tts_ms ? ` · tts ${Math.round(timings.tts_ms)}` : ''}
        </span>
        <svg viewBox="0 0 24 24" className={`h-3 w-3 shrink-0 text-mute transition-transform ${open ? 'rotate-180' : ''}`}
             fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <ol className="animate-risein mt-1.5 space-y-1 rounded-lg bg-ink-900/60 p-2.5">
          {result.route.trace.map((step, index) => (
            <li key={`${step.stage}-${index}`} className="flex items-start gap-2 font-mono text-[10px] leading-relaxed">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${step.accepted ? 'bg-ok' : 'bg-ink-500'}`} />
              <span className="w-24 shrink-0 text-slate-400">{step.stage}</span>
              <span className="min-w-0 flex-1 text-mute">{step.detail || step.intent || '—'}</span>
              <span className="shrink-0 text-mute/70">{step.ms ? `${step.ms.toFixed(1)}ms` : ''}</span>
            </li>
          ))}
          {result.route.normalized !== result.route.text && (
            <li className="border-t border-line-soft pt-1.5 font-mono text-[10px] text-mute">
              normalised: “{result.route.normalized}”
            </li>
          )}
        </ol>
      )}
    </div>
  )
}

function Bubble({ turn, onSpeak, speakingId }: {
  turn: Turn
  onSpeak: (turn: Turn) => void
  speakingId: string | null
}) {
  const { lang } = useLang()
  const [traceOpen, setTraceOpen] = useState(false)

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className={`max-w-[88%] rounded-2xl rounded-br-md bg-cat/[0.14] px-3.5 py-2.5 text-[14px]
                         text-slate-100 ring-1 ring-cat/20 ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {turn.text}
        </div>
      </div>
    )
  }

  const severity = turn.result?.reply.severity ?? 'ok'
  const shade = tone(severity)
  const unsupported = turn.result?.route.unsupported_on_machine

  return (
    <div className="flex justify-start">
      <div className={`w-full max-w-[94%] rounded-2xl rounded-bl-md border bg-ink-700/55 px-3.5 py-3
        ${severity === 'crit' ? 'border-crit/40' : severity === 'warn' ? 'border-warn/30' : 'border-line-soft'}`}>
        <div className="flex items-start gap-2.5">
          {severity !== 'ok' && (
            <span className={`mt-0.5 shrink-0 ${shade.text}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </span>
          )}
          <p className={`min-w-0 flex-1 text-[14px] leading-relaxed text-slate-100 ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {turn.text}
          </p>
          <button
            onClick={() => onSpeak(turn)}
            className={`shrink-0 rounded-lg p-1.5 transition-colors ${
              speakingId === turn.id ? 'bg-crit/20 text-crit' : 'text-mute hover:bg-ink-600 hover:text-slate-200'}`}
            aria-label="play"
          >
            {speakingId === turn.id ? (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />
              </svg>
            )}
          </button>
        </div>

        {unsupported && (
          <p className="mt-2 rounded-lg bg-ink-900/60 px-2.5 py-1.5 text-[11px] text-mute">
            {lang === 'hi' ? 'यह सेंसर इस मशीन पर मौजूद नहीं है' : 'This machine does not expose that sensor'}
          </p>
        )}

        {turn.result && <RouteBadge result={turn.result} open={traceOpen} onToggle={() => setTraceOpen((v) => !v)} />}
      </div>
    </div>
  )
}

export function Assistant({
  machineId, suggestions, onMachineSwitch, onDataChanged,
}: {
  machineId: string
  suggestions: Suggestion[]
  onMachineSwitch?: (machineId: string) => void
  onDataChanged?: () => void
}) {
  const { t, lang } = useLang()
  const { playInline, speak, stop, speakingId } = useSpeech()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy])

  // Switching machine resets the conversation: the context it referred to is gone.
  useEffect(() => { setTurns([]) }, [machineId])

  const handleResult = useCallback((result: AskResult, spokenQuestion?: string) => {
    const stamp = Date.now()
    const question = spokenQuestion ?? result.transcript ?? result.route.text
    const answer = result.reply.text[lang] ?? result.reply.text.hi

    setTurns((prev) => [
      ...prev,
      ...(question ? [{ id: `u${stamp}`, role: 'user' as const, text: question }] : []),
      { id: `a${stamp}`, role: 'assistant' as const, text: answer, result },
    ])

    if (result.audio?.base64 || result.speech_fallback_text) {
      void playInline(result.audio?.base64, result.speech_fallback_text ?? answer, lang, `a${stamp}`)
    }
    if (result.switched_machine && onMachineSwitch) onMachineSwitch(result.switched_machine)
    onDataChanged?.()
  }, [lang, onDataChanged, onMachineSwitch, playInline])

  const voice = useVoice({
    machineId,
    lang,
    speak: true,
    onResult: (result) => handleResult(result),
    onError: setError,
  })

  const ask = useCallback(async (body: { text?: string; intent?: string }, display: string) => {
    setBusy(true)
    setError('')
    try {
      const result = await api.ask({ machine_id: machineId, language: lang, speak: true, ...body })
      handleResult(result, display)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }, [handleResult, lang, machineId])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    void ask({ text }, text)
  }

  const micLabel = voice.state === 'recording' ? t('cockpit.releaseToSend')
    : voice.state === 'processing' ? t('cockpit.thinking')
    : t('cockpit.holdToTalk')

  return (
    <section className="panel flex h-full min-h-0 flex-col">
      <header className="panel-head">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </span>
          {t('cockpit.assistant')}
        </h2>
        {turns.length > 0 && (
          <button onClick={() => { stop(); setTurns([]) }} className="btn-quiet px-2 py-1 text-[11px]">
            {lang === 'hi' ? 'साफ़ करें' : 'Clear'}
          </button>
        )}
      </header>

      {/* conversation */}
      <div ref={scrollRef} className="scroll-fade min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-700 text-cat">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M8 9h8M8 13h5" />
              </svg>
            </div>
            <p className={`max-w-[240px] text-sm text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {t('cockpit.emptyChat')}
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <Bubble
            key={turn.id}
            turn={turn}
            speakingId={speakingId}
            onSpeak={(item) =>
              speakingId === item.id ? stop() : void speak(item.result?.reply.speech[lang] ?? item.text, lang, item.id)
            }
          />
        ))}

        {(busy || voice.state === 'processing') && (
          <div className="flex items-center gap-2 px-1 text-xs text-mute">
            <Spinner className="h-3.5 w-3.5" />
            {t('cockpit.thinking')}
          </div>
        )}
        {voice.state === 'recording' && (
          <div className="flex items-center gap-2 px-1 text-xs text-crit">
            <span className="h-2 w-2 animate-pulse rounded-full bg-crit" />
            {t('cockpit.listening')}
          </div>
        )}
      </div>

      {/* quick questions */}
      {suggestions.length > 0 && (
        <div className="border-t border-line-soft px-4 py-3">
          <p className="label mb-2">{t('cockpit.quickAsk')}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => {
              const label = lang === 'hi' ? suggestion.label_hi : suggestion.label_en
              return (
                <button
                  key={suggestion.id}
                  disabled={busy}
                  onClick={() => ask({ intent: suggestion.intent }, label)}
                  className={`chip ${lang === 'hi' ? 'lang-hi' : ''}`}
                  title={suggestion.intent}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* input row */}
      <form onSubmit={submit} className="flex items-end gap-3 border-t border-line-soft p-4">
        <div className="min-w-0 flex-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('cockpit.askPlaceholder')}
            className={`field py-2.5 text-sm ${lang === 'hi' ? 'lang-hi' : ''}`}
            disabled={voice.state !== 'idle'}
          />
          {error && <p className="mt-1.5 text-[11px] leading-snug text-crit">{error}</p>}
          {voice.usingBrowserStt && !error && (
            <p className="mt-1.5 text-[11px] text-mute">
              {lang === 'hi' ? 'ब्राउज़र पहचान इस्तेमाल हो रही है' : 'Using browser speech recognition'}
            </p>
          )}
        </div>

        {input.trim() ? (
          <button type="submit" disabled={busy} className="btn-primary h-11 px-4">
            {t('cockpit.send')}
          </button>
        ) : (
          <MicButton state={voice.state} onStart={voice.start} onStop={voice.stop} size="md" label={micLabel} />
        )}
      </form>
    </section>
  )
}
