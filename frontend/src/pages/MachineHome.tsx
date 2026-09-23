import { useCallback, useEffect, useRef, useState } from 'react'
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
import { IncidentReport } from '../components/IncidentReport'
import { VideoCard, type MachineVideo } from '../components/VideoCard'

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
    ? 'मशीन कैसे चलाते हैं, यह देखने के लिए लाल बटन वाली वीडियो दबाइए। कुछ भी पूछना हो तो माइक दबाकर बोलिए।'
    : 'To see how to operate the machine, tap the video with the red button. To ask anything, hold the mic and speak.'}` : ''

  // On arrival: safety first, then how to use this page. Once per machine.
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
  const beltOn = telemetry.sensors.seatbelt?.value === 'Fastened'
  const near = Number(telemetry.sensors.proximity_objects?.value ?? 0) > 0
  const tiles = (TILES[machine.family] ?? TILES.excavator)
    .filter((k) => k !== 'seatbelt')
    .map((k) => telemetry.sensors[k]).filter(Boolean) as Reading[]
  const anyCrit = warnings.some((w) => w.severity === 'crit')

  return (
    <div className="space-y-5">
      <PageHeader icon={<MachineIcon family={machine.family} className="h-10 w-12" />}
        title={lang === 'hi' ? machine.short_hi : machine.model}
        onReplay={() => (speakingId === 'intro-machine' ? stop() : void speak(arrival, lang, 'intro-machine', true))}
        speaking={speakingId === 'intro-machine'} />

      {/* ---------------- safety first ---------------- */}
      <section className={`rounded-[28px] border-2 p-5 ${warnings.length
        ? (anyCrit ? 'border-crit bg-crit/[0.09]' : 'border-warn bg-warn/[0.08]') : 'border-ok/60 bg-ok/[0.07]'}`}>
        <div className="mb-4 flex items-center gap-3">
          <Pictogram name="shield" className={`h-10 w-10 ${warnings.length ? (anyCrit ? 'text-crit' : 'text-warn') : 'text-ok'}`} />
          <h2 className={`flex-1 text-[24px] font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('सबसे पहले सुरक्षा', 'Safety first')}</h2>
          <SpeakButton active={speakingId === 'safety'}
            onClick={() => (speakingId === 'safety' ? stop() : void speak(safetySpeech(warnings, lang), lang, 'safety', true))} />
        </div>

        {warnings.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-ink-900/50 p-4">
            <Pictogram name="check" className="h-12 w-12 shrink-0 text-ok" />
            <p className={`text-xl font-bold text-ok ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('सब सुरक्षित है', 'All clear')}</p>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {warnings.map((w, i) => {
              const tone = toneOf(w.severity)
              return (
                <li key={w.key} className="flex items-center gap-3 rounded-2xl bg-ink-900/60 p-3">
                  <span className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${tone.bg} ${tone.text}`}>
                    <Pictogram name={w.icon} className="h-10 w-10" />
                    <span className={`absolute -left-2 -top-2 grid h-7 w-7 place-items-center rounded-full text-sm font-extrabold text-ink-900 ${tone.solid}`}>{i + 1}</span>
                  </span>
                  <span className={`text-lg font-semibold leading-snug text-slate-100 ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(w.hi, w.en)}</span>
                </li>
              )
            })}
          </ol>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          {[
            { key: 'belt', icon: 'seatbelt', ok: beltOn, intent: 'SEATBELT_STATUS', label: t('सीट बेल्ट', 'Seatbelt'),
              value: beltOn ? t('लगी है', 'On') : t('नहीं लगी', 'Off') },
            { key: 'near', icon: 'proximity', ok: !near, intent: 'PROXIMITY_HAZARD', label: t('आसपास', 'Around'),
              value: near ? t('कोई है!', 'Someone!') : t('साफ़', 'Clear') },
          ].map((card) => {
            const tone = toneOf(card.ok ? 'ok' : 'crit')
            return (
              <button key={card.key} onClick={() => void askIntent(card.intent, card.label)} disabled={busy}
                className={`relative flex flex-col items-center gap-1 rounded-3xl bg-ink-900/60 p-4 ring-2 transition-all active:scale-95 ${tone.ring}`}>
                <span className={`absolute right-2.5 top-2.5 ${tone.text}`}><Pictogram name={tone.icon} className="h-6 w-6" /></span>
                <Pictogram name={card.icon} className={`h-14 w-14 ${tone.text}`} />
                <span className={`text-base font-bold text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>{card.label}</span>
                <span className={`text-xl font-extrabold ${tone.text} ${lang === 'hi' ? 'lang-hi' : ''}`}>{card.value}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-4">
          <IncidentReport machineId={machine.id} onSent={load} />
        </div>
      </section>

      {/* ---------------- how to operate: the video ---------------- */}
      {detail.video && <VideoCard video={detail.video} />}

      {/* ---------------- readings ---------------- */}
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((reading) => {
          const tone = toneOf(reading.status)
          const label = lang === 'hi' ? reading.label_hi : reading.label_en
          const intent = SENSOR_INTENT[reading.key]
          return (
            <button key={reading.key} disabled={busy || !intent}
              onClick={() => intent && void askIntent(intent, label)}
              className={`relative flex flex-col items-start gap-2 rounded-3xl border-2 bg-ink-800 p-4 text-left transition-all active:scale-95
                ${reading.status === 'ok' ? 'border-line' : tone.border}`}>
              <span className={`absolute right-3 top-3 ${tone.text}`}><Pictogram name={tone.icon} className="h-7 w-7" /></span>
              <Pictogram name={SENSOR_ICON[reading.key] ?? 'gauge'} className={`h-12 w-12 ${reading.status === 'ok' ? 'text-cat' : tone.text}`} />
              <div className="flex items-baseline gap-1.5">
                <span className={`${typeof reading.value === 'number' ? 'font-mono text-[34px]' : `text-[26px] ${lang === 'hi' ? 'lang-hi' : ''}`}
                  font-bold leading-none ${reading.status === 'ok' ? 'text-white' : tone.text}`}>
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

      {/* ---------------- questions as pictures ---------------- */}
      {detail.suggestions.length > 0 && (
        <div>
          <p className={`mb-3 flex items-center gap-2 text-lg font-bold text-slate-200 ${lang === 'hi' ? 'lang-hi' : ''}`}>
            <Pictogram name="help" className="h-7 w-7 text-cat" />{t('दबाकर पूछें', 'Tap to ask')}
          </p>
          <div className="grid grid-cols-1 gap-2">
            {detail.suggestions.map((sug) => {
              const label = lang === 'hi' ? sug.label_hi : sug.label_en
              return (
                <button key={sug.id} onClick={() => void askIntent(sug.intent, label)} disabled={busy}
                  className="flex min-h-[64px] items-center gap-4 rounded-2xl bg-ink-800 px-4 py-3 text-left transition-all active:scale-[0.98]">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-cat/15 text-cat">
                    <Pictogram name={INTENT_ICON[sug.intent] ?? 'help'} className="h-8 w-8" />
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
          <Pictogram name="book" className="h-8 w-8" />{t('मशीन की जानकारी', 'About this machine')}
        </button>
        <button onClick={onChange}
          className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-line text-base font-bold text-slate-200">
          <Pictogram name="switch" className="h-8 w-8" />{t('मशीन बदलें', 'Change machine')}
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
