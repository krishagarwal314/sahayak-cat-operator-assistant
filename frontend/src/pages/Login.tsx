import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { LanguageToggle, Logo } from '../components/Chrome'
import { MachineIcon } from '../components/MachineIcon'
import { Spinner } from '../components/ui'

interface DemoAccount {
  username: string
  password: string
  name_en: string
  name_hi: string
  role: string
}

export default function Login() {
  const { t, lang } = useLang()
  const { login, operator } = useSession()
  const navigate = useNavigate()

  const [username, setUsername] = useState('OP1001')
  const [password, setPassword] = useState('cat1234')
  const [accounts, setAccounts] = useState<DemoAccount[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (operator) navigate('/shift', { replace: true })
  }, [operator, navigate])

  useEffect(() => {
    api.demoAccounts().then(setAccounts).catch(() => setAccounts([]))
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(username.trim(), password)
      navigate('/shift', { replace: true })
    } catch {
      setError(t('login.error'))
    } finally {
      setBusy(false)
    }
  }

  const pitches = [t('login.pitch1'), t('login.pitch2'), t('login.pitch3')]

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ---------------- brand panel ---------------- */}
      <aside className="grain relative hidden overflow-hidden border-r border-line-soft bg-ink-800/40 p-12 lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute -right-24 top-1/4 text-cat/[0.045]"
          aria-hidden="true"
        >
          <MachineIcon family="excavator" className="h-[540px] w-[540px]" />
        </div>

        <Logo />

        <div className="relative z-10 mt-auto max-w-lg">
          <h1 className={`text-balance text-[42px] font-extrabold leading-[1.12] tracking-tight text-white
                          ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {lang === 'hi' ? (
              <>मशीन की भाषा,<br /><span className="text-cat">आपकी भाषा में</span></>
            ) : (
              <>The machine's data,<br /><span className="text-cat">in your language</span></>
            )}
          </h1>

          <ul className="mt-9 space-y-4">
            {pitches.map((pitch) => (
              <li key={pitch} className="flex items-start gap-3">
                <span className="mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cat/15 text-cat">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.4"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                </span>
                <span className={`text-[15px] leading-relaxed text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>
                  {pitch}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex items-center gap-6 border-t border-line-soft pt-6">
            {[
              { value: '35', label: lang === 'hi' ? 'इरादे' : 'intents' },
              { value: '3', label: lang === 'hi' ? 'मशीनें' : 'machines' },
              { value: '<2ms', label: lang === 'hi' ? 'राउटिंग' : 'routing' },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="font-mono text-xl font-bold text-cat">{stat.value}</div>
                <div className="label">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ---------------- form ---------------- */}
      <main className="flex flex-col justify-center px-6 py-12 sm:px-14">
        <div className="mb-8 flex items-center justify-between lg:justify-end">
          <div className="lg:hidden"><Logo /></div>
          <LanguageToggle />
        </div>

        <div className="mx-auto w-full max-w-sm">
          <h2 className={`text-2xl font-bold tracking-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>
            {t('login.title')}
          </h2>
          <p className="mt-1.5 text-sm text-mute">{t('login.subtitle')}</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="operator" className="label mb-1.5 block">{t('login.operatorId')}</label>
              <input
                id="operator"
                className="field font-mono tracking-wide"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="characters"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="label mb-1.5 block">{t('login.password')}</label>
              <input
                id="password"
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full py-3 text-[15px]">
              {busy ? <Spinner /> : null}
              {t('login.submit')}
            </button>
          </form>

          {accounts.length > 0 && (
            <div className="mt-9">
              <p className="label mb-2.5">{t('login.demo')}</p>
              <div className="space-y-2">
                {accounts.map((account) => (
                  <button
                    key={account.username}
                    onClick={() => { setUsername(account.username); setPassword(account.password) }}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-ink-800/60 px-3 py-2.5
                               text-left transition-colors hover:border-cat/50 hover:bg-ink-700/60"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-600 text-[11px] font-bold text-cat">
                      {account.name_en.split(' ').map((part) => part[0]).join('')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-200">
                        {lang === 'hi' ? account.name_hi : account.name_en}
                      </span>
                      <span className="block font-mono text-[11px] text-mute">
                        {account.username} · {account.password}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-ink-600 px-2 py-0.5 text-[10px] uppercase tracking-wider text-mute">
                      {account.role}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
