import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import type { MachineAbout as About } from '../lib/types'
import { MachineIcon } from '../components/MachineIcon'
import { Pictogram } from '../components/Pictogram'
import { VideoOverlay } from '../components/VideoOverlay'

type Step = 'safety' | 'summary' | 'parts' | 'video'
const STEPS: Step[] = ['safety', 'summary', 'parts', 'video']

/**
 * Getting to know a machine, one topic per screen - the same pattern as the
 * picture guides. Safety comes first. Each screen reads itself aloud; a big
 * green button moves on.
 */
export default function MachineAbout() {
  const { lang } = useLang()
  const navigate = useNavigate()
  const { machineId } = useSession()
  const { speak, stop, speakingId } = useVoiceOut()
  const [about, setAbout] = useState<About | null>(null)
  const [index, setIndex] = useState(0)
  const [video, setVideo] = useState(false)
  const runRef = useRef(0)

  useEffect(() => {
    if (!machineId) { navigate('/machine', { replace: true }); return }
    api.machineAbout(machineId).then(setAbout).catch(() => navigate('/machine', { replace: true }))
    return () => stop()
  }, [machineId, navigate, stop])

  const step = STEPS[index]
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)

  const textFor = useCallback((s: Step): string => {
    if (!about) return ''
    const section = about.sections.find((x) => x.id === s)
    if (!section) return ''
    return lang === 'hi' ? section.speech_hi : section.en
  }, [about, lang])

  useEffect(() => {
    if (!about) return
    const run = ++runRef.current
    const timer = window.setTimeout(() => { if (run === runRef.current) void speak(textFor(step), lang, `about-${step}`, true) }, 350)
    return () => window.clearTimeout(timer)
  }, [about, step, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!about) return <div className="h-72 animate-pulse rounded-3xl bg-ink-800" />

  const last = index === STEPS.length - 1
  const next = () => { stop(); if (last) navigate('/machine'); else setIndex(index + 1) }
  const speaking = speakingId === `about-${step}`
  const titles: Record<Step, [string, string]> = {
    safety: ['सबसे पहले सुरक्षा', 'Safety first'], summary: ['यह कौन सी मशीन है', 'What this machine is'],
    parts: ['मुख्य हिस्से', 'Main parts'], video: ['मशीन चलाना देखें', 'Watch how to operate'],
  }

  return (
    <div className="flex min-h-[calc(100vh-15rem)] flex-col">
      {/* progress */}
      <div className="mb-4 flex gap-2">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => { stop(); setIndex(i) }} aria-label={s}
            className={`h-3 flex-1 rounded-full ${i < index ? 'bg-ok' : i === index ? (s === 'safety' ? 'bg-crit' : 'bg-cat') : 'bg-ink-600'}`} />
        ))}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <MachineIcon family={about.machine.family} className="h-9 w-11 text-cat" />
        <h1 className={`flex-1 text-[26px] font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(...titles[step])}</h1>
      </div>

      {/* one topic */}
      <div className={`flex-1 rounded-[32px] border-2 p-5 animate-risein
        ${step === 'safety' ? 'border-crit/70 bg-crit/[0.08]' : 'border-line bg-ink-800'}`} key={step}>
        {step === 'safety' && (
          <ol className="space-y-3">
            {about.safety.map((rule, i) => (
              <li key={rule.en} className="flex items-center gap-3">
                <span className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-crit/15 text-crit">
                  <Pictogram name={rule.icon} className="h-11 w-11" />
                  <span className="absolute -left-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-crit text-sm font-extrabold text-white">{i + 1}</span>
                </span>
                <span className={`text-lg leading-snug text-slate-100 ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(rule.hi, rule.en)}</span>
              </li>
            ))}
          </ol>
        )}
        {step === 'summary' && (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <MachineIcon family={about.machine.family} className="h-40 w-48 animate-bob text-cat" />
            <p className={`text-[22px] font-bold leading-snug text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(about.identify_hi, about.identify_en)}</p>
          </div>
        )}
        {step === 'parts' && (
          <div className="grid grid-cols-2 gap-3">
            {about.parts.map((part) => (
              <div key={part.name_en} className="flex flex-col items-center gap-2 rounded-3xl bg-ink-900/60 p-4 text-center">
                <Pictogram name={part.icon} className="h-16 w-16 text-cat" />
                <span className={`text-lg font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(part.name_hi, part.name_en)}</span>
              </div>
            ))}
          </div>
        )}
        {step === 'video' && (
          <button onClick={() => { stop(); setVideo(true) }} className="group relative block w-full overflow-hidden rounded-3xl bg-black">
            <span className="grid aspect-video w-full place-items-center bg-gradient-to-b from-cat/20 to-ink-900">
              <MachineIcon family={about.machine.family} className="h-32 w-40 text-cat/60" />
            </span>
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-28 w-28 place-items-center rounded-full bg-crit text-white shadow-[0_10px_40px_rgba(0,0,0,0.6)] group-active:scale-95">
                <Pictogram name="play" className="ml-1 h-16 w-16" />
              </span>
            </span>
          </button>
        )}
      </div>

      {/* controls */}
      <div className="mt-4 grid grid-cols-[1fr_1.8fr] gap-3">
        <button onClick={() => (speaking ? stop() : void speak(textFor(step), lang, `about-${step}`, true))}
          className={`flex h-20 flex-col items-center justify-center gap-1 rounded-3xl text-base font-bold ${speaking ? 'bg-cat text-ink-900' : 'bg-ink-800 text-slate-200'}`}>
          <Pictogram name={speaking ? 'pause' : 'speaker'} className="h-9 w-9" />{t('फिर सुनें', 'Repeat')}
        </button>
        <button onClick={next}
          className="flex h-20 items-center justify-center gap-3 rounded-3xl bg-ok text-2xl font-extrabold text-ink-900 active:scale-95">
          {last ? t('मशीन पर चलें', 'Go to machine') : t('आगे', 'Next')}
          <Pictogram name="next" className="h-9 w-9" />
        </button>
      </div>

      {video && <VideoOverlay video={about.video} machineId={about.machine.id} family={about.machine.family} onClose={() => setVideo(false)} />}
    </div>
  )
}
