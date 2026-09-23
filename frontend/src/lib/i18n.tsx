import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Lang } from './types'

/** Every user-facing string in both languages. */
const STRINGS = {
  'app.name': { hi: 'कैट साथी', en: 'CAT Saathi' },
  'app.tagline': { hi: 'कैट मशीन ऑपरेटर सहायक', en: 'CAT Machine Operator Assistant' },

  'login.title': { hi: 'अपनी शिफ्ट शुरू करें', en: 'Start your shift' },
  'login.subtitle': { hi: 'अपना ऑपरेटर आईडी और पासवर्ड डालें', en: 'Sign in with your operator ID' },
  'login.operatorId': { hi: 'ऑपरेटर आईडी', en: 'Operator ID' },
  'login.password': { hi: 'पासवर्ड', en: 'Password' },
  'login.submit': { hi: 'लॉगिन करें', en: 'Sign in' },
  'login.demo': { hi: 'डेमो खाते', en: 'Demo accounts' },
  'login.error': { hi: 'आईडी या पासवर्ड गलत है', en: 'Wrong ID or password' },
  'login.pitch1': { hi: 'हिंदी में बोलिए, मशीन की भाषा में जवाब पाइए', en: 'Speak Hindi, get answers in machine language' },
  'login.pitch2': { hi: 'हर सवाल स्थानीय रूप से हल होता है, कोई क्लाउड एलएलएम नहीं', en: 'Every question answered locally, no cloud LLM' },
  'login.pitch3': { hi: 'हर मशीन के लिए अलग संदर्भ, एक ही इंटरफ़ेस', en: 'One interface, machine-aware context' },

  'shift.title': { hi: 'आज का काम', en: "Today's work" },
  'shift.listen': { hi: 'सुनें', en: 'Listen' },
  'shift.stop': { hi: 'रोकें', en: 'Stop' },
  'shift.listenHint': { hi: 'पूरा ब्रीफिंग हिंदी में सुनें', en: 'Hear the full briefing aloud' },
  'shift.tasks': { hi: 'काम', en: 'Tasks' },
  'shift.estimated': { hi: 'अनुमानित समय', en: 'Estimated' },
  'shift.machine': { hi: 'आज की मशीन', en: "Today's machine" },
  'shift.continue': { hi: 'मशीन चुनें', en: 'Choose machine' },
  'shift.safety': { hi: 'सुरक्षा निर्देश', en: 'Safety note' },
  'shift.instructions': { hi: 'निर्देश', en: 'Instructions' },
  'shift.location': { hi: 'जगह', en: 'Location' },
  'shift.start': { hi: 'शुरू करें', en: 'Start' },
  'shift.complete': { hi: 'पूरा हुआ', en: 'Complete' },
  'shift.assignedBy': { hi: 'मैनेजर द्वारा अंग्रेज़ी में दिया गया, आपके लिए हिंदी में अनुवादित', en: 'Assigned by your manager in English, translated for you' },

  'machines.title': { hi: 'अपनी मशीन चुनें', en: 'Select your machine' },
  'machines.subtitle': { hi: 'बोलकर या छूकर चुनें', en: 'Choose by voice or by tapping' },
  'machines.assigned': { hi: 'आज सौंपी गई', en: 'Assigned today' },
  'machines.certified': { hi: 'प्रमाणित', en: 'Certified' },
  'machines.notCertified': { hi: 'प्रमाणित नहीं', en: 'Not certified' },
  'machines.tasksToday': { hi: 'आज के काम', en: 'tasks today' },
  'machines.voiceSelect': { hi: 'मशीन बोलकर चुनें', en: 'Select by voice' },
  'machines.voiceHint': { hi: 'जैसे बोलिए: "लोडर चुनो"', en: 'Say for example: "select the loader"' },
  'machines.open': { hi: 'खोलें', en: 'Open' },

  'cockpit.assistant': { hi: 'सहायक', en: 'Assistant' },
  'cockpit.askPlaceholder': { hi: 'सवाल लिखें या माइक दबाकर बोलें…', en: 'Type a question, or hold the mic…' },
  'cockpit.send': { hi: 'भेजें', en: 'Send' },
  'cockpit.listening': { hi: 'सुन रहा हूँ…', en: 'Listening…' },
  'cockpit.thinking': { hi: 'समझ रहा हूँ…', en: 'Working…' },
  'cockpit.quickAsk': { hi: 'तुरंत पूछें', en: 'Quick questions' },
  'cockpit.telemetry': { hi: 'मशीन की स्थिति', en: 'Machine status' },
  'cockpit.health': { hi: 'मशीन स्वास्थ्य', en: 'Machine health' },
  'cockpit.safety': { hi: 'सुरक्षा', en: 'Safety' },
  'cockpit.currentTask': { hi: 'मौजूदा काम', en: 'Current task' },
  'cockpit.findings': { hi: 'ध्यान देने योग्य', en: 'Needs attention' },
  'cockpit.noFindings': { hi: 'कोई समस्या नहीं मिली', en: 'No issues found' },
  'cockpit.seatbelt': { hi: 'सीट बेल्ट', en: 'Seatbelt' },
  'cockpit.fastened': { hi: 'लगी है', en: 'Fastened' },
  'cockpit.unfastened': { hi: 'नहीं लगी', en: 'Unfastened' },
  'cockpit.proximity': { hi: 'नज़दीकी क्षेत्र', en: 'Proximity' },
  'cockpit.clear': { hi: 'साफ़', en: 'Clear' },
  'cockpit.occupied': { hi: 'वस्तु मौजूद', en: 'Object detected' },
  'cockpit.eta': { hi: 'पूरा होने में', en: 'Time remaining' },
  'cockpit.progress': { hi: 'प्रगति', en: 'Progress' },
  'cockpit.emptyChat': { hi: 'नमस्ते! मशीन के बारे में कुछ भी पूछिए।', en: 'Ask me anything about this machine.' },
  'cockpit.holdToTalk': { hi: 'बोलने के लिए दबाएँ', en: 'Hold to talk' },
  'cockpit.releaseToSend': { hi: 'छोड़ें और भेजें', en: 'Release to send' },
  'cockpit.micDenied': { hi: 'माइक की अनुमति नहीं मिली', en: 'Microphone permission denied' },
  'cockpit.reportIncident': { hi: 'घटना दर्ज करें', en: 'Report incident' },
  'cockpit.incidentPlaceholder': { hi: 'क्या हुआ था, संक्षेप में बताइए…', en: 'Briefly describe what happened…' },
  'cockpit.submit': { hi: 'दर्ज करें', en: 'Submit' },
  'cockpit.cancel': { hi: 'रद्द करें', en: 'Cancel' },

  'training.title': { hi: 'प्रशिक्षण केंद्र', en: 'Training hub' },
  'training.recommended': { hi: 'आपके लिए सुझाया गया', en: 'Recommended for you' },
  'training.instructors': { hi: 'इंस्ट्रक्टर बुक करें', en: 'Book an instructor' },
  'training.book': { hi: 'बुक करें', en: 'Book' },
  'training.booked': { hi: 'बुक हो गया', en: 'Booked' },
  'training.minutes': { hi: 'मिनट', en: 'min' },
  'training.skills': { hi: 'आपकी दक्षता', en: 'Your skill level' },

  'insights.title': { hi: 'सिस्टम अंतर्दृष्टि', en: 'System insights' },
  'insights.routing': { hi: 'सवाल कैसे हल हुए', en: 'How questions were answered' },
  'insights.locally': { hi: 'स्थानीय रूप से हल', en: 'Resolved locally' },
  'insights.avgTime': { hi: 'औसत समय', en: 'Avg routing time' },
  'insights.llmCalls': { hi: 'एलएलएम कॉल', en: 'LLM calls' },
  'insights.turns': { hi: 'कुल सवाल', en: 'Questions asked' },
  'insights.models': { hi: 'मॉडल', en: 'Models' },
  'insights.stages': { hi: 'राउटिंग चरण', en: 'Routing stages' },
  'insights.intents': { hi: 'पहचाने गए इरादे', en: 'Detected intents' },

  'nav.shift': { hi: 'शिफ्ट', en: 'Shift' },
  'nav.machines': { hi: 'मशीनें', en: 'Machines' },
  'nav.cockpit': { hi: 'कॉकपिट', en: 'Cockpit' },
  'nav.training': { hi: 'प्रशिक्षण', en: 'Training' },
  'nav.insights': { hi: 'अंतर्दृष्टि', en: 'Insights' },
  'nav.logout': { hi: 'लॉग आउट', en: 'Sign out' },
  'nav.simple': { hi: 'ऑपरेटर व्यू', en: 'Operator view' },

  'common.loading': { hi: 'लोड हो रहा है…', en: 'Loading…' },
  'common.retry': { hi: 'दोबारा कोशिश करें', en: 'Retry' },
  'common.back': { hi: 'वापस', en: 'Back' },
  'common.close': { hi: 'बंद करें', en: 'Close' },
  'common.minutes': { hi: 'मिनट', en: 'min' },
  'common.hours': { hi: 'घंटे', en: 'h' },
  'common.of': { hi: 'में से', en: 'of' },
  'common.high': { hi: 'ज़रूरी', en: 'High' },
  'common.medium': { hi: 'सामान्य', en: 'Medium' },
  'common.low': { hi: 'कम', en: 'Low' },
  'common.pending': { hi: 'बाकी', en: 'Pending' },
  'common.in_progress': { hi: 'चल रहा है', en: 'In progress' },
  'common.done': { hi: 'पूरा', en: 'Done' },
  'common.blocked': { hi: 'रुका', en: 'Blocked' },
  'common.ok': { hi: 'सामान्य', en: 'Normal' },
  'common.warn': { hi: 'चेतावनी', en: 'Warning' },
  'common.crit': { hi: 'गंभीर', en: 'Critical' },
  'common.unknown': { hi: 'अज्ञात', en: 'Unknown' },
} as const

export type StringKey = keyof typeof STRINGS

interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  toggle: () => void
  t: (key: StringKey) => string
  /** Pick the right half of a {hi,en} pair coming from the API. */
  pick: <T>(pair: { hi: T; en: T } | undefined | null, fallback?: T) => T | undefined
}

const LangContext = createContext<LangContextValue | null>(null)
const STORAGE_KEY = 'sahayak.lang'

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(STORAGE_KEY) as Lang) || 'hi',
  )

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => setLangState(next), [])
  const toggle = useCallback(() => setLangState((l) => (l === 'hi' ? 'en' : 'hi')), [])
  const t = useCallback((key: StringKey) => STRINGS[key]?.[lang] ?? String(key), [lang])
  const pick = useCallback(
    <T,>(pair: { hi: T; en: T } | undefined | null, fallback?: T) =>
      (pair ? pair[lang] : fallback),
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, toggle, t, pick }), [lang, setLang, toggle, t, pick])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used inside LanguageProvider')
  return ctx
}
