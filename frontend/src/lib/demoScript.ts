/**
 * Scripted voice for the live demo.
 *
 * Speech recognition and the intent model are not reliable enough to show on
 * stage, so pressing the mic plays one fixed question per screen - whatever is
 * actually said - and the app answers it from the real machine data. The
 * answer is genuine; only the question is fixed.
 *
 * Switch back to real speech recognition with ?live=1 in the address bar
 * (?live=0 to return to the script).
 */
import type { Lang } from './types'

export interface ScriptLine {
  question: Record<Lang, string>
  /** Forced intent: the app skips classification and answers this directly. */
  intent?: string
}

// Most specific route first.
const SCRIPT: [RegExp, ScriptLine][] = [
  [/^\/machine\/about/, { intent: 'HOW_TO_OPERATE', question: { hi: 'यह मशीन कैसे चलाऊँ?', en: 'How do I operate this machine?' } }],
  [/^\/machine/, { intent: 'FUEL_STATUS', question: { hi: 'कितना ईंधन बचा है?', en: 'How much fuel is left?' } }],
  [/^\/work/, { intent: 'TASK_TODAY', question: { hi: 'आज मेरा काम क्या है?', en: 'What is my work today?' } }],
  [/^\/learn/, { intent: 'TRAINING_HELP', question: { hi: 'मुझे ट्रेनिंग चाहिए।', en: 'I need training.' } }],
  [/^\/pro\/cockpit/, { intent: 'MACHINE_HEALTH', question: { hi: 'मशीन में कोई खराबी है क्या?', en: 'Is anything wrong with the machine?' } }],
]

/** Machine picker: no forced intent, the words themselves select the excavator. */
export const PICK_MACHINE: ScriptLine = { question: { hi: 'एक्सकेवेटर चुनो', en: 'Select the excavator' } }

export const INCIDENT_SCRIPT: Record<Lang, string> = {
  hi: 'मशीन के पीछे अचानक एक आदमी आ गया था। मैंने तुरंत मशीन रोक दी। कोई चोट नहीं लगी।',
  en: 'A worker suddenly walked behind the machine. I stopped at once. Nobody was hurt.',
}

const FALLBACK: ScriptLine = { intent: 'MACHINE_HEALTH', question: { hi: 'मशीन में कोई खराबी है क्या?', en: 'Is anything wrong with the machine?' } }

export function scriptFor(path: string, picking = false): ScriptLine {
  if (picking) return PICK_MACHINE
  return SCRIPT.find(([pattern]) => pattern.test(path))?.[1] ?? FALLBACK
}

const KEY = 'saathi.live-voice'

/** Scripted unless someone opted into real recognition with ?live=1. */
export function isScripted(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('live')
    if (param === '1') localStorage.setItem(KEY, '1')
    if (param === '0') localStorage.removeItem(KEY)
    return localStorage.getItem(KEY) !== '1'
  } catch {
    return true
  }
}
