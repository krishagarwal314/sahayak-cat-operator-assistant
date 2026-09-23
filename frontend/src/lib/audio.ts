/**
 * Audio plumbing for the voice layer.
 *
 * The backend models do the real work, but a demo cannot afford to go silent if
 * a model is missing, so every path has a browser-native fallback:
 *   speech out -> backend TTS, else the Web Speech API
 *   speech in  -> backend STT, else the browser's own recogniser
 */

export type Lang = 'hi' | 'en'

const BCP47: Record<Lang, string> = { hi: 'hi-IN', en: 'en-IN' }

// -------------------------------------------------------------- recording
export class Recorder {
  private media?: MediaRecorder
  private chunks: Blob[] = []
  private stream?: MediaStream

  get active(): boolean {
    return this.media?.state === 'recording'
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    // webm/opus everywhere except Safari, which gives us mp4; ffmpeg on the
    // server reads both, so we just take whatever the browser offers.
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    )
    this.chunks = []
    this.media = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined)
    this.media.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.media.start(120)
  }

  async stop(): Promise<Blob | null> {
    const recorder = this.media
    if (!recorder || recorder.state === 'inactive') {
      this.release()
      return null
    }
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }))
      recorder.stop()
    })
    this.release()
    return blob.size > 800 ? blob : null
  }

  cancel(): void {
    if (this.media && this.media.state !== 'inactive') this.media.stop()
    this.release()
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = undefined
    this.media = undefined
  }
}

/** Live input level 0..1, for the mic waveform. */
export class LevelMeter {
  private ctx?: AudioContext
  private stream?: MediaStream
  private analyser?: AnalyserNode
  private data?: Uint8Array<ArrayBuffer>

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.ctx = new AudioContext()
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    source.connect(this.analyser)
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
  }

  read(): number {
    if (!this.analyser || !this.data) return 0
    this.analyser.getByteTimeDomainData(this.data)
    let peak = 0
    for (const sample of this.data) peak = Math.max(peak, Math.abs(sample - 128) / 128)
    return Math.min(1, peak * 1.6)
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.ctx?.close()
    this.ctx = undefined
    this.stream = undefined
    this.analyser = undefined
  }
}

// -------------------------------------------------------------- playback
/*
 * One shared audio element for the whole app.
 *
 * Strict browsers (Brave, Safari, Chrome on some sites) only let a page play
 * sound from an element that was started inside a user tap. A page intro is
 * fetched and played a second or two AFTER the tap that opened the page, so a
 * brand new Audio() for it was refused - silently, because the rejection was
 * caught and ignored. Instead we create one element, start it once inside the
 * very first tap (unlockAudio, with a silent clip), and reuse that same
 * element for everything afterwards. Browsers keep an unlocked element
 * unlocked.
 */
let shared: HTMLAudioElement | null = null
let unlocked = false
let playing = false
let finishCurrent: ((result: PlayResult) => void) | null = null

export type PlayResult = 'ended' | 'blocked' | 'error' | 'stopped'

function sharedAudio(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio()
    shared.preload = 'auto'
  }
  return shared
}

/** A 50 ms silent WAV, built in memory, used only to unlock audio. */
function silentWav(): string {
  const samples = 400, rate = 8000
  const buffer = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  text(36, 'data'); v.setUint32(40, samples * 2, true)
  let binary = ''
  new Uint8Array(buffer).forEach((b) => { binary += String.fromCharCode(b) })
  return `data:audio/wav;base64,${btoa(binary)}`
}

/** Call from inside a user gesture. Safe to call repeatedly. */
export function unlockAudio(): void {
  if (unlocked) return
  const audio = sharedAudio()
  if (!playing) {
    audio.src = silentWav()
    void audio.play().then(() => { unlocked = true }).catch(() => undefined)
  }
  // iOS needs speech synthesis woken from a gesture as well.
  if ('speechSynthesis' in window && !window.speechSynthesis.speaking) {
    const wake = new SpeechSynthesisUtterance(' ')
    wake.volume = 0
    window.speechSynthesis.speak(wake)
  }
}

/** Install once: the first tap or key press anywhere unlocks audio. */
export function installAudioUnlock(): void {
  const handler = () => {
    unlockAudio()
    if (unlocked) {
      window.removeEventListener('pointerdown', handler, true)
      window.removeEventListener('keydown', handler, true)
    }
  }
  window.addEventListener('pointerdown', handler, true)
  window.addEventListener('keydown', handler, true)
}

export function stopSpeaking(): void {
  if (finishCurrent) finishCurrent('stopped')
  if (shared) {
    shared.pause()
    shared.removeAttribute('src')
    shared.load()
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function playUrl(url: string): Promise<PlayResult> {
  stopSpeaking()
  const audio = sharedAudio()
  return new Promise((resolve) => {
    const finish = (result: PlayResult) => {
      if (finishCurrent !== finish) return
      finishCurrent = null
      playing = false
      audio.onended = null
      audio.onerror = null
      URL.revokeObjectURL(url)
      resolve(result)
    }
    finishCurrent = finish
    audio.onended = () => finish('ended')
    audio.onerror = () => finish('error')
    audio.src = url
    playing = true
    audio.play().then(() => { unlocked = true }).catch((err: DOMException) => {
      finish(err?.name === 'NotAllowedError' ? 'blocked' : 'error')
    })
  })
}

export function playBase64(base64: string, mime = 'audio/wav'): Promise<PlayResult> {
  return playUrl(URL.createObjectURL(base64ToBlob(base64, mime)))
}

export function playBlob(blob: Blob): Promise<PlayResult> {
  return playUrl(URL.createObjectURL(blob))
}

/** Browser speech synthesis, used when the TTS model is not available. */
export function speakWithBrowser(text: string, lang: Lang): Promise<void> {
  if (!('speechSynthesis' in window) || !text.trim()) return Promise.resolve()
  stopSpeaking()
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = BCP47[lang]
    utterance.rate = lang === 'hi' ? 0.94 : 1
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.lang === BCP47[lang]) ??
      window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang))
    if (voice) utterance.voice = voice
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    window.speechSynthesis.speak(utterance)
  })
}

export function browserTtsAvailable(): boolean {
  return 'speechSynthesis' in window
}

// -------------------------------------------------------------- browser STT
type SpeechRecognitionCtor = new () => any

function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function browserSttAvailable(): boolean {
  return recognitionCtor() !== null
}

/** One-shot browser recognition; resolves with '' when nothing was heard. */
export function recognizeWithBrowser(lang: Lang, timeoutMs = 9000): Promise<string> {
  const Ctor = recognitionCtor()
  if (!Ctor) return Promise.resolve('')
  return new Promise((resolve) => {
    const recognition = new Ctor()
    recognition.lang = BCP47[lang]
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    let settled = false
    const done = (value: string) => {
      if (settled) return
      settled = true
      try { recognition.stop() } catch { /* already stopped */ }
      resolve(value)
    }
    recognition.onresult = (event: any) => done(event.results?.[0]?.[0]?.transcript ?? '')
    recognition.onerror = () => done('')
    recognition.onend = () => done('')
    window.setTimeout(() => done(''), timeoutMs)
    recognition.start()
  })
}
