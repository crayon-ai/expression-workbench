import { TARGET_SAMPLE_RATE } from "./config"

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
