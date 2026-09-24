import { useEffect, useRef } from 'react'
import { useLang } from '../lib/i18n'
import { useVoiceOut } from '../lib/speechContext'
import { usePageIntro } from '../lib/usePageIntro'
import { useGuard } from '../components/Guard'
import { Pictogram } from '../components/Pictogram'
import { PageHeader } from '../components/Simple'

/** Cab guard: the camera watches the operator's eyes and sounds an alarm on drowsiness. */
export default function Guard() {
  const { lang } = useLang()
  const { speak, speakingId } = useVoiceOut()
  const { replay } = usePageIntro('guard', speak)
  const { state, active, video, start, stop } = useGuard()
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)
  const view = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (view.current && video?.srcObject && view.current.srcObject !== video.srcObject) {
      view.current.srcObject = video.srcObject
      void view.current.play().catch(() => undefined)
    }
  }, [video, state.status])

  // Draw the tracked eye outline over the video.
  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    if (!state.eyePoints.length) return
    const bad = state.status === 'closing' || state.status === 'drowsy'
    ctx.fillStyle = bad ? '#FF5A5F' : '#3DD68C'
    ctx.strokeStyle = ctx.fillStyle
    ctx.lineWidth = 3
    for (const eye of [state.eyePoints.slice(0, 6), state.eyePoints.slice(6)]) {
      ctx.beginPath()
      eye.forEach(([x, y], i) => (i ? ctx.lineTo(x * c.width, y * c.height) : ctx.moveTo(x * c.width, y * c.height)))
      ctx.closePath()
      ctx.stroke()
      eye.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x * c.width, y * c.height, 3, 0, Math.PI * 2); ctx.fill() })
    }
  }, [state])

  const status = {
    off: { color: 'bg-ink-800 text-mute', hi: 'निगरानी बंद है', en: 'Guard is off' },
    loading: { color: 'bg-ink-800 text-cat', hi: 'कैमरा चालू हो रहा है…', en: 'Starting camera…' },
    'no-face': { color: 'bg-cat text-ink-900', hi: 'चेहरा कैमरे की तरफ़ कीजिए', en: 'Face the camera' },
    awake: { color: 'bg-ok text-ink-900', hi: 'जागे हुए हैं', en: 'Awake and alert' },
    closing: { color: 'bg-cat text-ink-900', hi: 'आँखें बंद हो रही हैं', en: 'Eyes closing' },
    drowsy: { color: 'bg-crit text-white', hi: 'नींद! अलार्म', en: 'Drowsy! Alarm' },
    error: { color: 'bg-crit text-white', hi: 'कैमरा नहीं खुला', en: 'Camera unavailable' },
  }[state.status]

  const tiles = [
    { icon: 'face', hi: 'आँखें', en: 'Eyes', value: `${Math.round((1 - state.eyesClosed) * 100)}%`, sub: t('खुली', 'open') },
    { icon: 'clock', hi: 'नींद का हिस्सा', en: 'PERCLOS', value: `${state.perclos.toFixed(0)}%`, sub: t('पिछला 1 मिनट', 'last minute') },
    { icon: 'repeat', hi: 'पलकें', en: 'Blinks', value: `${state.blinksPerMin}`, sub: t('प्रति मिनट', 'per minute') },
    { icon: 'idle', hi: 'उबासी', en: 'Yawns', value: `${state.yawns}`, sub: t('अब तक', 'so far') },
  ]

  return (
    <div className="space-y-4 pb-4">
      <PageHeader icon={<Pictogram name="face" className="h-10 w-10" />} title={t('केबिन गार्ड', 'Cab guard')}
        onReplay={replay} speaking={speakingId === 'intro-guard'} />

      <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] border-2 border-line bg-black">
        {active ? (
          <>
            <video ref={view} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
            <canvas ref={canvas} width={640} height={480} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100" />
          </>
        ) : (
          <div className="grid h-full place-items-center text-mute"><Pictogram name="camera" className="h-24 w-24" /></div>
        )}
        <div className={`absolute inset-x-3 top-3 rounded-2xl px-4 py-2 text-center text-xl font-extrabold ${status.color} ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {status[lang]}{state.status === 'closing' ? ` · ${state.closedSeconds.toFixed(1)}s` : ''}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {tiles.map((x) => (
          <div key={x.en} className="rounded-2xl bg-ink-800 p-3 text-center">
            <Pictogram name={x.icon} className="mx-auto h-7 w-7 text-cat" />
            <div className="mt-1 font-mono text-2xl font-bold text-white">{x.value}</div>
            <div className={`text-[11px] font-bold text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(x.hi, x.en)}</div>
            <div className={`text-[10px] text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>{x.sub}</div>
          </div>
        ))}
      </div>

      <button onClick={() => (active ? stop() : start())}
        className={`flex h-20 w-full items-center justify-center gap-3 rounded-3xl text-2xl font-extrabold active:scale-95
          ${active ? 'bg-ink-800 text-white' : 'bg-ok text-ink-900'} ${lang === 'hi' ? 'lang-hi' : ''}`}>
        <Pictogram name={active ? 'pause' : 'play'} className="h-9 w-9" />
        {active ? t('निगरानी बंद करें', 'Stop guard') : t('निगरानी शुरू करें', 'Start guard')}
      </button>

      <p className={`text-center text-sm text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
        {t('आँखें 1.5 सेकंड बंद रहीं तो अलार्म बजेगा। वीडियो फ़ोन से बाहर नहीं जाता।',
           'Eyes closed for 1.5 seconds sounds the alarm. Video never leaves the phone.')}
      </p>
      <p className="text-center text-[11px] font-semibold text-mute">MediaPipe Face Landmarker · 478 points + 52 blendshapes · on-device WebAssembly</p>
    </div>
  )
}
