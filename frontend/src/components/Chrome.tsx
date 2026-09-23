import { NavLink, useNavigate } from 'react-router-dom'
import { useLang } from '../lib/i18n'
import { getViewMode, setViewMode, VIEW_HOME } from '../lib/viewMode'
import { useSession } from '../lib/session'
import { MachineIcon } from './MachineIcon'

export function Logo({ compact = false }: { compact?: boolean }) {
  const { t } = useLang()
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-cat text-ink-900 shadow-[0_4px_16px_-6px_rgba(255,205,17,0.9)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v8" />
          <path d="M8.5 6.5 12 3l3.5 3.5" />
          <path d="M5 13a7 7 0 0 0 14 0" />
          <path d="M9 20h6" />
        </svg>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-tight text-white">{t('app.name')}</div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-mute">{t('app.tagline')}</div>
        </div>
      )}
    </div>
  )
}

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLang()
  return (
    <div className={`inline-flex items-center rounded-full border border-line bg-ink-800/80 p-0.5 ${className}`}>
      {(['hi', 'en'] as const).map((code) => (
        <button
          key={code}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
            lang === code ? 'bg-cat text-ink-900 shadow-sm' : 'text-mute hover:text-slate-200'
          }`}
        >
          {code === 'hi' ? 'हिंदी' : 'EN'}
        </button>
      ))}
    </div>
  )
}

const NAV = [
  { to: '/pro/shift', key: 'nav.shift' },
  { to: '/pro/machines', key: 'nav.machines' },
  { to: '/pro/cockpit', key: 'nav.cockpit' },
  { to: '/pro/training', key: 'nav.training' },
  { to: '/pro/insights', key: 'nav.insights' },
] as const

export function TopBar({ machineName, machineFamily }: { machineName?: string; machineFamily?: string }) {
  const { t, lang } = useLang()
  const { operator, logout } = useSession()
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-ink-900/85 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <button onClick={() => navigate(VIEW_HOME[getViewMode()])} className="shrink-0" aria-label="home">
          <Logo />
        </button>

        <nav className="ml-2 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                  isActive ? 'bg-ink-700 text-white' : 'text-mute hover:bg-ink-800 hover:text-slate-200'
                }`
              }
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
          {machineName && (
            <button
              onClick={() => navigate('/pro/machines')}
              className="hidden items-center gap-2 rounded-xl border border-line bg-ink-800 px-3 py-1.5
                         text-xs font-semibold text-slate-200 transition-colors hover:border-cat/50 sm:flex"
              title={t('machines.title')}
            >
              <MachineIcon family={machineFamily ?? 'excavator'} className="h-5 w-5 text-cat" />
              <span className="max-w-[150px] truncate">{machineName}</span>
            </button>
          )}

          <button onClick={() => { setViewMode('simple'); navigate(VIEW_HOME.simple) }}
            className="whitespace-nowrap rounded-xl bg-cat px-2.5 py-1.5 text-xs font-bold text-ink-900 hover:bg-cat-dark">
            {t('nav.simple')}
          </button>

          <LanguageToggle />

          {operator && (
            <div className="flex items-center gap-2">
              <div className="hidden h-9 w-9 place-items-center rounded-full border border-line bg-ink-700 sm:grid
                              text-[11px] font-bold text-cat">
                {operator.avatar_initials}
              </div>
              <button onClick={() => { logout(); navigate('/login') }} className="btn-quiet px-2 py-1.5 text-xs"
                      title={t('nav.logout')}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5M21 12H9" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-line-soft px-4 py-1.5 lg:hidden">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive ? 'bg-ink-700 text-white' : 'text-mute'
              } ${lang === 'hi' ? 'lang-hi' : ''}`
            }
          >
            {t(item.key)}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
