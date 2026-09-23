import { homeFor } from '../lib/viewMode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { PAGE_INTROS } from '../lib/intros'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import type { FacePerson, FaceStatus } from '../lib/types'
import { Pictogram } from '../components/Pictogram'

type Mode = 'start' | 'scan' | 'enroll-pick' | 'enroll' | 'welcome' | 'nocamera'
const SCAN_EVERY_MS = 1100
const ENROLL_SAMPLES = 3

/** Grab the current video frame as a small JPEG. */
async function frame(video: HTMLVideoElement): Promise<Blob | null> {
  if (!video.videoWidth) return null
  const width = 480
  const height = Math.round((video.videoHeight / video.videoWidth) * width)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(video, 0, 0, width, height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85))
}

export default function FaceLogin() {
  const { lang, setLang } = useLang()
  const { adopt, operator } = useSession()
  const { speak } = useVoiceOut()
  const navigate = useNavigate()

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const busyRef = useRef(false)
  const lastMessageRef = useRef('')

  const [mode, setMode] = useState<Mode>('start')
  const [status, setStatus] = useState<FaceStatus | null>(null)
  const [message, setMessage] = useState('')
  const [box, setBox] = useState<number[]>([])
  const [welcome, setWelcome] = useState<{ name: string; initials: string } | null>(null)
  const [enrollee, setEnrollee] = useState<FacePerson | null>(null)
  const [samples, setSamples] = useState(0)

  useEffect(() => { if (operator) navigate(homeFor(operator.role), { replace: true }) }, [operator, navigate])
  useEffect(() => { api.faceStatus().then(setStatus).catch(() => setStatus(null)) }, [])
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  const say = useCallback((text: string) => { void speak(text, lang, 'login', true) }, [lang, speak])

  // Tell the operator what is wrong, but do not repeat the same sentence every scan.
  const announce = useCallback((text: string) => {
    setMessage(text)
    if (text && text !== lastMessageRef.current) {
      lastMessageRef.current = text
      say(text)
    }
  }, [say])

  const finish = useCallback((token: string, op: any, greeting: string) => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    setWelcome({ name: lang === 'hi' ? op.name_hi : op.name_en, initials: op.avatar_initials })
    setMode('welcome')
    say(greeting)
    window.setTimeout(() => {
      adopt(token, op)
      // Everyone gets the interface in their own language: operators Hindi, the
      // manager (profile language English) English.
      if (op.language === 'hi' || op.language === 'en') setLang(op.language)
      navigate(homeFor(op.role), { replace: true })
    }, 2200)
  }, [adopt, lang, navigate, say, setLang])

  // ---------------------------------------------------------------- camera
  const startCamera = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      return true
    } catch {
      return false
    }
  }, [])

  async function begin() {
    const cameraOk = status?.available !== false && (await startCamera())
    if (!cameraOk) {
      setMode('nocamera')
      say(lang === 'hi' ? 'कैमरा नहीं मिला। अपनी फोटो दबाइए।' : 'No camera found. Tap your photo.')
      return
    }
    const nobodyEnrolled = status && status.people.every((p) => p.face_samples === 0)
    if (nobodyEnrolled && status?.allow_enroll) {
      setMode('enroll-pick')
      say(PAGE_INTROS.enroll[lang])
    } else {
      setMode('scan')
      say(PAGE_INTROS.login[lang])
    }
  }

  // ---------------------------------------------------------------- scanning
  useEffect(() => {
    if (mode !== 'scan') return
    const timer = window.setInterval(async () => {
      if (busyRef.current || !videoRef.current) return
      busyRef.current = true
      try {
        const image = await frame(videoRef.current)
        if (!image) return
        const result = await api.faceLogin(image)
        setBox(result.box ?? [])
        if (result.matched && result.token && result.operator) {
          finish(result.token, result.operator, result.greeting?.[lang] ?? '')
        } else if (result.status === 'unknown' || result.status === 'too_small') {
          announce(result.message[lang])
        } else {
          setMessage(result.message[lang])
        }
      } catch {
        /* a dropped frame is not worth telling anyone about */
      } finally {
        busyRef.current = false
      }
    }, SCAN_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [announce, finish, lang, mode])

  // ---------------------------------------------------------------- enrolment
  useEffect(() => {
    if (mode !== 'enroll' || !enrollee) return
    let cancelled = false
    async function capture() {
      let saved = 0
      while (!cancelled && saved < ENROLL_SAMPLES) {
        await new Promise((r) => window.setTimeout(r, 1000))
        if (cancelled || !videoRef.current) return
        const image = await frame(videoRef.current)
        if (!image) continue
        try {
          const result = await api.faceEnroll(enrollee!.id, image)
          setBox(result.box ?? [])
          if (result.saved) {
            saved += 1
            setSamples(saved)
          } else {
            announce(result.message[lang])
          }
        } catch { /* try the next frame */ }
      }
      if (cancelled) return
      say(lang === 'hi' ? 'चेहरा जुड़ गया। अब आप कैमरे से लॉगिन कर सकते हैं।' : 'Face saved. You can now log in with the camera.')
      const fresh = await api.faceStatus().catch(() => null)
      if (fresh) setStatus(fresh)
      setEnrollee(null)
      setSamples(0)
      lastMessageRef.current = ''
      setMode('scan')
    }
    void capture()
    return () => { cancelled = true }
  }, [announce, enrollee, lang, mode, say])

  async function tapLogin(person: FacePerson) {
    try {
      const result = await api.tapLogin(person.id)
      finish(result.token, result.operator, result.greeting[lang])
    } catch {
      announce(lang === 'hi' ? 'लॉगिन नहीं हो पाया। फिर कोशिश करें।' : 'Could not log in. Try again.')
    }
  }

  function pick(person: FacePerson) {
    if (mode === 'enroll-pick') {
      setEnrollee(person)
      setSamples(0)
      setMode('enroll')
      say(lang === 'hi' ? `${person.name_hi}, कैमरे में सीधे देखिए और हिलिए मत।` : `${person.name_en}, look straight at the camera and hold still.`)
    } else {
      void tapLogin(person)
    }
  }

  const people = (status?.people ?? []).filter((p) => p.role === 'operator' || p.role === 'manager')
  const showCamera = mode === 'scan' || mode === 'enroll' || mode === 'enroll-pick'
  const boxStyle = box.length === 4 ? {
    // The preview is mirrored like a selfie, so the box is mirrored too.
    left: `${(1 - box[0] - box[2]) * 100}%`, top: `${box[1] * 100}%`,
    width: `${box[2] * 100}%`, height: `${box[3] * 100}%`,
  } : undefined

  // ================================================================ render
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cat text-ink-900">
            <Pictogram name="face" className="h-8 w-8" />
          </div>
          <div className="leading-tight">
            <div className="text-xl font-extrabold text-white">CAT Saathi</div>
            <div className={`text-sm text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>{lang === 'hi' ? 'आपका मशीन साथी' : 'Your machine companion'}</div>
          </div>
        </div>
        <button onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
          className="h-12 rounded-2xl border border-line bg-ink-800 px-4 text-base font-bold text-slate-100">
          {lang === 'hi' ? 'English' : 'हिंदी'}
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-5 pb-8">
        {/* ------------- first tap: unlocks the camera and the voice ------------- */}
        {mode === 'start' && (
          <button onClick={begin}
            className="mt-6 flex w-full flex-1 flex-col items-center justify-center gap-6 rounded-[36px] border-2 border-cat/40 bg-cat/10 p-8 transition-transform active:scale-[0.98]">
            <div className="relative grid h-44 w-44 place-items-center rounded-full bg-cat text-ink-900">
              <span className="absolute inset-0 rounded-full bg-cat/40 animate-pulsering" />
              <Pictogram name="face" className="relative h-24 w-24" />
            </div>
            <div className={`text-center text-[32px] font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {lang === 'hi' ? 'शुरू करने के लिए दबाइए' : 'Tap to start'}
            </div>
            <div className="flex items-center gap-3 text-mute">
              <Pictogram name="camera" className="h-8 w-8" />
              <span className="text-2xl">+</span>
              <Pictogram name="speaker" className="h-8 w-8" />
            </div>
          </button>
        )}

        {/* ------------- camera ------------- */}
        <div className={`${showCamera ? '' : 'hidden'} relative mt-2 w-full overflow-hidden rounded-[32px] border-4 bg-black
          ${mode === 'enroll' ? 'border-ok' : 'border-cat/60'}`} style={{ aspectRatio: '4 / 3' }}>
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
          {/* oval face guide */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-[78%] w-[52%] rounded-[50%] border-4 border-dashed border-white/50" />
          </div>
          {boxStyle && (
            <div className={`pointer-events-none absolute rounded-2xl border-4 transition-all duration-300
              ${mode === 'enroll' ? 'border-ok' : 'border-cat'}`} style={boxStyle} />
          )}
          {mode === 'scan' && (
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-cat/80 shadow-[0_0_24px_6px_rgba(255,205,17,0.6)]"
                 style={{ animation: 'scanline 2.2s ease-in-out infinite' }} />
          )}
          {mode === 'enroll' && (
            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-gradient-to-t from-black/80 to-transparent pb-4 pt-10">
              {Array.from({ length: ENROLL_SAMPLES }).map((_, i) => (
                <span key={i} className={`h-5 w-5 rounded-full border-2 border-white ${i < samples ? 'bg-ok' : 'bg-transparent'}`} />
              ))}
            </div>
          )}
        </div>

        {showCamera && (
          <div className="mt-5 flex min-h-[64px] items-center gap-3 text-center">
            <Pictogram name={mode === 'enroll' ? 'user_plus' : 'face'} className="h-10 w-10 shrink-0 text-cat" />
            <p className={`text-[22px] font-bold leading-snug text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {mode === 'enroll'
                ? (lang === 'hi' ? `${enrollee?.name_hi}, सीधे देखिए` : `${enrollee?.name_en}, look straight`)
                : mode === 'enroll-pick'
                  ? (lang === 'hi' ? 'पहली बार? अपनी फोटो दबाइए' : 'First time? Tap your photo')
                  : (message || (lang === 'hi' ? 'कैमरे में देखिए' : 'Look at the camera'))}
            </p>
          </div>
        )}

        {/* ------------- success ------------- */}
        {mode === 'welcome' && welcome && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 animate-risein">
            <div className="grid h-44 w-44 place-items-center rounded-full bg-ok text-ink-900">
              <Pictogram name="check" className="h-28 w-28" />
            </div>
            <div className={`text-center text-[34px] font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {lang === 'hi' ? `नमस्ते ${welcome.name}` : `Hello ${welcome.name}`}
            </div>
          </div>
        )}

        {/* ------------- people: pick to enrol, or tap to log in ------------- */}
        {(mode === 'scan' || mode === 'enroll-pick' || mode === 'nocamera') && people.length > 0 && (
          <div className="mt-6 w-full">
            {mode === 'nocamera' && (
              <p className={`mb-4 text-center text-[24px] font-bold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                {lang === 'hi' ? 'अपनी फोटो दबाइए' : 'Tap your photo'}
              </p>
            )}
            {mode === 'scan' && (
              <p className={`mb-3 text-center text-base text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
                {lang === 'hi' ? 'पहचान नहीं हो रही? अपनी फोटो दबाइए' : 'Not recognised? Tap your photo'}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              {people.map((person) => (
                <button key={person.id} onClick={() => pick(person)}
                  className={`flex flex-col items-center gap-2 rounded-3xl border-2 p-3 transition-all active:scale-95
                    ${mode === 'enroll-pick' ? 'border-ok/50 bg-ok/10' : 'border-line bg-ink-800 hover:border-cat/50'}`}>
                  <div className="relative grid h-20 w-20 place-items-center rounded-full bg-ink-600 text-2xl font-extrabold text-cat">
                    {person.avatar_initials}
                    {person.face_samples > 0 && (
                      <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-ok text-ink-900">
                        <Pictogram name="face" className="h-5 w-5" />
                      </span>
                    )}
                  </div>
                  <span className={`text-center text-base font-bold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                    {lang === 'hi' ? person.name_hi : person.name_en}
                  </span>
                </button>
              ))}
            </div>

            {mode === 'scan' && status?.allow_enroll && (
              <button onClick={() => { setMode('enroll-pick'); say(PAGE_INTROS.enroll[lang]) }}
                className="mt-4 flex h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line text-lg font-bold text-slate-200">
                <Pictogram name="user_plus" className="h-8 w-8 text-ok" />
                {lang === 'hi' ? 'नया चेहरा जोड़ें' : 'Add a new face'}
              </button>
            )}
            {mode === 'enroll-pick' && (
              <button onClick={() => { setMode('scan'); say(PAGE_INTROS.login[lang]) }}
                className="mt-4 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-ink-800 text-base font-bold text-slate-300">
                <Pictogram name="prev" className="h-6 w-6" />{lang === 'hi' ? 'वापस' : 'Back'}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
