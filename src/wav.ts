import { MAX_CHUNK_SECONDS, TARGET_SAMPLE_RATE } from "./config"

export type Pcm = { mono: Float32Array; rate: number }

/** 把录下的 Blob 解码成单声道 PCM。格式不支持时抛错，由调用方走录音时顺带收的 PCM。 */
export async function decodeBlob(blob: Blob): Promise<Pcm> {
  const Ctx =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) throw new Error("这个浏览器不支持音频解码")
  const ctx = new Ctx()
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
    const channels = buffer.numberOfChannels
    const mono = new Float32Array(buffer.length)
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch)
      for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channels
    }
    return { mono, rate: buffer.sampleRate }
  } finally {
    void ctx.close()
  }
}

/** 把任意采样率的单声道 PCM 降到 16kHz（按窗口取平均，相当于简单的低通再抽取）。 */
export function resample(input: Float32Array, fromRate: number, toRate = TARGET_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input
  if (fromRate <= 0) return input
  const ratio = fromRate / toRate
  const length = Math.floor(input.length / ratio)
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j] ?? 0
    output[i] = sum / (end - start)
  }
  return output
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i++) {
    const value = samples[i] ?? 0
    sum += value * value
  }
  return Math.sqrt(sum / Math.max(1, end - start))
}

/**
 * 切成不超过 maxSeconds 的段。每次在上限前 5 秒内找最安静的 100ms，从那里切，
 * 尽量不把一个字切成两半。找不到安静处时，就在上限处硬切。
 */
export function splitPcm(
  samples: Float32Array,
  rate = TARGET_SAMPLE_RATE,
  maxSeconds = MAX_CHUNK_SECONDS,
): Float32Array[] {
  const max = Math.floor(maxSeconds * rate)
  const search = Math.floor(5 * rate)
  const frame = Math.floor(0.1 * rate)
  const chunks: Float32Array[] = []
  let offset = 0
  while (samples.length - offset > max) {
    const hardEnd = offset + max
    let bestCut = hardEnd
    let bestLevel = Number.POSITIVE_INFINITY
    for (let end = hardEnd; end - frame >= hardEnd - search; end -= Math.floor(frame / 2)) {
      const level = rms(samples, end - frame, end)
      if (level < bestLevel) {
        bestLevel = level
        bestCut = end - Math.floor(frame / 2)
      }
    }
    chunks.push(samples.subarray(offset, bestCut))
    offset = bestCut
  }
  if (samples.length - offset > rate * 0.3) chunks.push(samples.subarray(offset))
  return chunks
}

/** 16-bit PCM 单声道 WAV。 */
export function encodeWav(samples: Float32Array, rate = TARGET_SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  writeString(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, samples.length * 2, true)
  let at = 44
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(at, value < 0 ? value * 0x8000 : value * 0x7fff, true)
    at += 2
  }
  return new Blob([buffer], { type: "audio/wav" })
}

export function concatPcm(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
