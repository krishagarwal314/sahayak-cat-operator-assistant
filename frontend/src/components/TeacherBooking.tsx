import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useLang } from '../lib/i18n'
import { useVoiceOut } from '../lib/speechContext'
import type { Instructor } from '../lib/types'
import { Pictogram } from './Pictogram'
import { SpeakButton } from './Simple'

/** "Tomorrow 08:00" -> day, hour and a picture: nobody has to read a clock. */
function slotParts(slot: string) {
  const [dayWord, time = ''] = slot.split(' ')
  const [hh, mm = '00'] = time.split(':')
  const hour = Number(hh)
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const part = hour < 12 ? ['सुबह', 'morning'] : hour < 16 ? ['दोपहर', 'afternoon'] : hour < 19 ? ['शाम', 'evening'] : ['रात', 'night']
  const today = dayWord.toLowerCase() === 'today'
  return {
    dayHi: today ? 'आज' : 'कल', dayEn: today ? 'Today' : 'Tomorrow',
    timeHi: `${part[0]} ${h12}${mm !== '00' ? `:${mm}` : ''} बजे`,
    timeEn: `${h12}${mm !== '00' ? `:${mm}` : ''} ${hour < 12 ? 'am' : 'pm'}`,
    // Spoken form avoids "4:30" - said as "saadhe chaar" by people, but read
    // badly by the voice - so half hours are spoken in words.
    spokenHi: `${today ? 'आज' : 'कल'} ${part[0]} ${h12}${mm === '30' ? ' बजकर तीस मिनट' : ' बजे'}`,
    icon: hour >= 6 && hour < 18 ? 'sun' : 'clock',
  }
}

// Which teacher suits which machine first. The safety teacher suits everyone.
const FIRST_FOR: Record<string, string> = { excavator: 'IN-01', loader: 'IN-03', dozer: 'IN-03' }

export function TeacherBooking({ family }: { family: string }) {
  const { lang } = useLang()
  const { speak, speakingId, stop } = useVoiceOut()
  const [teachers, setTeachers] = useState<Instructor[]>([])
  const [booked, setBooked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ teacher: Instructor; slot: string } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const t = (hi: string, en: string) => (lang === 'hi' ? hi : en)

  const load = () => api.training().then((d) => {
    const first = FIRST_FOR[family]
    setTeachers([...d.instructors].sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : a.id === 'IN-02' ? -1 : 1)))
    setBooked(new Set(d.bookings.map((b: any) => `${b.instructor_id}|${b.slot}`)))
  }).catch(() => undefined)
  useEffect(() => { void load() }, [family]) // eslint-disable-line react-hooks/exhaustive-deps

  function ask(teacher: Instructor, slot: string) {
    const p = slotParts(slot)
    setConfirm({ teacher, slot })
    void speak(lang === 'hi'
      ? `${teacher.name_hi} के साथ ${p.spokenHi} का समय बुक करें? हाँ के लिए हरा बटन दबाइए।`
      : `Book ${teacher.name_en} ${p.dayEn.toLowerCase()} at ${p.timeEn}? Press green for yes.`, lang, 'booking', true)
  }

  async function book() {
    if (!confirm) return
    setBusy(true)
    try {
      await api.book(confirm.teacher.id, confirm.slot)
      const p = slotParts(confirm.slot)
      setDone(`${confirm.teacher.id}|${confirm.slot}`)
      void speak(lang === 'hi'
        ? `बुक हो गया। ${confirm.teacher.name_hi} आपसे ${p.spokenHi} मिलेंगे।`
        : `Booked. ${confirm.teacher.name_en} will see you ${p.dayEn.toLowerCase()} at ${p.timeEn}.`, lang, 'booking', true)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="teachers" className="scroll-mt-24 space-y-3">
      <div className="flex items-center gap-3 px-1">
        <Pictogram name="person" className="h-9 w-9 text-cat" />
        <h2 className={`flex-1 text-[22px] font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('टीचर से सीखें', 'Learn from a trainer')}</h2>
        <SpeakButton active={speakingId === 'teachers-intro'}
          onClick={() => (speakingId === 'teachers-intro' ? stop() : void speak(
            t('किसी टीचर का समय चुनिए। समय वाला बटन दबाइए।', 'Pick a time with a trainer. Tap a time button.'), lang, 'teachers-intro', true))} />
      </div>

      {teachers.map((teacher) => {
        const id = `teacher-${teacher.id}`
        const intro = lang === 'hi' ? `${teacher.name_hi}। ${teacher.expertise_hi} सिखाते हैं।` : `${teacher.name_en}. Teaches ${teacher.expertise_en.toLowerCase()}.`
        return (
          <div key={teacher.id} className="rounded-[28px] border-2 border-line bg-ink-800 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-cat text-xl font-extrabold text-ink-900">
                {teacher.name_en.split(' ').map((w) => w[0]).join('')}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-xl font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(teacher.name_hi, teacher.name_en)}</div>
                <div className={`text-sm leading-snug text-mute ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(teacher.expertise_hi, teacher.expertise_en)}</div>
              </div>
              <SpeakButton active={speakingId === id}
                onClick={() => (speakingId === id ? stop() : void speak(intro, lang, id, true))} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {teacher.slots.map((slot) => {
                const p = slotParts(slot)
                const taken = booked.has(`${teacher.id}|${slot}`)
                return (
                  <button key={slot} disabled={taken} onClick={() => ask(teacher, slot)}
                    className={`flex h-20 items-center gap-2 rounded-2xl px-3 text-left transition-all active:scale-95
                      ${taken ? 'bg-ok/15 ring-2 ring-ok' : 'bg-ink-700'}`}>
                    <Pictogram name={taken ? 'check' : p.icon} className={`h-10 w-10 shrink-0 ${taken ? 'text-ok' : 'text-cat'}`} />
                    <span className="min-w-0">
                      <span className={`block text-lg font-extrabold leading-tight text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(p.dayHi, p.dayEn)}</span>
                      <span className={`block text-sm leading-tight text-slate-300 ${lang === 'hi' ? 'lang-hi' : ''}`}>
                        {taken ? t('बुक है', 'Booked') : t(p.timeHi, p.timeEn)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* yes / no, with the teacher's face and the time, big */}
      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-end bg-ink-900/85 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-md animate-risein rounded-[32px] border-2 border-cat/50 bg-ink-800 p-6 text-center">
            {done === `${confirm.teacher.id}|${confirm.slot}` ? (
              <>
                <div className="mx-auto grid h-28 w-28 place-items-center rounded-full bg-ok text-ink-900"><Pictogram name="check" className="h-20 w-20" /></div>
                <p className={`mt-4 text-[26px] font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t('बुक हो गया', 'Booked')}</p>
                <button onClick={() => { setConfirm(null); setDone(null) }} className="mt-5 h-16 w-full rounded-2xl bg-ink-700 text-xl font-bold text-white">
                  {t('ठीक है', 'OK')}
                </button>
              </>
            ) : (
              <>
                <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-cat text-3xl font-extrabold text-ink-900">
                  {confirm.teacher.name_en.split(' ').map((w) => w[0]).join('')}
                </div>
                <p className={`mt-3 text-2xl font-extrabold text-white ${lang === 'hi' ? 'lang-hi' : ''}`}>{t(confirm.teacher.name_hi, confirm.teacher.name_en)}</p>
                <p className={`mt-1 flex items-center justify-center gap-2 text-xl text-cat ${lang === 'hi' ? 'lang-hi' : ''}`}>
                  <Pictogram name={slotParts(confirm.slot).icon} className="h-7 w-7" />
                  {t(`${slotParts(confirm.slot).dayHi} ${slotParts(confirm.slot).timeHi}`, `${slotParts(confirm.slot).dayEn} ${slotParts(confirm.slot).timeEn}`)}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button onClick={() => { stop(); setConfirm(null) }}
                    className="flex h-24 flex-col items-center justify-center gap-1 rounded-3xl bg-ink-700 text-lg font-bold text-white">
                    <Pictogram name="cross" className="h-10 w-10 text-crit" />{t('नहीं', 'No')}
                  </button>
                  <button onClick={() => void book()} disabled={busy}
                    className="flex h-24 flex-col items-center justify-center gap-1 rounded-3xl bg-ok text-lg font-extrabold text-ink-900">
                    <Pictogram name="check" className="h-10 w-10" />{t('हाँ', 'Yes')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
