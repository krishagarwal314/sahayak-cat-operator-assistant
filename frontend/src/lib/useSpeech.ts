import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { playBase64, playBlob, speakWithBrowser, stopSpeaking, type PlayResult } from './audio'
import type { Lang } from './types'

/**
 * One speak() for the whole app.
 *
 * Tries the backend TTS model first (that is the Hindi voice we want), and
 * falls back to the browser's own synthesis so the assistant is never mute -
 * which matters when a model has not been downloaded yet.
 */
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  // True when the browser refused to play without a fresh tap. The UI then
  // makes the speaker button pulse so one tap brings the voice back.
  const [blocked, setBlocked] = useState(false)
  const noteResult = useCallback((result: PlayResult) => {
    if (result === 'blocked') setBlocked(true)
    else if (result === 'ended') setBlocked(false)
  }, [])
  const tokenRef = useRef(0)

  useEffect(() => () => stopSpeaking(), [])

  const stop = useCallback(() => {
    tokenRef.current += 1
    stopSpeaking()
    setSpeaking(false)
    setSpeakingId(null)
  }, [])

  const speak = useCallback(async (text: string, lang: Lang, id?: string, slow = false) => {
    if (!text.trim()) return
    tokenRef.current += 1
    const token = tokenRef.current
    stopSpeaking()
    setSpeaking(true)
    setSpeakingId(id ?? null)
    try {
      const blob = await api.speak(text, lang, slow)
      if (tokenRef.current !== token) return
      noteResult(await playBlob(blob))
    } catch {
      if (tokenRef.current !== token) return
      await speakWithBrowser(text, lang)
    } finally {
      if (tokenRef.current === token) {
        setSpeaking(false)
        setSpeakingId(null)
      }
    }
  }, [noteResult])

  /** Play audio the API already returned inline, with the same fallback. */
  const playInline = useCallback(
    async (base64: string | undefined | null, fallbackText: string, lang: Lang, id?: string) => {
      tokenRef.current += 1
      const token = tokenRef.current
      stopSpeaking()
      setSpeaking(true)
      setSpeakingId(id ?? null)
      try {
        if (base64) noteResult(await playBase64(base64))
        else await speakWithBrowser(fallbackText, lang)
      } finally {
        if (tokenRef.current === token) {
          setSpeaking(false)
          setSpeakingId(null)
        }
      }
    },
    [noteResult],
  )

  return { speak, playInline, stop, speaking, speakingId, blocked }
}
