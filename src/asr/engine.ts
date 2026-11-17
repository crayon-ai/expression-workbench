import { TOTAL_BYTES } from "./assets"
import type { WorkerIn, WorkerOut } from "./asr.worker"

/** 本机语音识别的状态：录音和识别都在用户的设备上，不上传。 */
export type AsrState =
  | { status: "idle"; total: number }
  | { status: "downloading"; loaded: number; total: number }
  | { status: "initializing"; total: number }
  | { status: "ready"; total: number; fromCache: boolean; downloadMs: number; initMs: number; sources: string[] }
  | { status: "error"; total: number; message: string }
  | { status: "unsupported"; total: number; message: string }

type Listener = (state: AsrState) => void

let state: AsrState = { status: "idle", total: TOTAL_BYTES }
const listeners = new Set<Listener>()
let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (e: Error) => void; onPiece?: (done: number, total: number) => void }
>()
let lastRun: { ms: number; audioSeconds: number } | null = null

function setState(next: AsrState) {
  state = next
  for (const l of listeners) l(state)
}

export function getAsrState(): AsrState {
  return state
}

export function lastRunStats() {
  return lastRun
}

export function subscribeAsr(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

// WebAssembly SIMD 检测（运行时只有 SIMD 版）
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])

function unsupportedReason(): string | null {
  if (typeof Worker === "undefined") return "这个浏览器不支持后台线程"
  if (typeof WebAssembly === "undefined") return "这个浏览器不支持 WebAssembly"
  try {
    if (!WebAssembly.validate(SIMD_PROBE)) return "这个浏览器太旧（不支持 WebAssembly SIMD）"
  } catch {
    return "这个浏览器太旧（不支持 WebAssembly SIMD）"
  }
  if (typeof crypto === "undefined" || !crypto.subtle) return "这个页面不是安全连接，没法校验模型文件"
  return null
}

function onMessage(event: MessageEvent<WorkerOut>) {
  const msg = event.data
  switch (msg.type) {
    case "progress":
      setState({ status: "downloading", loaded: msg.loaded, total: msg.total })
      break
    case "initializing":
      setState({ status: "initializing", total: TOTAL_BYTES })
      break
    case "ready":
      setState({
        status: "ready",
        total: TOTAL_BYTES,
        fromCache: msg.fromCache,
        downloadMs: msg.downloadMs,
        initMs: msg.initMs,
        sources: msg.sources,
      })
      break
    case "load-error":
      setState({ status: "error", total: TOTAL_BYTES, message: msg.message })
      for (const [id, p] of pending) {
        p.reject(new Error(`识别模型没加载成功：${msg.message}`))
        pending.delete(id)
      }
      break
    case "piece":
      pending.get(msg.id)?.onPiece?.(msg.done, msg.total)
      break
    case "result": {
      lastRun = { ms: msg.ms, audioSeconds: msg.audioSeconds }
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      p?.resolve(msg.text)
      break
    }
    case "transcribe-error": {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      p?.reject(new Error(msg.message))
      break
    }
  }
}

/** 开始准备识别（只下载一次，之后读本机缓存）。可以反复调用。 */
export function prepareAsr(): void {
  if (state.status === "ready" || state.status === "downloading" || state.status === "initializing") return
  if (state.status === "unsupported") return
  const reason = unsupportedReason()
  if (reason) {
    setState({ status: "unsupported", total: TOTAL_BYTES, message: reason })
    return
  }
  if (!worker) {
    try {
      worker = new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" })
    } catch (error) {
      setState({ status: "unsupported", total: TOTAL_BYTES, message: "这个浏览器不能启动识别线程" })
      void error
      return
    }
    worker.onmessage = onMessage
    worker.onerror = () => {
      setState({ status: "error", total: TOTAL_BYTES, message: "识别线程出错了" })
      for (const [id, p] of pending) {
        p.reject(new Error("识别线程出错了"))
        pending.delete(id)
      }
      worker?.terminate()
      worker = null
    }
  }
  setState({ status: "downloading", loaded: 0, total: TOTAL_BYTES })
  worker.postMessage({ type: "load" } satisfies WorkerIn)
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined)
}

/** 在本机识别 16 kHz 单声道录音。模型没准备好时会等它。 */
export function transcribeLocal(pcm: Float32Array, onPiece?: (done: number, total: number) => void): Promise<string> {
  // 已经失败过就直接走手动输入，不在「讲完了」之后再重下一遍让人干等
  if (state.status === "unsupported") return Promise.reject(new Error(state.message))
  if (state.status === "error") return Promise.reject(new Error(`识别模型没加载成功：${state.message}`))
  prepareAsr()
  const now = getAsrState()
  if (now.status === "unsupported" || now.status === "error") return Promise.reject(new Error(now.message))
  if (!worker) return Promise.reject(new Error("识别线程没有启动"))
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onPiece })
    const copy = pcm.slice()
    worker?.postMessage({ type: "transcribe", id, pcm: copy } satisfies WorkerIn, [copy.buffer])
  })
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
