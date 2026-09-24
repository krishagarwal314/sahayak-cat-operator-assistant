import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { siren } from '../lib/cabGuard'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import { usePageIntro } from '../lib/usePageIntro'
import type { MachineDetail } from '../lib/types'
import { Pictogram } from '../components/Pictogram'
import { PageHeader } from '../components/Simple'

type Sensor = { value: number | string; status: string; unit?: string }
const COLOR: Record<string, string> = { ok: '#3DD68C', warn: '#FFCD11', crit: '#FF5A5F' }
const colorOf = (s?: Sensor) => COLOR[s?.status ?? 'ok'] ?? COLOR.ok
const num = (s?: Sensor) => (typeof s?.value === 'number' ? Math.round(s.value as number) : s?.value ?? '-')

export const PEOPLE_ALERT = {
  hi: 'रुकिए! मशीन के घूमने वाले दायरे में आदमी है। मशीन मत घुमाइए।',
  en: 'Stop! A person is inside the swing zone. Do not swing the machine.',
}

/**
 * The machine, live. Top: a digital twin of the excavator going through its
 * dig cycle, each part coloured by its sensor (engine, hydraulics, tracks,
 * fuel, bucket, cab). Bottom: a 360 degree proximity radar - the swing danger
 * zone, the caution ring, and people around the machine.
 */
export default function Live() {
  const { lang } = useLang()
  const { machineId } = useSession()
  const { speak, speakingId } = useVoiceOut()
  const { replay } = usePageIntro('live', speak)
  const [detail, setDetail] = useState<MachineDetail | null>(null)
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)

  useEffect(() => {
    const load = () => machineId && api.machine(machineId).then(setDetail).catch(() => undefined)
    load()
    const timer = window.setInterval(load, 8000)
    return () => window.clearInterval(timer)
  }, [machineId])

  const sensors = (detail?.telemetry?.sensors ?? {}) as Record<string, Sensor>
  const part = (key: string) => {
    const s = sensors
    const lines: Record<string, [string, string]> = {
      engine: [`इंजन ${num(s.engine_temp_c)} डिग्री है। ${s.engine_temp_c?.status === 'ok' ? 'सब ठीक है।' : 'इंजन गरम है, भार कम कीजिए।'}`,
               `Engine is at ${num(s.engine_temp_c)} degrees. ${s.engine_temp_c?.status === 'ok' ? 'All good.' : 'It is hot, ease the load.'}`],
      hydraulic: [`हाइड्रोलिक तेल ${num(s.hydraulic_temp_c)} डिग्री, दबाव ${num(s.hydraulic_pressure_bar)} बार। ${s.hydraulic_temp_c?.status === 'ok' ? 'ठीक है।' : 'ध्यान दीजिए।'}`,
                  `Hydraulic oil at ${num(s.hydraulic_temp_c)} degrees, pressure ${num(s.hydraulic_pressure_bar)} bar. ${s.hydraulic_temp_c?.status === 'ok' ? 'All good.' : 'Needs attention.'}`],
      tracks: [`ट्रैक का खिंचाव ${num(s.track_tension_pct)} प्रतिशत है। ${s.track_tension_pct?.status === 'ok' ? 'ठीक है।' : 'जाँच करवाइए।'}`,
               `Track tension is ${num(s.track_tension_pct)} percent. ${s.track_tension_pct?.status === 'ok' ? 'All good.' : 'Get it checked.'}`],
      fuel: [`डीज़ल ${num(s.fuel_level_pct)} प्रतिशत है। ${s.fuel_level_pct?.status === 'ok' ? 'काफ़ी है।' : 'जल्दी भरवाइए।'}`,
             `Diesel is at ${num(s.fuel_level_pct)} percent. ${s.fuel_level_pct?.status === 'ok' ? 'Enough for now.' : 'Refuel soon.'}`],
      bucket: [`बकेट में ${num(s.bucket_payload_kg)} किलो माल है।`, `The bucket is carrying ${num(s.bucket_payload_kg)} kilograms.`],
      cab: [s.seatbelt?.value === 'Fastened' ? 'केबिन में सीट बेल्ट लगी है।' : 'सीट बेल्ट खुली है। अभी लगाइए।',
            s.seatbelt?.value === 'Fastened' ? 'Seatbelt is fastened in the cab.' : 'The seatbelt is off. Fasten it now.'],
    }
    const [hi, en] = lines[key]
    void speak(lang === 'hi' ? hi : en, lang, `part-${key}`, true)
  }

  return (
    <div className="space-y-5 pb-4">
      <PageHeader icon={<Pictogram name="proximity" className="h-10 w-10" />} title={t('लाइव मशीन', 'Live machine')}
        onReplay={replay} speaking={speakingId === 'intro-live'} />
      <section className="rounded-[28px] border-2 border-line bg-ink-800 p-3">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className={`text-sm font-bold text-slate-200 ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {detail ? t(detail.machine.name_hi, detail.machine.name_en) : ''}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-bold text-ok"><span className="h-2 w-2 animate-pulse rounded-full bg-ok" />LIVE</span>
        </div>
        <Twin sensors={sensors} onPart={part} />
        <p className={`px-1 pt-1 text-center text-sm text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {t('किसी भी हिस्से को दबाइए और सुनिए', 'Tap any part to hear it')}
        </p>
      </section>
      <Radar />
    </div>
  )
}

// ------------------------------------------------------------------ twin
function Twin({ sensors, onPart }: { sensors: Record<string, Sensor>; onPart: (k: string) => void }) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => { setPhase(((now - start) / 6000) % 1); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  // Dig cycle: reach out, curl in, lift, dump.
  const w = Math.sin(phase * Math.PI * 2)
  const boom = -8 + 14 * w
  const arm = 10 - 32 * Math.sin(phase * Math.PI * 2 + 0.9)
  const bucket = -15 + 45 * Math.sin(phase * Math.PI * 2 + 1.8)
  const fuel = typeof sensors.fuel_level_pct?.value === 'number' ? (sensors.fuel_level_pct.value as number) / 100 : 0.5
  const hit = 'cursor-pointer transition-opacity hover:opacity-80'

  return (
    <svg viewBox="0 0 400 250" className="w-full">
      <line x1="10" y1="232" x2="390" y2="232" stroke="#3D3D3D" strokeWidth="3" />
      {/* tracks */}
      <g className={hit} onClick={() => onPart('tracks')}>
        <rect x="45" y="196" width="190" height="34" rx="17" fill="#1A1A1A" stroke={colorOf(sensors.track_tension_pct)} strokeWidth="5" />
        {[68, 104, 140, 176, 212].map((x) => <circle key={x} cx={x} cy="213" r="10" fill="#2A323E" stroke="#555" strokeWidth="2" />)}
      </g>
      {/* house: counterweight + engine */}
      <g className={hit} onClick={() => onPart('engine')}>
        <rect x="62" y="140" width="92" height="52" rx="6" fill="#FFCD11" />
        <rect x="72" y="150" width="56" height="32" rx="4" fill={colorOf(sensors.engine_temp_c)} opacity="0.9" />
        {[80, 92, 104, 116].map((x) => <line key={x} x1={x} y1="154" x2={x} y2="178" stroke="#1A1A1A" strokeWidth="3" />)}
      </g>
      {/* fuel tank with level */}
      <g className={hit} onClick={() => onPart('fuel')}>
        <rect x="134" y="148" width="16" height="40" rx="3" fill="#1A1A1A" stroke="#555" strokeWidth="2" />
        <rect x="136" y={150 + 36 * (1 - fuel)} width="12" height={36 * fuel} fill={colorOf(sensors.fuel_level_pct)} />
      </g>
      {/* cab */}
      <g className={hit} onClick={() => onPart('cab')}>
        <rect x="152" y="96" width="62" height="96" rx="6" fill="#FFCD11" />
        <rect x="160" y="104" width="46" height="40" rx="4" fill="#9ED3F0" opacity="0.85" />
        <circle cx="183" cy="160" r="7" fill={sensors.seatbelt?.value === 'Fastened' ? '#3DD68C' : '#FF5A5F'} />
      </g>
      {/* boom, arm, bucket: each rotates about its own pin */}
      <g transform={`rotate(${boom} 205 150)`}>
        <g className={hit} onClick={() => onPart('hydraulic')}>
          <path d="M198 142 L305 62 L318 74 L214 160 Z" fill="#FFCD11" stroke="#1A1A1A" strokeWidth="2" />
          <line x1="212" y1="170" x2="262" y2="104" stroke={colorOf(sensors.hydraulic_temp_c)} strokeWidth="7" strokeLinecap="round" />
        </g>
        <g transform={`rotate(${arm} 311 68)`}>
          <path d="M304 64 L318 64 L330 170 L318 172 Z" fill="#FFCD11" stroke="#1A1A1A" strokeWidth="2" />
          <g className={hit} onClick={() => onPart('bucket')} transform={`rotate(${bucket} 324 170)`}>
            <path d="M318 166 L352 170 L348 200 Q330 212 314 196 Z" fill="#3D3D3D" stroke={colorOf(sensors.bucket_payload_kg)} strokeWidth="3" />
            {[322, 332, 342].map((x) => <path key={x} d={`M${x} 204 l3 8 l3 -8`} fill="#1A1A1A" />)}
          </g>
        </g>
      </g>
      {[205, 311].map((x, i) => <circle key={x} cx={x} cy={i ? 68 : 150} r="4" fill="#1A1A1A" />)}
    </svg>
  )
}

// ------------------------------------------------------------------ radar
const R = 130           // pixels for 15 m
const DANGER_M = 6.5    // CAT 320 tail + front swing radius
const CAUTION_M = 10
const m2px = (m: number) => (m / 15) * R

/** Where each person is at time t (seconds): a looped walking path in metres. */
function people(t: number): { id: string; x: number; y: number }[] {
  const loop = (t % 30) / 30
  // Worker A walks in behind the machine, pauses, walks back out.
  const inward = loop < 0.5 ? loop * 2 : 2 - loop * 2
  const aDist = 13.5 - 9.5 * Math.min(1, inward * 1.3)
  const aAng = (200 * Math.PI) / 180
  // Worker B circles slowly at a safe distance; C stands still near the trucks.
  const bAng = t / 9
  return [
    { id: 'A', x: aDist * Math.cos(aAng), y: aDist * Math.sin(aAng) },
    { id: 'B', x: 11.5 * Math.cos(bAng), y: 11.5 * Math.sin(bAng) },
    { id: 'C', x: 9, y: -9.5 },
  ]
}

function Radar() {
  const { lang } = useLang()
  const { speak } = useVoiceOut()
  const [t, setT] = useState(0)
  const alarmed = useRef(false)
  useEffect(() => {
    const start = performance.now()
    const timer = window.setInterval(() => setT((performance.now() - start) / 1000), 80)
    return () => window.clearInterval(timer)
  }, [])

  const blips = people(t).map((p) => ({ ...p, d: Math.hypot(p.x, p.y) }))
  const nearest = Math.min(...blips.map((b) => b.d))
  const zone = nearest < DANGER_M ? 'danger' : nearest < CAUTION_M ? 'caution' : 'clear'
  const swing = 25 * Math.sin(t / 2.2)
  const sweep = (t * 120) % 360

  useEffect(() => {
    if (zone === 'danger' && !alarmed.current) {
      alarmed.current = true
      siren(1.2)
      window.setTimeout(() => void speak(PEOPLE_ALERT[lang], lang, 'radar-alert'), 700)
    }
    if (zone !== 'danger') alarmed.current = false
  }, [zone, lang, speak])

  const tone = zone === 'danger' ? 'text-crit' : zone === 'caution' ? 'text-cat' : 'text-ok'
  const label = zone === 'danger' ? (lang === 'hi' ? 'रुकिए! दायरे में आदमी' : 'STOP! Person in swing zone')
    : zone === 'caution' ? (lang === 'hi' ? 'सावधान: पास में लोग' : 'Caution: people nearby')
    : (lang === 'hi' ? 'आसपास साफ़ है' : 'All clear')

  return (
    <section className={`rounded-[28px] border-2 p-4 ${zone === 'danger' ? 'border-crit bg-crit/10' : 'border-line bg-ink-800'}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xl font-extrabold ${tone} ${lang === 'hi' ? 'lang-hi' : ''}`}>{label}</span>
        <span className="font-mono text-lg font-bold text-white">{nearest.toFixed(1)} m</span>
      </div>
      <svg viewBox="-150 -150 300 300" className="mx-auto w-full max-w-sm">
        <defs>
          <radialGradient id="sweep" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={`scale(${R})`}>
            <stop offset="0" stopColor="#3DD68C" stopOpacity="0.35" />
            <stop offset="1" stopColor="#3DD68C" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle r={R} fill="#0B0E13" stroke="#2A323E" strokeWidth="2" />
        <circle r={m2px(CAUTION_M)} fill="#FFCD11" fillOpacity="0.07" stroke="#FFCD11" strokeOpacity="0.6" strokeDasharray="6 5" />
        <circle r={m2px(DANGER_M)} fill="#FF5A5F" fillOpacity={zone === 'danger' ? 0.35 : 0.12} stroke="#FF5A5F" strokeWidth="2" />
        {[5, 10, 15].map((m) => <text key={m} x="4" y={-m2px(m) + 12} fontSize="10" fill="#8A8A8A">{m} m</text>)}
        <line x1={-R} y1="0" x2={R} y2="0" stroke="#2A323E" /><line x1="0" y1={-R} x2="0" y2={R} stroke="#2A323E" />
        {/* sweep */}
        <g transform={`rotate(${sweep})`}>
          <path d={`M0 0 L${R} 0 A${R} ${R} 0 0 0 ${R * Math.cos(-0.5)} ${R * Math.sin(-0.5)} Z`} fill="url(#sweep)" />
          <line x1="0" y1="0" x2={R} y2="0" stroke="#3DD68C" strokeWidth="2" strokeOpacity="0.8" />
        </g>
        {/* the machine from above, its boom swinging */}
        <g transform={`rotate(${swing})`}>
          <rect x="-11" y="-16" width="22" height="32" rx="3" fill="#FFCD11" />
          <rect x="-4" y="-16" width="8" height="-1" />
          <line x1="0" y1="-14" x2="0" y2={-m2px(6)} stroke="#FFCD11" strokeWidth="6" strokeLinecap="round" />
        </g>
        {/* people */}
        {blips.map((b) => {
          const c = b.d < DANGER_M ? '#FF5A5F' : b.d < CAUTION_M ? '#FFCD11' : '#3DD68C'
          return (
            <g key={b.id} transform={`translate(${m2px(b.x)} ${m2px(b.y)})`}>
              {b.d < DANGER_M && <circle r="14" fill={c} opacity="0.3" className="animate-ping" />}
              <circle r="7" fill={c} stroke="#000" strokeWidth="2" />
            </g>
          )
        })}
      </svg>
      <div className={`mt-2 flex justify-center gap-4 text-xs font-semibold text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-crit" />{lang === 'hi' ? 'घूमने का दायरा 6.5 m' : 'Swing zone 6.5 m'}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-cat" />{lang === 'hi' ? 'सावधानी 10 m' : 'Caution 10 m'}</span>
      </div>
      <p className="mt-1 text-center text-[11px] text-mute">Proximity feed: simulated site workers</p>
    </section>
  )
}
