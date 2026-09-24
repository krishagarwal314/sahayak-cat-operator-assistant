import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import { usePageIntro } from '../lib/usePageIntro'
import type { MachineCard, MachineDetail, Reading } from '../lib/types'
import { MachineIcon } from '../components/MachineIcon'
import { Pictogram, SENSOR_ICON } from '../components/Pictogram'
import { PageHeader, SpeakButton, toneOf, useAnswer } from '../components/Simple'
import { IncidentReport } from '../components/IncidentReport'
import type { MachineVideo } from '../components/VideoCard'
import { VideoOverlay } from '../components/VideoOverlay'

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
          {lang === 'hi' ? 'या नीचे माइक दबाकर बोलिए: “एक्सकेवेटर चुनो”' : 'Or tap the mic below and say: “select the excavator”'}
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
interface Warning { key: string; icon: string; severity: 'crit' | 'warn'; hi: string; en: string }

/** Everything that needs the operator's attention right now, most dangerous first. */
function warningsFor(detail: MachineDetail): Warning[] {
  const out: Warning[] = []
  const sensors = detail.telemetry.sensors
  if (sensors.seatbelt && sensors.seatbelt.value !== 'Fastened') {
    out.push({ key: 'belt', icon: 'seatbelt', severity: 'crit', hi: 'सीट बेल्ट नहीं लगी है। अभी लगाइए।', en: 'Seatbelt is not fastened. Fasten it now.' })
  }
  if (Number(sensors.proximity_objects?.value ?? 0) > 0) {
    out.push({ key: 'near', icon: 'proximity', severity: 'crit', hi: 'मशीन के पास कोई है। रुकिए और देखिए।', en: 'Someone is near the machine. Stop and look.' })
  }
  // Predicted risk, weather, night work and fatigue - for every machine.
  for (const extra of (detail as MachineDetail & { safety_extra?: Warning[] }).safety_extra ?? []) {
    out.push({ key: extra.key, icon: extra.icon, severity: extra.severity, hi: extra.hi, en: extra.en })
  }
  const findings = [...detail.health.findings]
    .filter((f) => f.severity !== 'info' && !/SEATBELT|PROXIMITY/.test(f.code))
    .sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1))
  for (const f of findings) {
    const icon = /FUEL/.test(f.code) ? 'fuel' : /IDL/.test(f.code) ? 'idle' : /THERMAL|TEMP/.test(f.code) ? 'temp'
      : /TIRE/.test(f.code) ? 'tire' : /UNDERCARRIAGE|TRACK/.test(f.code) ? 'track' : /SERVICE/.test(f.code) ? 'wrench' : 'alert'
    out.push({ key: f.code, icon, severity: f.severity === 'critical' ? 'crit' : 'warn', hi: f.title.hi, en: f.title.en })
  }
  return out.slice(0, 5)
}

/** Make sure a line ends in a full stop: the voice only pauses where one is. */
const endSentence = (text: string, stop: string) => (/[।.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}${stop}`)

function safetySpeech(warnings: Warning[], lang: 'hi' | 'en'): string {
  if (lang === 'hi') {
    return warnings.length
      ? `सबसे पहले सुरक्षा। ध्यान दीजिए। ${warnings.map((w, i) => `नंबर ${i + 1}। ${endSentence(w.hi, '।')}`).join(' ')}`
      : 'सबसे पहले सुरक्षा। सब ठीक है। सीट बेल्ट लगी है और आसपास कोई नहीं है।'
  }
  return warnings.length
    ? `Safety first. Please note. ${warnings.map((w, i) => `Number ${i + 1}. ${endSentence(w.en, '.')}`).join(' ')}`
    : 'Safety first. All clear. Your seatbelt is on and nobody is nearby.'
}

function MachineView({ onChange }: { onChange: () => void }) {
  const { lang } = useLang()
  const navigate = useNavigate()
  const { machineId } = useSession()
  const { speak, stop, speakingId } = useVoiceOut()
  const { askIntent, busy } = useAnswer()
  const [detail, setDetail] = useState<(MachineDetail & { video?: MachineVideo }) | null>(null)
  const [showVideo, setShowVideo] = useState(false)
  const spokenFor = useRef<string | null>(null)

  const load = useCallback(() => {
    if (machineId) api.machine(machineId).then(setDetail).catch(() => undefined)
  }, [machineId])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 8000)
    return () => window.clearInterval(timer)
  }, [load])

  const warnings = detail ? warningsFor(detail) : []
  const arrival = detail ? `${safetySpeech(warnings, lang)} ${lang === 'hi'
    ? 'मशीन चलाना देखने के लिए लाल वीडियो बटन दबाइए।'
    : 'To see how to operate it, tap the red video button.'}` : ''

  // Safety first, the moment the page opens. Once per machine.
  useEffect(() => {
    if (!detail) return
    const stamp = `${detail.machine.id}:${lang}`
    if (spokenFor.current === stamp) return
    spokenFor.current = stamp
    const timer = window.setTimeout(() => void speak(arrival, lang, 'intro-machine', true), 450)
    return () => window.clearTimeout(timer)
  }, [detail, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail) return <div className="h-64 animate-pulse rounded-3xl bg-ink-800" />

  const { machine, telemetry } = detail
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)
  const crit = warnings.filter((w) => w.severity === 'crit').length
  const level = crit ? 'crit' : warnings.length ? 'warn' : 'ok'
  const tone = toneOf(level)
  const headline = level === 'ok' ? t('सब सुरक्षित है', 'All safe')
    : level === 'crit' ? t(`रुकिए! ${warnings.length} खतरे`, `Stop! ${warnings.length} dangers`)
    : t(`${warnings.length} बातों पर ध्यान दें`, `${warnings.length} things to check`)
  const tiles = (TILES[machine.family] ?? TILES.excavator)
    .filter((k) => k !== 'seatbelt' && k !== 'load_cycles').slice(0, 4)
    .map((k) => telemetry.sensors[k]).filter(Boolean) as Reading[]

  return (
    <div className="space-y-4">
      <PageHeader icon={<MachineIcon family={machine.family} className="h-10 w-12" />}
        title={lang === 'hi' ? machine.short_hi : machine.model}
        onReplay={() => (speakingId === 'intro-machine' ? stop() : void speak(arrival, lang, 'intro-machine', true))}
        speaking={speakingId === 'intro-machine'} />

      {/* 1. safety - one card, read first */}
      <button onClick={() => (speakingId === 'safety' ? stop() : void speak(safetySpeech(warnings, lang), lang, 'safety', true))}
        className={`flex w-full items-center gap-4 rounded-[28px] p-5 text-left ring-4 transition-all active:scale-[0.98] ${tone.bg} ${tone.ring}`}>
        <span className={`grid h-20 w-20 shrink-0 place-items-center rounded-full text-ink-900 ${tone.solid}`}>
          <Pictogram name={level === 'ok' ? 'shield' : tone.icon} className="h-12 w-12" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[26px] font-extrabold leading-tight ${tone.text} ${lang === 'hi' ? 'lang-hi' : ''}`}>{headline}</span>
          {warnings[0] && (
            <span className={`mt-1 block text-lg leading-snug text-slate-100 ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(warnings[0].hi, warnings[0].en)}</span>
          )}
        </span>
        <Pictogram name={speakingId === 'safety' ? 'pause' : 'speaker'} className="h-8 w-8 shrink-0 text-slate-300" />
      </button>

      {/* 2. two big actions */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => { stop(); setShowVideo(true) }} disabled={!detail.video}
          className="flex h-32 flex-col items-center justify-center gap-2 rounded-[28px] bg-crit text-white shadow-[0_12px_28px_-12px_rgba(255,90,95,0.9)] active:scale-95 disabled:opacity-40">
          <Pictogram name="play" className="h-14 w-14" />
          <span className={`text-xl font-extrabold ${lang === 'hi' ? 'lang-hi leading-none' : ''}`}>{t('वीडियो', 'Video')}</span>
        </button>
        <button onClick={() => navigate('/machine/about')}
          className="flex h-32 flex-col items-center justify-center gap-2 rounded-[28px] bg-cat text-ink-900 shadow-[0_12px_28px_-12px_rgba(255,205,17,0.9)] active:scale-95">
          <Pictogram name="book" className="h-14 w-14" />
          <span className={`text-xl font-extrabold ${lang === 'hi' ? 'lang-hi leading-none' : ''}`}>{t('जानकारी', 'About')}</span>
        </button>
      </div>

      {/* live machine and cab guard */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/live')}
          className="flex h-24 items-center justify-center gap-3 rounded-[28px] border-2 border-cat/60 bg-cat/10 text-white active:scale-95">
          <Pictogram name="proximity" className="h-11 w-11 text-cat" />
          <span className={`text-lg font-extrabold leading-tight ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('लाइव मशीन', 'Live machine')}</span>
        </button>
        <button onClick={() => navigate('/guard')}
          className="flex h-24 items-center justify-center gap-3 rounded-[28px] border-2 border-ok/60 bg-ok/10 text-white active:scale-95">
          <Pictogram name="face" className="h-11 w-11 text-ok" />
          <span className={`text-lg font-extrabold leading-tight ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('केबिन गार्ड', 'Cab guard')}</span>
        </button>
      </div>

      {/* 3. four readings - tap one to hear it */}
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((reading) => {
          const tt = toneOf(reading.status)
          const label = lang === 'hi' ? reading.label_hi : reading.label_en
          const intent = SENSOR_INTENT[reading.key]
          return (
            <button key={reading.key} disabled={busy || !intent} onClick={() => intent && void askIntent(intent, label)}
              className={`relative flex flex-col items-start gap-1.5 rounded-3xl border-2 bg-ink-800 p-4 text-left transition-all active:scale-95
                ${reading.status === 'ok' ? 'border-line' : tt.border}`}>
              <span className={`absolute right-3 top-3 ${tt.text}`}><Pictogram name={tt.icon} className="h-6 w-6" /></span>
              <Pictogram name={SENSOR_ICON[reading.key] ?? 'gauge'} className={`h-10 w-10 ${reading.status === 'ok' ? 'text-cat' : tt.text}`} />
              <span className="flex items-baseline gap-1.5">
                <span className={`font-mono text-[30px] font-bold leading-none ${reading.status === 'ok' ? 'text-white' : tt.text}`}>{shortValue(reading, lang)}</span>
                {typeof reading.value === 'number' && <span className={`text-sm text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>{unitFor(reading, lang)}</span>}
              </span>
              <span className={`text-sm font-semibold leading-tight text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>{label}</span>
            </button>
          )
        })}
      </div>

      {/* 4. the rarely needed things, kept small */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <IncidentReport machineId={machine.id} onSent={load} compact />
        <button onClick={onChange}
          className="flex h-16 items-center justify-center gap-2 rounded-2xl border-2 border-line text-base font-bold text-slate-200">
          <Pictogram name="switch" className="h-7 w-7" />{t('मशीन बदलें', 'Change')}
        </button>
      </div>

      {showVideo && detail.video && <VideoOverlay video={detail.video} onClose={() => setShowVideo(false)} />}
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
