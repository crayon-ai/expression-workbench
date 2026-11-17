/** icefall 字节级 BPE：token 里的每个字符对应一个 UTF-8 字节。 */
const PRINTABLE = (() => {
  const t: number[] = []
  for (let i = 256; i <= 287; i++) t.push(i)
  for (let i = 32; i <= 126; i++) t.push(i)
  for (let i = 288; i <= 305; i++) t.push(i)
  for (let i = 308; i <= 318; i++) t.push(i)
  for (let i = 321; i <= 328; i++) t.push(i)
  for (let i = 330; i <= 382; i++) t.push(i)
  for (let i = 384; i <= 422; i++) t.push(i)
  return t
})()

const CHAR_TO_BYTE = new Map<number, number>(PRINTABLE.map((code, byte) => [code, byte]))
const decoder = new TextDecoder("utf-8")

export function parseTokens(text: string): string[] {
  const table: string[] = []
  for (const line of text.split("\n")) {
    const at = line.lastIndexOf(" ")
    if (at <= 0) continue
    table[Number(line.slice(at + 1))] = line.slice(0, at)
  }
  return table
}

/** CTC 贪心解码后的 token id → 文字。 */
export function decodeIds(ids: number[], table: string[]): string {
  const joined = ids.map((id) => table[id] ?? "").join("").replaceAll("\u2581", " ")
  const bytes: number[] = []
  for (const ch of joined) {
    const b = CHAR_TO_BYTE.get(ch.codePointAt(0) as number)
    if (b !== undefined) bytes.push(b)
  }
  const text = decoder.decode(new Uint8Array(bytes)).replaceAll("\uFFFD", "")
  // 汉字之间不留空格，其他空格合并
  return text
    .replace(/\s+/g, " ")
    .replace(/(?<=[\u3400-\u9fff\uff00-\uffef\u3000-\u303f])\s+(?=[\u3400-\u9fff\uff00-\uffef\u3000-\u303f])/g, "")
    .trim()
}

export function ctcGreedy(logProbs: Float32Array, frames: number, vocab: number): number[] {
  const out: number[] = []
  let prev = -1
  for (let t = 0; t < frames; t++) {
    let best = 0
    let bestVal = -Infinity
    const base = t * vocab
    for (let v = 0; v < vocab; v++) {
      const x = logProbs[base + v] as number
      if (x > bestVal) {
        bestVal = x
        best = v
      }
    }
    if (best !== prev && best !== 0) out.push(best)
    prev = best
  }
  return out
}
