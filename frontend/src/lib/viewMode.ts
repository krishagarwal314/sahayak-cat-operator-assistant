/**
 * Two ways to use the same app, remembered per device:
 *   simple   - pictures, voice everywhere, one action per screen
 *   standard - for operators who read comfortably: text, charts, typing
 */
export type ViewMode = 'simple' | 'standard'

const KEY = 'saathi.view'

export function getViewMode(): ViewMode {
  try {
    return localStorage.getItem(KEY) === 'standard' ? 'standard' : 'simple'
  } catch {
    return 'simple'
  }
}

export function setViewMode(mode: ViewMode): void {
  try { localStorage.setItem(KEY, mode) } catch { /* private window: just not remembered */ }
}

/** The first screen of each view. */
export const VIEW_HOME: Record<ViewMode, string> = { simple: '/work', standard: '/pro/shift' }

/** Where someone lands after login: managers to their portal, operators to their view. */
export function homeFor(role?: string): string {
  return role === 'manager' ? '/manager' : VIEW_HOME[getViewMode()]
}
