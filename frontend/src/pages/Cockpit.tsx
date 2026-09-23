import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import type { MachineDetail, Reading } from '../lib/types'
import { Assistant } from '../components/Assistant'
import { MachineIcon } from '../components/MachineIcon'
import { HealthRing, Loading, Panel, ProgressBar, Sparkline, Spinner, StatusPill, Toast, tone } from '../components/ui'

const POLL_MS = 6000

/** Sensors worth a big tile, in the order an operator scans them. */
const PRIMARY = [
  'fuel_level_pct', 'engine_temp_c', 'hydraulic_temp_c', 'transmission_temp_c',
  'hydraulic_pressure_bar', 'payload_kg', 'idling_time_min', 'load_cycles',
  'tire_pressure_psi', 'track_tension_pct', 'undercarriage_wear_pct', 'engine_hours',
]

function SensorTile({ reading, series }: { reading: Reading; series?: { value: number }[] }) {
  const { lang } = useLang()
  const shade = tone(reading.status)
  const label = lang === 'hi' ? reading.label_hi : reading.label_en

  return (
    <div className={`relative overflow-hidden rounded-xl border bg-ink-800/60 p-3.5 transition-colors
      ${reading.status === 'crit' ? 'border-crit/45' : reading.status === 'warn' ? 'border-warn/35' : 'border-line-soft'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[11px] font-medium leading-tight text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
          {label}
        </span>
        {reading.status !== 'ok' && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${shade.dot}`} />}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`font-mono text-xl font-bold tabular-nums ${reading.status === 'ok' ? 'text-slate-100' : shade.text}`}>
          {typeof reading.value === 'number' ? reading.value : reading.value}
        </span>
        <span className="text-[11px] text-mute">{reading.unit}</span>
      </div>
      {series && series.length > 1 && (
        <div className="-mx-1 mt-1.5">
          <Sparkline points={series} tone={reading.status} className="h-6 w-full" />
        </div>
      )}
    </div>
  )
}

export default function Cockpit() {
  const { t, lang } = useLang()
  const { machineId, selectMachine } = useSession()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<MachineDetail | null>(null)
  const [series, setSeries] = useState<Record<string, { value: number }[]>>({})
  const [toast, setToast] = useState('')
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [incidentText, setIncidentText] = useState('')
  const [incidentBusy, setIncidentBusy] = useState(false)

  const load = useCallback(async (id: string) => {
    const data = await api.machine(id)
    setDetail(data)
    return data
  }, [])

  useEffect(() => {
    if (!machineId) {
      navigate('/machines', { replace: true })
      return
    }
    load(machineId).catch((e) => setToast(String(e.message ?? e)))
  }, [machineId, load, navigate])

  // Sparklines for the tiles that are actually shown.
  useEffect(() => {
    if (!detail) return
    const keys = PRIMARY.filter((key) => detail.telemetry.sensors[key])
    Promise.all(keys.map((key) =>
      api.series(detail.machine.id, key, 20).then((res) => [key, res.points] as const).catch(() => null),
    )).then((pairs) => {
      const next: Record<string, { value: number }[]> = {}
      pairs.forEach((pair) => { if (pair) next[pair[0]] = pair[1] })
      setSeries(next)
    })
  }, [detail?.machine?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep telemetry live without refetching the whole page.
  useEffect(() => {
    if (!machineId) return
    const timer = setInterval(() => {
      api.telemetry(machineId)
        .then((telemetry) => setDetail((prev) => (prev ? { ...prev, telemetry } : prev)))
        .catch(() => { /* transient */ })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [machineId])

  const switchMachine = useCallback(async (id: string) => {
    await selectMachine(id)
    await load(id)
  }, [load, selectMachine])

  async function submitIncident(event: React.FormEvent) {
    event.preventDefault()
    if (!detail || !incidentText.trim()) return
    setIncidentBusy(true)
    try {
      const res = await api.logIncident({
        machine_id: detail.machine.id,
        description: incidentText.trim(),
        language: lang,
      })
      setToast(res.confirmation[lang])
      setIncidentText('')
      setIncidentOpen(false)
      await load(detail.machine.id)
    } catch (e: any) {
      setToast(String(e.message ?? e))
    } finally {
      setIncidentBusy(false)
    }
  }

  async function toggleSeatbelt() {
    if (!detail) return
    const current = detail.telemetry.sensors.seatbelt?.value === 'Fastened'
    try {
      await api.setSeatbelt(detail.machine.id, !current)
      await load(detail.machine.id)
    } catch (e: any) {
      setToast(String(e.message ?? e))
    }
  }

  if (!detail) return <Loading />

  const { machine, telemetry, health, safety, fuel, maintenance, current_task: task, conditions } = detail
  const name = lang === 'hi' ? machine.name_hi : machine.name_en
  const shiftPct = Math.min(100, (telemetry.shift_elapsed_min / (telemetry.shift_elapsed_min + telemetry.shift_remaining_min)) * 100)
  const seatbeltOn = telemetry.sensors.seatbelt?.value === 'Fastened'
  const proximity = Number(telemetry.sensors.proximity_objects?.value ?? 0)
  const tiles = PRIMARY.map((key) => telemetry.sensors[key]).filter(Boolean) as Reading[]

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* ============ left: machine ============ */}
        <div className="min-w-0 space-y-5">
          {/* header */}
          <div className="panel grain relative overflow-hidden">
            <div className="relative z-10 flex flex-wrap items-center gap-5 p-5">
              <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-line-soft
                               bg-ink-700/70 ${tone(telemetry.status).text}`}>
                <MachineIcon family={machine.family} className="h-11 w-11" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-mute">{machine.id}</span>
                  <StatusPill status={telemetry.status} />
                </div>
                <h1 className={`mt-0.5 truncate text-xl font-extrabold tracking-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                  {name}
                </h1>
                <p className="mt-0.5 text-xs text-mute">
                  {machine.site} · {lang === 'hi' ? conditions.weather_hi : conditions.weather_en} · {conditions.ambient_temp_c}°C
                  {' · '}
                  <span className={fuel.status === 'ok' ? '' : tone(fuel.status).text}>
                    {lang === 'hi' ? 'ईंधन' : 'Fuel'} {fuel.percent}% (~{fuel.hours_left}{lang === 'hi' ? ' घं' : 'h'})
                  </span>
                </p>
              </div>

              <div className="w-full sm:w-48">
                <div className="flex items-center justify-between text-[11px] text-mute">
                  <span>{lang === 'hi' ? 'शिफ्ट' : 'Shift'}</span>
                  <span className="font-mono">{Math.round(telemetry.shift_remaining_min)} {t('common.minutes')}</span>
                </div>
                <div className="mt-1.5"><ProgressBar value={shiftPct} tone="ok" /></div>
              </div>
            </div>
          </div>

          {/* health + safety */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Panel title={t('cockpit.health')} bodyClass="p-5">
              <div className="flex items-center gap-5">
                <HealthRing score={health.score} />
                <div className="min-w-0 flex-1 space-y-2">
                  {(['critical', 'warning', 'info'] as const).map((severity) => (
                    <div key={severity} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-mute">
                        <span className={`h-1.5 w-1.5 rounded-full ${tone(severity).dot}`} />
                        {severity === 'critical' ? t('common.crit') : severity === 'warning' ? t('common.warn')
                          : (lang === 'hi' ? 'जानकारी' : 'Info')}
                      </span>
                      <span className="font-mono font-semibold text-slate-200">{health.counts[severity]}</span>
                    </div>
                  ))}
                  <div className="border-t border-line-soft pt-2 text-[11px] text-mute">
                    {lang === 'hi' ? 'सर्विस में' : 'Service in'}{' '}
                    <span className="font-mono text-slate-200">{Math.round(maintenance.hours_remaining)} h</span>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel
              title={t('cockpit.safety')}
              bodyClass="p-5"
              actions={<span className={`font-mono text-lg font-bold ${tone(safety.severity).text}`}>{safety.score}</span>}
            >
              <div className="space-y-3">
                <button
                  onClick={toggleSeatbelt}
                  className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left transition-colors
                    ${seatbeltOn ? 'border-ok/30 bg-ok/[0.07]' : 'border-crit/45 bg-crit/[0.09]'}`}
                  title={lang === 'hi' ? 'डेमो के लिए बदलें' : 'Toggle for the demo'}
                >
                  <span className="text-xs font-medium text-slate-300">{t('cockpit.seatbelt')}</span>
                  <span className={`text-xs font-bold ${seatbeltOn ? 'text-ok' : 'text-crit'}`}>
                    {seatbeltOn ? t('cockpit.fastened') : t('cockpit.unfastened')}
                  </span>
                </button>

                <div className={`flex items-center justify-between rounded-xl border px-3.5 py-3
                  ${proximity ? 'border-crit/45 bg-crit/[0.09]' : 'border-line-soft bg-ink-800/50'}`}>
                  <span className="text-xs font-medium text-slate-300">{t('cockpit.proximity')}</span>
                  <span className={`text-xs font-bold ${proximity ? 'text-crit' : 'text-ok'}`}>
                    {proximity ? t('cockpit.occupied') : t('cockpit.clear')}
                  </span>
                </div>

                <button onClick={() => setIncidentOpen(true)} className="btn-ghost w-full !py-2 text-xs">
                  {t('cockpit.reportIncident')}
                  {safety.incident_count > 0 && (
                    <span className="rounded-full bg-ink-600 px-1.5 text-[10px]">{safety.incident_count}</span>
                  )}
                </button>
              </div>
            </Panel>
          </div>

          {/* current task */}
          {task && (
            <Panel
              title={t('cockpit.currentTask')}
              actions={
                <span className="rounded-full bg-ink-600 px-2 py-0.5 text-[10px] font-semibold text-mute">
                  {t(`common.${task.status}` as never)}
                </span>
              }
            >
              <h3 className={`text-[15px] font-bold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
                {(lang === 'hi' ? task.hi.title : task.title_en) || task.title_en}
              </h3>
              <p className="mt-1 text-xs text-mute">
                {(lang === 'hi' ? task.hi.location : task.location) || task.location}
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-mute">
                    <span>{t('cockpit.progress')}</span>
                    <span className="font-mono text-slate-200">{Math.round(task.progress * 100)}%</span>
                  </div>
                  <div className="mt-1.5"><ProgressBar value={task.progress * 100} tone="warn" /></div>
                </div>
                {task.estimate && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-mute">
                      <span>{t('cockpit.eta')}</span>
                      <span className="font-mono font-semibold text-cat">
                        {task.estimate.remaining_minutes} {t('common.minutes')}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-mute">
                      {lang === 'hi'
                        ? `${task.estimate.samples} पिछले कामों से, भरोसा ${Math.round(task.estimate.confidence * 100)}%`
                        : `from ${task.estimate.samples} past jobs · ${Math.round(task.estimate.confidence * 100)}% confidence`}
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {/* sensors */}
          <Panel title={t('cockpit.telemetry')} bodyClass="p-4"
                 actions={<span className="font-mono text-[10px] text-mute">
                   {new Date(telemetry.timestamp).toLocaleTimeString(lang === 'hi' ? 'hi-IN' : 'en-IN')}
                 </span>}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {tiles.map((reading) => (
                <SensorTile key={reading.key} reading={reading} series={series[reading.key]} />
              ))}
            </div>
          </Panel>

          {/* findings */}
          <Panel title={t('cockpit.findings')}
                 actions={<span className="font-mono text-[11px] text-mute">{health.findings.length}</span>}>
            {health.findings.length === 0 ? (
              <p className="py-5 text-center text-sm text-ok">{t('cockpit.noFindings')}</p>
            ) : (
              <ul className="space-y-2.5">
                {health.findings.map((finding) => {
                  const shade = tone(finding.severity)
                  return (
                    <li key={finding.code} className={`rounded-xl border p-3.5 ${shade.bg}
                      ${finding.severity === 'critical' ? 'border-crit/40' : finding.severity === 'warning' ? 'border-warn/30' : 'border-line-soft'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${shade.dot}`} />
                        <h4 className={`text-[13px] font-bold ${shade.text} ${lang === 'hi' ? 'lang-hi' : ''}`}>
                          {finding.title[lang]}
                        </h4>
                        <span className="ml-auto font-mono text-[9px] uppercase text-mute">{finding.code}</span>
                      </div>
                      <p className={`mt-1.5 text-xs leading-relaxed text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>
                        {finding.detail[lang]}
                      </p>
                      <p className={`mt-1.5 text-xs leading-relaxed text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
                        → {finding.recommendation[lang]}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>

        {/* ============ right: assistant ============ */}
        <div className="lg:sticky lg:top-[88px] lg:h-[calc(100vh-108px)]">
          <Assistant
            machineId={machine.id}
            suggestions={detail.suggestions}
            onMachineSwitch={switchMachine}
            onDataChanged={() => { void load(machine.id) }}
          />
        </div>
      </div>

      {/* incident modal */}
      {incidentOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/80 p-4 backdrop-blur-sm"
             role="dialog" aria-modal="true">
          <form onSubmit={submitIncident} className="panel w-full max-w-md animate-risein p-5">
            <h3 className="text-base font-bold text-white">{t('cockpit.reportIncident')}</h3>
            <p className="mt-1 text-xs text-mute">{machine.model} · {machine.site}</p>
            <textarea
              autoFocus
              value={incidentText}
              onChange={(e) => setIncidentText(e.target.value)}
              placeholder={t('cockpit.incidentPlaceholder')}
              rows={4}
              className={`field mt-4 resize-none ${lang === 'hi' ? 'lang-hi' : ''}`}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setIncidentOpen(false)}>
                {t('cockpit.cancel')}
              </button>
              <button type="submit" className="btn-primary" disabled={incidentBusy || !incidentText.trim()}>
                {incidentBusy && <Spinner />}{t('cockpit.submit')}
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  )
}
