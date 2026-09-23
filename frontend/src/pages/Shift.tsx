import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSpeech } from '../lib/useSpeech'
import type { Briefing, Task } from '../lib/types'
import { Loading, ProgressBar, Spinner, Toast, tone } from '../components/ui'
import { MachineIcon } from '../components/MachineIcon'

const PRIORITY_TONE: Record<string, string> = { high: 'crit', medium: 'warn', low: 'info' }

function formatMinutes(total: number, lang: 'hi' | 'en'): string {
  const hours = Math.floor(total / 60)
  const minutes = Math.round(total % 60)
  if (hours && minutes) return lang === 'hi' ? `${hours} घं ${minutes} मि` : `${hours}h ${minutes}m`
  if (hours) return lang === 'hi' ? `${hours} घंटे` : `${hours}h`
  return lang === 'hi' ? `${minutes} मिनट` : `${minutes}m`
}

export default function Shift() {
  const { t, lang } = useLang()
  const navigate = useNavigate()
  const { speak, stop, speaking, speakingId } = useSpeech()

  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busyTask, setBusyTask] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    api.briefing().then(setBriefing).catch((e) => setError(String(e.message ?? e)))
  }, [])

  const machines = useMemo(() => {
    if (!briefing) return []
    const seen = new Map<string, Task['machine']>()
    briefing.tasks.forEach((task) => seen.set(task.machine.id, task.machine))
    return [...seen.values()]
  }, [briefing])

  async function setStatus(task: Task, status: Task['status']) {
    setBusyTask(task.id)
    try {
      const updated = await api.setTaskStatus(task.id, status)
      setBriefing((prev) =>
        prev ? { ...prev, tasks: prev.tasks.map((row) => (row.id === task.id ? updated : row)) } : prev,
      )
    } catch (e: any) {
      setToast(String(e.message ?? e))
    } finally {
      setBusyTask(null)
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="text-sm text-crit">{error}</p>
        <button className="btn-ghost mt-4" onClick={() => location.reload()}>{t('common.retry')}</button>
      </div>
    )
  }
  if (!briefing) return <Loading />

  const briefingText = briefing.text[lang]
  const operatorName = lang === 'hi' ? briefing.operator.name_hi : briefing.operator.name_en
  const shiftLabel = lang === 'hi' ? (briefing.operator.shift_hi ?? briefing.operator.shift) : briefing.operator.shift

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-7 sm:px-6">
      {/* ---------------- header ---------------- */}
      <div className="panel grain relative overflow-hidden">
        <div className="pointer-events-none absolute -right-10 -top-8 text-cat/[0.05]" aria-hidden="true">
          <MachineIcon family={machines[0]?.family ?? 'excavator'} className="h-56 w-56" />
        </div>

        <div className="relative z-10 flex flex-wrap items-start gap-6 p-6 sm:p-7">
          <div className="min-w-0 flex-1">
            <p className="label">{new Date().toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN',
              { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className={`mt-1.5 text-3xl font-extrabold tracking-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {lang === 'hi' ? `नमस्ते, ${operatorName}` : `Hello, ${operatorName}`}
            </h1>
            <p className="mt-1 text-sm text-mute">{shiftLabel} · {briefing.operator.site}</p>

            <div className="mt-5 flex flex-wrap items-center gap-6">
              <div>
                <div className="stat-value text-cat">{briefing.task_count}</div>
                <div className="label mt-0.5">{t('shift.tasks')}</div>
              </div>
              <div className="h-9 w-px bg-line-soft" />
              <div>
                <div className="stat-value text-slate-100">{formatMinutes(briefing.estimated_minutes, lang)}</div>
                <div className="label mt-0.5">{t('shift.estimated')}</div>
              </div>
              <div className="h-9 w-px bg-line-soft" />
              <div className="flex items-center gap-2.5">
                {machines.map((machine) => (
                  <div key={machine.id} className="flex items-center gap-2 rounded-xl border border-line bg-ink-700/60 px-3 py-2">
                    <MachineIcon family={machine.family} className="h-6 w-6 text-cat" />
                    <div className="leading-tight">
                      <div className="text-xs font-semibold text-slate-200">{machine.model}</div>
                      <div className="text-[10px] text-mute">{t('shift.machine')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* listen to the whole briefing */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => (speaking && speakingId === 'briefing' ? stop() : speak(briefingText, lang, 'briefing'))}
              className={`group relative grid h-[90px] w-[90px] place-items-center rounded-2xl transition-all
                ${speaking && speakingId === 'briefing'
                  ? 'bg-crit text-white shadow-[0_0_0_6px_rgba(255,90,95,0.16)]'
                  : 'bg-cat text-ink-900 hover:bg-cat-dark active:scale-95 shadow-[0_10px_30px_-12px_rgba(255,205,17,0.95)]'}`}
              aria-label={t('shift.listen')}
            >
              {speaking && speakingId === 'briefing' ? (
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4V5z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M18.5 5.5a9 9 0 0 1 0 13" />
                </svg>
              )}
            </button>
            <div className="text-center">
              <div className="text-xs font-bold text-slate-200">
                {speaking && speakingId === 'briefing' ? t('shift.stop') : t('shift.listen')}
              </div>
              <div className="max-w-[130px] text-[10px] leading-tight text-mute">{t('shift.listenHint')}</div>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2 border-t border-line-soft px-6 py-2.5">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-cat" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
          </svg>
          <p className="text-[11px] text-mute">{t('shift.assignedBy')}</p>
        </div>
      </div>

      {/* ---------------- tasks ---------------- */}
      <div className="mt-6 space-y-4">
        {briefing.tasks.map((task, index) => {
          const title = (lang === 'hi' ? task.hi.title : task.title_en) || task.title_en
          const instructions = (lang === 'hi' ? task.hi.instructions : task.instructions_en) || task.instructions_en
          const safety = (lang === 'hi' ? task.hi.safety_note : task.safety_note_en) || task.safety_note_en
          const location = (lang === 'hi' ? task.hi.location : task.location) || task.location
          const isOpen = expanded === task.id
          const priorityTone = tone(PRIORITY_TONE[task.priority] ?? 'info')
          const estimate = task.estimate
          const spoken = [title, `${t('shift.location')}: ${location}`, instructions, `${t('shift.safety')}: ${safety}`].join('। ')

          return (
            <article key={task.id}
                     className={`panel overflow-hidden transition-colors ${task.status === 'done' ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4 p-5">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl font-mono text-sm font-bold
                  ${task.status === 'done' ? 'bg-ok/15 text-ok' : 'bg-ink-600 text-cat'}`}>
                  {task.status === 'done' ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="3"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>
                  ) : index + 1}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide
                                      ${priorityTone.bg} ${priorityTone.text}`}>
                      {t(`common.${task.priority}` as never)}
                    </span>
                    <span className="rounded-full bg-ink-600 px-2 py-0.5 text-[10px] font-semibold text-mute">
                      {t(`common.${task.status}` as never)}
                    </span>
                    <span className="font-mono text-[11px] text-mute">{task.planned_start}</span>
                  </div>

                  <h3 className={`mt-2 text-[17px] font-bold leading-snug text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                    {title}
                  </h3>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-mute">
                    <span className="inline-flex items-center gap-1.5">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"
                           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
                      </svg>
                      {location}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MachineIcon family={task.machine.family} className="h-4 w-4" />
                      {task.machine.model}
                    </span>
                    {estimate && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-600/80 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                        ~{formatMinutes(estimate.expected_minutes, lang)}
                        <span className="text-mute">
                          ({formatMinutes(estimate.low_minutes, lang)}–{formatMinutes(estimate.high_minutes, lang)})
                        </span>
                      </span>
                    )}
                  </div>

                  {task.status === 'in_progress' && (
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-mute">
                        <span>{t('cockpit.progress')}</span>
                        <span className="font-mono">{Math.round(task.progress * 100)}%</span>
                      </div>
                      <ProgressBar value={task.progress * 100} tone="warn" />
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button
                    onClick={() => (speaking && speakingId === task.id ? stop() : speak(spoken, lang, task.id))}
                    className="btn-ghost h-9 w-9 !px-0"
                    aria-label={t('shift.listen')}
                  >
                    {speaking && speakingId === task.id ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-crit" fill="currentColor" aria-hidden="true">
                        <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"
                           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />
                      </svg>
                    )}
                  </button>
                  <button onClick={() => setExpanded(isOpen ? null : task.id)} className="btn-quiet h-9 w-9 !px-0"
                          aria-expanded={isOpen} aria-label="details">
                    <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                         fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                         aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="animate-risein space-y-4 border-t border-line-soft bg-ink-900/40 px-5 py-4">
                  <div>
                    <p className="label mb-1.5">{t('shift.instructions')}</p>
                    <p className={`text-sm leading-relaxed text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>
                      {instructions}
                    </p>
                  </div>
                  <div className="rounded-xl border border-warn/30 bg-warn/[0.07] p-3.5">
                    <p className="label mb-1.5 !text-warn">⚠ {t('shift.safety')}</p>
                    <p className={`text-sm leading-relaxed text-warn/90 ${lang === 'hi' ? 'lang-hi' : ''}`}>{safety}</p>
                  </div>

                  {estimate && estimate.factors.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {estimate.factors.map((factor) => (
                        <span key={factor.label_en} className="chip !text-[11px]">
                          {lang === 'hi' ? factor.label_hi : factor.label_en}
                          <span className={factor.effect_pct > 0 ? 'text-crit' : 'text-ok'}>
                            {factor.effect_pct > 0 ? '+' : ''}{factor.effect_pct}%
                          </span>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    {task.status !== 'in_progress' && task.status !== 'done' && (
                      <button className="btn-primary" disabled={busyTask === task.id}
                              onClick={() => setStatus(task, 'in_progress')}>
                        {busyTask === task.id && <Spinner />}{t('shift.start')}
                      </button>
                    )}
                    {task.status === 'in_progress' && (
                      <button className="btn-ghost" disabled={busyTask === task.id}
                              onClick={() => setStatus(task, 'done')}>
                        {busyTask === task.id && <Spinner />}{t('shift.complete')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>

      <div className="sticky bottom-4 mt-7">
        <button onClick={() => navigate('/pro/machines')} className="btn-primary w-full py-3.5 text-base shadow-glow">
          {t('shift.continue')}
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  )
}
