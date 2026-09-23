import { useCallback, useEffect, useRef } from 'react'
import { useLang } from './i18n'
import { PAGE_INTROS, type PageKey } from './intros'

/**
 * Speak a page's one-line introduction when it opens, slowly.
 *
 * Browsers only allow audio after the user has touched the page, which is why
 * this works from the second screen onwards: logging in was that touch. The
 * returned function replays the line, for the small speaker on each page.
 */
export function usePageIntro(
  key: PageKey,
  speak: (text: string, lang: 'hi' | 'en', id?: string, slow?: boolean) => Promise<void>,
  enabled = true,
) {
  const { lang } = useLang()
  const spokenFor = useRef<string | null>(null)

  const replay = useCallback(() => {
    void speak(PAGE_INTROS[key][lang], lang, `intro-${key}`, true)
  }, [key, lang, speak])

  useEffect(() => {
    if (!enabled) return
    const stamp = `${key}:${lang}`
    if (spokenFor.current === stamp) return
    spokenFor.current = stamp
    // A short delay lets the page paint first, so voice and picture arrive together.
    const timer = window.setTimeout(replay, 450)
    return () => window.clearTimeout(timer)
  }, [enabled, key, lang, replay])

  return { replay, text: PAGE_INTROS[key][lang] }
}
