import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import { usePageIntro } from '../lib/usePageIntro'
import type { MachineCard, MachineDetail, Reading } from '../lib/types'
import { MachineIcon } from '../components/MachineIcon'
import { INTENT_ICON, Pictogram, SENSOR_ICON } from '../components/Pictogram'
import { PageHeader, SpeakButton, toneOf, useAnswer } from '../components/Simple'

/** Tapping a tile asks about that sensor, so the answer is spoken, not just shown. */
const SENSOR_INTENT: Record<string, string> = {
  fuel_level_pct: 'FUEL_STATUS', engine_temp_c: 'ENGINE_TEMP', hydraulic_temp_c: 'HYDRAULIC_TEMP',
  transmission_temp_c: 'TRANSMISSION_TEMP', idling_time_min: 'IDLE_TIME', load_cycles: 'LOAD_CYCLES',
  payload_kg: 'PAYLOAD_STATUS', tire_pressure_psi: 'TIRE_PRESSURE', track_tension_pct: 'TRACK_TENSION',
  undercarriage_wear_pct: 'UNDERCARRIAGE_WEAR', seatbelt: 'SEATBELT_STATUS', proximity_objects: 'PROXIMITY_HAZARD',
}

/** The few readings an operator actually needs, in the order they scan them. */
const TILES: Record<string, string[]> = {
  excavator: ['fuel_level_pct', 'engine_temp_c', 'hydraulic_temp_c', 'seatbelt', 'idling_time_min', 'load_cycles'],
  loader: ['fuel_level_pct', 'engine_temp_c', 'transmission_temp_c', 'seatbelt', 'payload_kg', 'tire_pressure_psi'],
  dozer: ['fuel_level_pct', 'engine_temp_c', 'transmission_temp_c', 'seatbelt', 'undercarriage_wear_pct', 'track_tension_pct'],
}

const UNIT_HI: Record<string, string> = { min: 'मिनट', cycles: 'साइकिल', kg: 'किलो', h: 'घंटे' }

function unitFor(reading: Reading, lang: 'hi' | 'en'): string {
  return lang === 'hi' ? (UNIT_HI[reading.unit] ?? reading.unit) : reading.unit
}

function shortValue(reading: Reading, lang: 'hi' | 'en'): string {
  if (reading.key === 'seatbelt') return reading.value === 'Fastened' ? (lang === 'hi' ? 'लगी है' : 'On') : (lang === 'hi' ? 'नहीं लगी' : 'Off')
  if (reading.key === 'proximity_objects') return Number(reading.value) ? (lang === 'hi' ? 'कोई पास है' : 'Someone near') : (lang === 'hi' ? 'साफ़' : 'Clear')
  const n = Number(reading.value)
  return Number.isFinite(n) ? `${Math.round(n)}` : String(reading.value)
}

// ================================================================ picker
function Picker() {
  const { lang } = useLang()
  const navigate = useNavigate()
  const { selectMachine } = useSession()
  const { speak, stop, speakingId } = useVoiceOut()
  const { replay } = usePageIntro('machines', speak)
  const [machines, setMachines] = useState<MachineCard[]>([])

  useEffect(() => { api.machines().then(setMachines).catch(() => undefined) }, [])

  async function pick(machine: MachineCard) {
    stop()
    await selectMachine(machine.id)
    // First stop after choosing: what this machine is and how to be safe on it.
    navigate('/machine/about')
  }

  const identify = (machine: MachineCard) =>
    (lang === 'hi' ? machine.identify_hi : machine.identify_en) ?? (lang === 'hi' ? machine.name_hi : machine.name_en)

  return (
    <div className="space-y-5">
      <PageHeader icon={<MachineIcon family="excavator" className="h-10 w-12" />}
        title={lang === 'hi' ? 'अपनी मशीन चुनें' : 'Choose your machine'}
        onReplay={replay} speaking={speakingId === 'intro-machines'} />

      <div className="flex items-center gap-3 rounded-2xl bg-ink-800 px-4 py-3">
        <Pictogram name="mic" className="h-8 w-8 shrink-0 text-cat" />
        <p className={`text-lg text-slate-200 ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {lang === 'hi' ? 'या नीचे माइक दबाकर बोलिए: “लोडर चुनो”' : 'Or hold the mic below and say: “select the loader”'}
        </p>
      </div>

      {machines.map((machine) => {
        const tone = toneOf(machine.status)
        const id = `which-${machine.id}`
        return (
          <div key={machine.id}
            className={`flex items-stretch overflow-hidden rounded-[28px] border-2 bg-ink-800 ${machine.assigned ? 'border-cat' : 'border-line'}`}>
            <button onClick={() => void pick(machine)}
              className="flex min-w-0 flex-1 items-center gap-4 p-4 text-left transition-colors active:bg-ink-700">
              <div className="grid h-24 w-28 shrink-0 place-items-center rounded-3xl bg-cat/10 text-cat">
                <MachineIcon family={machine.family} className="h-16 w-20" />
              </div>
              <div className="min-w-0 flex-1">
                {machine.assigned && (
                  <span className={`mb-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-cat px-2.5 py-1 text-xs font-extrabold text-ink-900 ${lang === 'hi' ? 'lang-hi leading-none' : ''}`}>
                    <Pictogram name="star" className="h-3.5 w-3.5 shrink-0" />{lang === 'hi' ? 'आज की मशीन' : "Today's machine"}
                  </span>
                )}
                <div className={`text-[24px] font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                  {lang === 'hi' ? machine.short_hi : machine.family[0].toUpperCase() + machine.family.slice(1)}
                </div>
                <div className="mt-0.5 text-base font-semibold text-mute">{machine.model}</div>
                <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${tone.bg} ${tone.text}`}>
                  <Pictogram name={tone.icon} className="h-5 w-5" />
                  <span className={`text-sm font-bold ${lang === 'hi' ? 'lang-hi' : ''}`}>
                    {machine.status === 'ok' ? (lang === 'hi' ? 'ठीक है' : 'Good')
                      : machine.status === 'crit' ? (lang === 'hi' ? 'खतरा' : 'Danger') : (lang === 'hi' ? 'ध्यान दें' : 'Check')}
                  </span>
                </div>
              </div>
            </button>
            {/* "Which machine is this?" - tells the operator before they choose */}
            <div className="flex items-center border-l border-line-soft px-3">
              <SpeakButton size="lg" label="which machine is this"
                active={speakingId === id}
                onClick={() => (speakingId === id ? stop() : void speak(identify(machine), lang, id, true))} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ================================================================ machine view
function MachineView({ onChange }: { onChange: () => void }) {
  const { lang } = useLang()
  const navigate = useNavigate()
  const { machineId } = useSession()
  const { speak, speakingId } = useVoiceOut()
  const { askIntent, busy } = useAnswer()
  const { replay } = usePageIntro('machine', speak)
  const [detail, setDetail] = useState<MachineDetail | null>(null)

  const load = useCallback(() => {
    if (machineId) api.machine(machineId).then(setDetail).catch(() => undefined)
  }, [machineId])

  useEffect(() => {
    load()
    const timer = window.setInterval(() => {
      if (machineId) api.telemetry(machineId).then((telemetry) => setDetail((d) => d && { ...d, telemetry })).catch(() => undefined)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [load, machineId])

  if (!detail) return <div className="h-64 animate-pulse rounded-3xl bg-ink-800" />

  const { machine, telemetry, health } = detail
  const verdict = health.counts.critical ? 'crit' : health.counts.warning ? 'warn' : 'ok'
  const tone = toneOf(verdict)
  const issues = health.counts.critical + health.counts.warning
  const verdictText = verdict === 'ok'
    ? (lang === 'hi' ? 'सब ठीक है' : 'All good')
    : verdict === 'crit'
      ? (lang === 'hi' ? 'रुकिए! खतरा है' : 'Stop! Danger')
      : (lang === 'hi' ? `${issues} बातों पर ध्यान दें` : `${issues} things to check`)
  const tiles = (TILES[machine.family] ?? TILES.excavator).map((k) => telemetry.sensors[k]).filter(Boolean) as Reading[]

  return (
    <div className="space-y-5">
      <PageHeader icon={<MachineIcon family={machine.family} className="h-10 w-12" />}
        title={lang === 'hi' ? machine.short_hi : machine.model}
        onReplay={replay} speaking={speakingId === 'intro-machine'} />

      {/* the verdict, in one glance */}
      <button onClick={() => void askIntent('MACHINE_HEALTH', verdictText)} disabled={busy}
        className={`flex w-full items-center gap-5 rounded-[28px] p-5 text-left ring-4 transition-all active:scale-[0.98] ${tone.bg} ${tone.ring}`}>
        <div className={`grid h-24 w-24 shrink-0 place-items-center rounded-full ${tone.solid} text-ink-900`}>
          <Pictogram name={tone.icon} className="h-16 w-16" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[28px] font-extrabold leading-tight ${tone.text} ${lang === 'hi' ? 'lang-hi' : ''}`}>{verdictText}</div>
          <div className={`mt-1 flex items-center gap-2 text-base text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>
            <Pictogram name="speaker" className="h-5 w-5" />{lang === 'hi' ? 'सुनने के लिए दबाइए' : 'Tap to hear'}
          </div>
        </div>
      </button>

      {/* the readings that matter, as pictures */}
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((reading) => {
          const t = toneOf(reading.status)
          const label = lang === 'hi' ? reading.label_hi : reading.label_en
          const intent = SENSOR_INTENT[reading.key]
          return (
            <button key={reading.key} disabled={busy || !intent}
              onClick={() => intent && void askIntent(intent, label)}
              className={`relative flex flex-col items-start gap-2 rounded-3xl border-2 bg-ink-800 p-4 text-left transition-all active:scale-95
                ${reading.status === 'ok' ? 'border-line' : t.border}`}>
              <span className={`absolute right-3 top-3 ${t.text}`}><Pictogram name={t.icon} className="h-7 w-7" /></span>
              <Pictogram name={SENSOR_ICON[reading.key] ?? 'gauge'} className={`h-12 w-12 ${reading.status === 'ok' ? 'text-cat' : t.text}`} />
              <div className="flex items-baseline gap-1.5">
                {/* Numbers in the tabular face; words in the Devanagari face, which
                    the monospace font breaks apart. */}
                <span className={`${typeof reading.value === 'number' ? 'font-mono text-[34px]' : `text-[26px] ${lang === 'hi' ? 'lang-hi' : ''}`}
                  font-bold leading-none ${reading.status === 'ok' ? 'text-white' : t.text}`}>
                  {shortValue(reading, lang)}
                </span>
                {typeof reading.value === 'number' && (
                  <span className={`text-base text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>{unitFor(reading, lang)}</span>
                )}
              </div>
              <span className={`text-base font-semibold leading-tight text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>{label}</span>
            </button>
          )
        })}
      </div>

      {/* questions as pictures */}
      {detail.suggestions.length > 0 && (
        <div>
          <p className={`mb-3 flex items-center gap-2 text-lg font-bold text-slate-200 ${lang === 'hi' ? 'lang-hi' : ''}`}>
            <Pictogram name="help" className="h-7 w-7 text-cat" />{lang === 'hi' ? 'दबाकर पूछें' : 'Tap to ask'}
          </p>
          <div className="grid grid-cols-1 gap-2">
            {detail.suggestions.map((s) => {
              const label = lang === 'hi' ? s.label_hi : s.label_en
              return (
                <button key={s.id} onClick={() => void askIntent(s.intent, label)} disabled={busy}
                  className="flex min-h-[64px] items-center gap-4 rounded-2xl bg-ink-800 px-4 py-3 text-left transition-all active:scale-[0.98]">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-cat/15 text-cat">
                    <Pictogram name={INTENT_ICON[s.intent] ?? 'help'} className="h-8 w-8" />
                  </span>
                  <span className={`text-lg font-semibold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/machine/about')}
          className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-cat/50 bg-cat/10 text-base font-bold text-cat">
          <Pictogram name="book" className="h-8 w-8" />{lang === 'hi' ? 'मशीन की जानकारी' : 'About this machine'}
        </button>
        <button onClick={onChange}
          className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-line text-base font-bold text-slate-200">
          <Pictogram name="switch" className="h-8 w-8" />{lang === 'hi' ? 'मशीन बदलें' : 'Change machine'}
        </button>
      </div>
    </div>
  )
}

export default function MachineHome() {
  const { machineId } = useSession()
  const [params, setParams] = useSearchParams()
  const picking = !machineId || params.get('pick') === '1'
  return picking
    ? <Picker />
    : <MachineView onChange={() => setParams({ pick: '1' })} />
}
