import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import { usePageIntro } from '../lib/usePageIntro'
import type { GuideSummary } from '../lib/types'
import { Pictogram } from '../components/Pictogram'
import { PageHeader } from '../components/Simple'

const COLOR: Record<string, string> = {
  amber: 'bg-cat/15 text-cat border-cat/40',
  green: 'bg-ok/15 text-ok border-ok/40',
  blue: 'bg-sky-400/15 text-sky-300 border-sky-400/40',
  red: 'bg-crit/15 text-crit border-crit/40',
}

export default function Learn() {
  const { lang } = useLang()
  const navigate = useNavigate()
  const { machineId } = useSession()
  const { speak, speakingId } = useVoiceOut()
  const { replay } = usePageIntro('learn', speak)
  const [guides, setGuides] = useState<GuideSummary[]>([])

  useEffect(() => { api.guides(machineId ?? undefined).then(setGuides).catch(() => undefined) }, [machineId])

  return (
    <div className="space-y-5">
      <PageHeader icon={<Pictogram name="book" className="h-10 w-10" />}
        title={lang === 'hi' ? 'मशीन चलाना सीखें' : 'Learn the machine'}
        onReplay={replay} speaking={speakingId === 'intro-learn'} />

      <div className="grid grid-cols-2 gap-3">
        {guides.map((guide) => {
          const title = lang === 'hi' ? guide.title_hi : guide.title_en
          return (
            <button key={guide.id} onClick={() => navigate(`/guide/${guide.id}`)}
              onFocus={() => void speak(title, lang, `g-${guide.id}`, true)}
              className={`flex flex-col items-center gap-3 rounded-[28px] border-2 p-5 text-center transition-all active:scale-95 ${COLOR[guide.color] ?? COLOR.amber}`}>
              <Pictogram name={guide.icon} className="h-20 w-20" />
              <span className={`text-lg font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{title}</span>
              <span className="flex gap-1.5" aria-label={`${guide.steps} steps`}>
                {Array.from({ length: guide.steps }).map((_, i) => (
                  <span key={i} className="h-2.5 w-2.5 rounded-full bg-current opacity-70" />
                ))}
              </span>
            </button>
          )
        })}
      </div>

      <button onClick={() => navigate('/pro/training')}
        className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-ink-800 text-lg font-bold text-slate-200">
        <Pictogram name="play" className="h-7 w-7 text-cat" />{lang === 'hi' ? 'वीडियो और टीचर' : 'Videos and trainers'}
      </button>
    </div>
  )
}
