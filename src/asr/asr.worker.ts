/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm"
import { ASR_MODEL, ORT_WASM, TOTAL_BYTES, loadAsset } from "./assets"
import { computeFbank } from "./fbank"
import { ctcGreedy, decodeIds, parseTokens } from "./bbpe"
import { findPieces, joinPieces } from "./segment"
import tokensText from "./tokens.txt?raw"

export type WorkerIn = { type: "load" } | { type: "transcribe"; id: number; pcm: Float32Array }

export type WorkerOut =
  | { type: "progress"; loaded: number; total: number }
  | { type: "initializing" }
  | { type: "ready"; fromCache: boolean; sources: string[]; downloadMs: number; initMs: number }
  | { type: "load-error"; message: string }
  | { type: "piece"; id: number; done: number; total: number }
  | { type: "result"; id: number; text: string; ms: number; audioSeconds: number }
  | { type: "transcribe-error"; id: number; message: string }

const scope = self as unknown as {
  postMessage: (msg: WorkerOut) => void
  onmessage: ((event: MessageEvent<WorkerIn>) => void) | null
}
const post = (msg: WorkerOut) => scope.postMessage(msg)

const tokens = parseTokens(tokensText)
let session: ort.InferenceSession | null = null
let loading: Promise<void> | null = null
let lastLoadError = ""

async function load(): Promise<void> {
  const started = performance.now()
  let loaded = 0
  let failed = false
  const bump = (n: number) => {
    loaded += n
    if (!failed) post({ type: "progress", loaded, total: TOTAL_BYTES })
  }
  post({ type: "progress", loaded: 0, total: TOTAL_BYTES })
  const [wasm, model] = await Promise.all([loadAsset(ORT_WASM, bump), loadAsset(ASR_MODEL, bump)]).catch(
    (error: unknown) => {
      // 一个失败就整体失败；另一个还在下的不再报进度，免得界面又跳回「下载中」
      failed = true
      throw error
    },
  )
  const downloadMs = performance.now() - started
  post({ type: "initializing" })
  const initStart = performance.now()
  ort.env.wasm.wasmBinary = wasm.data
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ort.env.logLevel = "error"
  session = await ort.InferenceSession.create(new Uint8Array(model.data), {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
    logSeverityLevel: 3,
  })
  // 热身一次，第一次真识别就不会慢
  await runPiece(new Float32Array(16000))
  post({
    type: "ready",
    fromCache: wasm.fromCache && model.fromCache,
    sources: [wasm.source, model.source],
    downloadMs,
    initMs: performance.now() - initStart,
  })
}

async function runPiece(samples: Float32Array): Promise<string> {
  if (!session) throw new Error("识别模型还没准备好")
  const { data, frames } = computeFbank(samples)
  if (frames < 10) return ""
  const feeds = {
    x: new ort.Tensor("float32", data, [1, frames, 80]),
    x_lens: new ort.Tensor("int64", BigInt64Array.from([BigInt(frames)]), [1]),
  }
  const out = await session.run(feeds)
  const logProbs = out.log_probs as ort.Tensor
  const lens = out.log_probs_len as ort.Tensor
  const outFrames = Number((lens.data as BigInt64Array)[0])
  const vocab = logProbs.dims[2] as number
  const ids = ctcGreedy(logProbs.data as Float32Array, outFrames, vocab)
  for (const t of Object.values(out)) t.dispose?.()
  return decodeIds(ids, tokens)
}

async function transcribe(id: number, pcm: Float32Array) {
  const started = performance.now()
  const pieces = findPieces(pcm)
  const texts: Array<{ text: string; pauseBefore: number }> = []
  for (let i = 0; i < pieces.length; i++) {
    post({ type: "piece", id, done: i, total: pieces.length })
    const p = pieces[i] as { start: number; end: number; pauseBefore: number }
    texts.push({ text: await runPiece(pcm.subarray(p.start, p.end)), pauseBefore: p.pauseBefore })
  }
  post({ type: "piece", id, done: pieces.length, total: pieces.length })
  post({ type: "result", id, text: joinPieces(texts), ms: performance.now() - started, audioSeconds: pcm.length / 16000 })
}

scope.onmessage = (event) => {
  const msg = event.data
  if (msg.type === "load") {
    if (!loading) {
      loading = load().catch((error: unknown) => {
        loading = null
        session = null
        lastLoadError = error instanceof Error ? error.message : String(error)
        post({ type: "load-error", message: lastLoadError })
      })
    }
    return
  }
  if (msg.type === "transcribe") {
    const run = async () => {
      if (loading) await loading
      if (!session) throw new Error(lastLoadError ? `识别模型没加载成功：${lastLoadError}` : "识别模型没加载成功")
      await transcribe(msg.id, msg.pcm)
    }
    run().catch((error: unknown) =>
      post({ type: "transcribe-error", id: msg.id, message: error instanceof Error ? error.message : String(error) }),
    )
  }
}
