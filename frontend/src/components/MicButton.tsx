import { useEffect, useRef, useState } from 'react'
import { LevelMeter } from '../lib/audio'

export type MicState = 'idle' | 'recording' | 'processing'

/**
 * Press and hold to talk. Holding is deliberate: an operator wearing gloves in a
 * noisy cab needs an unambiguous "I am recording now" signal, and hold-to-talk
 * removes any chance of the mic latching open.
 */
export function MicButton({
  state, onStart, onStop, size = 'lg', label,
}: {
  state: MicState
  onStart: () => void
  onStop: () => void
  size?: 'lg' | 'md'
  label?: string
}) {
  const [level, setLevel] = useState(0)
  const meterRef = useRef<LevelMeter | null>(null)
  const frameRef = useRef<number>()

  useEffect(() => {
    if (state !== 'recording') {
      meterRef.current?.stop()
      meterRef.current = null
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      setLevel(0)
      return
    }
    let cancelled = false
    const meter = new LevelMeter()
    meterRef.current = meter
    void meter.start().then(() => {
      if (cancelled) return
      const tick = () => {
        setLevel(meter.read())
        frameRef.current = requestAnimationFrame(tick)
      }
      tick()
    }).catch(() => { /* level meter is decoration; recording still works */ })

    return () => {
      cancelled = true
      meter.stop()
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [state])

  const dimension = size === 'lg' ? 'h-[76px] w-[76px]' : 'h-14 w-14'
  const iconSize = size === 'lg' ? 'h-7 w-7' : 'h-5 w-5'

  const press = (event: React.PointerEvent) => {
    event.preventDefault()
    if (state === 'idle') onStart()
  }
  const release = (event: React.PointerEvent) => {
    event.preventDefault()
    if (state === 'recording') onStop()
  }

  return (
    <div className="relative flex flex-col items-center gap-2">
      {state === 'recording' && (
        <>
          <span className="pointer-events-none absolute top-0 h-[76px] w-[76px] rounded-full bg-crit/30 animate-pulsering" />
          <span
            className="pointer-events-none absolute top-0 rounded-full bg-crit/20 transition-transform duration-75"
            style={{ height: 76, width: 76, transform: `scale(${1 + level * 0.55})` }}
          />
        </>
      )}
      <button
        type="button"
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        disabled={state === 'processing'}
        aria-label={label ?? 'hold to talk'}
        className={`relative grid ${dimension} place-items-center rounded-full transition-all duration-150
          ${state === 'recording'
            ? 'bg-crit text-white scale-105 shadow-[0_0_0_6px_rgba(255,90,95,0.18)]'
            : state === 'processing'
              ? 'bg-ink-600 text-mute'
              : 'bg-cat text-ink-900 hover:bg-cat-dark active:scale-95 shadow-[0_8px_26px_-10px_rgba(255,205,17,0.95)]'}`}
      >
        {state === 'processing' ? (
          <svg className={`${iconSize} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg className={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v4M8 22h8" />
          </svg>
        )}
      </button>
      {label && <span className="text-[11px] font-medium text-mute">{label}</span>}
    </div>
  )
}
