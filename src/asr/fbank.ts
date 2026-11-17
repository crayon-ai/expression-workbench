/**
 * Kaldi 风格 80 维 log-mel fbank，参数与 sherpa-onnx / kaldi-native-fbank 默认一致：
 * 16 kHz，25 ms 帧长、10 ms 帧移，snip_edges=false，去直流，预加重 0.97，povey 窗，
 * 512 点 FFT 功率谱，mel 20–7600 Hz，dither=0。输入是 [-1, 1] 浮点采样（不乘 32768）。
 */
const RATE = 16000
const FRAME_LEN = 400
const SHIFT = 160
const FFT = 512
const BINS = 80
const PREEMPH = 0.97
const EPS = 1.1920928955078125e-7

const povey = (() => {
  const w = new Float64Array(FRAME_LEN)
  const a = (2 * Math.PI) / (FRAME_LEN - 1)
  for (let i = 0; i < FRAME_LEN; i++) w[i] = Math.pow(0.5 - 0.5 * Math.cos(a * i), 0.85)
  return w
})()

function melOf(f: number): number {
  return 1127 * Math.log(1 + f / 700)
}

/** 每个 mel 通道：起始 FFT bin 和权重。 */
const melBanks = (() => {
  const numFftBins = FFT / 2
  const binWidth = RATE / FFT
  const low = melOf(20)
  const high = melOf(RATE / 2 - 400)
  const delta = (high - low) / (BINS + 1)
  const banks: Array<{ start: number; weights: Float64Array }> = []
  for (let b = 0; b < BINS; b++) {
    const left = low + b * delta
    const center = low + (b + 1) * delta
    const right = low + (b + 2) * delta
    let first = -1
    let last = -1
    const tmp = new Float64Array(numFftBins)
    for (let i = 0; i < numFftBins; i++) {
      const mel = melOf(binWidth * i)
      if (mel > left && mel < right) {
        tmp[i] = mel <= center ? (mel - left) / (center - left) : (right - mel) / (right - center)
        if (first < 0) first = i
        last = i
      }
    }
    banks.push({ start: first, weights: tmp.slice(first, last + 1) })
  }
  return banks
})()

// 512 点实数 FFT 用的复数 FFT（基 2，就地）。
const fftCos = new Float64Array(FFT / 2)
const fftSin = new Float64Array(FFT / 2)
for (let i = 0; i < FFT / 2; i++) {
  fftCos[i] = Math.cos((2 * Math.PI * i) / FFT)
  fftSin[i] = -Math.sin((2 * Math.PI * i) / FFT)
}
const bitrev = (() => {
  const r = new Uint16Array(FFT)
  const bits = Math.log2(FFT)
  for (let i = 0; i < FFT; i++) {
    let x = i
    let y = 0
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1)
      x >>= 1
    }
    r[i] = y
  }
  return r
})()

function fft(re: Float64Array, im: Float64Array) {
  for (let i = 0; i < FFT; i++) {
    const j = bitrev[i] as number
    if (j > i) {
      const tr = re[i] as number
      re[i] = re[j] as number
      re[j] = tr
      const ti = im[i] as number
      im[i] = im[j] as number
      im[j] = ti
    }
  }
  for (let size = 2; size <= FFT; size <<= 1) {
    const half = size >> 1
    const step = FFT / size
    for (let start = 0; start < FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = fftCos[k * step] as number
        const s = fftSin[k * step] as number
        const a = start + k
        const b = a + half
        const tr = (re[b] as number) * c - (im[b] as number) * s
        const ti = (re[b] as number) * s + (im[b] as number) * c
        re[b] = (re[a] as number) - tr
        im[b] = (im[a] as number) - ti
        re[a] = (re[a] as number) + tr
        im[a] = (im[a] as number) + ti
      }
    }
  }
}

/** 返回 [frames, 80] 的扁平 Float32Array。 */
export function computeFbank(samples: Float32Array): { data: Float32Array; frames: number } {
  const n = samples.length
  const frames = Math.floor((n + SHIFT / 2) / SHIFT)
  const out = new Float32Array(frames * BINS)
  const frame = new Float64Array(FRAME_LEN)
  const re = new Float64Array(FFT)
  const im = new Float64Array(FFT)
  const power = new Float64Array(FFT / 2 + 1)
  for (let f = 0; f < frames; f++) {
    const begin = f * SHIFT + SHIFT / 2 - FRAME_LEN / 2
    let mean = 0
    for (let i = 0; i < FRAME_LEN; i++) {
      let s = begin + i
      // 两端按 Kaldi 方式镜像
      while (s < 0 || s >= n) s = s < 0 ? -s - 1 : 2 * n - 1 - s
      const v = samples[s] as number
      frame[i] = v
      mean += v
    }
    mean /= FRAME_LEN
    for (let i = 0; i < FRAME_LEN; i++) frame[i] = (frame[i] as number) - mean
    for (let i = FRAME_LEN - 1; i > 0; i--) frame[i] = (frame[i] as number) - PREEMPH * (frame[i - 1] as number)
    frame[0] = (frame[0] as number) - PREEMPH * (frame[0] as number)
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < FRAME_LEN; i++) re[i] = (frame[i] as number) * (povey[i] as number)
    fft(re, im)
    for (let i = 0; i <= FFT / 2; i++) power[i] = (re[i] as number) ** 2 + (im[i] as number) ** 2
    for (let b = 0; b < BINS; b++) {
      const bank = melBanks[b] as { start: number; weights: Float64Array }
      let e = 0
      for (let k = 0; k < bank.weights.length; k++) e += (bank.weights[k] as number) * (power[bank.start + k] as number)
      out[f * BINS + b] = Math.log(Math.max(e, EPS))
    }
  }
  return { data: out, frames }
}
