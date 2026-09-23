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
let currentAudio: HTMLAudioElement | null = null

export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export function playBase64(base64: string, mime = 'audio/wav'): Promise<void> {
  stopSpeaking()
  const url = URL.createObjectURL(base64ToBlob(base64, mime))
  const audio = new Audio(url)
  currentAudio = audio
  return new Promise((resolve) => {
    const finish = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    audio.onended = finish
    audio.onerror = finish
    void audio.play().catch(finish)
  })
}

export function playBlob(blob: Blob): Promise<void> {
  stopSpeaking()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  currentAudio = audio
  return new Promise((resolve) => {
    const finish = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    audio.onended = finish
    audio.onerror = finish
    void audio.play().catch(finish)
  })
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
