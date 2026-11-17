import { useEffect, useRef, useState } from "react"

const BAND_COUNT = 16
const SILENCE_MS = 2000
const VOICE_THRESHOLD = 0.045
const DEMO_NOTE =
  "麦克风没有打开。没有麦克风就不能转写，讲完之后会改成手动输入：把你讲的话打出来当逐字稿。"

export type RecorderPhase = "idle" | "checking" | "recording"

export type StopResult = {
  url: string | null
  blob: Blob | null
  pcm: Float32Array | null
  rate: number
}

function emptyStop(): StopResult {
  return { url: null, blob: null, pcm: null, rate: 0 }
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return ""
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
}

function emptyBands(): number[] {
  return Array.from({ length: BAND_COUNT }, () => 0.08)
}

function simulateBands(now: number): { level: number; bands: number[] } {
  const bands = Array.from({ length: BAND_COUNT }, (_, i) => {
    const wave =
      0.2 +
      0.1 * Math.sin(now / 430 + i * 0.52) +
      0.06 * Math.sin(now / 180 + i * 1.15) +
      0.04 * Math.sin(now / 1100 + i * 0.2)
    return Math.min(0.62, Math.max(0.07, wave))
  })
  const level = bands.reduce((sum, value) => sum + value, 0) / bands.length
  return { level, bands }
}

function readMeter(analyser: AnalyserNode): { level: number; bands: number[] } {
  const time = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(time)
  let sum = 0
  for (const sample of time) {
    const value = (sample - 128) / 128
    sum += value * value
  }
  const level = Math.min(1, Math.sqrt(sum / time.length) * 3.4)

  const freq = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(freq)
  const chunk = Math.max(1, Math.floor(freq.length / BAND_COUNT))
  const bands = Array.from({ length: BAND_COUNT }, (_, i) => {
    let acc = 0
    for (let j = 0; j < chunk; j++) acc += freq[i * chunk + j] ?? 0
    return Math.min(1, (acc / chunk / 255) * 1.7)
  })
  return { level, bands }
}

function blend(prev: number[], next: number[]): number[] {
  return next.map((value, i) => {
    const last = prev[i] ?? value
    return last * 0.55 + value * 0.45
  })
}

function shapeBands(level: number, freqBands: number[], now: number): number[] {
  const loudest = freqBands.reduce((max, value) => Math.max(max, value), 0)
  const useLevel = loudest < 0.14
  return freqBands.map((value, i) => {
    const t = i / (BAND_COUNT - 1)
    const envelope = Math.sin(t * Math.PI)
    const flutter = 0.62 + 0.38 * Math.sin(now / 130 + i * 1.37) + 0.12 * Math.sin(now / 70 + i * 2.1)
    const fromLevel = useLevel ? level * (0.18 + 0.95 * envelope) * flutter : 0
    const mixed = Math.max(value * (0.9 + 0.2 * envelope), fromLevel)
    return Math.min(1, Math.pow(Math.max(0.05, mixed), 0.62) * 1.15)
  })
}

export function useRecorder() {
  const [phase, setPhase] = useState<RecorderPhase>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [micNote, setMicNote] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [level, setLevel] = useState(0)
  const [bands, setBands] = useState<number[]>(emptyBands)
  const [heardVoice, setHeardVoice] = useState(false)
  const [hearing, setHearing] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const startingRef = useRef(false)
  const demoRef = useRef(false)
  const lastVoiceRef = useRef<number | null>(null)
  const bandsRef = useRef<number[]>(emptyBands())
  const activeRef = useRef(false)
  // 录音时顺带收一份 PCM。decodeAudioData 不认录下的格式时（Safari 偶尔会），拿它当退路。
  const pcmChunksRef = useRef<Float32Array[]>([])
  const pcmSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const pcmProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const pcmSinkRef = useRef<GainNode | null>(null)
  const sampleRateRef = useRef(0)

  function stopTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function stopMeter() {
    activeRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    void ctxRef.current?.close()
    ctxRef.current = null
    analyserRef.current = null
  }

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  function stopPcmCapture() {
    if (pcmProcessorRef.current) {
      pcmProcessorRef.current.onaudioprocess = null
      pcmProcessorRef.current.disconnect()
      pcmProcessorRef.current = null
    }
    pcmSourceRef.current?.disconnect()
    pcmSourceRef.current = null
    pcmSinkRef.current?.disconnect()
    pcmSinkRef.current = null
  }

  function startPcmCapture() {
    stopPcmCapture()
    const ctx = ctxRef.current
    const stream = streamRef.current
    if (!ctx || !stream || typeof ctx.createScriptProcessor !== "function") return
    pcmChunksRef.current = []
    sampleRateRef.current = ctx.sampleRate
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const sink = ctx.createGain()
    sink.gain.value = 0
    processor.onaudioprocess = (event) => {
      pcmChunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(sink)
    sink.connect(ctx.destination)
    pcmSourceRef.current = source
    pcmProcessorRef.current = processor
    pcmSinkRef.current = sink
  }

  function tickMeter() {
    if (!activeRef.current) return
    const now = Date.now()
    let nextLevel = 0
    let nextBands = emptyBands()
    const analyser = analyserRef.current
    if (demoRef.current || !analyser) {
      const simulated = simulateBands(now)
      nextLevel = simulated.level
      nextBands = simulated.bands
      // Gentle demo wave occasionally reads as presence, so the duck still feels alive.
      if (nextLevel > 0.28) lastVoiceRef.current = now
    } else {
      const reading = readMeter(analyser)
      nextLevel = reading.level
      nextBands = blend(bandsRef.current, reading.bands)
      if (reading.level >= VOICE_THRESHOLD) lastVoiceRef.current = now
    }
    nextBands = shapeBands(nextLevel, nextBands, now)
    bandsRef.current = nextBands
    if (ctxRef.current?.state === "suspended") void ctxRef.current.resume()
    const lastVoice = lastVoiceRef.current
    const isHearing = lastVoice !== null && now - lastVoice < SILENCE_MS
    setLevel(nextLevel)
    setBands(nextBands)
    setHearing(isHearing)
    if (lastVoice !== null) setHeardVoice(true)
    rafRef.current = requestAnimationFrame(tickMeter)
  }

  function startMeter() {
    stopMeter()
    activeRef.current = true
    const stream = streamRef.current
    if (stream && !demoRef.current) {
      const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) {
        const ctx = new Ctx()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.7
        ctx.createMediaStreamSource(stream).connect(analyser)
        ctxRef.current = ctx
        analyserRef.current = analyser
        void ctx.resume()
      }
    }
    rafRef.current = requestAnimationFrame(tickMeter)
  }

  function enterDemo(note: string) {
    demoRef.current = true
    setDemoMode(true)
    setMicNote(note)
    startMeter()
  }

  async function ensureStream(): Promise<boolean> {
    if (demoRef.current) return false
    if (streamRef.current) return true
    if (!navigator.mediaDevices?.getUserMedia) {
      enterDemo(DEMO_NOTE)
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      return true
    } catch {
      releaseStream()
      enterDemo(DEMO_NOTE)
      return false
    }
  }

  async function startCheck() {
    if (startingRef.current || phase === "recording" || phase === "checking") return
    startingRef.current = true
    setMicNote(null)
    setHeardVoice(false)
    setHearing(false)
    lastVoiceRef.current = null
    setPhase("checking")
    try {
      const ok = await ensureStream()
      if (ok) startMeter()
    } finally {
      startingRef.current = false
    }
  }

  async function start() {
    if (startingRef.current || phase === "recording") return
    startingRef.current = true
    try {
      const hasStream = await ensureStream()
      setElapsed(0)
      if (!hasStream) {
        const startedAt = Date.now()
        setPhase("recording")
        timerRef.current = window.setInterval(() => {
          setElapsed(Math.floor((Date.now() - startedAt) / 1000))
        }, 200)
        if (!activeRef.current) startMeter()
        return
      }
      if (typeof MediaRecorder === "undefined") {
        enterDemo("这里录不了音。讲完之后会改成手动输入：把你讲的话打出来当逐字稿。")
        const startedAt = Date.now()
        setPhase("recording")
        timerRef.current = window.setInterval(() => {
          setElapsed(Math.floor((Date.now() - startedAt) / 1000))
        }, 200)
        return
      }
      const mime = pickMime()
      const recorder = new MediaRecorder(streamRef.current!, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorderRef.current = recorder
      recorder.start()
      startPcmCapture()
      const startedAt = Date.now()
      setPhase("recording")
      if (!activeRef.current) startMeter()
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000))
      }, 200)
    } finally {
      startingRef.current = false
    }
  }

  function stop(): Promise<StopResult> {
    stopTimer()
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive") {
      setPhase("idle")
      stopPcmCapture()
      stopMeter()
      releaseStream()
      return Promise.resolve(emptyStop())
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        })
        const url = blob.size > 0 ? URL.createObjectURL(blob) : null
        const pcm = pcmChunksRef.current.length > 0 ? concatFloat32(pcmChunksRef.current) : null
        const rate = sampleRateRef.current
        recorderRef.current = null
        stopPcmCapture()
        stopMeter()
        releaseStream()
        setPhase("idle")
        resolve({ url, blob: blob.size > 0 ? blob : null, pcm, rate })
      }
      recorder.stop()
    })
  }

  useEffect(() => {
    const unlock = () => {
      void ctxRef.current?.resume()
    }
    window.addEventListener("pointerdown", unlock)
    window.addEventListener("keydown", unlock)
    return () => {
      window.removeEventListener("pointerdown", unlock)
      window.removeEventListener("keydown", unlock)
      stopTimer()
      stopPcmCapture()
      stopMeter()
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop()
        } catch {
          // Leaving the page mid-record; the blob is discarded.
        }
      }
      recorderRef.current = null
      releaseStream()
    }
  }, [])

  return {
    phase,
    elapsed,
    micNote,
    demoMode,
    level,
    bands,
    hearing,
    heardVoice,
    startCheck,
    start,
    stop,
  }
}
