/**
 * 把 16 kHz 录音按停顿切成小段：每段单独识别，停顿处补标点（只补标点，不改字）。
 * 停顿 ≥ 0.4 s 断开；≥ 0.9 s 记作句号，否则逗号。单段最长 20 s，超过就在最安静处切。
 */
const RATE = 16000
const FRAME = 480 // 30 ms
const SPLIT_PAUSE = 0.4
const LONG_PAUSE = 0.9
const MAX_PIECE = 20
const PAD = 0.3

export type Piece = { start: number; end: number; pauseBefore: number }

function frameRms(samples: Float32Array): Float32Array {
  const count = Math.floor(samples.length / FRAME)
  const out = new Float32Array(count)
  for (let f = 0; f < count; f++) {
    let sum = 0
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) sum += (samples[i] as number) ** 2
    out[f] = Math.sqrt(sum / FRAME)
  }
  return out
}

export function findPieces(samples: Float32Array): Piece[] {
  const rms = frameRms(samples)
  if (rms.length === 0) return []
  const sorted = Array.from(rms).sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)] as number
  const loudest = sorted[sorted.length - 1] as number
  if (loudest < 0.01) return []
  // 只用来找停顿：门限偏低，宁可少切也不把轻声的字当成停顿
  const threshold = Math.max(0.004, floor * 2, loudest * 0.015)
  const speech = Array.from(rms, (v) => v >= threshold)
  const first = speech.indexOf(true)
  const last = speech.lastIndexOf(true)
  if (first < 0) return []

  // 停顿 ≥ SPLIT_PAUSE 的中点作为切点；切出的段首尾相接，不丢任何声音
  const minGap = Math.round((SPLIT_PAUSE * RATE) / FRAME)
  const cuts: Array<{ at: number; pause: number }> = []
  let f = first
  while (f <= last) {
    if (speech[f]) {
      f++
      continue
    }
    let g = f
    while (g <= last && !speech[g]) g++
    if (g - f >= minGap) cuts.push({ at: Math.floor((f + g) / 2), pause: ((g - f) * FRAME) / RATE })
    f = g
  }
  const startAt = Math.max(0, first * FRAME - PAD * RATE)
  const endAt = Math.min(samples.length, (last + 1) * FRAME + PAD * RATE)
  const bounds = [{ at: startAt, pause: 0 }, ...cuts.map((c) => ({ at: c.at * FRAME, pause: c.pause })), { at: endAt, pause: 0 }]

  const pieces: Piece[] = []
  for (let i = 0; i + 1 < bounds.length; i++) {
    let start = (bounds[i] as { at: number }).at
    const end = (bounds[i + 1] as { at: number }).at
    let pauseBefore = i === 0 ? 0 : (bounds[i] as { pause: number }).pause
    // 超过 20 s 的段在 15–20 s 之间最安静的帧处切开
    while (end - start > MAX_PIECE * RATE) {
      const lo = Math.floor((start + 15 * RATE) / FRAME)
      const hi = Math.floor((start + MAX_PIECE * RATE) / FRAME)
      let best = hi
      for (let k = lo; k < hi; k++) if ((rms[k] as number) < (rms[best] as number)) best = k
      const cut = best * FRAME + FRAME / 2
      pieces.push({ start, end: cut, pauseBefore })
      pauseBefore = 0
      start = cut
    }
    pieces.push({ start, end, pauseBefore })
  }
  return pieces
}

export function joinPieces(texts: Array<{ text: string; pauseBefore: number }>): string {
  let out = ""
  for (const { text, pauseBefore } of texts) {
    if (!text) continue
    if (out && !/[，。！？；、,.!?;…]$/.test(out)) out += pauseBefore >= LONG_PAUSE ? "。" : "，"
    out += text
  }
  return out
}
