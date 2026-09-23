import { useCallback, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { Recorder, browserSttAvailable, recognizeWithBrowser } from './audio'
import type { AskResult, Lang } from './types'

type State = 'idle' | 'recording' | 'processing'

/**
 * Hold-to-talk voice querying.
 *
 * Primary path records audio and sends it to the backend, which runs Hindi STT
 * and answers in one round trip. If the STT model is not installed the backend
 * returns 503 once; we remember that and switch to the browser's own recogniser
 * for the rest of the session, so a demo never dead-ends on a missing download.
 */
export function useVoice(opts: {
  machineId: string
  lang: Lang
  speak?: boolean
  onResult: (result: AskResult) => void
  onError?: (message: string) => void
}) {
  const { machineId, lang, speak = true, onResult, onError } = opts

  const [state, setState] = useState<State>('idle')
  const [transcript, setTranscript] = useState('')
  const recorderRef = useRef<Recorder | null>(null)
  const backendSttRef = useRef(true)

  const fail = useCallback((message: string) => {
    setState('idle')
    onError?.(message)
  }, [onError])

  const start = useCallback(async () => {
    setTranscript('')

    // Browser-recognition mode: no recording, the API captures audio itself.
    if (!backendSttRef.current) {
      if (!browserSttAvailable()) {
        fail(lang === 'hi'
          ? 'इस ब्राउज़र में आवाज़ पहचान उपलब्ध नहीं है। कृपया सवाल टाइप करें।'
          : 'Speech recognition is unavailable in this browser. Please type instead.')
        return
      }
      setState('recording')
      const heard = await recognizeWithBrowser(lang)
      if (!heard) {
        setState('idle')
        return
      }
      setTranscript(heard)
      setState('processing')
      try {
        const result = await api.ask({ machine_id: machineId, text: heard, language: lang, speak })
        onResult({ ...result, transcript: heard })
        setState('idle')
      } catch (e: any) {
        fail(String(e?.message ?? e))
      }
      return
    }

    try {
      const recorder = new Recorder()
      await recorder.start()
      recorderRef.current = recorder
      setState('recording')
    } catch {
      fail(lang === 'hi' ? 'माइक की अनुमति नहीं मिली' : 'Microphone permission denied')
    }
  }, [fail, lang, machineId, onResult, speak])

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    if (!recorder) {
      setState('idle')
      return
    }
    setState('processing')
    const blob = await recorder.stop()
    if (!blob) {
      setState('idle')
      return
    }
    try {
      const result = await api.voiceAsk(blob, machineId, lang, speak)
      if (result.transcript) setTranscript(result.transcript)
      onResult(result)
      setState('idle')
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        // STT model missing: switch to the browser recogniser from now on.
        backendSttRef.current = false
        fail(lang === 'hi'
          ? 'सर्वर पर आवाज़ मॉडल नहीं मिला, ब्राउज़र की पहचान इस्तेमाल होगी। दोबारा दबाकर बोलिए।'
          : 'Speech model not installed on the server; switching to browser recognition. Press and speak again.')
        return
      }
      fail(String((e as Error)?.message ?? e))
    }
  }, [fail, lang, machineId, onResult, speak])

  const cancel = useCallback(() => {
    recorderRef.current?.cancel()
    recorderRef.current = null
    setState('idle')
  }, [])

  return { state, start, stop, cancel, transcript, usingBrowserStt: !backendSttRef.current }
}
