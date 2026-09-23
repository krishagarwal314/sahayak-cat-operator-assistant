import { createContext, useContext } from 'react'
import { useSpeech } from './useSpeech'

type SpeechApi = ReturnType<typeof useSpeech>

const SpeechContext = createContext<SpeechApi | null>(null)

/**
 * One voice for the whole app. A page intro, a reply and a guide step must
 * never talk over each other, so everything speaks through this single channel
 * and starting anything new stops whatever was playing.
 */
export function SpeechProvider({ children }: { children: React.ReactNode }) {
  const speech = useSpeech()
  return <SpeechContext.Provider value={speech}>{children}</SpeechContext.Provider>
}

export function useVoiceOut(): SpeechApi {
  const ctx = useContext(SpeechContext)
  if (!ctx) throw new Error('useVoiceOut must be used inside SpeechProvider')
  return ctx
}
