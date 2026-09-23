import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import type { Instructor, TrainingModule } from '../lib/types'
import { Loading, Panel, ProgressBar, Spinner, Toast } from '../components/ui'

const FORMAT_ICON: Record<string, JSX.Element> = {
  video: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 11 6-4v10l-6-4z" />
    </svg>
  ),
  simulation: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="12" rx="4" /><path d="M7 11v4M5 13h4M16 12h.01M19 15h.01" />
    </svg>
  ),
}

export default function Training() {
  const { t, lang } = useLang()
  const { machineId } = useSession()

  const [data, setData] = useState<{
    modules: TrainingModule[]
    instructors: Instructor[]
    bookings: any[]
    skill_scores: Record<string, number>
  } | null>(null)
  const [toast, setToast] = useState('')
  const [booking, setBooking] = useState<string | null>(null)

  const load = useCallback(() => {
    api.training(machineId ?? undefined).then(setData).catch((e) => setToast(String(e.message ?? e)))
  }, [machineId])

  useEffect(load, [load])

  async function book(instructor: Instructor, slot: string) {
    setBooking(`${instructor.id}-${slot}`)
    try {
      const res = await api.book(instructor.id, slot)
      setToast(res.confirmation[lang])
      load()
    } catch (e: any) {
      setToast(String(e.message ?? e))
    } finally {
      setBooking(null)
    }
  }

  if (!data) return <Loading />

  const bookedSlots = new Set(data.bookings.map((b) => `${b.instructor_id}-${b.slot}`))

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <h1 className={`text-2xl font-extrabold tracking-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
        {t('training.title')}
      </h1>
      <p className="mt-1 text-sm text-mute">
        {lang === 'hi'
          ? 'आपके काम और मशीन के हिसाब से चुने गए मॉड्यूल'
          : 'Modules picked for your machine and the gaps in your record'}
      </p>

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {data.modules.map((module) => (
              <article key={module.id}
                       className="panel group overflow-hidden transition-all hover:-translate-y-0.5 hover:border-cat/40">
                <div
                  className="relative h-24 overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, hsl(${module.thumbnail_hue} 55% 22%), hsl(${module.thumbnail_hue + 28} 45% 13%))`,
                  }}
                >
                  <div className="absolute inset-0 opacity-[0.16]"
                       style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 9px)' }} />
                  <div className="absolute bottom-2.5 left-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
                      {FORMAT_ICON[module.format] ?? FORMAT_ICON.video}
                      {module.duration_min} {t('training.minutes')}
                    </span>
                    <span className="rounded-full bg-black/45 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80 backdrop-blur">
                      {module.level}
                    </span>
                  </div>
                  {module.recommended && (
                    <span className="absolute right-2.5 top-2.5 rounded-full bg-cat px-2 py-0.5 text-[10px] font-bold text-ink-900">
                      {t('training.recommended')}
                    </span>
                  )}
                </div>

                <div className="p-4">
                  <h3 className={`text-[14px] font-bold leading-snug text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                    {lang === 'hi' ? module.title_hi : module.title_en}
                  </h3>
                  <p className={`mt-1.5 text-xs leading-relaxed text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
                    {lang === 'hi' ? module.summary_hi : module.summary_en}
                  </p>
                  <button className="btn-ghost mt-3.5 w-full !py-2 text-xs group-hover:border-cat/50">
                    {module.format === 'simulation'
                      ? (lang === 'hi' ? 'सिम्युलेटर खोलें' : 'Open simulator')
                      : (lang === 'hi' ? 'वीडियो देखें' : 'Watch video')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <Panel title={t('training.skills')}>
            <div className="space-y-3.5">
              {Object.entries(data.skill_scores).map(([family, score]) => (
                <div key={family}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize text-slate-300">{family}</span>
                    <span className="font-mono text-mute">{Math.round(score * 100)}%</span>
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar value={score * 100} tone={score >= 0.75 ? 'ok' : score >= 0.5 ? 'warn' : 'crit'} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={t('training.instructors')}>
            <div className="space-y-4">
              {data.instructors.map((instructor) => (
                <div key={instructor.id} className="rounded-xl border border-line-soft bg-ink-800/50 p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-600 text-[11px] font-bold text-cat">
                      {instructor.name_en.split(' ').map((p) => p[0]).join('')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h4 className="truncate text-sm font-semibold text-slate-100">
                          {lang === 'hi' ? instructor.name_hi : instructor.name_en}
                        </h4>
                        <span className="shrink-0 font-mono text-[10px] text-cat">★ {instructor.rating}</span>
                      </div>
                      <p className={`mt-0.5 text-[11px] leading-snug text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
                        {lang === 'hi' ? instructor.expertise_hi : instructor.expertise_en}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {instructor.slots.map((slot) => {
                      const key = `${instructor.id}-${slot}`
                      const taken = bookedSlots.has(key)
                      return (
                        <button
                          key={slot}
                          disabled={taken || booking === key}
                          onClick={() => book(instructor, slot)}
                          className={`chip !text-[11px] ${taken ? '!border-ok/40 !text-ok' : ''}`}
                        >
                          {booking === key && <Spinner className="h-3 w-3" />}
                          {slot}
                          {taken && ' ✓'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  )
}
