import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoice } from '../lib/useVoice'
import type { AskResult, MachineCard } from '../lib/types'
import { Loading, Panel, StatusPill, Toast, tone } from '../components/ui'
import { MachineIcon } from '../components/MachineIcon'
import { MicButton } from '../components/MicButton'

export default function MachineSelect() {
  const { t, lang } = useLang()
  const { selectMachine } = useSession()
  const navigate = useNavigate()

  const [machines, setMachines] = useState<MachineCard[] | null>(null)
  const [toast, setToast] = useState('')
  const [heard, setHeard] = useState('')

  useEffect(() => {
    api.machines().then(setMachines).catch((e) => setToast(String(e.message ?? e)))
  }, [])

  const open = useCallback(async (machineId: string) => {
    await selectMachine(machineId)
    navigate('/cockpit')
  }, [navigate, selectMachine])

  const onVoiceResult = useCallback((result: AskResult) => {
    setHeard(result.transcript ?? result.route.text)
    const target = result.switched_machine
      ?? (result.route.intent === 'SWITCH_MACHINE' ? result.reply.data?.machine_id : null)
    if (target) {
      void open(target)
      return
    }
    setToast(lang === 'hi'
      ? 'कौन सी मशीन चाहिए, यह समझ नहीं आया। नाम लेकर कहिए, जैसे "लोडर चुनो"।'
      : 'I could not tell which machine you meant. Try naming it, e.g. "select the loader".')
  }, [lang, open])

  // Any machine works as the routing context here; SWITCH_MACHINE carries the target.
  const voice = useVoice({
    machineId: machines?.[0]?.id ?? 'EXC001',
    lang,
    speak: false,
    onResult: onVoiceResult,
    onError: setToast,
  })

  if (!machines) return <Loading />

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className={`text-2xl font-extrabold tracking-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {t('machines.title')}
          </h1>
          <p className="mt-1 text-sm text-mute">{t('machines.subtitle')}</p>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-line bg-ink-800/70 px-5 py-3">
          <MicButton
            state={voice.state}
            onStart={voice.start}
            onStop={voice.stop}
            size="md"
          />
          <div className="max-w-[210px]">
            <div className="text-xs font-bold text-slate-200">
              {voice.state === 'recording' ? t('cockpit.listening')
                : voice.state === 'processing' ? t('cockpit.thinking')
                : t('machines.voiceSelect')}
            </div>
            <div className="mt-0.5 text-[11px] leading-tight text-mute">
              {heard || t('machines.voiceHint')}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {machines.map((machine) => {
          const statusTone = tone(machine.status)
          const name = lang === 'hi' ? machine.name_hi : machine.name_en
          const questions = lang === 'hi' ? machine.quick_questions_hi : machine.quick_questions_en

          return (
            <button
              key={machine.id}
              onClick={() => open(machine.id)}
              className={`panel group relative overflow-hidden p-0 text-left transition-all duration-200
                          hover:-translate-y-0.5 hover:border-cat/50 hover:shadow-glow
                          ${machine.assigned ? 'ring-1 ring-cat/30' : ''}`}
            >
              {machine.assigned && (
                <span className="absolute right-0 top-0 rounded-bl-xl bg-cat px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-900">
                  {t('machines.assigned')}
                </span>
              )}

              <div className="flex items-start gap-4 p-5">
                <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-line-soft
                                 bg-ink-700/70 transition-colors group-hover:border-cat/40 ${statusTone.text}`}>
                  <MachineIcon family={machine.family} className="h-10 w-10" />
                </div>
                <div className="min-w-0 flex-1 pr-14">
                  <div className="font-mono text-[11px] text-mute">{machine.id}</div>
                  <h2 className={`mt-0.5 truncate text-base font-bold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                    {name}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-mute">{machine.site}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 px-5">
                <StatusPill status={machine.status} />
                {machine.attention_count > 0 && (
                  <span className="rounded-full bg-ink-600 px-2 py-1 text-[11px] font-medium text-mute">
                    {machine.attention_count} {lang === 'hi' ? 'सेंसर ध्यान माँगते हैं' : 'sensors need attention'}
                  </span>
                )}
                <span className={`rounded-full px-2 py-1 text-[11px] font-medium
                  ${machine.certified ? 'bg-ok/10 text-ok' : 'bg-crit/10 text-crit'}`}>
                  {machine.certified ? t('machines.certified') : t('machines.notCertified')}
                </span>
              </div>

              <div className="mt-4 border-t border-line-soft px-5 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-mute">
                    <span className="font-mono text-sm font-bold text-slate-200">{machine.task_count}</span>{' '}
                    {t('machines.tasksToday')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cat opacity-0 transition-opacity group-hover:opacity-100">
                    {t('machines.open')}
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </span>
                </div>
                {questions[0] && (
                  <p className={`mt-2 truncate text-[11px] text-mute/80 ${lang === 'hi' ? 'lang-hi' : ''}`}>
                    “{questions[0]}”
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <Panel className="mt-6" bodyClass="px-5 py-4">
        <p className="text-xs leading-relaxed text-mute">
          {lang === 'hi'
            ? 'हर मशीन के अपने सेंसर हैं, इसलिए वही सवाल हर मशीन पर अलग जवाब देता है। जो सेंसर मौजूद नहीं है, सहायक साफ़ मना कर देता है, अंदाज़ा नहीं लगाता।'
            : 'Each machine exposes its own sensors, so the same question is answered differently per machine. Where a sensor does not exist, the assistant says so plainly instead of guessing.'}
        </p>
      </Panel>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  )
}
