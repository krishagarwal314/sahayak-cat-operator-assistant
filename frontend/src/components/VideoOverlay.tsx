import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, prefetchSpeech } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useVoiceOut } from '../lib/speechContext'
import type { Guide } from '../lib/types'
import type { MachineVideo } from './VideoCard'
import { Pictogram } from './Pictogram'

interface Slide {
  key: string
  icon: string
  chapter: number
  title: { hi: string; en: string }
  line: { hi: string; en: string }
  speech: { hi: string; en: string }
  warning: boolean
  cover?: boolean
}

// Start it, do the job, shut it down: the three things an operator does every day.
const WORK_GUIDE: Record<string, string> = {
  excavator: 'excavator_trench', loader: 'loader_truck', dozer: 'dozer_push',
}

function slidesFrom(guides: Guide[]): Slide[] {
  const out: Slide[] = []
  guides.forEach((g, chapter) => {
    out.push({
      key: `${g.id}-cover`, icon: g.icon, chapter, cover: true, warning: false,
      title: { hi: g.title_hi, en: g.title_en }, line: { hi: g.intro_hi, en: g.intro_en },
      speech: { hi: `${g.title_hi}। ${g.intro_speech_hi}`, en: `${g.title_en}. ${g.intro_en}` },
    })
    for (const s of g.steps) {
      out.push({
        key: `${g.id}-${s.number}`, icon: s.icon, chapter, warning: s.warning,
        title: { hi: s.title_hi, en: s.title_en }, line: { hi: s.say_hi, en: s.say_en },
        speech: { hi: s.speech_hi, en: s.speech_en },
      })
    }
  })
  return out
}

/**
 * The machine's video, made for someone who cannot read.
 *
 * The official Cat clip is in English with fast narration. So the default is a
 * picture video: one big picture at a time with the words spoken slowly in
 * the operator's language, moving on by itself - start the machine, do the
 * job, shut it down. It needs no internet and always plays. The real clip is
 * one tap away for anyone who wants it.
 */
export function VideoOverlay({ video, machineId, family, onClose }: {
  video?: MachineVideo | null
  machineId: string
  family: string
  onClose: () => void
}) {
  const { lang } = useLang()
  const { speak, stop } = useVoiceOut()
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)

  const [mode, setMode] = useState<'pictures' | 'real'>('pictures')
  const [slides, setSlides] = useState<Slide[] | null>(null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const runRef = useRef(0)

  useEffect(() => {
    const ids = ['start_up', WORK_GUIDE[family] ?? 'excavator_trench', 'shutdown']
    Promise.all(ids.map((id) => api.guide(id).catch(() => null)))
      .then((gs) => setSlides(slidesFrom(gs.filter((g): g is Guide => g !== null))))
    return () => stop()
  }, [family, machineId, stop])

  const total = slides?.length ?? 0
  const done = slides !== null && index >= total
  const slide = slides && !done ? slides[index] : null
  const chapters = useMemo(() => {
    const counts: number[] = []
    slides?.forEach((s) => { counts[s.chapter] = (counts[s.chapter] ?? 0) + 1 })
    return counts
  }, [slides])

  // Play: speak this picture, then move on by itself.
  useEffect(() => {
    if (!slides || mode !== 'pictures' || !playing) return
    const run = ++runRef.current
    if (done) {
      void speak(t('वीडियो पूरा हुआ। शाबाश!', 'That is the end of the video. Well done!'), lang, 'video-end')
      setPlaying(false)
      return
    }
    const next = slides[index + 1]
    if (next) prefetchSpeech(next.speech[lang], lang, true)
    void (async () => {
      const started = Date.now()
      await speak(slide!.speech[lang], lang, `video-${index}`, true)
      if (run !== runRef.current) return
      // A pause after the words, and every picture stays up long enough to
      // look at - even if the voice failed and returned at once.
      const pause = Math.max(slide!.warning ? 1400 : 800, 4000 - (Date.now() - started))
      window.setTimeout(() => { if (run === runRef.current) setIndex((i) => i + 1) }, pause)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playing, slides, mode, lang])

  const go = useCallback((to: number) => {
    runRef.current++
    stop()
    setIndex(Math.max(0, Math.min(total, to)))
  }, [stop, total])

  const toggle = () => {
    if (done) { go(0); setPlaying(true); return }
    runRef.current++
    stop()
    setPlaying((p) => !p)
  }

  const switchMode = (m: 'pictures' | 'real') => {
    runRef.current++
    stop()
    setPlaying(m === 'pictures')
    setMode(m)
  }

  // Portalled to <body>: an animated parent would otherwise trap a fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink-900">
      {/* top: which video, and a big way out */}
      <div className="flex items-center gap-2 p-3">
        <div className="flex flex-1 gap-2">
          <button onClick={() => switchMode('pictures')}
            className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-base font-extrabold
              ${mode === 'pictures' ? 'bg-cat text-ink-900' : 'bg-ink-800 text-mute'}`}>
            <Pictogram name="play" className="h-6 w-6" />
            <span className={lang === 'hi' ? 'lang-hi leading-none' : ''}>{t('चित्र वीडियो', 'Picture video')}</span>
          </button>
          {video && (
            <button onClick={() => switchMode('real')}
              className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-base font-extrabold
                ${mode === 'real' ? 'bg-cat text-ink-900' : 'bg-ink-800 text-mute'}`}>
              <Pictogram name="camera" className="h-6 w-6" />
              <span className={lang === 'hi' ? 'lang-hi leading-none' : ''}>{t('असली वीडियो', 'Real video')}</span>
            </button>
          )}
        </div>
        <button onClick={() => { stop(); onClose() }} aria-label="close"
          className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 text-white">
          <Pictogram name="cross" className="h-8 w-8" />
        </button>
      </div>

      {mode === 'real' && video ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 pb-6">
          <div className="relative aspect-video w-full max-w-4xl">
            <iframe className="absolute inset-0 h-full w-full rounded-xl" title={video.title}
              src={`https://www.youtube-nocookie.com/embed/${video.youtube_id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&cc_load_policy=1&cc_lang_pref=${lang}&hl=${lang}`}
              referrerPolicy="strict-origin-when-cross-origin"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          </div>
          <a href={`https://www.youtube.com/watch?v=${video.youtube_id}`} target="_blank" rel="noreferrer"
             className={`text-base font-bold text-mute underline ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {t('नहीं चल रहा? यूट्यूब पर खोलें', 'Not playing? Open on YouTube')}
          </a>
        </div>
      ) : !slides ? (
        <div className="grid flex-1 place-items-center"><span className="h-12 w-12 animate-spin rounded-full border-4 border-ink-600 border-t-cat" /></div>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-5">
          {/* progress: one segment per chapter, filled as it plays */}
          <div className="flex gap-1.5 pb-3">
            {chapters.map((count, c) => {
              const start = chapters.slice(0, c).reduce((a, b) => a + b, 0)
              const fill = done ? 1 : Math.max(0, Math.min(1, (index - start + (slide?.chapter === c ? 0.5 : 0)) / count))
              return (
                <div key={c} className="h-2.5 overflow-hidden rounded-full bg-ink-600" style={{ flex: count }}>
                  <div className="h-full rounded-full bg-cat transition-all duration-500" style={{ width: `${fill * 100}%` }} />
                </div>
              )
            })}
          </div>

          {/* the picture */}
          <button onClick={toggle} aria-label={playing ? 'pause' : 'play'}
            className={`relative grid flex-1 place-items-center overflow-hidden rounded-[36px] border-4
              ${done ? 'border-ok bg-ok/10' : slide?.warning ? 'border-crit bg-crit/10' : slide?.cover ? 'border-cat/60 bg-cat/10' : 'border-line bg-ink-800'}`}
            style={{ minHeight: 280 }}>
            {slide?.warning && (
              <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-crit py-2 text-lg font-extrabold text-white">
                <Pictogram name="alert" className="h-7 w-7" />{t('सावधान!', 'Careful!')}
              </div>
            )}
            <div key={slide?.key ?? 'done'} className="animate-zoomin">
              <div className={`${playing ? 'animate-drift' : ''} ${done ? 'text-ok' : slide?.warning ? 'text-crit' : 'text-cat'}`}>
                <Pictogram name={done ? 'check' : slide!.icon} className="h-48 w-48 sm:h-60 sm:w-60" />
              </div>
            </div>
            {!playing && (
              <span className="absolute inset-0 grid place-items-center bg-black/40">
                <span className="grid h-28 w-28 place-items-center rounded-full bg-crit text-white shadow-[0_10px_40px_rgba(0,0,0,0.6)]">
                  <Pictogram name={done ? 'repeat' : 'play'} className="ml-1 h-16 w-16" />
                </span>
              </span>
            )}
          </button>

          {/* the words, like subtitles */}
          <div key={`${slide?.key}-words`} className="animate-risein py-4" style={{ minHeight: 130 }}>
            <h2 className={`text-[28px] font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {done ? t('वीडियो पूरा हुआ', 'The end') : slide!.title[lang]}
            </h2>
            {!done && (
              <p className={`mt-1 text-lg leading-relaxed text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>{slide!.line[lang]}</p>
            )}
          </div>

          {/* three buttons: back, play/pause, forward */}
          <div className="grid grid-cols-[1fr_1.6fr_1fr] gap-3">
            <button onClick={() => go(index - 1)} disabled={index === 0} aria-label="previous"
              className="grid h-20 place-items-center rounded-3xl bg-ink-800 text-slate-200 disabled:opacity-30">
              <Pictogram name="prev" className="h-10 w-10" />
            </button>
            <button onClick={toggle}
              className={`flex h-20 items-center justify-center gap-2 rounded-3xl text-2xl font-extrabold active:scale-95
                ${playing ? 'bg-ink-600 text-white' : 'bg-ok text-ink-900'}`}>
              <Pictogram name={done ? 'repeat' : playing ? 'pause' : 'play'} className="h-10 w-10" />
              <span className={lang === 'hi' ? 'lang-hi leading-none' : ''}>
                {done ? t('फिर से', 'Again') : playing ? t('रोकें', 'Pause') : t('चलाएँ', 'Play')}
              </span>
            </button>
            <button onClick={() => go(index + 1)} disabled={done} aria-label="next"
              className="grid h-20 place-items-center rounded-3xl bg-ink-800 text-slate-200 disabled:opacity-30">
              <Pictogram name="next" className="h-10 w-10" />
            </button>
          </div>
        </div>
      )}
    </div>
  , document.body)
}
