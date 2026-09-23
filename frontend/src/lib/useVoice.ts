import { useCallback, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, ApiError } from './api'
import { Recorder, browserSttAvailable, recognizeWithBrowser } from './audio'
import { isScripted, scriptFor } from './demoScript'
import type { AskResult, Lang } from './types'

type State = 'idle' | 'recording' | 'processing'

/**
 * Tap to talk: start() on the first tap, stop() on the second.
 *
 * Scripted mode (the default for the demo): the mic animates as if listening,
 * then asks this screen's fixed question and returns the real answer. No
 * microphone access, no speech recognition, nothing that can mishear on stage.
 *
 * Live mode (?live=1): records audio, runs Hindi speech recognition on the
 * server, falls back to the browser's recogniser if that model is missing.
 */
export function useVoice(opts: {
  machineId: string
  lang: Lang
  speak?: boolean
  picking?: boolean
  onResult: (result: AskResult) => void
  onError?: (message: string) => void
}) {
  const { machineId, lang, speak = true, picking = false, onResult, onError } = opts
  const location = useLocation()

  const [state, setState] = useState<State>('idle')
  const [transcript, setTranscript] = useState('')
  const recorderRef = useRef<Recorder | null>(null)
  const backendSttRef = useRef(true)
  const scripted = isScripted()

  const fail = useCallback((message: string) => {
    setState('idle')
    onError?.(message)
  }, [onError])

  // ------------------------------------------------------------ scripted
  const runScript = useCallback(async () => {
    const line = scriptFor(location.pathname, picking)
    const question = line.question[lang]
    setTranscript(question)
    setState('processing')
    try {
      if (line.intent === 'USAGE_REPORT') {
        onResult(await reportAsAnswer(machineId, lang, question))
        setState('idle')
        return
      }
      const result = await api.ask({
        machine_id: machineId, text: question, intent: line.intent, language: lang, speak,
      })
      onResult({ ...result, transcript: question })
      setState('idle')
    } catch (e: any) {
      fail(String(e?.message ?? e))
    }
  }, [fail, lang, location.pathname, machineId, onResult, picking, speak])

  // ------------------------------------------------------------ live
  const start = useCallback(async () => {
    setTranscript('')
    if (scripted) {
      setState('recording')
      return
    }
    if (!backendSttRef.current) {
      if (!browserSttAvailable()) {
        fail(lang === 'hi' ? 'इस ब्राउज़र में आवाज़ पहचान उपलब्ध नहीं है।' : 'Speech recognition is unavailable in this browser.')
        return
      }
      setState('recording')
      const heard = await recognizeWithBrowser(lang)
      if (!heard) { setState('idle'); return }
      setTranscript(heard)
      setState('processing')
      try {
        const result = await api.ask({ machine_id: machineId, text: heard, language: lang, speak })
        onResult({ ...result, transcript: heard })
        setState('idle')
      } catch (e: any) { fail(String(e?.message ?? e)) }
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
  }, [fail, lang, machineId, onResult, scripted, speak])

  const stop = useCallback(async () => {
    if (scripted) {
      if (state === 'recording') await runScript()
      return
    }
    const recorder = recorderRef.current
    recorderRef.current = null
    if (!recorder) { setState('idle'); return }
    setState('processing')
    const blob = await recorder.stop()
    if (!blob) { setState('idle'); return }
    try {
      const result = await api.voiceAsk(blob, machineId, lang, speak)
      if (result.transcript) setTranscript(result.transcript)
      onResult(result)
      setState('idle')
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        backendSttRef.current = false
        fail(lang === 'hi' ? 'सर्वर पर आवाज़ मॉडल नहीं मिला। दोबारा दबाकर बोलिए।' : 'Speech model missing on the server. Press and speak again.')
        return
      }
      fail(String((e as Error)?.message ?? e))
    }
  }, [fail, lang, machineId, onResult, runScript, scripted, speak, state])

  const cancel = useCallback(() => {
    recorderRef.current?.cancel()
    recorderRef.current = null
    setState('idle')
  }, [])

  return { state, start, stop, cancel, transcript, usingBrowserStt: !backendSttRef.current, scripted }
}

/** The machine report, shaped like any other spoken answer. */
async function reportAsAnswer(machineId: string, lang: Lang, question: string): Promise<AskResult> {
  const report = await api.signals(machineId, true, lang)
  const said = report.summary?.[lang] ?? report.headline[lang]
  const text = { hi: lang === 'hi' ? said : report.headline.hi, en: lang === 'en' ? said : report.headline.en }
  return {
    machine_id: machineId, switched_machine: null, language: lang, total_ms: 0, at: new Date().toISOString(),
    transcript: question, audio: report.audio ?? null, speech_fallback_text: said,
    route: {
      intent: 'USAGE_REPORT', confidence: 1, stage: 'quick_action', text: question, normalized: question,
      script: lang === 'hi' ? 'devanagari' : 'latin', slots: {}, alternatives: [], unsupported_on_machine: false,
      total_ms: 0, trace: [],
    },
    reply: {
      text, speech: text, severity: report.signals.some((s) => s.level === 'danger') ? 'crit' : 'warn',
      card: null, data: {}, followups: [],
    },
  }
}
