import { materialDefs } from "../shared/materials"

export type Sentence = {
  id: string
  text: string
}

export type Material = {
  id: string
  title: string
  kind: string
  length: string
  summary: string
  context: string
  listener: string
  paragraphs: string[]
  premises: Array<{ id: string; label: string }>
}

export const materials: Material[] = materialDefs.map((def) => ({
  id: def.id,
  title: def.title,
  kind: def.kind,
  length: def.length,
  summary: def.summary,
  context: def.context,
  listener: def.listener,
  paragraphs: def.paragraphs,
  premises: def.premises,
}))

export function getMaterial(id: string): Material | undefined {
  return materials.find((item) => item.id === id)
}

/** 按中文句末标点（。！？!?；…和换行）把一整段识别文字切成句子。 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = []
  let buffer = ""
  for (const char of text) {
    buffer += char
    if ("。！？!?；…".includes(char) || char === "\n") {
      if (buffer.trim()) out.push({ id: `s${out.length + 1}`, text: buffer.trim() })
      buffer = ""
    }
  }
  if (buffer.trim()) out.push({ id: `s${out.length + 1}`, text: buffer.trim() })
  return out
}

/** 逐字稿 = 所有句子拼起来，无分隔。 */
export function transcriptOf(sentences: Sentence[]): string {
  return sentences.map((sentence) => sentence.text).join("")
}

const squash = (text: string) => text.replace(/\s+/g, "")

/** 找到包含这段引用的句子 id；找不到返回 null。 */
export function findSentenceId(sentences: Sentence[], quote: string): string | null {
  const needle = squash(quote.replace(/^[「“"]+|[」”"]+$/g, ""))
  if (!needle) return null
  const hit = sentences.find((sentence) => squash(sentence.text).includes(needle))
  return hit?.id ?? null
}
