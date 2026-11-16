import { useEffect, useRef, useState } from "react"

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return ""
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
}

export function useRecorder() {
  const [phase, setPhase] = useState<"idle" | "recording">("idle")
  const [elapsed, setElapsed] = useState(0)
  const [micNote, setMicNote] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const startingRef = useRef(false)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  async function start() {
    if (startingRef.current || phase === "recording") return
    startingRef.current = true
    setMicNote(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setMicNote("这里用不了麦克风。你可以继续讲，点「讲完了」会进入示例逐字稿。")
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorderRef.current = recorder
      recorder.start()
      const startedAt = Date.now()
      setElapsed(0)
      setPhase("recording")
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000))
      }, 200)
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setMicNote("麦克风没有打开。你可以继续讲，点「讲完了」会进入示例逐字稿。")
      setPhase("idle")
    } finally {
      startingRef.current = false
    }
  }

  function stop(): Promise<string | null> {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive") {
      setPhase("idle")
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        })
        const url = blob.size > 0 ? URL.createObjectURL(blob) : null
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        setPhase("idle")
        resolve(url)
      }
      recorder.stop()
    })
  }

  return { phase, elapsed, micNote, start, stop }
}
