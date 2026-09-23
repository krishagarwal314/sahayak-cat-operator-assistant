import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useVoiceOut } from '../lib/speechContext'
import { usePageIntro } from '../lib/usePageIntro'
import type { Briefing, Task } from '../lib/types'
import { MachineIcon } from '../components/MachineIcon'
import { Pictogram, TASK_ICON } from '../components/Pictogram'
import { PageHeader, SpeakButton } from '../components/Simple'

function duration(minutes: number, lang: 'hi' | 'en') {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (lang === 'hi') return h ? (m ? `${h} घंटे ${m} मिनट` : `${h} घंटे`) : `${m} मिनट`
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m} min`
}

export default function Work() {
  const { lang } = useLang()
  const navigate = useNavigate()
  const { speak, stop, speakingId } = useVoiceOut()
  const { replay } = usePageIntro('work', speak)
  const [briefing, setBriefing] = useState<Briefing | null>(null)

  const knownIds = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  // Poll for work the manager assigns while the operator is on this screen, and
  // say so out loud - someone who is not looking at the phone still finds out.
  useEffect(() => {
    let alive = true
    const load = () => api.briefing().then((b) => {
      if (!alive) return
      const ids = new Set(b.tasks.map((t) => t.id))
      if (knownIds.current) {
        const added = b.tasks.filter((t) => !knownIds.current!.has(t.id))
        if (added.length) {
          setFresh(new Set(added.map((t) => t.id)))
          const title = lang === 'hi' ? (added[0].hi.title ?? added[0].title_en) : added[0].title_en
          void speak(lang === 'hi' ? `नया काम आया है। ${title}।` : `New work has arrived. ${title}.`, lang, 'new-task', true)
        }
      }
      knownIds.current = ids
      setBriefing(b)
    }).catch(() => undefined)
    void load()
    const timer = window.setInterval(load, 15000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [lang, speak])

  async function setStatus(task: Task, status: Task['status']) {
    const updated = await api.setTaskStatus(task.id, status)
    setBriefing((b) => b && { ...b, tasks: b.tasks.map((t) => (t.id === task.id ? updated : t)) })
    const title = lang === 'hi' ? (task.hi.title ?? task.title_en) : task.title_en
    void speak(status === 'done'
      ? (lang === 'hi' ? `शाबाश! ${title} पूरा हुआ।` : `Well done! ${title} is complete.`)
      : (lang === 'hi' ? `${title} शुरू हो गया।` : `${title} has started.`), lang, 'status', true)
  }

  const listening = speakingId === 'briefing'

  return (
    <div className="space-y-5">
      <PageHeader icon={<Pictogram name="clipboard" className="h-10 w-10" />}
        title={lang === 'hi' ? 'आज का काम' : "Today's work"}
        onReplay={replay} speaking={speakingId === 'intro-work'} />

      {/* the one big action on this page */}
      <button
        onClick={() => (listening ? stop() : briefing && void speak(briefing.text[lang], lang, 'briefing', true))}
        disabled={!briefing}
        className={`flex h-28 w-full items-center gap-5 rounded-[28px] px-6 text-left transition-all active:scale-[0.98]
          ${listening ? 'bg-crit text-white' : 'bg-cat text-ink-900 shadow-[0_12px_32px_-12px_rgba(255,205,17,0.9)]'}`}>
        <span className={`grid h-20 w-20 shrink-0 place-items-center rounded-full ${listening ? 'bg-white/20' : 'bg-ink-900/10'}`}>
          <Pictogram name={listening ? 'pause' : 'speaker'} className="h-12 w-12" />
        </span>
        <span className={`text-[28px] font-extrabold leading-tight ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {listening ? (lang === 'hi' ? 'रोकें' : 'Stop') : (lang === 'hi' ? 'पूरा काम सुनें' : 'Hear all work')}
        </span>
      </button>

      {!briefing && <div className="h-40 animate-pulse rounded-3xl bg-ink-800" />}

      {briefing?.tasks.map((task, index) => {
        const title = (lang === 'hi' ? task.hi.title : task.title_en) || task.title_en
        const place = (lang === 'hi' ? task.hi.location : task.location) || task.location
        const minutes = task.estimate?.expected_minutes ?? task.planned_minutes
        const done = task.status === 'done'
        const running = task.status === 'in_progress'
        const spoken = lang === 'hi'
          ? `काम ${index + 1}। ${title}। जगह, ${place}। लगभग ${duration(minutes, 'hi')}। ${task.hi.safety_note ?? ''}`
          : `Task ${index + 1}. ${title}. At ${place}. About ${duration(minutes, 'en')}. ${task.safety_note_en}`

        return (
          <article key={task.id}
            className={`relative overflow-hidden rounded-[28px] border-2 bg-ink-800 transition-opacity
              ${done ? 'border-ok/40 opacity-70' : running ? 'border-cat' : fresh.has(task.id) ? 'border-ok animate-risein' : 'border-line'}`}>
            {fresh.has(task.id) && (
              <span className={`absolute right-4 top-3 z-10 rounded-full bg-ok px-3 py-1 text-sm font-extrabold text-ink-900 ${lang === 'hi' ? 'lang-hi leading-none' : ''}`}>
                {lang === 'hi' ? 'नया' : 'New'}
              </span>
            )}
            <div className="flex gap-4 p-4">
              {/* picture of the job, with its number */}
              <div className="relative shrink-0">
                <div className={`grid h-24 w-24 place-items-center rounded-3xl
                  ${done ? 'bg-ok/15 text-ok' : 'bg-cat/15 text-cat'}`}>
                  <Pictogram name={done ? 'check' : (TASK_ICON[task.task_type] ?? 'clipboard')} className="h-16 w-16" />
                </div>
                <span className="absolute -left-2 -top-2 grid h-10 w-10 place-items-center rounded-full border-4 border-ink-800 bg-white text-lg font-extrabold text-ink-900">
                  {index + 1}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <h2 className={`text-[21px] font-extrabold leading-snug text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{title}</h2>
                <div className="mt-2 space-y-1.5">
                  <p className="flex items-center gap-2 text-lg text-slate-200">
                    <Pictogram name="clock" className="h-6 w-6 shrink-0 text-cat" />{duration(minutes, lang)}
                  </p>
                  <p className={`flex items-center gap-2 text-base text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
                    <Pictogram name="pin" className="h-6 w-6 shrink-0 text-cat" /><span className="truncate">{place}</span>
                  </p>
                  <p className="flex items-center gap-2 text-base text-mute">
                    <MachineIcon family={task.machine.family} className="h-6 w-7 shrink-0 text-cat" />{task.machine.model}
                  </p>
                </div>
              </div>

              <SpeakButton onClick={() => (speakingId === task.id ? stop() : void speak(spoken, lang, task.id, true))}
                           active={speakingId === task.id} />
            </div>

            {running && (
              <div className="mx-4 mb-3 h-3 overflow-hidden rounded-full bg-ink-600">
                <div className="h-full rounded-full bg-cat transition-[width] duration-700"
                     style={{ width: `${Math.max(4, task.progress * 100)}%` }} />
              </div>
            )}

            {!done && (
              <div className="grid grid-cols-2 gap-2 border-t border-line-soft p-3">
                {task.guide_id && (
                  <button onClick={() => navigate(`/guide/${task.guide_id}`)}
                    className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-ink-700 text-lg font-bold text-slate-100">
                    <Pictogram name="book" className="h-8 w-8 text-cat" />{lang === 'hi' ? 'कैसे करें' : 'How to'}
                  </button>
                )}
                <button onClick={() => void setStatus(task, running ? 'done' : 'in_progress')}
                  className={`flex h-16 items-center justify-center gap-2 rounded-2xl text-lg font-extrabold text-ink-900
                    ${running ? 'bg-ok' : 'bg-cat'} ${task.guide_id ? '' : 'col-span-2'}`}>
                  <Pictogram name={running ? 'check' : 'play'} className="h-8 w-8" />
                  {running ? (lang === 'hi' ? 'पूरा हुआ' : 'Done') : (lang === 'hi' ? 'शुरू करें' : 'Start')}
                </button>
              </div>
            )}
          </article>
        )
      })}

      {briefing && (
        <button onClick={() => navigate('/machine')}
          className="flex h-20 w-full items-center justify-center gap-3 rounded-[28px] border-2 border-cat/50 bg-cat/10 text-2xl font-extrabold text-cat">
          <MachineIcon family={briefing.tasks[0]?.machine.family ?? 'excavator'} className="h-10 w-12" />
          {lang === 'hi' ? 'मशीन पर चलें' : 'Go to machine'}
          <Pictogram name="next" className="h-8 w-8" />
        </button>
      )}
    </div>
  )
}
