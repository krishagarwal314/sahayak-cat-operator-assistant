/**
 * Pictograms: the visual vocabulary of the simple interface.
 *
 * Operators may not read comfortably, so every concept on screen - a sensor, a
 * step in a guide, a button - is carried by one of these first and by a word
 * second. One consistent style: 48 unit grid, rounded 2.6 stroke, a soft tinted
 * fill for the key shape so the icon still reads at a glance in sunlight.
 */
import type { ReactNode } from 'react'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const F = { fill: 'currentColor', fillOpacity: 0.16, stroke: 'currentColor', strokeWidth: 2.6, strokeLinejoin: 'round' as const }
const DOT = { fill: 'currentColor' }

// A small excavator body reused inside several scenes.
const miniMachine = (x = 14, y = 18) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="0" y="4" width="16" height="9" rx="2" {...F} />
    <path d="M4 4V0h7l3 4" {...S} />
    <rect x="-2" y="15" width="20" height="5" rx="2.5" {...S} />
  </g>
)

const ICONS: Record<string, ReactNode> = {
  // ------------------------------------------------------------ guide: checks
  walkaround: (<>
    {miniMachine(16, 16)}
    <path d="M24 5a19 19 0 1 1-16.2 9" {...S} />
    <path d="M1.8 16.2L7.8 14l.8 6.4" {...S} strokeWidth={3} />
  </>),
  leak: (<>
    <path d="M6 12h36M10 12v6h28v-6" {...S} />
    <path d="M24 22c-3.5 4.6-5.5 7.6-5.5 10.3a5.5 5.5 0 0 0 11 0c0-2.7-2-5.7-5.5-10.3z" {...F} />
    <path d="M36 24c-1.6 2.2-2.5 3.6-2.5 4.8a2.5 2.5 0 0 0 5 0c0-1.2-.9-2.6-2.5-4.8z" {...F} />
    <path d="M8 43h32" {...S} />
  </>),
  oil: (<>
    <path d="M20 6h8M24 6v8" {...S} />
    <path d="M24 16c-6 8-9 13-9 17.5a9 9 0 0 0 18 0C33 29 30 24 24 16z" {...F} />
    <path d="M19.5 33.5h9M19.5 29h9" {...S} strokeWidth={2} />
  </>),
  track: (<>
    <rect x="5" y="18" width="38" height="16" rx="8" {...S} />
    <circle cx="13" cy="26" r="4" {...F} /><circle cx="24" cy="26" r="4" {...F} /><circle cx="35" cy="26" r="4" {...F} />
    <path d="M9 38l2 3M17 38l2 3M25 38l2 3M33 38l2 3" {...S} strokeWidth={2} />
  </>),
  climb: (<>
    <path d="M15 4v40M33 4v40" {...S} />
    <path d="M15 12h18M15 22h18M15 32h18" {...S} strokeWidth={2.2} />
    <circle cx="15" cy="12" r="3.4" {...DOT} /><circle cx="33" cy="12" r="3.4" {...DOT} /><circle cx="15" cy="32" r="3.4" {...DOT} />
  </>),
  seatbelt: (<>
    <path d="M14 8h13a3 3 0 0 1 3 3v17H14a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3z" {...F} />
    <path d="M11 28h24v7H11zM15 35v7M31 35v7" {...S} />
    <path d="M27 9L16 27" {...S} strokeWidth={4} />
    <rect x="19" y="18" width="7" height="5" rx="1" transform="rotate(-58 22.5 20.5)" fill="currentColor" />
  </>),
  // ------------------------------------------------------------ guide: start
  lookaround: (<>
    <path d="M6 24s6.5-10 18-10 18 10 18 10-6.5 10-18 10S6 24 6 24z" {...F} />
    <circle cx="24" cy="24" r="4.5" {...DOT} />
    <path d="M2 40l5-4M46 40l-5-4M2 8l5 4M46 8l-5 4" {...S} />
  </>),
  lever: (<>
    <path d="M12 40h24l-3-7H15z" {...F} />
    <path d="M24 33V13" {...S} />
    <circle cx="24" cy="10" r="5" {...F} />
    <path d="M17 24h-5M31 24h5" {...S} strokeDasharray="1 4" />
  </>),
  key: (<>
    <circle cx="15" cy="24" r="8" {...F} />
    <circle cx="15" cy="24" r="2.4" {...DOT} />
    <path d="M23 24h20M37 24v6M42 24v4" {...S} />
  </>),
  gauge: (<>
    <path d="M6 32a18 18 0 0 1 36 0" {...F} />
    <path d="M24 32l9-10" {...S} strokeWidth={3} />
    <circle cx="24" cy="32" r="3" {...DOT} />
    <path d="M10 26l2 1M24 14v3M38 26l-2 1" {...S} />
    <path d="M6 38h36" {...S} />
  </>),
  warmup: (<>
    <path d="M20 8a4 4 0 0 1 8 0v18a8 8 0 1 1-8 0z" {...F} />
    <circle cx="24" cy="33" r="3.6" {...DOT} />
    <path d="M24 28V15" {...S} strokeWidth={3} />
    <path d="M35 10c2 2-2 4 0 6M40 10c2 2-2 4 0 6" {...S} strokeWidth={2} />
  </>),
  horn: (<>
    <path d="M8 20h7l14-9v26l-14-9H8z" {...F} />
    <path d="M35 18a8 8 0 0 1 0 12M39 13a15 15 0 0 1 0 22" {...S} />
  </>),
  // ------------------------------------------------------------ guide: trench
  position: (<>
    <path d="M4 34h40M4 42h40" {...S} />
    <path d="M4 38h40" {...S} strokeDasharray="3 4" strokeWidth={2} />
    {miniMachine(14, 6)}
    <path d="M36 16h8l-3-3M44 16l-3 3" {...S} />
  </>),
  cable: (<>
    <path d="M4 16h40" {...S} />
    <path d="M4 16l6-5M14 16l6-5M24 16l6-5M34 16l6-5" {...S} strokeWidth={1.6} />
    <path d="M6 33c6-5 10 5 18 0s12-5 18 0" {...S} strokeWidth={4} />
    <path d="M26 21l-5 8h6l-4 8" {...S} />
  </>),
  bucket_down: (<>
    <path d="M24 4v14M18 13l6 6 6-6" {...S} />
    <path d="M13 24h22l-3 12H16z" {...F} />
    <path d="M16 36l-1 4M22 36v4M28 36v4M33 36l1 4" {...S} />
    <path d="M6 44h36" {...S} />
  </>),
  dig: (<>
    {/* excavator arm reaching down into a trench, bucket full of soil */}
    <path d="M4 36h12v6h16v-6h12" {...S} />
    <path d="M44 6L32 14l-8 12" {...S} strokeWidth={3.2} />
    <circle cx="32" cy="14" r="2.4" {...DOT} />
    <path d="M17 24h12l-3 11h-6z" {...F} />
    <path d="M20 35v3M23 35v3M26 35v3" {...S} strokeWidth={2.2} />
    <circle cx="21" cy="28" r="1.6" {...DOT} /><circle cx="25" cy="27" r="1.6" {...DOT} /><circle cx="23" cy="31" r="1.6" {...DOT} />
  </>),
  swing: (<>
    <circle cx="24" cy="30" r="5" {...F} />
    <path d="M24 30L38 14" {...S} />
    <path d="M8 22a18 18 0 0 1 32-6" {...S} strokeDasharray="3 3" />
    <path d="M40 16l-6 .5M40 16l-1.5-6" {...S} />
    <path d="M4 42h40" {...S} />
  </>),
  measure: (<>
    <path d="M6 12h10v28h16V12h10" {...S} />
    <rect x="21" y="4" width="6" height="34" rx="1" {...F} />
    <path d="M21 10h3M21 16h4M21 22h3M21 28h4M21 34h3" {...S} strokeWidth={1.8} />
  </>),
  // ------------------------------------------------------------ guide: loader
  bucket_flat: (<>
    <path d="M4 38h40" {...S} />
    <path d="M10 26h26l4 12H8z" {...F} />
    <path d="M36 26V16" {...S} />
    <path d="M18 18l-4 4 4 4" {...S} />
  </>),
  fill: (<>
    <path d="M22 40L34 14l12 26z" {...F} />
    <path d="M4 40h40" {...S} />
    <path d="M4 30h16l2 8H4z" {...F} />
    <path d="M12 22h8M16 18l4 4-4 4" {...S} />
  </>),
  reverse: (<>
    <path d="M38 24H12M20 14L10 24l10 10" {...S} strokeWidth={3.2} />
    <circle cx="38" cy="24" r="5" {...F} />
  </>),
  y_turn: (<>
    <path d="M24 44V26M24 26L10 8M24 26l14-18" {...S} strokeWidth={3} />
    <path d="M10 8l-1 7M10 8l7 1M38 8l1 7M38 8l-7 1" {...S} />
  </>),
  payload: (<>
    <path d="M17 12a7 7 0 0 1 14 0" {...S} />
    <path d="M12 16h24l5 26H7z" {...F} />
    <path d="M18 28v8M18 32l5-4M18 32l5 4M28 28v8M28 28h4v4h-4" {...S} strokeWidth={2} />
  </>),
  dump: (<>
    <path d="M6 36h28v-10H6z" {...F} />
    <circle cx="12" cy="40" r="3" {...S} /><circle cx="28" cy="40" r="3" {...S} />
    <path d="M26 8h14l-3 10H29z" {...F} transform="rotate(35 33 13)" />
    <circle cx="26" cy="20" r="1.5" {...DOT} /><circle cx="22" cy="24" r="1.5" {...DOT} /><circle cx="27" cy="25" r="1.5" {...DOT} />
  </>),
  truck: (<>
    <path d="M4 16h24v18H4z" {...F} />
    <path d="M28 22h9l6 7v5H28z" {...S} />
    <circle cx="12" cy="37" r="4" {...S} /><circle cx="35" cy="37" r="4" {...S} />
    <path d="M32 22v6h10" {...S} strokeWidth={2} />
  </>),
  // ------------------------------------------------------------ guide: dozer
  blade: (<>
    <path d="M8 8c8 4 8 28 0 32h6c6-6 6-26 0-32z" {...F} />
    <path d="M14 24h14" {...S} />
    <rect x="26" y="16" width="16" height="12" rx="2" {...F} />
    <rect x="24" y="32" width="20" height="7" rx="3.5" {...S} />
  </>),
  push: (<>
    <path d="M4 40h40" {...S} />
    <path d="M4 40l7-12 9 12" {...F} />
    <path d="M22 18c5 3 5 19 0 22h4c4-4 4-18 0-22z" {...F} />
    <path d="M30 24h12M36 18l6 6-6 6" {...S} />
  </>),
  slope: (<>
    <path d="M4 42L42 10v32z" {...F} />
    <path d="M24 34V14M18 20l6-6 6 6" {...S} strokeWidth={3} />
    <path d="M8 12l14 14M22 12L8 26" {...S} stroke="#FF5A5F" />
  </>),
  radio: (<>
    <rect x="15" y="12" width="18" height="32" rx="3" {...F} />
    <path d="M19 12V4" {...S} />
    <rect x="19" y="17" width="10" height="7" rx="1" {...S} strokeWidth={2} />
    <path d="M20 30h8M20 35h8M20 40h8" {...S} strokeWidth={2} />
    <path d="M37 10a8 8 0 0 1 0 10M41 7a13 13 0 0 1 0 16" {...S} strokeWidth={2} />
  </>),
  blade_up: (<>
    <path d="M10 16c7 3 7 22 0 26h5c5-5 5-21 0-26z" {...F} />
    <path d="M32 30V8M25 15l7-7 7 7" {...S} strokeWidth={3} />
    <path d="M4 44h40" {...S} />
  </>),
  // ------------------------------------------------------------ guide: shutdown
  park: (<>
    <rect x="8" y="6" width="32" height="32" rx="6" {...F} />
    <path d="M19 30V14h7a5 5 0 0 1 0 10h-7" {...S} strokeWidth={3.2} />
    <path d="M4 44h40" {...S} />
  </>),
  key_off: (<>
    <circle cx="15" cy="24" r="8" {...F} />
    <path d="M23 24h20M37 24v6" {...S} />
    <path d="M6 42L42 6" {...S} stroke="#FF5A5F" strokeWidth={3.2} />
  </>),
  power: (<>
    <path d="M24 6v16" {...S} strokeWidth={3.4} />
    <path d="M14 12a15 15 0 1 0 20 0" {...S} strokeWidth={3.4} />
  </>),
  // ------------------------------------------------------------ sensors
  fuel: (<>
    <rect x="8" y="8" width="20" height="34" rx="3" {...F} />
    <path d="M12 16h12" {...S} />
    <path d="M28 18h5a3 3 0 0 1 3 3v12a3 3 0 0 0 6 0V16l-5-5" {...S} />
  </>),
  temp: (<>
    <path d="M20 8a4 4 0 0 1 8 0v18a8 8 0 1 1-8 0z" {...F} />
    <circle cx="24" cy="33" r="3.6" {...DOT} />
    <path d="M24 28V14M32 12h5M32 18h5M32 24h5" {...S} />
  </>),
  hydraulic: (<>
    <path d="M24 8c-7 9-10 14.5-10 19.5a10 10 0 0 0 20 0C34 22.5 31 17 24 8z" {...F} />
    <path d="M18 30c2 2 4 2 6 0s4-2 6 0" {...S} strokeWidth={2} />
  </>),
  gear: (<>
    <circle cx="24" cy="24" r="7" {...F} />
    <path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.6 10.6l4.2 4.2M33.2 33.2l4.2 4.2M10.6 37.4l4.2-4.2M33.2 14.8l4.2-4.2" {...S} strokeWidth={3} />
  </>),
  tire: (<>
    <circle cx="24" cy="24" r="17" {...F} />
    <circle cx="24" cy="24" r="7" {...S} />
    <path d="M24 7v6M24 35v6M7 24h6M35 24h6" {...S} />
  </>),
  idle: (<>
    <path d="M14 6h20M14 42h20M16 6c0 10 16 10 16 18S16 32 16 42M32 6c0 10-16 10-16 18s16 8 16 18" {...S} />
    <path d="M18 38c2-4 10-4 12 0z" fill="currentColor" />
  </>),
  cycles: (<>
    <path d="M38 20A15 15 0 0 0 10 16M10 28a15 15 0 0 0 28 4" {...S} />
    <path d="M10 8v8h8M38 40v-8h-8" {...S} />
  </>),
  battery: (<>
    <rect x="6" y="14" width="32" height="22" rx="3" {...F} />
    <path d="M42 21v8" {...S} strokeWidth={3.4} />
    <path d="M22 18l-5 8h9l-5 7" {...S} />
  </>),
  wrench: (<>
    <path d="M30 6a9 9 0 0 0-8 12L7 33a4 4 0 0 0 6 6l15-15a9 9 0 0 0 12-8l-5 3-5-5z" {...F} />
  </>),
  person: (<>
    <circle cx="24" cy="12" r="6" {...F} />
    <path d="M13 42V30a11 11 0 0 1 22 0v12" {...F} />
  </>),
  proximity: (<>
    <circle cx="24" cy="22" r="4.5" {...F} />
    <path d="M17 40v-6a7 7 0 0 1 14 0v6" {...F} />
    <path d="M10 12a18 18 0 0 1 28 0M5 7a25 25 0 0 1 38 0" {...S} />
  </>),
  shield: (<>
    <path d="M24 4l16 6v12c0 10-7 18-16 22C15 40 8 32 8 22V10z" {...F} />
    <path d="M17 24l5 5 9-10" {...S} strokeWidth={3.2} />
  </>),
  sun: (<>
    <circle cx="24" cy="24" r="8" {...F} />
    <path d="M24 4v5M24 39v5M4 24h5M39 24h5M9.9 9.9l3.5 3.5M34.6 34.6l3.5 3.5M9.9 38.1l3.5-3.5M34.6 13.4l3.5-3.5" {...S} />
  </>),
  // ------------------------------------------------------------ work & navigation
  clipboard: (<>
    <rect x="9" y="8" width="30" height="36" rx="3" {...F} />
    <rect x="17" y="4" width="14" height="8" rx="2" {...S} />
    <path d="M15 22l3 3 5-6M27 22h7M15 33l3 3 5-6M27 33h7" {...S} strokeWidth={2.2} />
  </>),
  clock: (<>
    <circle cx="24" cy="24" r="18" {...F} />
    <path d="M24 13v11l7 5" {...S} strokeWidth={3} />
  </>),
  pin: (<>
    <path d="M24 44s14-13 14-24a14 14 0 0 0-28 0c0 11 14 24 14 24z" {...F} />
    <circle cx="24" cy="20" r="5" {...S} />
  </>),
  book: (<>
    <path d="M24 12c-5-4-13-4-18-2v28c5-2 13-2 18 2 5-4 13-4 18-2V10c-5-2-13-2-18 2z" {...F} />
    <path d="M24 12v28" {...S} />
  </>),
  home: (<>
    <path d="M6 22L24 7l18 15" {...S} />
    <path d="M11 19v22h26V19" {...F} />
    <path d="M20 41V29h8v12" {...S} />
  </>),
  help: (<>
    <circle cx="24" cy="24" r="18" {...F} />
    <path d="M18 18a6 6 0 1 1 8.5 5.5c-1.8.9-2.5 2-2.5 4v1" {...S} strokeWidth={3} />
    <circle cx="24" cy="35" r="2" {...DOT} />
  </>),
  alert: (<>
    <path d="M24 5l20 36H4z" {...F} />
    <path d="M24 18v11" {...S} strokeWidth={3.4} />
    <circle cx="24" cy="35" r="2.2" {...DOT} />
  </>),
  check: (<>
    <circle cx="24" cy="24" r="19" {...F} />
    <path d="M14 24l7 7 13-14" {...S} strokeWidth={3.6} />
  </>),
  cross: (<>
    <circle cx="24" cy="24" r="19" {...F} />
    <path d="M16 16l16 16M32 16L16 32" {...S} strokeWidth={3.6} />
  </>),
  // ------------------------------------------------------------ controls
  mic: (<>
    <rect x="17" y="4" width="14" height="24" rx="7" {...F} />
    <path d="M10 22a14 14 0 0 0 28 0M24 36v7M17 43h14" {...S} />
  </>),
  speaker: (<>
    <path d="M6 18h8l12-9v30l-12-9H6z" {...F} />
    <path d="M32 17a9 9 0 0 1 0 14M37 12a16 16 0 0 1 0 24" {...S} />
  </>),
  play: (<><path d="M15 9l24 15-24 15z" {...F} /></>),
  pause: (<><rect x="12" y="9" width="8" height="30" rx="2" fill="currentColor" /><rect x="28" y="9" width="8" height="30" rx="2" fill="currentColor" /></>),
  next: (<><path d="M8 24h30M28 12l12 12-12 12" {...S} strokeWidth={3.6} /></>),
  prev: (<><path d="M40 24H10M20 12L8 24l12 12" {...S} strokeWidth={3.6} /></>),
  repeat: (<>
    <path d="M38 20A15 15 0 0 0 10 16M10 28a15 15 0 0 0 28 4" {...S} strokeWidth={3} />
    <path d="M10 8v8h8M38 40v-8h-8" {...S} strokeWidth={3} />
  </>),
  camera: (<>
    <path d="M6 16h8l3-5h14l3 5h8v24H6z" {...F} />
    <circle cx="24" cy="27" r="7" {...S} />
  </>),
  face: (<>
    <path d="M6 16V9a3 3 0 0 1 3-3h7M32 6h7a3 3 0 0 1 3 3v7M42 32v7a3 3 0 0 1-3 3h-7M16 42H9a3 3 0 0 1-3-3v-7" {...S} strokeWidth={3} />
    <circle cx="18" cy="20" r="2" {...DOT} /><circle cx="30" cy="20" r="2" {...DOT} />
    <path d="M17 30c4 4 10 4 14 0" {...S} />
  </>),
  user_plus: (<>
    <circle cx="20" cy="14" r="7" {...F} />
    <path d="M6 42v-6a14 14 0 0 1 22-11" {...S} />
    <path d="M36 26v14M29 33h14" {...S} strokeWidth={3.2} />
  </>),
  logout: (<>
    <path d="M20 42H10a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h10" {...S} />
    <path d="M32 34l10-10-10-10M42 24H18" {...S} />
  </>),
  switch: (<>
    <path d="M8 16h30M32 10l6 6-6 6M40 32H10M16 26l-6 6 6 6" {...S} />
  </>),
  chart: (<>
    <path d="M6 42h36M10 42V26M20 42V14M30 42V22M40 42V8" {...S} strokeWidth={4} />
  </>),
  star: (<><path d="M24 5l5.9 12 13.1 1.9-9.5 9.2 2.2 13-11.7-6.2-11.7 6.2 2.2-13-9.5-9.2L18.1 17z" {...F} /></>),
}

export const PICTOGRAM_NAMES = Object.keys(ICONS)

export function Pictogram({
  name, className = 'h-10 w-10', title,
}: { name: string; className?: string; title?: string }) {
  const body = ICONS[name] ?? ICONS.help
  return (
    <svg viewBox="0 0 48 48" className={className} role={title ? 'img' : undefined}
         aria-hidden={title ? undefined : true} aria-label={title}>
      {title && <title>{title}</title>}
      {body}
    </svg>
  )
}

/** Which pictogram represents each sensor. */
export const SENSOR_ICON: Record<string, string> = {
  fuel_level_pct: 'fuel', def_level_pct: 'fuel', engine_temp_c: 'temp',
  hydraulic_temp_c: 'hydraulic', hydraulic_pressure_bar: 'gauge', transmission_temp_c: 'gear',
  tire_pressure_psi: 'tire', track_tension_pct: 'track', undercarriage_wear_pct: 'track',
  payload_kg: 'payload', bucket_payload_kg: 'payload', idling_time_min: 'idle',
  load_cycles: 'cycles', swing_cycles: 'swing', engine_hours: 'clock', oil_pressure_kpa: 'oil',
  battery_v: 'battery', seatbelt: 'seatbelt', proximity_objects: 'proximity',
  ambient_temp_c: 'sun', blade_load_pct: 'blade',
}

/** Which pictogram represents each task type. */
export const TASK_ICON: Record<string, string> = {
  trench_excavation: 'dig', truck_loading: 'truck', site_cleanup: 'push',
  stockpile_feeding: 'fill', haul_road_maintenance: 'blade', bulk_excavation: 'dig',
}

/** Which pictogram represents each assistant intent, for quick-question buttons. */
export const INTENT_ICON: Record<string, string> = {
  USAGE_REPORT: 'chart',
  FUEL_STATUS: 'fuel', MACHINE_HEALTH: 'wrench', TASK_TODAY: 'clipboard', TASK_NEXT: 'next',
  TASK_TIME_ESTIMATE: 'clock', TASK_PROGRESS: 'chart', HYDRAULIC_TEMP: 'hydraulic',
  ENGINE_TEMP: 'temp', TRANSMISSION_TEMP: 'gear', PAYLOAD_STATUS: 'payload', LOAD_CYCLES: 'cycles',
  TRACK_TENSION: 'track', UNDERCARRIAGE_WEAR: 'track', TIRE_PRESSURE: 'tire', SEATBELT_STATUS: 'seatbelt',
  SAFETY_STATUS: 'shield', PROXIMITY_HAZARD: 'proximity', IDLE_TIME: 'idle', HOW_TO_OPERATE: 'book',
  WEATHER_CONDITIONS: 'sun', MAINTENANCE_DUE: 'wrench', ACTIVE_ALERTS: 'alert', HELP: 'help',
}
