/**
 * Cab guard: drowsiness detection from the cab camera, on the device.
 *
 * MediaPipe Face Landmarker (478 face points + 52 blendshapes) runs in the
 * browser as WebAssembly - no video ever leaves the phone, and it works with
 * no internet. From its eye-blink and jaw-open blendshapes we track:
 *   - eyes closed continuously for 1.5 s  -> drowsy (alarm)
 *   - PERCLOS: share of the last minute with eyes closed (a standard
 *     fatigue measure in driver-monitoring research)
 *   - blinks per minute, and yawns (mouth wide open for over a second)
 */
import type { FaceLandmarker } from '@mediapipe/tasks-vision'

export interface GuardState {
  status: 'off' | 'loading' | 'no-face' | 'awake' | 'closing' | 'drowsy' | 'error'
  eyesClosed: number        // 0..1, how closed the eyes are right now
  closedSeconds: number     // how long they have been closed
  perclos: number           // % of the last 60 s with eyes closed
  blinksPerMin: number
  yawns: number
  eyePoints: [number, number][]   // normalised eye outline points, for drawing
  error?: string
}

const CLOSED = 0.5
const DROWSY_AFTER_S = 1.5
const YAWN_OPEN = 0.55
const YAWN_AFTER_S = 1.0
// Eye outline landmark indices (left and right eye contours).
const EYE_POINTS = [33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380]

let landmarker: FaceLandmarker | null = null
async function loadModel(): Promise<FaceLandmarker> {
  if (landmarker) return landmarker
  const vision = await import('@mediapipe/tasks-vision')
  const files = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm')
  const opts = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
    outputFaceBlendshapes: true, runningMode: 'VIDEO' as const, numFaces: 1,
  })
  try {
    landmarker = await vision.FaceLandmarker.createFromOptions(files, opts('GPU'))
  } catch {
    landmarker = await vision.FaceLandmarker.createFromOptions(files, opts('CPU'))
  }
  return landmarker
}

export class CabGuard {
  video: HTMLVideoElement
  private stream: MediaStream | null = null
  private raf = 0
  private closedFrom: number | null = null
  private yawnFrom: number | null = null
  private yawnCounted = false
  private wasClosed = false
  private history: { t: number; closed: boolean }[] = []
  private blinks: number[] = []
  private yawns = 0
  private drowsyFired = false

  constructor(private onState: (s: GuardState) => void, private onDrowsy: (s: GuardState) => void,
              private onYawn: () => void) {
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
  }

  async start() {
    this.onState(this.blank('loading'))
    try {
      const [model, stream] = await Promise.all([
        loadModel(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false }),
      ])
      this.stream = stream
      this.video.srcObject = stream
      await this.video.play()
      const loop = () => {
        this.tick(model)
        this.raf = requestAnimationFrame(loop)
      }
      loop()
    } catch (e: any) {
      this.onState({ ...this.blank('error'), error: String(e?.message ?? e) })
    }
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.onState(this.blank('off'))
  }

  /** Call after the operator acknowledges an alarm, so it can fire again. */
  rearm() {
    this.drowsyFired = false
    this.closedFrom = null
  }

  private blank(status: GuardState['status']): GuardState {
    return { status, eyesClosed: 0, closedSeconds: 0, perclos: 0, blinksPerMin: 0, yawns: this.yawns, eyePoints: [] }
  }

  private lastVideoTime = -1
  private tick(model: FaceLandmarker) {
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return
    this.lastVideoTime = this.video.currentTime
    const now = performance.now()
    const result = model.detectForVideo(this.video, now)
    const shapes = result.faceBlendshapes?.[0]?.categories
    const face = result.faceLandmarks?.[0]
    if (!shapes || !face) {
      this.closedFrom = null
      this.onState(this.blank('no-face'))
      return
    }
    const score = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0
    const eyes = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2
    const jaw = score('jawOpen')
    const closed = eyes > CLOSED

    // blinks: an open -> closed transition
    if (closed && !this.wasClosed) this.blinks.push(now)
    this.wasClosed = closed
    this.blinks = this.blinks.filter((t) => now - t < 60_000)

    // PERCLOS over the last minute
    this.history.push({ t: now, closed })
    this.history = this.history.filter((h) => now - h.t < 60_000)
    const perclos = this.history.length ? (100 * this.history.filter((h) => h.closed).length) / this.history.length : 0

    // continuous closure
    if (closed) this.closedFrom ??= now
    else this.closedFrom = null
    const closedSeconds = this.closedFrom ? (now - this.closedFrom) / 1000 : 0

    // yawns
    if (jaw > YAWN_OPEN) {
      this.yawnFrom ??= now
      if (!this.yawnCounted && (now - this.yawnFrom) / 1000 > YAWN_AFTER_S) {
        this.yawns += 1
        this.yawnCounted = true
        this.onYawn()
      }
    } else {
      this.yawnFrom = null
      this.yawnCounted = false
    }

    const status: GuardState['status'] = closedSeconds >= DROWSY_AFTER_S ? 'drowsy' : closed ? 'closing' : 'awake'
    const state: GuardState = {
      status, eyesClosed: eyes, closedSeconds, perclos,
      blinksPerMin: this.blinks.length, yawns: this.yawns,
      eyePoints: EYE_POINTS.map((i) => [face[i].x, face[i].y] as [number, number]),
    }
    this.onState(state)
    if (status === 'drowsy' && !this.drowsyFired) {
      this.drowsyFired = true
      this.onDrowsy(state)
    }
  }
}

/** A loud two-tone siren from the Web Audio API - no sound file needed. */
export function siren(seconds = 2.5): () => void {
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  if (!Ctx) return () => undefined
  const ctx = new Ctx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  gain.gain.value = 0.25
  osc.connect(gain).connect(ctx.destination)
  const t0 = ctx.currentTime
  for (let i = 0; i < seconds * 4; i++) osc.frequency.setValueAtTime(i % 2 ? 660 : 990, t0 + i * 0.25)
  osc.start()
  osc.stop(t0 + seconds)
  return () => { try { osc.stop() } catch { /* already stopped */ } void ctx.close() }
}
