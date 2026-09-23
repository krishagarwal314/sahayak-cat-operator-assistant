import { useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Recorder, browserSttAvailable, recognizeWithBrowser } from '../lib/audio'
import { useLang } from '../lib/i18n'
import { useVoiceOut } from '../lib/speechContext'
import { Pictogram } from './Pictogram'

type ReportState = 'closed' | 'idle' | 'recording' | 'working' | 'confirm' | 'sent'

/**
 * The big red "report an accident" button and its voice sheet: hold, say what
 * happened, hear it read back, confirm. Lives on the machine page, because an
 * accident is always about a machine.
 */
export function IncidentReport({ machineId, onSent, compact = false }: { machineId: string; onSent?: () => void; compact?: boolean }) {
  const { lang } = useLang()
  const { speak } = useVoiceOut()
  const recorder = useRef<Recorder | null>(null)
  const [state, setState] = useState<ReportState>('closed')
  const [said, setSaid] = useState('')
  const id = machineId

  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)

  function openReport() {
    setSaid('')
    setState('idle')
    void speak(t('क्या हुआ? बड़ा बटन दबाकर बताइए।', 'What happened? Tap the big button and tell me.'), lang, 'incident', true)
  }

  async function startTalking() {
    setState('recording')
    // Prefer the server's Hindi model; fall back to the browser recogniser.
    try {
      recorder.current = new Recorder()
      await recorder.current.start()
    } catch {
      if (browserSttAvailable()) {
        const text = await recognizeWithBrowser(lang)
        finishTalking(text)
      } else {
        setState('idle')
      }
    }
  }

  async function stopTalking() {
    const rec = recorder.current
    recorder.current = null
    if (!rec) return
    setState('working')
    const blob = await rec.stop()
    if (!blob) { setState('idle'); return }
    try {
      const result = await api.transcribe(blob, lang)
      finishTalking(result.text)
    } catch (e) {
      if (e instanceof ApiError && e.status === 503 && browserSttAvailable()) {
        void speak(t('फिर से बोलिए।', 'Please say it again.'), lang, 'incident', true)
        setState('recording')
        finishTalking(await recognizeWithBrowser(lang))
      } else {
        setState('idle')
      }
    }
  }

  function finishTalking(text: string) {
    if (!text.trim()) { setState('idle'); return }
    setSaid(text)
    setState('confirm')
    void speak(t(`आपने कहा: ${text}। भेजने के लिए हरा बटन दबाइए।`, `You said: ${text}. Press green to send.`), lang, 'incident', true)
  }

  async function send() {
    setState('working')
    const res = await api.logIncident({ machine_id: id, description: said, language: lang })
    setState('sent')
    void speak(res.confirmation[lang], lang, 'incident', true)
    onSent?.()
  }


  return (<>
    {compact ? (
      <button onClick={openReport}
        className="flex h-16 items-center justify-center gap-2 rounded-2xl border-2 border-crit/60 text-base font-bold text-crit">
        <Pictogram name="alert" className="h-7 w-7" />{t('दुर्घटना', 'Accident')}
      </button>
    ) : (
      <button onClick={openReport}
        className="flex h-24 w-full items-center justify-center gap-4 rounded-[28px] bg-crit text-white shadow-[0_12px_32px_-12px_rgba(255,90,95,0.9)] active:scale-[0.98]">
        <Pictogram name="alert" className="h-12 w-12" />
        <span className={`text-[26px] font-extrabold ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('दुर्घटना बताएँ', 'Report accident')}</span>
      </button>
    )}
    {/* ---------------- report sheet ---------------- */}
      {state !== 'closed' && (
        <div className="fixed inset-0 z-[60] flex items-end bg-ink-900/85 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-lg animate-risein rounded-[32px] border-2 border-crit/50 bg-ink-800 p-6">
            <div className="flex items-center gap-3">
              <Pictogram name="alert" className="h-10 w-10 text-crit" />
              <h2 className={`flex-1 text-2xl font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('दुर्घटना बताएँ', 'Report accident')}</h2>
              <button onClick={() => setState('closed')} className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-700 text-mute">
                <Pictogram name="cross" className="h-7 w-7" />
              </button>
            </div>

            {state === 'sent' ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="grid h-28 w-28 place-items-center rounded-full bg-ok text-ink-900"><Pictogram name="check" className="h-20 w-20" /></div>
                <p className={`text-center text-2xl font-bold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('भेज दिया गया', 'Sent')}</p>
                <button onClick={() => setState('closed')} className="h-16 w-full rounded-2xl bg-ink-700 text-xl font-bold text-white">{t('ठीक है', 'OK')}</button>
              </div>
            ) : state === 'confirm' || (state === 'working' && said) ? (
              <div className="space-y-4 pt-5">
                <div className="flex gap-3 rounded-2xl bg-ink-900/70 p-4">
                  <Pictogram name="mic" className="h-7 w-7 shrink-0 text-cat" />
                  <p className={`text-xl text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{said}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => { setSaid(''); setState('idle') }}
                    className="flex h-20 flex-col items-center justify-center rounded-3xl bg-ink-700 text-lg font-bold text-white">
                    <Pictogram name="repeat" className="h-8 w-8 text-cat" />{t('फिर बोलें', 'Again')}
                  </button>
                  <button onClick={() => void send()} disabled={state === 'working'}
                    className="flex h-20 flex-col items-center justify-center rounded-3xl bg-ok text-lg font-extrabold text-ink-900">
                    <Pictogram name="check" className="h-8 w-8" />{t('भेजें', 'Send')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 pt-8">
                <button
                  onClick={() => {
                    if (state === 'idle') void startTalking()
                    else if (state === 'recording') void stopTalking()
                  }}
                  disabled={state === 'working'}
                  className={`relative grid h-40 w-40 place-items-center rounded-full transition-all
                    ${state === 'recording' ? 'scale-110 bg-crit text-white' : state === 'working' ? 'bg-ink-600 text-mute' : 'bg-cat text-ink-900'}`}>
                  {state === 'recording' && <span className="absolute inset-0 rounded-full bg-crit/40 animate-pulsering" />}
                  {state === 'working'
                    ? <span className="h-14 w-14 animate-spin rounded-full border-4 border-mute/30 border-t-mute" />
                    : <Pictogram name="mic" className="relative h-20 w-20" />}
                </button>
                <p className={`text-center text-xl font-bold text-slate-200 ${lang === 'hi' ? 'lang-hi' : ''}`}>
                  {state === 'recording' ? t('बोलिए… फिर दोबारा दबाइए', 'Speak… then tap again') : t('दबाइए और बताइए क्या हुआ', 'Tap and say what happened')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
  </>)
}
