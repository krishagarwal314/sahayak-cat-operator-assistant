import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../lib/i18n'
import { useVoiceOut } from '../lib/speechContext'
import type { MachineVideo } from './VideoCard'
import { Pictogram } from './Pictogram'

/** Full-screen video. One thing on screen: the video, and a big way out. */
export function VideoOverlay({ video, onClose }: { video: MachineVideo; onClose: () => void }) {
  const { lang } = useLang()
  const { stop } = useVoiceOut()
  useEffect(() => { stop() }, [stop])
  // Portalled to <body>: an animated parent would otherwise trap a fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      <div className="flex items-center justify-end p-3">
        <button onClick={onClose} aria-label="close"
          className="flex h-14 items-center gap-2 rounded-2xl bg-white/15 px-5 text-lg font-bold text-white">
          <Pictogram name="cross" className="h-7 w-7" />{lang === 'hi' ? 'बंद करें' : 'Close'}
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 pb-6">
        <div className="relative aspect-video w-full max-w-4xl">
          <iframe className="absolute inset-0 h-full w-full rounded-xl" title={video.title}
            src={`https://www.youtube-nocookie.com/embed/${video.youtube_id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&cc_load_policy=1&cc_lang_pref=${lang}&hl=${lang}`}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        </div>
        <a href={`https://www.youtube.com/watch?v=${video.youtube_id}`} target="_blank" rel="noreferrer"
           className={`text-base font-bold text-mute underline ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {lang === 'hi' ? 'नहीं चल रहा? यूट्यूब पर खोलें' : 'Not playing? Open on YouTube'}
        </a>
      </div>
    </div>,
    document.body,
  )
}
