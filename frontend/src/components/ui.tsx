import type { ReactNode } from 'react'
import type { Severity } from '../lib/types'
import { useLang } from '../lib/i18n'

export const SEVERITY_TONE: Record<string, { text: string; bg: string; ring: string; dot: string }> = {
  ok: { text: 'text-ok', bg: 'bg-ok/10', ring: 'ring-ok/30', dot: 'bg-ok' },
  warn: { text: 'text-warn', bg: 'bg-warn/10', ring: 'ring-warn/30', dot: 'bg-warn' },
  crit: { text: 'text-crit', bg: 'bg-crit/10', ring: 'ring-crit/30', dot: 'bg-crit' },
  critical: { text: 'text-crit', bg: 'bg-crit/10', ring: 'ring-crit/30', dot: 'bg-crit' },
  warning: { text: 'text-warn', bg: 'bg-warn/10', ring: 'ring-warn/30', dot: 'bg-warn' },
  info: { text: 'text-sky-300', bg: 'bg-sky-400/10', ring: 'ring-sky-400/30', dot: 'bg-sky-400' },
  unknown: { text: 'text-mute', bg: 'bg-mute/10', ring: 'ring-mute/20', dot: 'bg-mute' },
}

export function tone(severity: string) {
  return SEVERITY_TONE[severity] ?? SEVERITY_TONE.unknown
}

export function Panel({
  title, actions, children, className = '', bodyClass = 'p-5',
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <h2 className="text-sm font-semibold tracking-tight text-slate-200">{title}</h2>
          {actions}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export function StatusPill({ status, label }: { status: Severity | string; label?: string }) {
  const { t } = useLang()
  const key = (['ok', 'warn', 'crit'].includes(status) ? status : 'unknown') as 'ok' | 'warn' | 'crit' | 'unknown'
  const shade = tone(status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${shade.bg} ${shade.text} ${shade.ring}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${shade.dot} ${status === 'crit' ? 'animate-pulse' : ''}`} />
      {label ?? t(`common.${key}` as never)}
    </span>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Loading({ label }: { label?: string }) {
  const { t } = useLang()
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-mute">
      <Spinner className="h-5 w-5" />
      <span className="text-sm">{label ?? t('common.loading')}</span>
    </div>
  )
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-mute/60">{icon}</div>}
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="max-w-xs text-xs text-mute">{hint}</p>}
    </div>
  )
}

export function Sparkline({
  points, tone: lineTone = 'ok', className = 'h-8 w-full',
}: {
  points: { value: number }[]
  tone?: string
  className?: string
}) {
  if (points.length < 2) return <div className={className} />
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 28 - ((value - min) / span) * 24
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const colour = tone(lineTone).text

  return (
    <svg className={className} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${path} L100,32 L0,32 Z`} className={`${colour} opacity-10`} fill="currentColor" />
      <path d={path} className={colour} fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function ProgressBar({ value, tone: barTone = 'ok' }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  const shade = tone(barTone)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-600">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${shade.dot}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function HealthRing({ score, size = 116 }: { score: number; size?: number }) {
  const radius = size / 2 - 9
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const severity = clamped >= 80 ? 'ok' : clamped >= 60 ? 'warn' : 'crit'
  const shade = tone(severity)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} className="text-ink-600"
                stroke="currentColor" strokeWidth="9" fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          className={`${shade.text} transition-[stroke-dashoffset] duration-700`}
          stroke="currentColor" strokeWidth="9" fill="none" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono text-2xl font-bold tabular-nums ${shade.text}`}>{clamped}</span>
        <span className="label mt-0.5">score</span>
      </div>
    </div>
  )
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-risein rounded-xl border border-cat/40
                 bg-ink-800 px-5 py-3 text-sm text-slate-100 shadow-glow"
    >
      <div className="flex items-center gap-3">
        <span>{message}</span>
        <button onClick={onClose} className="text-mute transition-colors hover:text-white" aria-label="close">×</button>
      </div>
    </div>
  )
}
