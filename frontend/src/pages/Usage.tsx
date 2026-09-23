import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import type { Signal, Signals } from '../lib/types'
import { MachineIcon } from '../components/MachineIcon'
import { Pictogram } from '../components/Pictogram'
import { PageHeader } from '../components/Simple'

const LOOK = {
  danger: { card: 'border-crit bg-crit/15', icon: 'text-crit', dot: 'bg-crit' },
  warn: { card: 'border-cat/60 bg-cat/10', icon: 'text-cat', dot: 'bg-cat' },
  ok: { card: 'border-ok/40 bg-ok/10', icon: 'text-ok', dot: 'bg-ok' },
} as const

/**
 * The operator's usage dashboard: what every small ML model says about them
 * and their machine right now, one picture card each. Red first. Tap a card to
 * hear it. The model behind each card is named in small print, for whoever
 * asks where the number came from.
 */
export default function Usage() {
  const { lang } = useLang()
  const { machineId } = useSession()
  const { speak, stop, speakingId } = useVoiceOut()
  const [data, setData] = useState<Signals | null>(null)
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)

  useEffect(() => {
    api.signals(machineId ?? 'EXC001').then(setData).catch(() => undefined)
  }, [machineId])

  const intro = useCallback(() => {
    if (!data) return
    void speak(`${t('यह आपकी मशीन की रिपोर्ट है।', 'This is your machine report.')} ${data.headline[lang]}`, lang, 'intro-usage', true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lang, speak])

  // Speak the headline once the report has arrived.
  useEffect(() => {
    if (!data) return
    const timer = window.setTimeout(intro, 450)
    return () => window.clearTimeout(timer)
  }, [data, intro])

  const hear = (s: Signal) => {
    if (speakingId === `signal-${s.key}`) { stop(); return }
    void speak(s.say[lang], lang, `signal-${s.key}`, true)
  }

  if (!data) {
    return <div className="grid min-h-[50vh] place-items-center"><span className="h-12 w-12 animate-spin rounded-full border-4 border-ink-600 border-t-cat" /></div>
  }

  const danger = data.signals.filter((s) => s.level === 'danger').length
  const ring = data.score >= 80 ? 'text-ok' : data.score >= 60 ? 'text-cat' : 'text-crit'

  return (
    <div className="space-y-5 pb-4">
      <PageHeader icon={<Pictogram name="chart" className="h-10 w-10" />} title={t('मशीन रिपोर्ट', 'Machine report')}
        onReplay={intro} speaking={speakingId === 'intro-usage'} />

      {/* who, which machine, and one number */}
      <section className="flex items-center gap-4 rounded-[28px] border-2 border-line bg-ink-800 p-4">
        <div className="relative grid h-24 w-24 shrink-0 place-items-center">
          <svg viewBox="0 0 36 36" className={`absolute inset-0 h-full w-full -rotate-90 ${ring}`}>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3.5" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
              strokeDasharray={`${(data.score / 100) * 97.4} 97.4`} />
          </svg>
          <span className={`font-mono text-3xl font-bold ${ring}`}>{data.score}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {data.operator && (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cat text-sm font-extrabold text-ink-900">{data.operator.avatar_initials}</span>
            )}
            <span className={`truncate text-lg font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {data.operator ? t(data.operator.name_hi, data.operator.name_en) : ''}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-mute">
            <MachineIcon family={data.machine.family} className="h-5 w-6 text-cat" />
            <span className={lang === 'hi' ? 'lang-hi' : ''}>{t(data.machine.name_hi, data.machine.name_en)}</span>
          </div>
          <p className={`mt-2 text-lg font-bold leading-snug ${danger ? 'text-crit' : 'text-slate-100'} ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {data.headline[lang]}
          </p>
        </div>
      </section>

      {/* one card per model signal, red first */}
      <div className="grid grid-cols-2 gap-3">
        {data.signals.map((s) => {
          const look = LOOK[s.level]
          const speaking = speakingId === `signal-${s.key}`
          return (
            <button key={s.key} onClick={() => hear(s)}
              className={`relative flex flex-col items-start gap-2 rounded-3xl border-2 p-4 text-left transition-transform active:scale-[0.97]
                ${look.card} ${speaking ? 'ring-4 ring-cat' : ''}`}>
              <div className="flex w-full items-start justify-between">
                <Pictogram name={s.icon} className={`h-12 w-12 ${look.icon}`} />
                <Pictogram name={speaking ? 'pause' : 'speaker'} className="h-6 w-6 text-mute" />
              </div>
              <span className={`text-base font-bold text-slate-200 ${lang === 'hi' ? 'lang-hi leading-tight' : ''}`}>{s.title[lang]}</span>
              <span className={`text-xl font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{s.value[lang]}</span>
              <span className="mt-auto flex items-center gap-1.5 text-[11px] font-semibold text-mute">
                <span className={`h-2 w-2 rounded-full ${look.dot}`} />{s.model.name}
              </span>
            </button>
          )
        })}
      </div>

      {/* the models behind the cards */}
      <section className="rounded-3xl border border-line bg-ink-800/60 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-200">
          <Pictogram name="chart" className="h-5 w-5 text-cat" />{t('ये कार्ड इन मॉडलों से बने हैं', 'Models behind these cards')}
        </div>
        <ul className="space-y-1.5">
          {data.models.map((m) => (
            <li key={m.name} className="text-xs leading-snug text-mute">
              <span className="font-bold text-slate-300">{m.name}</span> · {m.arch}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
