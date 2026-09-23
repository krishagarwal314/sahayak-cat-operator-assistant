import { useState } from 'react'
import { useLang } from '../lib/i18n'
import { useVoiceOut } from '../lib/speechContext'
import { Pictogram } from './Pictogram'

export interface MachineVideo {
  youtube_id: string
  title: string
  channel: string
  about_hi: string
  about_en: string
}

/**
 * A tutorial video that loads only when tapped. The thumbnail is a picture,
 * the play button is huge and red, and pressing it stops any speech so the
 * video's own sound is not talked over.
 */
export function VideoCard({ video, highlight = false }: { video: MachineVideo; highlight?: boolean }) {
  const { lang } = useLang()
  const { stop } = useVoiceOut()
  const [playing, setPlaying] = useState(false)
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)

  return (
    <section className={`overflow-hidden rounded-[28px] border-2 border-line bg-ink-800 transition-all ${highlight ? 'ring-4 ring-cat shadow-glow' : ''}`}>
      <div className="relative aspect-video w-full bg-black">
        {playing ? (
          <iframe className="absolute inset-0 h-full w-full" title={video.title}
            src={`https://www.youtube-nocookie.com/embed/${video.youtube_id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&cc_load_policy=1&cc_lang_pref=${lang}&hl=${lang}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        ) : (
          <button onClick={() => { stop(); setPlaying(true) }} className="group absolute inset-0" aria-label={t('वीडियो चलाएँ', 'Play video')}>
            <img src={`https://i.ytimg.com/vi/${video.youtube_id}/hqdefault.jpg`} alt=""
              className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-24 w-24 place-items-center rounded-full bg-crit text-white shadow-[0_10px_40px_rgba(0,0,0,0.6)] transition-transform group-active:scale-95">
                <Pictogram name="play" className="ml-1 h-14 w-14" />
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 p-4">
        <Pictogram name="play" className="h-8 w-8 shrink-0 text-crit" />
        <div className="min-w-0 flex-1">
          <p className={`text-lg font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('मशीन कैसे चलाएँ, वीडियो देखें', 'Watch: how to operate')}</p>
          <p className={`text-sm text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(video.about_hi, video.about_en)}</p>
        </div>
      </div>
    </section>
  )
}
