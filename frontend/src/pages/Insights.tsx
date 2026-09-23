import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { Loading, Panel, ProgressBar, Spinner, Toast, tone } from '../components/ui'

const STAGE_META: Record<string, { hi: string; en: string; tone: string; cost: string }> = {
  quick_action: { hi: 'बटन (L0)', en: 'Quick action (L0)', tone: 'info', cost: '0 ms' },
  rules: { hi: 'नियम (L1)', en: 'Rules (L1)', tone: 'ok', cost: '<1 ms' },
  embeddings: { hi: 'अर्थ-मिलान (L2)', en: 'Embeddings (L2)', tone: 'warn', cost: '~15 ms' },
  classifier: { hi: 'वर्गीकारक (L3)', en: 'Classifier (L3)', tone: 'info', cost: '~25 ms' },
  fallback: { hi: 'स्पष्टीकरण (L4)', en: 'Clarify (L4)', tone: 'critical', cost: '0 ms' },
}

export default function Insights() {
  const { t, lang } = useLang()
  const { machineId } = useSession()

  const [analytics, setAnalytics] = useState<any>(null)
  const [models, setModels] = useState<any>(null)
  const [routerInfo, setRouterInfo] = useState<any>(null)
  const [intents, setIntents] = useState<any>(null)
  const [warming, setWarming] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    Promise.all([
      api.analytics(), api.systemModels(), api.routerInfo(), api.intents(machineId ?? undefined),
    ]).then(([a, m, r, i]) => {
      setAnalytics(a); setModels(m); setRouterInfo(r); setIntents(i)
    }).catch((e) => setToast(String(e.message ?? e)))
  }, [machineId])

  async function warm() {
    setWarming(true)
    try {
      await api.warm()
      const [m, r] = await Promise.all([api.systemModels(), api.routerInfo()])
      setModels(m); setRouterInfo(r)
      setToast(lang === 'hi' ? 'मॉडल लोड हो गए' : 'Models loaded')
    } catch (e: any) {
      setToast(String(e.message ?? e))
    } finally {
      setWarming(false)
    }
  }

  if (!analytics || !models || !routerInfo) return <Loading />

  const stages = Object.entries(analytics.by_stage as Record<string, number>)
  const totalTurns = Math.max(1, analytics.turns)
  const topIntents = Object.entries(analytics.by_intent as Record<string, number>).slice(0, 8)
  const supportedCount = intents?.intents?.filter((i: any) => i.supported).length ?? 0

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-extrabold tracking-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {t('insights.title')}
          </h1>
          <p className="mt-1 text-sm text-mute">
            {lang === 'hi'
              ? 'हर सवाल किस चरण पर हल हुआ, और उसमें कितना समय लगा'
              : 'Which stage answered each question, and what it cost'}
          </p>
        </div>
        <button onClick={warm} disabled={warming} className="btn-ghost text-xs">
          {warming && <Spinner className="h-3.5 w-3.5" />}
          {lang === 'hi' ? 'मॉडल गर्म करें' : 'Warm up models'}
        </button>
      </div>

      {/* headline numbers */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t('insights.turns'), value: analytics.turns, tint: 'text-slate-100' },
          { label: t('insights.locally'), value: `${analytics.resolved_locally_pct}%`, tint: 'text-ok' },
          { label: t('insights.avgTime'), value: `${analytics.avg_route_ms} ms`, tint: 'text-cat' },
          { label: t('insights.llmCalls'), value: analytics.llm_calls, tint: 'text-ok' },
        ].map((stat) => (
          <div key={stat.label} className="panel p-5">
            <div className={`font-mono text-3xl font-bold tabular-nums ${stat.tint}`}>{stat.value}</div>
            <div className="label mt-1.5">{stat.label}</div>
          </div>
        ))}
      </div>

      <MlModels ml={models.ml} speech={models.tts?.cache} />

      <div className="mt-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        {/* routing distribution */}
        <Panel title={t('insights.routing')}>
          {stages.length === 0 ? (
            <p className="py-8 text-center text-sm text-mute">
              {lang === 'hi' ? 'अभी कोई सवाल नहीं पूछा गया' : 'No questions asked yet'}
            </p>
          ) : (
            <div className="space-y-4">
              {stages.map(([stage, count]) => {
                const meta = STAGE_META[stage] ?? STAGE_META.fallback
                const pct = ((count as number) / totalTurns) * 100
                return (
                  <div key={stage}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-200">{lang === 'hi' ? meta.hi : meta.en}</span>
                      <span className="font-mono text-mute">{count} · {Math.round(pct)}% · {meta.cost}</span>
                    </div>
                    <div className="mt-1.5"><ProgressBar value={pct} tone={meta.tone} /></div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-5 rounded-xl border border-line-soft bg-ink-900/40 p-3.5">
            <p className={`text-[11px] leading-relaxed text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>
              {lang === 'hi'
                ? 'सवाल सबसे सस्ते चरण से शुरू होकर तभी आगे बढ़ता है जब भरोसा कम हो। ज़्यादातर सवाल पहले ही चरण पर हल हो जाते हैं, इसलिए जवाब तेज़, सस्ता और हर बार एक जैसा रहता है।'
                : 'A question starts at the cheapest stage and only escalates when confidence is low. Most land on the first stage, which is why answers are fast, free, and identical every time.'}
            </p>
          </div>
        </Panel>

        {/* stages + thresholds */}
        <Panel title={t('insights.stages')}>
          <ol className="space-y-2.5">
            {routerInfo.stages.map((stage: any) => (
              <li key={stage.id} className="flex items-start gap-3 rounded-xl border border-line-soft bg-ink-800/50 p-3">
                <span className="mt-0.5 rounded-md bg-ink-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cat">
                  {stage.id}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-200">{stage.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-mute">{stage.cost}</span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-mute">{stage.note}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {Object.entries(routerInfo.thresholds as Record<string, number>).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-ink-900/50 px-2.5 py-1.5">
                <div className="font-mono text-[10px] text-mute">{key}</div>
                <div className="font-mono text-sm font-semibold text-slate-200">{value}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* models */}
        <Panel title={t('insights.models')}>
          <div className="space-y-2.5">
            {Object.entries(models.registry.configured as Record<string, string>).map(([role, name]) => {
              const loaded = Object.keys(models.registry.loaded ?? {}).includes(role)
              const failed = (models.registry.failed ?? {})[role]
              const state = failed ? 'crit' : loaded ? 'ok' : 'unknown'
              return (
                <div key={role} className="flex items-center gap-3 rounded-xl border border-line-soft bg-ink-800/50 px-3.5 py-2.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone(state).dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-mute">{role}</div>
                    <div className="truncate font-mono text-[11px] text-slate-300">{name}</div>
                  </div>
                  <span className={`shrink-0 text-[10px] font-semibold ${tone(state).text}`}>
                    {failed ? (lang === 'hi' ? 'अनुपलब्ध' : 'missing')
                      : loaded ? (lang === 'hi' ? 'लोडेड' : 'loaded')
                      : (lang === 'hi' ? 'निष्क्रिय' : 'idle')}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-3.5 text-[11px] text-mute">
            {lang === 'hi' ? 'प्रोफ़ाइल' : 'Profile'}: <span className="font-mono text-slate-300">{models.registry.profile}</span>
            {' · '}
            {lang === 'hi' ? 'डिवाइस' : 'Device'}: <span className="font-mono text-slate-300">{models.registry.device}</span>
          </p>
        </Panel>

        {/* intents */}
        <Panel title={t('insights.intents')}
               actions={<span className="font-mono text-[11px] text-mute">
                 {supportedCount}/{intents?.count ?? 0}
               </span>}>
          {topIntents.length > 0 && (
            <div className="mb-4 space-y-2">
              {topIntents.map(([intent, count]) => (
                <div key={intent} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate font-mono text-[11px] text-slate-300">{intent}</span>
                  <div className="flex-1"><ProgressBar value={((count as number) / totalTurns) * 100} tone="warn" /></div>
                  <span className="w-6 shrink-0 text-right font-mono text-[11px] text-mute">{count as number}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {intents?.intents?.map((intent: any) => (
              <span
                key={intent.name}
                title={intent.description}
                className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                  intent.supported ? 'bg-ink-600 text-slate-300' : 'bg-ink-800 text-mute/50 line-through'}`}
              >
                {intent.name}
              </span>
            ))}
          </div>
        </Panel>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  )
}

/** The three small prediction models, each against the simple rule it replaces. */
function MlModels({ ml, speech }: { ml: any; speech?: any }) {
  const { lang } = useLang()
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)
  if (!ml) return null
  const cards = [
    ml.task_time && {
      title: t('काम का समय', 'Task time'), model: t('ग्रेडिएंट बूस्टिंग', 'Gradient boosting'),
      main: `${ml.task_time.mae_minutes} ${t('मिनट', 'min')}`, mainLabel: t('औसत गलती', 'average error'),
      base: `${ml.task_time.baseline_mae_minutes} ${t('मिनट', 'min')}`,
      note: t(`दायरे में असली समय: ${ml.task_time.range_coverage_pct}%`, `Real time inside the range: ${ml.task_time.range_coverage_pct}%`),
    },
    ml.safety_risk && {
      title: t('अगले घंटे सुरक्षा ख़तरा', 'Safety risk, next hour'), model: t('ग्रेडिएंट बूस्टिंग', 'Gradient boosting'),
      main: `${ml.safety_risk.auc}`, mainLabel: 'AUC', base: `${ml.safety_risk.baseline_auc}`,
      note: t(`चेतावनी सही: ${ml.safety_risk['precision_at_0.4_pct']}%`, `Flags that were right: ${ml.safety_risk['precision_at_0.4_pct']}%`),
    },
    ml.unusual_use && {
      title: t('मशीन का असामान्य इस्तेमाल', 'Unusual machine use'), model: t('आइसोलेशन फ़ॉरेस्ट', 'Isolation forest'),
      main: `${ml.unusual_use.precision_pct}%`, mainLabel: t('सही पकड़', 'flags that were real'),
      base: `${ml.unusual_use.baseline_precision_pct}%`,
      note: t(`गड़बड़ी पकड़ी: ${ml.unusual_use.recall_pct}%`, `Misuse caught: ${ml.unusual_use.recall_pct}%`),
    },
  ].filter(Boolean) as { title: string; model: string; main: string; mainLabel: string; base: string; note: string }[]
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-3">
      {cards.map((c) => (
        <div key={c.title} className="panel p-5">
          <div className={`text-sm font-bold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{c.title}</div>
          <div className="label mt-0.5">{c.model} · {t('अनदेखे डेटा पर जाँचा', 'tested on unseen data')}</div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold tabular-nums text-ok">{c.main}</span>
            <span className="text-xs text-mute">{c.mainLabel}</span>
          </div>
          <div className="mt-1 text-xs text-mute">{t('सीधे नियम से', 'simple rule')}: <span className="font-mono text-slate-300">{c.base}</span></div>
          <div className={`mt-2 text-xs text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>{c.note}</div>
        </div>
      ))}
      {speech && (
        <div className="panel p-5 md:col-span-3">
          <div className="text-sm font-bold text-white">{t('आवाज़ कैश', 'Speech cache')}</div>
          <div className="mt-1 text-xs text-mute">
            {t(`${speech.disk_items} आवाज़ें सहेजी (${speech.disk_mb} MB) · दोबारा इस्तेमाल: ${speech.hits + speech.disk_hits} · नई बनाई: ${speech.misses}`,
               `${speech.disk_items} clips stored (${speech.disk_mb} MB) · reused: ${speech.hits + speech.disk_hits} · newly made: ${speech.misses}`)}
          </div>
        </div>
      )}
    </div>
  )
}
