import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { useVoiceOut } from '../lib/speechContext'
import type { Estimate, ManagerOptions, ManagerOverview, Task, TaskDraft, TeamMember } from '../lib/types'
import { MachineIcon } from '../components/MachineIcon'
import { Pictogram, TASK_ICON } from '../components/Pictogram'
import { Logo, LanguageToggle } from '../components/Chrome'
import { ProgressBar, Spinner, StatusPill, Toast, tone } from '../components/ui'

const REFRESH_MS = 10000

function mins(total: number, lang: 'hi' | 'en') {
  const h = Math.floor(total / 60), m = Math.round(total % 60)
  if (lang === 'hi') return h ? (m ? `${h} घं ${m} मि` : `${h} घं`) : `${m} मि`
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

const STATUS_LABEL = {
  pending: { en: 'Pending', hi: 'बाकी', tone: 'unknown' },
  in_progress: { en: 'In progress', hi: 'चल रहा', tone: 'warn' },
  done: { en: 'Done', hi: 'पूरा', tone: 'ok' },
  blocked: { en: 'Blocked', hi: 'रुका', tone: 'crit' },
} as const

// ============================================================ task row
function TaskRow({ task, team, onChanged, onToast }: {
  task: Task; team: TeamMember[]; onChanged: () => void; onToast: (m: string) => void
}) {
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = STATUS_LABEL[task.status]
  const hindiChecked = task.translation_source === 'manager' || task.translation_source === 'curated' || task.translation_source === 'model'

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    try { await fn(); onToast(done); onChanged() } catch (e: any) { onToast(String(e.message ?? e)) } finally { setBusy(false) }
  }

  return (
    <li className="rounded-xl border border-line-soft bg-ink-900/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cat/10 text-cat">
          <Pictogram name={TASK_ICON[task.task_type] ?? 'clipboard'} className="h-7 w-7" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-mute">#{task.sequence}</span>
            <span className="truncate text-sm font-semibold text-slate-100">{task.title_en}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
            <span className="flex items-center gap-1"><MachineIcon family={task.machine.family} className="h-3.5 w-4" />{task.machine.model}</span>
            <span className="font-mono">{task.planned_start}</span>
            <span>{mins(task.estimate?.expected_minutes ?? task.planned_minutes, lang)}</span>
            {task.priority === 'high' && <span className="font-semibold text-crit">{lang === 'hi' ? 'ज़रूरी' : 'High'}</span>}
            <span className={hindiChecked ? 'text-ok' : 'text-warn'} title={hindiChecked ? 'Hindi ready' : 'Worker will see English'}>
              {hindiChecked ? 'हिंदी ✓' : 'EN only'}
            </span>
          </span>
        </span>
        <StatusPill status={status.tone} label={status[lang]} />
      </button>

      {task.status === 'in_progress' && (
        <div className="px-3 pb-3"><ProgressBar value={task.progress * 100} tone="warn" /></div>
      )}

      {open && (
        <div className="animate-risein space-y-3 border-t border-line-soft p-3">
          {task.hi?.title && <p className="lang-hi text-sm text-slate-300">{task.hi.title}</p>}
          <div className="flex flex-wrap gap-2">
            {(['pending', 'in_progress', 'done', 'blocked'] as const).map((s) => (
              <button key={s} disabled={busy || task.status === s}
                onClick={() => run(() => api.managerUpdateTask(task.id, { status: s }), lang === 'hi' ? 'स्थिति बदली' : 'Status updated')}
                className={`chip !text-[11px] ${task.status === s ? '!border-cat !text-cat' : ''}`}>
                {STATUS_LABEL[s][lang]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-mute">{lang === 'hi' ? 'दूसरे को दें' : 'Reassign to'}</label>
            <select disabled={busy} value={task.operator_id}
              onChange={(e) => run(() => api.managerUpdateTask(task.id, { operator_id: e.target.value }),
                lang === 'hi' ? 'काम दूसरे को दिया गया' : 'Task reassigned')}
              className="field !w-auto !py-1.5 !text-xs">
              {team.map((m) => <option key={m.operator.id} value={m.operator.id}>{lang === 'hi' ? m.operator.name_hi : m.operator.name_en}</option>)}
            </select>
            <button disabled={busy}
              onClick={() => { if (confirm(lang === 'hi' ? 'यह काम हटाएँ?' : 'Remove this task?')) void run(() => api.managerDeleteTask(task.id), lang === 'hi' ? 'काम हटाया गया' : 'Task removed') }}
              className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-crit hover:bg-crit/10">
              <Pictogram name="cross" className="h-4 w-4" />{lang === 'hi' ? 'हटाएँ' : 'Remove'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

// ============================================================ assign form
const BLANK: TaskDraft = {
  operator_id: '', machine_id: '', task_type: '', title_en: '', instructions_en: '', safety_note_en: '',
  location: '', priority: 'medium', planned_start: '08:00', planned_minutes: 90,
}

function AssignDrawer({ options, preset, onClose, onAssigned }: {
  options: ManagerOptions; preset: string | null; onClose: () => void; onAssigned: (message: string) => void
}) {
  const { lang } = useLang()
  const { speak, stop, speakingId } = useVoiceOut()
  const firstOp = options.operators.find((o) => o.id === preset) ?? options.operators[0]
  const firstMachine = options.machines.find((m) => firstOp?.certified_families.includes(m.family)) ?? options.machines[0]
  const firstType = options.task_types.find((t) => t.families.includes(firstMachine.family))!

  const [draft, setDraft] = useState<TaskDraft>({
    ...BLANK, operator_id: firstOp.id, machine_id: firstMachine.id, task_type: firstType.id,
    planned_minutes: firstType.default_minutes, location: firstMachine.site,
  })
  const [hindi, setHindi] = useState({ title: '', instructions: '', safety_note: '', location: '' })
  const [estimate, setEstimate] = useState<(Estimate & { certification: { certified: boolean; skill: number | null } }) | null>(null)
  const [translating, setTranslating] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const operator = options.operators.find((o) => o.id === draft.operator_id)!
  const machine = options.machines.find((m) => m.id === draft.machine_id)!
  const types = options.task_types.filter((t) => t.families.includes(machine.family))
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  // A new machine may not support the chosen job; keep the form consistent.
  useEffect(() => {
    if (!types.some((t) => t.id === draft.task_type)) {
      setDraft((d) => ({ ...d, task_type: types[0].id, planned_minutes: types[0].default_minutes }))
    }
  }, [draft.machine_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live prediction as the manager edits.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.managerEstimate({ ...draft, title_en: draft.title_en || 'draft task' }).then(setEstimate).catch(() => setEstimate(null))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [draft.operator_id, draft.machine_id, draft.task_type, draft.planned_minutes]) // eslint-disable-line react-hooks/exhaustive-deps

  async function translateNow() {
    setTranslating(true); setNote('')
    try {
      const res = await api.managerTranslate({
        title: draft.title_en, instructions: draft.instructions_en, safety_note: draft.safety_note_en, location: draft.location,
      })
      if (res.available) {
        setHindi((h) => ({
          title: res.hi.title ?? h.title, instructions: res.hi.instructions ?? h.instructions,
          safety_note: res.hi.safety_note ?? h.safety_note, location: res.hi.location ?? h.location,
        }))
      }
      setNote(res.note ?? '')
    } catch (e: any) { setNote(String(e.message ?? e)) } finally { setTranslating(false) }
  }

  const spoken = [hindi.title, hindi.location && `जगह, ${hindi.location}`, hindi.instructions, hindi.safety_note && `सुरक्षा के लिए, ${hindi.safety_note}`]
    .filter(Boolean).join('। ')

  async function submit() {
    if (draft.title_en.trim().length < 3) { setError(lang === 'hi' ? 'काम का नाम लिखिए' : 'Give the task a title'); return }
    setSubmitting(true); setError('')
    try {
      const res = await api.managerCreateTask({ ...draft, hi: hindi })
      onAssigned(res.message)
    } catch (e: any) { setError(String(e.message ?? e)) } finally { setSubmitting(false) }
  }

  const cert = operator.certified_families.includes(machine.family)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/70 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-5xl animate-risein flex-col overflow-hidden border-l border-line bg-ink-800 shadow-panel">
        <header className="flex items-center gap-3 border-b border-line-soft px-6 py-4">
          <Pictogram name="clipboard" className="h-7 w-7 text-cat" />
          <h2 className="flex-1 text-lg font-bold text-white">{lang === 'hi' ? 'काम सौंपें' : 'Assign work'}</h2>
          <button onClick={onClose} className="btn-quiet !px-2"><Pictogram name="cross" className="h-6 w-6" /></button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* ---------------- form ---------------- */}
          <div className="space-y-6 p-6">
            <section>
              <p className="label mb-2">{lang === 'hi' ? 'किसे' : 'Worker'}</p>
              <div className="grid grid-cols-2 gap-2">
                {options.operators.map((o) => (
                  <button key={o.id} onClick={() => setDraft((d) => {
                      const current = options.machines.find((m) => m.id === d.machine_id)
                      if (current && o.certified_families.includes(current.family)) return { ...d, operator_id: o.id }
                      const better = options.machines.find((m) => o.certified_families.includes(m.family))
                      return better
                        ? { ...d, operator_id: o.id, machine_id: better.id, location: d.location === current?.site ? better.site : d.location }
                        : { ...d, operator_id: o.id }
                    })}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors
                      ${draft.operator_id === o.id ? 'border-cat bg-cat/10' : 'border-line hover:border-cat/40'}`}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink-600 text-sm font-bold text-cat">{o.avatar_initials}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">{lang === 'hi' ? o.name_hi : o.name_en}</span>
                      <span className="flex gap-1 pt-1">
                        {o.certified_families.map((f) => <MachineIcon key={f} family={f} className="h-4 w-5 text-mute" />)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <p className="label mb-2">{lang === 'hi' ? 'मशीन' : 'Machine'}</p>
              <div className="grid grid-cols-3 gap-2">
                {options.machines.map((m) => {
                  const ok = operator.certified_families.includes(m.family)
                  return (
                    <button key={m.id} onClick={() => setDraft((d) => ({ ...d, machine_id: m.id, location: d.location === machine.site ? m.site : d.location }))}
                      className={`flex flex-col items-center gap-1 rounded-xl border p-3 transition-colors
                        ${draft.machine_id === m.id ? 'border-cat bg-cat/10' : 'border-line hover:border-cat/40'}`}>
                      <MachineIcon family={m.family} className={`h-9 w-11 ${draft.machine_id === m.id ? 'text-cat' : 'text-slate-300'}`} />
                      <span className="text-xs font-semibold text-white">{m.model}</span>
                      <span className={`text-[10px] font-semibold ${ok ? 'text-ok' : 'text-warn'}`}>
                        {ok ? (lang === 'hi' ? 'प्रमाणित' : 'Certified') : (lang === 'hi' ? 'प्रमाणित नहीं' : 'Not certified')}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <p className="label mb-2">{lang === 'hi' ? 'काम का प्रकार' : 'Job type'}</p>
              <div className="flex flex-wrap gap-2">
                {types.map((t) => (
                  <button key={t.id} onClick={() => setDraft((d) => ({ ...d, task_type: t.id, planned_minutes: t.default_minutes }))}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors
                      ${draft.task_type === t.id ? 'border-cat bg-cat/10 text-white' : 'border-line text-slate-300 hover:border-cat/40'}`}>
                    <Pictogram name={t.icon} className="h-6 w-6 text-cat" />{lang === 'hi' ? t.label_hi : t.label_en}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <label className="label mb-1.5 block">{lang === 'hi' ? 'काम का नाम (अंग्रेज़ी में)' : 'Task title'}</label>
                <input className="field" value={draft.title_en} maxLength={160}
                  placeholder="e.g. Load river sand into dispatch trucks"
                  onChange={(e) => set('title_en', e.target.value)} />
              </div>
              <div>
                <label className="label mb-1.5 block">{lang === 'hi' ? 'निर्देश' : 'Instructions'}</label>
                <textarea className="field resize-none" rows={3} value={draft.instructions_en} maxLength={1200}
                  placeholder="What exactly should be done, and how much"
                  onChange={(e) => set('instructions_en', e.target.value)} />
              </div>
              <div>
                <label className="label mb-1.5 block">{lang === 'hi' ? 'सुरक्षा निर्देश' : 'Safety note'}</label>
                <textarea className="field resize-none" rows={2} value={draft.safety_note_en} maxLength={600}
                  placeholder="Hazards on this job the worker must know"
                  onChange={(e) => set('safety_note_en', e.target.value)} />
              </div>
              <div>
                <label className="label mb-1.5 block">{lang === 'hi' ? 'जगह' : 'Location'}</label>
                <input className="field" value={draft.location} maxLength={160} onChange={(e) => set('location', e.target.value)} />
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label mb-1.5 block">{lang === 'hi' ? 'शुरू' : 'Start'}</label>
                <input type="time" className="field font-mono" value={draft.planned_start}
                  onChange={(e) => set('planned_start', e.target.value)} />
              </div>
              <div>
                <label className="label mb-1.5 block">{lang === 'hi' ? 'योजना (मिनट)' : 'Planned (min)'}</label>
                <input type="number" min={5} max={720} className="field font-mono" value={draft.planned_minutes}
                  onChange={(e) => set('planned_minutes', Math.max(5, Math.min(720, Number(e.target.value) || 5)))} />
              </div>
              <div>
                <label className="label mb-1.5 block">{lang === 'hi' ? 'प्राथमिकता' : 'Priority'}</label>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-line p-1">
                  {(['high', 'medium', 'low'] as const).map((p) => (
                    <button key={p} onClick={() => set('priority', p)}
                      className={`rounded-lg py-2 text-xs font-semibold ${draft.priority === p
                        ? (p === 'high' ? 'bg-crit text-white' : p === 'medium' ? 'bg-warn text-ink-900' : 'bg-sky-400 text-ink-900') : 'text-mute'}`}>
                      {p === 'high' ? (lang === 'hi' ? 'ज़रूरी' : 'High') : p === 'medium' ? (lang === 'hi' ? 'सामान्य' : 'Med') : (lang === 'hi' ? 'कम' : 'Low')}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* ---------------- preview ---------------- */}
          <aside className="space-y-4 border-t border-line-soft bg-ink-900/40 p-6 lg:border-l lg:border-t-0">
            <div className="rounded-2xl border border-line-soft bg-ink-800 p-4">
              <p className="label mb-3 flex items-center gap-2"><Pictogram name="clock" className="h-4 w-4 text-cat" />{lang === 'hi' ? 'अनुमानित समय' : 'Predicted time'}</p>
              {estimate ? (<>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-bold text-cat">{mins(estimate.expected_minutes, lang)}</span>
                  <span className="text-xs text-mute">{mins(estimate.low_minutes, lang)} – {mins(estimate.high_minutes, lang)}</span>
                </div>
                <p className="mt-1 text-[11px] text-mute">
                  {lang === 'hi' ? `${estimate.samples} पिछले कामों से · भरोसा ${Math.round(estimate.confidence * 100)}%` : `from ${estimate.samples} past jobs · ${Math.round(estimate.confidence * 100)}% confidence`}
                </p>
                {estimate.expected_minutes > draft.planned_minutes * 1.15 && (
                  <p className="mt-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[11px] text-warn">
                    {lang === 'hi' ? 'आपकी योजना से ज़्यादा समय लग सकता है' : `Likely to overrun your ${draft.planned_minutes} min plan`}
                  </p>
                )}
                {estimate.factors.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {estimate.factors.map((f) => (
                      <span key={f.label_en} className="chip !py-1 !text-[10px]">
                        {lang === 'hi' ? f.label_hi : f.label_en}
                        <span className={f.effect_pct > 0 ? 'text-crit' : 'text-ok'}>{f.effect_pct > 0 ? '+' : ''}{f.effect_pct}%</span>
                      </span>
                    ))}
                  </div>
                )}
              </>) : <Spinner />}
              <p className={`mt-3 flex items-center gap-1.5 text-xs font-semibold ${cert ? 'text-ok' : 'text-warn'}`}>
                <Pictogram name={cert ? 'check' : 'alert'} className="h-4 w-4" />
                {cert
                  ? (lang === 'hi' ? `${operator.name_hi} इस मशीन पर प्रमाणित हैं` : `${operator.name_en} is certified on this machine`)
                  : (lang === 'hi' ? `${operator.name_hi} इस मशीन पर प्रमाणित नहीं हैं` : `${operator.name_en} is not certified on this machine`)}
              </p>
            </div>

            <div className="rounded-2xl border border-line-soft bg-ink-800 p-4">
              <div className="mb-3 flex items-center gap-2">
                <p className="label flex-1">{lang === 'hi' ? 'कर्मचारी क्या सुनेगा' : 'What the worker will hear'}</p>
                <button onClick={() => (speakingId === 'preview' ? stop() : void speak(spoken, 'hi', 'preview', true))}
                  disabled={!spoken} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-700 text-cat disabled:opacity-30" title="Listen">
                  <Pictogram name={speakingId === 'preview' ? 'pause' : 'speaker'} className="h-5 w-5" />
                </button>
              </div>
              <button onClick={() => void translateNow()} disabled={translating || !draft.title_en.trim()}
                className="btn-ghost mb-3 w-full !py-2 text-xs">
                {translating ? <Spinner className="h-3.5 w-3.5" /> : <Pictogram name="switch" className="h-4 w-4" />}
                {lang === 'hi' ? 'हिंदी में बदलें' : 'Translate to Hindi'}
              </button>
              {note && <p className="mb-3 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">{note}</p>}
              {(['title', 'location', 'instructions', 'safety_note'] as const).map((k) => (
                <div key={k} className="mb-2.5">
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-mute">
                    {{ title: 'शीर्षक · title', location: 'जगह · location', instructions: 'निर्देश · instructions', safety_note: 'सुरक्षा · safety' }[k]}
                  </label>
                  <textarea rows={k === 'instructions' ? 3 : k === 'safety_note' ? 2 : 1} value={hindi[k]}
                    onChange={(e) => setHindi((h) => ({ ...h, [k]: e.target.value }))}
                    className="field lang-hi resize-none !px-3 !py-2 !text-sm" placeholder="—" />
                </div>
              ))}
              {!hindi.title && (
                <p className="text-[11px] text-mute">{lang === 'hi' ? 'खाली छोड़ने पर कर्मचारी अंग्रेज़ी देखेगा।' : 'Left blank, the worker sees the English.'}</p>
              )}
            </div>
          </aside>
        </div>

        <footer className="flex items-center gap-3 border-t border-line-soft px-6 py-4">
          {error && <p className="flex-1 text-sm text-crit">{error}</p>}
          <button onClick={onClose} className="btn-ghost ml-auto">{lang === 'hi' ? 'रद्द करें' : 'Cancel'}</button>
          <button onClick={() => void submit()} disabled={submitting} className="btn-primary px-6">
            {submitting ? <Spinner /> : <Pictogram name="check" className="h-5 w-5" />}
            {lang === 'hi' ? `${operator.name_hi} को सौंपें` : `Assign to ${operator.name_en.split(' ')[0]}`}
          </button>
        </footer>
      </div>
    </div>
  )
}

// ============================================================ portal
export default function Manager() {
  const { lang } = useLang()
  const { operator, logout } = useSession()
  const navigate = useNavigate()
  const [overview, setOverview] = useState<ManagerOverview | null>(null)
  const [options, setOptions] = useState<ManagerOptions | null>(null)
  const [assignFor, setAssignFor] = useState<string | null | undefined>(undefined)
  const [toast, setToast] = useState('')
  const alive = useRef(true)

  const refresh = useCallback(() => {
    api.managerOverview().then((o) => alive.current && setOverview(o)).catch(() => undefined)
  }, [])

  useEffect(() => {
    alive.current = true
    refresh()
    api.managerOptions().then(setOptions).catch(() => undefined)
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => { alive.current = false; window.clearInterval(timer) }
  }, [refresh])

  const kpis = overview?.kpis
  const incidents = overview?.incidents ?? []
  const names = useMemo(() => Object.fromEntries((overview?.team ?? []).map((m) => [m.operator.id, lang === 'hi' ? m.operator.name_hi : m.operator.name_en])), [overview, lang])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line-soft bg-ink-900/85 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 sm:px-6">
          <Logo />
          <span className="hidden rounded-full bg-cat/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-cat sm:inline">
            {lang === 'hi' ? 'मैनेजर' : 'Manager'}
          </span>
          <div className="ml-auto flex items-center gap-2.5">
            <button onClick={() => navigate('/pro/insights')} className="btn-quiet !px-2.5 text-xs" title="Analytics">
              <Pictogram name="chart" className="h-5 w-5" /><span className="hidden sm:inline">{lang === 'hi' ? 'विश्लेषण' : 'Analytics'}</span>
            </button>
            <LanguageToggle />
            <div className="grid h-9 w-9 place-items-center rounded-full border border-line bg-ink-700 text-[11px] font-bold text-cat">{operator?.avatar_initials}</div>
            <button onClick={() => { logout(); navigate('/login') }} className="btn-quiet !px-2" title="Sign out">
              <Pictogram name="logout" className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <h1 className={`text-2xl font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {lang === 'hi' ? `नमस्ते, ${operator?.name_hi}` : `Good day, ${operator?.name_en?.split(' ')[0]}`}
            </h1>
            <p className="mt-1 text-sm text-mute">{lang === 'hi' ? 'आज की पूरी साइट एक नज़र में' : 'The whole site, live'}</p>
          </div>
          <button onClick={() => setAssignFor(null)} disabled={!options} className="btn-primary px-5 py-3 text-base">
            <Pictogram name="user_plus" className="h-5 w-5" />{lang === 'hi' ? 'काम सौंपें' : 'Assign work'}
          </button>
        </div>

        {/* ---------------- KPIs ---------------- */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { icon: 'person', v: kpis ? `${kpis.operators_active}/${kpis.operators}` : '–', l: lang === 'hi' ? 'काम पर' : 'Working now', t: 'text-slate-100' },
            { icon: 'clipboard', v: kpis ? `${kpis.tasks_done}/${kpis.tasks_total}` : '–', l: lang === 'hi' ? 'काम पूरे' : 'Tasks done', t: 'text-ok' },
            { icon: 'alert', v: kpis?.machines_attention ?? '–', l: lang === 'hi' ? 'मशीनें ध्यान माँगें' : 'Machines need attention', t: kpis?.machines_attention ? 'text-warn' : 'text-ok' },
            { icon: 'shield', v: kpis?.incidents ?? '–', l: lang === 'hi' ? 'घटनाएँ' : 'Incidents reported', t: kpis?.incidents ? 'text-crit' : 'text-ok' },
          ].map((k) => (
            <div key={k.l} className="panel flex items-center gap-4 p-4">
              <Pictogram name={k.icon} className={`h-9 w-9 shrink-0 ${k.t}`} />
              <div>
                <div className={`font-mono text-2xl font-bold ${k.t}`}>{k.v}</div>
                <div className="label mt-0.5">{k.l}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* ---------------- team ---------------- */}
          <section className="space-y-4">
            <h2 className="label">{lang === 'hi' ? 'टीम और आज का काम' : "Team and today's work"}</h2>
            {!overview && <div className="panel h-40 animate-pulse" />}
            {overview?.team.map((member) => (
              <div key={member.operator.id} className="panel p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="relative">
                    <div className="grid h-12 w-12 place-items-center rounded-full bg-ink-600 font-bold text-cat">{member.operator.avatar_initials}</div>
                    {member.active && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-ink-800 bg-ok" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-base font-bold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{lang === 'hi' ? member.operator.name_hi : member.operator.name_en}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-mute">
                      {member.operator.certified_families.map((f) => <MachineIcon key={f} family={f} className="h-4 w-5" />)}
                      <span>·</span><span>{member.operator.shift}</span>
                    </div>
                  </div>
                  <div className="w-40">
                    <div className="flex justify-between text-[11px] text-mute">
                      <span>{lang === 'hi' ? 'पूरा' : 'Done'}</span><span className="font-mono text-slate-200">{member.done}/{member.total}</span>
                    </div>
                    <div className="mt-1.5"><ProgressBar value={member.total ? (member.done / member.total) * 100 : 0} tone="ok" /></div>
                  </div>
                  <button onClick={() => setAssignFor(member.operator.id)} disabled={!options} className="btn-ghost !py-2 text-xs">
                    <Pictogram name="user_plus" className="h-4 w-4 text-cat" />{lang === 'hi' ? 'काम दें' : 'Assign'}
                  </button>
                </div>
                <ul className="mt-4 space-y-2">
                  {member.tasks.length === 0 && (
                    <li className="rounded-xl border border-dashed border-line py-6 text-center text-sm text-mute">
                      {lang === 'hi' ? 'आज कोई काम नहीं' : 'No work assigned today'}
                    </li>
                  )}
                  {member.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} team={overview.team} onChanged={refresh} onToast={setToast} />
                  ))}
                </ul>
              </div>
            ))}
          </section>

          {/* ---------------- fleet + incidents ---------------- */}
          <aside className="space-y-6">
            <section>
              <h2 className="label mb-3">{lang === 'hi' ? 'मशीनें' : 'Fleet'}</h2>
              <div className="space-y-3">
                {overview?.fleet.map((m) => {
                  const shade = tone(m.status)
                  return (
                    <div key={m.id} className="panel p-4">
                      <div className="flex items-center gap-3">
                        <div className={`grid h-12 w-14 shrink-0 place-items-center rounded-xl bg-ink-700 ${shade.text}`}>
                          <MachineIcon family={m.family} className="h-8 w-10" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{m.model}</span>
                            <StatusPill status={m.status} />
                          </div>
                          <div className="mt-1 flex gap-3 text-[11px] text-mute">
                            <span>{lang === 'hi' ? 'स्वास्थ्य' : 'Health'} <b className="font-mono text-slate-200">{m.health}</b></span>
                            <span>{lang === 'hi' ? 'ईंधन' : 'Fuel'} <b className="font-mono text-slate-200">{m.fuel_pct != null ? Math.round(Number(m.fuel_pct)) : '–'}%</b></span>
                            <span className={m.seatbelt === 'Fastened' ? '' : 'font-semibold text-crit'}>
                              {m.seatbelt === 'Fastened' ? (lang === 'hi' ? 'बेल्ट ✓' : 'Belt ✓') : (lang === 'hi' ? 'बेल्ट ✕' : 'Belt ✕')}
                            </span>
                          </div>
                          {m.operators.length > 0 && (
                            <div className="mt-1 text-[11px] text-cat">{m.operators.map((id) => names[id]).join(', ')}</div>
                          )}
                        </div>
                      </div>
                      {m.top_finding && (
                        <p className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${tone(m.top_finding.severity).bg} ${tone(m.top_finding.severity).text} ${lang === 'hi' ? 'lang-hi' : ''}`}>
                          {m.top_finding.title[lang]}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            <section>
              <h2 className="label mb-3">{lang === 'hi' ? 'घटनाएँ' : 'Incident reports'}</h2>
              <div className="panel divide-y divide-line-soft">
                {incidents.length === 0 && <p className="p-5 text-center text-sm text-ok">{lang === 'hi' ? 'कोई घटना नहीं' : 'No incidents reported'}</p>}
                {incidents.map((inc) => (
                  <div key={inc.id} className="flex gap-3 p-4">
                    <Pictogram name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-crit" />
                    <div className="min-w-0">
                      <p className={`text-sm text-slate-100 ${inc.language === 'hi' ? 'lang-hi' : ''}`}>{inc.description}</p>
                      <p className="mt-1 text-[11px] text-mute">
                        {names[inc.operator_id] ?? inc.operator_id} · {inc.machine_id} · {new Date(inc.created_at).toLocaleTimeString(lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {assignFor !== undefined && options && (
        <AssignDrawer options={options} preset={assignFor} onClose={() => setAssignFor(undefined)}
          onAssigned={(message) => { setAssignFor(undefined); setToast(message); refresh() }} />
      )}
      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  )
}
