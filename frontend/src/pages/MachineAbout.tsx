import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import type { MachineAbout as About } from '../lib/types'
import { MachineIcon } from '../components/MachineIcon'
import { Pictogram } from '../components/Pictogram'
import { PageHeader, SpeakButton } from '../components/Simple'

const GUIDE_COLOR: Record<string, string> = {
  amber: 'bg-cat/15 text-cat border-cat/40', green: 'bg-ok/15 text-ok border-ok/40',
  blue: 'bg-sky-400/15 text-sky-300 border-sky-400/40', red: 'bg-crit/15 text-crit border-crit/40',
}

/**
 * Everything about a machine, before the operator touches it.
 *
 * The page reads itself aloud top to bottom and lights up the part it is
 * reading, so someone who cannot read still follows along with their eyes.
 * Any part can be heard again on its own; the video plays on a tap.
 */
export default function MachineAbout() {
  const { lang } = useLang()
  const navigate = useNavigate()
  const { machineId } = useSession()
  const { speak, stop, speakingId } = useVoiceOut()
  const [about, setAbout] = useState<About | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [video, setVideo] = useState(false)
  const runRef = useRef(0)
  const refs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    if (!machineId) { navigate('/machine', { replace: true }); return }
    api.machineAbout(machineId).then(setAbout).catch(() => navigate('/machine', { replace: true }))
    return () => { runRef.current++; stop() }
  }, [machineId, navigate, stop])

  const textOf = useCallback((section: About['sections'][number]) => (lang === 'hi' ? section.speech_hi : section.en), [lang])

  const readAll = useCallback(async () => {
    if (!about) return
    const run = ++runRef.current
    setReading(true)
    for (const section of about.sections) {
      if (run !== runRef.current) return
      setActive(section.id)
      refs.current[section.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await speak(textOf(section), lang, `about-${section.id}`, true)
    }
    if (run === runRef.current) { setActive(null); setReading(false) }
  }, [about, lang, speak, textOf])

  const readOne = (id: string) => {
    if (!about) return
    runRef.current++
    setReading(false)
    const section = about.sections.find((s) => s.id === id)
    if (!section) return
    if (speakingId === `about-${id}`) { stop(); setActive(null); return }
    setActive(id)
    void speak(textOf(section), lang, `about-${id}`, true).then(() => setActive((a) => (a === id ? null : a)))
  }

  const stopAll = () => { runRef.current++; stop(); setActive(null); setReading(false) }

  // Read the whole page as soon as it opens.
  useEffect(() => {
    if (!about) return
    const timer = window.setTimeout(() => void readAll(), 500)
    return () => window.clearTimeout(timer)
  }, [about]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!about) return <div className="h-72 animate-pulse rounded-3xl bg-ink-800" />

  const ring = (id: string) => (active === id ? 'ring-4 ring-cat shadow-glow' : 'ring-0')
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)

  return (
    <div className="space-y-5">
      <PageHeader icon={<MachineIcon family={about.machine.family} className="h-10 w-12" />}
        title={t(about.machine.short_hi, about.machine.model)}
        onReplay={() => (reading ? stopAll() : void readAll())} speaking={reading} />

      <button onClick={() => (reading ? stopAll() : void readAll())}
        className={`flex h-24 w-full items-center gap-5 rounded-[28px] px-6 text-left transition-all active:scale-[0.98]
          ${reading ? 'bg-crit text-white' : 'bg-cat text-ink-900 shadow-[0_12px_32px_-12px_rgba(255,205,17,0.9)]'}`}>
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-black/10">
          <Pictogram name={reading ? 'pause' : 'speaker'} className="h-10 w-10" />
        </span>
        <span className={`text-[26px] font-extrabold ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {reading ? t('रोकें', 'Stop') : t('मशीन के बारे में सुनें', 'Hear about this machine')}
        </span>
      </button>

      {/* ---------------- what it is ---------------- */}
      <section ref={(el) => { refs.current.summary = el }}
        className={`rounded-[28px] border-2 border-line bg-ink-800 p-5 transition-all ${ring('summary')}`}>
        <div className="flex items-start gap-4">
          <div className="grid h-24 w-28 shrink-0 place-items-center rounded-3xl bg-cat/10 text-cat">
            <MachineIcon family={about.machine.family} className="h-16 w-20" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xl font-extrabold leading-snug text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(about.identify_hi, about.identify_en)}</p>
          </div>
          <SpeakButton onClick={() => readOne('summary')} active={speakingId === 'about-summary'} />
        </div>
        <p className={`mt-3 text-lg leading-relaxed text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(about.summary_hi, about.summary_en)}</p>
      </section>

      {/* ---------------- parts ---------------- */}
      <section ref={(el) => { refs.current.parts = el }}
        className={`rounded-[28px] border-2 border-line bg-ink-800 p-5 transition-all ${ring('parts')}`}>
        <div className="mb-4 flex items-center gap-3">
          <Pictogram name="gear" className="h-9 w-9 text-cat" />
          <h2 className={`flex-1 text-[22px] font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('मुख्य हिस्से', 'Main parts')}</h2>
          <SpeakButton onClick={() => readOne('parts')} active={speakingId === 'about-parts'} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {about.parts.map((part) => (
            <div key={part.name_en} className="flex flex-col items-center gap-2 rounded-3xl bg-ink-900/60 p-4 text-center">
              <Pictogram name={part.icon} className="h-16 w-16 text-cat" />
              <span className={`text-lg font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(part.name_hi, part.name_en)}</span>
              <span className={`text-sm leading-snug text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(part.what_hi, part.what_en)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- safety ---------------- */}
      <section ref={(el) => { refs.current.safety = el }}
        className={`rounded-[28px] border-2 border-crit/50 bg-crit/[0.08] p-5 transition-all ${ring('safety')}`}>
        <div className="mb-4 flex items-center gap-3">
          <Pictogram name="alert" className="h-9 w-9 text-crit" />
          <h2 className={`flex-1 text-[22px] font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('सुरक्षा के नियम', 'Safety rules')}</h2>
          <SpeakButton onClick={() => readOne('safety')} active={speakingId === 'about-safety'} />
        </div>
        <ol className="space-y-3">
          {about.safety.map((rule, i) => (
            <li key={rule.en} className="flex items-start gap-3 rounded-2xl bg-ink-900/60 p-3">
              <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-crit/15 text-crit">
                <Pictogram name={rule.icon} className="h-10 w-10" />
                <span className="absolute -left-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-crit text-sm font-extrabold text-white">{i + 1}</span>
              </span>
              <span className={`pt-1 text-lg leading-snug text-slate-100 ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(rule.hi, rule.en)}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- video ---------------- */}
      <section className="overflow-hidden rounded-[28px] border-2 border-line bg-ink-800">
        <div className="relative aspect-video w-full bg-black">
          {video ? (
            <iframe className="absolute inset-0 h-full w-full" title={about.video.title}
              src={`https://www.youtube-nocookie.com/embed/${about.video.youtube_id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&cc_load_policy=1&cc_lang_pref=${lang}&hl=${lang}`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          ) : (
            <button onClick={() => { stopAll(); setVideo(true) }} className="group absolute inset-0" aria-label="play video">
              <img src={`https://i.ytimg.com/vi/${about.video.youtube_id}/hqdefault.jpg`} alt=""
                className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" />
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid h-24 w-24 place-items-center rounded-full bg-crit text-white shadow-[0_10px_40px_rgba(0,0,0,0.6)] transition-transform group-active:scale-95">
                  <Pictogram name="play" className="ml-1 h-14 w-14" />
                </span>
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 p-4">
          <Pictogram name="play" className="h-8 w-8 shrink-0 text-crit" />
          <div className="min-w-0 flex-1">
            <p className={`text-lg font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('वीडियो देखें', 'Watch the video')}</p>
            <p className={`text-sm text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(about.video.about_hi, about.video.about_en)}</p>
          </div>
        </div>
      </section>

      {/* ---------------- guides ---------------- */}
      <section ref={(el) => { refs.current.guides = el }} className={`rounded-[28px] transition-all ${ring('guides')}`}>
        <div className="mb-3 flex items-center gap-3 px-1">
          <Pictogram name="book" className="h-9 w-9 text-cat" />
          <h2 className={`flex-1 text-[22px] font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('चलाना सीखें', 'Learn to operate')}</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {about.guides.map((g) => (
            <button key={g.id} onClick={() => navigate(`/guide/${g.id}`)}
              className={`flex flex-col items-center gap-2 rounded-[24px] border-2 p-4 text-center transition-all active:scale-95 ${GUIDE_COLOR[g.color] ?? GUIDE_COLOR.amber}`}>
              <Pictogram name={g.icon} className="h-16 w-16" />
              <span className={`text-base font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(g.title_hi, g.title_en)}</span>
            </button>
          ))}
        </div>
      </section>

      <button onClick={() => { stopAll(); navigate('/machine') }}
        className="flex h-24 w-full items-center justify-center gap-4 rounded-[28px] bg-ok text-ink-900 shadow-[0_12px_32px_-12px_rgba(61,214,140,0.9)] active:scale-[0.98]">
        <Pictogram name="help" className="h-12 w-12" />
        <span className={`text-[24px] font-extrabold ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('आगे: मशीन से पूछें', 'Next: ask the machine')}</span>
        <Pictogram name="next" className="h-10 w-10" />
      </button>
    </div>
  )
}
