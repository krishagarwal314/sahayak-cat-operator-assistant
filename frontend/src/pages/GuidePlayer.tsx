import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useVoiceOut } from '../lib/speechContext'
import type { Guide } from '../lib/types'
import { Pictogram } from '../components/Pictogram'

/**
 * One step at a time: a big picture, a few big words, a slow voice.
 *
 * Index -1 is the introduction, 0..n-1 are the steps, n is "all done". Each
 * screen speaks itself when it appears. With hands-free on, the next step
 * follows automatically a moment after the voice finishes - both hands can
 * stay on the controls.
 */
export default function GuidePlayer() {
  const { id } = useParams<{ id: string }>()
  const { lang } = useLang()
  const navigate = useNavigate()
  const { speak, stop, speakingId } = useVoiceOut()

  const [guide, setGuide] = useState<Guide | null>(null)
  const [index, setIndex] = useState(-1)
  const [auto, setAuto] = useState(false)
  const runRef = useRef(0)

  useEffect(() => {
    if (id) api.guide(id).then(setGuide).catch(() => navigate('/learn'))
    return () => stop()
  }, [id, navigate, stop])

  const total = guide?.steps.length ?? 0
  const step = guide && index >= 0 && index < total ? guide.steps[index] : null
  const done = guide !== null && index >= total

  const textFor = useCallback((i: number): string => {
    if (!guide) return ''
    if (i < 0) return lang === 'hi' ? `${guide.title_hi}। ${guide.intro_hi} शुरू करने के लिए हरा बटन दबाइए।` : `${guide.title_en}. ${guide.intro_en} Press the green button to begin.`
    if (i >= guide.steps.length) return lang === 'hi' ? 'शाबाश! आपने सारे कदम पूरे कर लिए।' : 'Well done! You have finished every step.'
    const s = guide.steps[i]
    return lang === 'hi' ? s.speech_hi : s.speech_en
  }, [guide, lang])

  // Speak each screen as it appears; in hands-free mode, move on afterwards.
  useEffect(() => {
    if (!guide) return
    const run = ++runRef.current
    const timer = window.setTimeout(async () => {
      await speak(textFor(index), lang, `guide-${index}`, true)
      if (auto && run === runRef.current && index >= 0 && index < guide.steps.length) {
        window.setTimeout(() => { if (run === runRef.current) setIndex((i) => i + 1) }, 1600)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [auto, guide, index, lang, speak, textFor])

  const go = (next: number) => { runRef.current++; stop(); setIndex(Math.max(-1, Math.min(total, next))) }
  const repeat = () => { runRef.current++; void speak(textFor(index), lang, `guide-${index}`, true) }

  if (!guide) {
    return <div className="grid min-h-screen place-items-center"><span className="h-12 w-12 animate-spin rounded-full border-4 border-ink-600 border-t-cat" /></div>
  }

  const warning = step?.warning
  const title = lang === 'hi' ? guide.title_hi : guide.title_en
  const speaking = speakingId === `guide-${index}`

  return (
    <div className="flex min-h-screen flex-col">
      {/* header: close, title, progress */}
      <header className="sticky top-0 z-20 border-b border-line-soft bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button onClick={() => { stop(); navigate(-1) }} aria-label="close"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-ink-800 text-slate-200">
            <Pictogram name="cross" className="h-8 w-8" />
          </button>
          <h1 className={`min-w-0 flex-1 truncate text-xl font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{title}</h1>
          <button onClick={() => setAuto((a) => !a)} aria-pressed={auto}
            className={`flex h-14 items-center gap-2 rounded-2xl px-3 text-sm font-bold transition-colors
              ${auto ? 'bg-ok text-ink-900' : 'bg-ink-800 text-mute'}`}>
            {/* Media convention: show what pressing it will do. */}
            <Pictogram name={auto ? 'pause' : 'play'} className="h-6 w-6" />
            <span className={lang === 'hi' ? 'lang-hi leading-none' : ''}>{lang === 'hi' ? 'अपने आप' : 'Hands-free'}</span>
          </button>
        </div>
        <div className="mx-auto flex max-w-2xl gap-1.5 px-4 pb-3">
          {guide.steps.map((s, i) => (
            <button key={s.number} onClick={() => go(i)} aria-label={`step ${s.number}`}
              className={`h-3 flex-1 rounded-full transition-colors
                ${i < index || done ? 'bg-ok' : i === index ? (s.warning ? 'bg-crit' : 'bg-cat') : 'bg-ink-600'}`} />
          ))}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-5">
        {/* ---------------- the picture ---------------- */}
        <div className={`relative grid flex-1 place-items-center overflow-hidden rounded-[36px] border-4 px-6 py-8
          ${done ? 'border-ok bg-ok/10' : warning ? 'border-crit bg-crit/10' : index < 0 ? 'border-cat/50 bg-cat/10' : 'border-line bg-ink-800'}`}
          style={{ minHeight: 300 }}>
          {warning && (
            <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-crit py-2.5 text-lg font-extrabold text-white">
              <Pictogram name="alert" className="h-7 w-7" />{lang === 'hi' ? 'सावधान!' : 'Careful!'}
            </div>
          )}
          {step && (
            <div className="absolute left-4 top-4 rounded-2xl bg-ink-900/80 px-4 py-2 text-lg font-extrabold text-white"
                 style={{ top: warning ? 56 : 16 }}>
              <span className={lang === 'hi' ? 'lang-hi' : ''}>{lang === 'hi' ? 'कदम' : 'Step'}</span>{' '}
              <span className="font-mono text-cat">{step.number}</span><span className="text-mute"> / {total}</span>
            </div>
          )}
          <div className={`animate-bob ${done ? 'text-ok' : warning ? 'text-crit' : 'text-cat'}`}>
            <Pictogram name={done ? 'check' : step ? step.icon : guide.icon} className="h-52 w-52 sm:h-64 sm:w-64" />
          </div>
        </div>

        {/* ---------------- the words ---------------- */}
        <div className="py-5">
          <h2 className={`text-[30px] font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {done ? (lang === 'hi' ? 'शाबाश! सब पूरा हुआ' : 'Well done! All finished')
              : step ? (lang === 'hi' ? step.title_hi : step.title_en)
              : title}
          </h2>
          <p className={`mt-2 text-xl leading-relaxed text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {done ? '' : step ? (lang === 'hi' ? step.say_hi : step.say_en) : (lang === 'hi' ? guide.intro_hi : guide.intro_en)}
          </p>
        </div>

        {/* ---------------- the controls ---------------- */}
        {done ? (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => go(-1)} className="flex h-20 items-center justify-center gap-2 rounded-3xl bg-ink-800 text-xl font-bold text-slate-100">
              <Pictogram name="repeat" className="h-9 w-9 text-cat" />{lang === 'hi' ? 'फिर से' : 'Again'}
            </button>
            <button onClick={() => navigate('/learn')} className="flex h-20 items-center justify-center gap-2 rounded-3xl bg-ok text-xl font-extrabold text-ink-900">
              <Pictogram name="check" className="h-9 w-9" />{lang === 'hi' ? 'पूरा' : 'Finish'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_1fr_1.6fr] gap-3">
            <button onClick={() => go(index - 1)} disabled={index < 0} aria-label="previous"
              className="flex h-24 flex-col items-center justify-center gap-1 rounded-3xl bg-ink-800 text-base font-bold text-slate-200 disabled:opacity-30">
              <Pictogram name="prev" className="h-10 w-10" />{lang === 'hi' ? 'पीछे' : 'Back'}
            </button>
            <button onClick={() => (speaking ? stop() : repeat())} aria-label="repeat"
              className={`flex h-24 flex-col items-center justify-center gap-1 rounded-3xl text-base font-bold
                ${speaking ? 'bg-cat text-ink-900' : 'bg-ink-800 text-slate-200'}`}>
              <Pictogram name={speaking ? 'pause' : 'speaker'} className="h-10 w-10" />{lang === 'hi' ? 'फिर सुनें' : 'Repeat'}
            </button>
            <button onClick={() => go(index + 1)}
              className="flex h-24 items-center justify-center gap-3 rounded-3xl bg-ok text-2xl font-extrabold text-ink-900 shadow-[0_10px_30px_-10px_rgba(61,214,140,0.9)] active:scale-95">
              {index < 0 ? (lang === 'hi' ? 'शुरू' : 'Start') : index === total - 1 ? (lang === 'hi' ? 'पूरा' : 'Done') : (lang === 'hi' ? 'आगे' : 'Next')}
              <Pictogram name={index === total - 1 ? 'check' : 'next'} className="h-10 w-10" />
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
