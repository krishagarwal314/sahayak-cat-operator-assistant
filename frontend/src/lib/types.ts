export type Lang = 'hi' | 'en'
export type Severity = 'ok' | 'warn' | 'crit' | 'unknown'

export interface Operator {
  id: string
  name_en: string
  name_hi: string
  role: string
  language: Lang
  shift: string
  shift_hi?: string
  site: string
  avatar_initials: string
  certified_families: string[]
  experience_years: number
  skill_scores: Record<string, number>
}

export interface Reading {
  key: string
  value: number | string
  unit: string
  label_en: string
  label_hi: string
  status: Severity
  warn_below?: number | null
  crit_below?: number | null
  warn_above?: number | null
  crit_above?: number | null
}

export interface Telemetry {
  machine_id: string
  machine_name_en: string
  machine_name_hi: string
  family: string
  timestamp: string
  shift_elapsed_min: number
  shift_remaining_min: number
  status: Severity
  sensors: Record<string, Reading>
  attention: Reading[]
}

export interface Finding {
  code: string
  severity: 'critical' | 'warning' | 'info'
  title: { en: string; hi: string }
  detail: { en: string; hi: string }
  recommendation: { en: string; hi: string }
  evidence: Record<string, unknown>
}

export interface Health {
  score: number
  grade: string
  findings: Finding[]
  counts: { critical: number; warning: number; info: number }
}

export interface MachineCard {
  id: string
  model: string
  name_en: string
  name_hi: string
  short_hi: string
  family: string
  icon: string
  site: string
  assigned: boolean
  certified: boolean
  task_count: number
  next_task: string | null
  status: Severity
  attention_count: number
  quick_questions_hi: string[]
  quick_questions_en: string[]
  identify_hi?: string
  identify_en?: string
}

export interface Estimate {
  expected_minutes: number
  low_minutes: number
  high_minutes: number
  confidence: number
  samples: number
  basis: string
  planned_minutes?: number
  delta_vs_planned?: number
  remaining_minutes: number
  factors: { label_en: string; label_hi: string; effect_pct: number }[]
  conditions: Conditions
}

export interface Conditions {
  weather: string
  weather_en: string
  weather_hi: string
  ground_en: string
  ground_hi: string
  ambient_temp_c: number
  shift: string
  advice_en: string
  advice_hi: string
}

export interface Task {
  id: string
  operator_id: string
  machine_id: string
  task_type: string
  sequence: number
  title_en: string
  instructions_en: string
  safety_note_en: string
  priority: 'high' | 'medium' | 'low'
  planned_start: string
  planned_minutes: number
  target_cycles: number
  location: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  hi: { title?: string; instructions?: string; safety_note?: string; location?: string }
  translation_source: string
  machine: { id: string; name_en: string; name_hi: string; model: string; family: string; icon: string }
  progress: number
  estimate?: Estimate
  guide_id?: string
}

export interface Briefing {
  operator: Operator
  task_count: number
  machines: string[]
  planned_minutes: number
  estimated_minutes: number
  tasks: Task[]
  text: { hi: string; en: string }
  lines: { hi: string[]; en: string[] }
}

export interface TraceStep {
  stage: string
  intent: string | null
  score: number
  accepted: boolean
  detail: string
  ms: number
}

export interface RouteInfo {
  intent: string
  confidence: number
  stage: string
  text: string
  normalized: string
  script: string
  slots: Record<string, string>
  alternatives: { intent: string; score: number }[]
  unsupported_on_machine: boolean
  total_ms: number
  trace: TraceStep[]
}

export interface Reply {
  text: { hi: string; en: string }
  speech: { hi: string; en: string }
  severity: Severity
  card: Record<string, any> | null
  data: Record<string, any>
  followups: { intent: string; label_hi: string; label_en: string }[]
}

export interface AskResult {
  machine_id: string
  switched_machine: string | null
  route: RouteInfo
  reply: Reply
  language: Lang
  total_ms: number
  at: string
  transcript?: string
  audio?: { base64: string; mime: string; sample_rate: number; duration_s: number; engine: string } | null
  speech_fallback_text?: string
  timings?: Record<string, number>
}

export interface Suggestion {
  id: string
  intent: string
  label_hi: string
  label_en: string
}

export interface SafetyReport {
  machine_id: string
  score: number
  severity: Severity
  seatbelt: { rate_pct: number; samples: number; violations: number; currently_fastened: boolean }
  proximity: { recorded_events: number; active_objects: number; rate_pct: number }
  incidents: any[]
  incident_count: number
  summary_hi: string
  summary_en: string
}

export interface MachineDetail {
  machine: any
  telemetry: Telemetry
  health: Health
  safety: SafetyReport
  fuel: any
  maintenance: any
  conditions: Conditions
  current_task: Task | null
  suggestions: Suggestion[]
  supported_intents: string[]
}

export interface TrainingModule {
  id: string
  family: string
  format: string
  duration_min: number
  level: string
  title_en: string
  title_hi: string
  summary_en: string
  summary_hi: string
  skill_tag: string
  thumbnail_hue: number
  recommended?: boolean
}

export interface Instructor {
  id: string
  name_en: string
  name_hi: string
  expertise_en: string
  expertise_hi: string
  languages: string[]
  rating: number
  slots: string[]
}

// ---------------------------------------------------------------- face login
export interface FacePerson {
  id: string
  name_en: string
  name_hi: string
  role: string
  avatar_initials: string
  face_samples: number
}

export interface FaceStatus {
  available: boolean
  allow_enroll: boolean
  allow_tap: boolean
  people: FacePerson[]
  samples_needed: number
  max_samples: number
}

export interface SessionResult {
  token: string
  expires_in: number
  operator: Operator
  method: string
  greeting: { hi: string; en: string }
}

export interface FaceLoginResult extends Partial<SessionResult> {
  matched: boolean
  status: 'match' | 'unknown' | 'no_face' | 'too_small' | 'unavailable'
  operator_id: string | null
  score: number
  box: number[]
  message: { hi: string; en: string }
}

export interface FaceEnrollResult {
  saved: boolean
  samples: number
  status: string
  box: number[]
  message: { hi: string; en: string }
}

// ---------------------------------------------------------------- guides
export interface GuideSummary {
  id: string
  icon: string
  color: string
  title_hi: string
  title_en: string
  steps: number
  families: string[]
}

export interface GuideStep {
  number: number
  icon: string
  title_hi: string
  title_en: string
  say_hi: string
  say_en: string
  speech_hi: string
  speech_en: string
  warning: boolean
}

export interface Guide extends Omit<GuideSummary, 'steps'> {
  intro_hi: string
  intro_en: string
  intro_speech_hi: string
  steps: GuideStep[]
}

// ---------------------------------------------------------------- manager
export interface TaskTypeOption {
  id: string
  families: string[]
  icon: string
  default_minutes: number
  default_cycles: number
  label_en: string
  label_hi: string
}

export interface ManagerOperator {
  id: string
  name_en: string
  name_hi: string
  avatar_initials: string
  certified_families: string[]
  skill_scores: Record<string, number>
  shift: string
  site: string
  experience_years?: number
}

export interface ManagerOptions {
  operators: ManagerOperator[]
  machines: { id: string; model: string; name_en: string; name_hi: string; family: string; site: string }[]
  task_types: TaskTypeOption[]
}

export interface TeamMember {
  operator: ManagerOperator
  tasks: Task[]
  done: number
  total: number
  planned_minutes: number
  current_machine: string | null
  active: boolean
}

export interface FleetMachine {
  id: string
  model: string
  name_en: string
  name_hi: string
  family: string
  site: string
  status: Severity
  health: number
  counts: { critical: number; warning: number; info: number }
  top_finding: Finding | null
  fuel_pct: number | null
  seatbelt: string | null
  safety_score: number
  operators: string[]
}

export interface ManagerOverview {
  generated_at: string
  team: TeamMember[]
  fleet: FleetMachine[]
  incidents: any[]
  kpis: {
    operators: number
    operators_active: number
    tasks_total: number
    tasks_done: number
    tasks_in_progress: number
    machines_attention: number
    machines_critical: number
    incidents: number
  }
}

export interface TaskDraft {
  operator_id: string
  machine_id: string
  task_type: string
  title_en: string
  instructions_en: string
  safety_note_en: string
  location: string
  priority: 'high' | 'medium' | 'low'
  planned_start: string
  planned_minutes: number
  target_cycles?: number | null
  hi?: { title?: string; instructions?: string; safety_note?: string; location?: string }
}

// ---------------------------------------------------------------- machine info
export interface MachineAbout {
  machine: { id: string; model: string; name_en: string; name_hi: string; short_hi: string; family: string; site: string }
  identify_hi: string
  identify_en: string
  summary_hi: string
  summary_en: string
  parts: { icon: string; name_hi: string; name_en: string; what_hi: string; what_en: string }[]
  safety: { icon: string; hi: string; en: string }[]
  guides: { id: string; icon: string; color: string; title_hi: string; title_en: string; steps: number }[]
  video: { youtube_id: string; title: string; channel: string; about_hi: string; about_en: string }
  sections: { id: string; hi: string; en: string; speech_hi: string }[]
}
