// suntao-expression-api：表达训练工作台「简单复述」的后端。
// 只做三件事：转写一段录音、按材料给听众反馈、生成复述报告。
// 不存录音、不存逐字稿。所有密钥只在 Worker secret 里。

import { findMaterialDef, type MaterialDef } from "../../shared/materials"

type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> }

interface Env {
  GLM_API_KEY: string
  ACCESS_CODE_SHA256: string // 访问口令的 SHA-256（hex），不存明文
  RL_AUTH: RateLimit // 口令错误
  RL_ASR: RateLimit // 转写
  RL_LLM: RateLimit // 反馈 + 报告
  ALLOWED_ORIGINS?: string // 逗号分隔，覆盖默认
}

const DEFAULT_ORIGINS = [
  "https://crayon-ai.github.io",
  "http://localhost:4731",
  "http://127.0.0.1:4731",
]

export const LIMITS = {
  audioBytes: 1_000_000, // 单段 WAV 上限（16kHz 单声道 16bit 约 31 秒）
  audioSeconds: 30, // 智谱单次上限 30 秒；前端按 25 秒切段
  promptChars: 500, // 转写上下文
  transcriptChars: 4000, // 单遍逐字稿
  jsonBytes: 32_000, // /feedback /report 请求体
}

const ZHIPU = "https://open.bigmodel.cn/api/paas/v4"
const ASR_MODEL = "glm-asr-2512"
const TEXT_MODEL = "glm-5.3"

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

function allowedOrigins(env: Env): string[] {
  const raw = env.ALLOWED_ORIGINS?.trim()
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : DEFAULT_ORIGINS
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !allowedOrigins(env).includes(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Code",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  }
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function constantTimeEqual(a: string, b: string): boolean {
  // 两边都是 64 位 hex；长度不同直接判否（长度本身不是秘密）
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function requireCode(request: Request, env: Env, ip: string): Promise<void> {
  const code = request.headers.get("X-Access-Code")?.trim() ?? ""
  const expected = (env.ACCESS_CODE_SHA256 ?? "").trim().toLowerCase()
  const ok = code.length > 0 && code.length <= 200 && expected.length === 64 && constantTimeEqual(await sha256Hex(code), expected)
  if (ok) return
  const { success } = await env.RL_AUTH.limit({ key: `auth:${ip}` })
  if (!success) throw new HttpError(429, "rate_limited", "口令试错太多次，请一分钟后再试")
  throw new HttpError(401, "bad_code", "访问口令不对")
}

async function limit(binding: RateLimit, key: string) {
  const { success } = await binding.limit({ key })
  if (!success) throw new HttpError(429, "rate_limited", "请求太频繁，请稍等一分钟再试")
}

// ---------- 转写 ----------

function wavSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new HttpError(400, "bad_audio", "只接受 WAV 录音")
  let offset = 12
  let byteRate = 0
  while (offset + 8 <= bytes.length) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    if (id === "fmt ") byteRate = view.getUint32(offset + 16, true)
    if (id === "data") {
      if (!byteRate) break
      const dataSize = Math.min(size, bytes.length - offset - 8)
      return dataSize / byteRate
    }
    offset += 8 + size + (size % 2)
  }
  throw new HttpError(400, "bad_audio", "录音文件格式不完整")
}

async function transcribe(request: Request, env: Env): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0")
  if (length > LIMITS.audioBytes + 20_000) throw new HttpError(413, "too_large", "这一段录音太大")
  const form = await request.formData()
  const file = form.get("file")
  if (!file || typeof file === "string") throw new HttpError(400, "bad_audio", "没有收到录音")
  if (file.size > LIMITS.audioBytes) throw new HttpError(413, "too_large", "这一段录音太大")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const seconds = wavSeconds(bytes)
  if (seconds > LIMITS.audioSeconds + 0.5) throw new HttpError(413, "too_long", "这一段录音超过 30 秒")
  if (seconds < 0.3) return { text: "" }

  const prompt = String(form.get("prompt") ?? "").slice(-LIMITS.promptChars)
  const material = findMaterialDef(String(form.get("materialId") ?? ""))

  const upstream = new FormData()
  upstream.append("model", ASR_MODEL)
  upstream.append("stream", "false")
  upstream.append("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav")
  if (prompt) upstream.append("prompt", prompt)
  // 热词（material.hotwords）的 multipart 写法官方文档没写清，账户无转写额度时无法验证，暂不发送。
  void material

  const response = await fetch(`${ZHIPU}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GLM_API_KEY}` },
    body: upstream,
  })
  if (!response.ok) {
    let upstreamCode = ""
    try {
      upstreamCode = String(((await response.json()) as { error?: { code?: unknown } }).error?.code ?? "")
    } catch {
      // ignore
    }
    console.log("asr upstream", response.status, upstreamCode)
    if (upstreamCode === "1113") throw new HttpError(503, "asr_unavailable", "语音转写额度不足，暂时用不了")
    throw new HttpError(502, "upstream", "语音转写服务暂时不可用")
  }
  const data = (await response.json()) as { text?: unknown }
  if (typeof data.text !== "string") throw new HttpError(502, "upstream", "语音转写没有返回文字")
  return { text: data.text.trim(), seconds: Math.round(seconds * 10) / 10, model: ASR_MODEL }
}

// ---------- 文本模型 ----------

async function chatJson(env: Env, system: string, user: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${ZHIPU}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      thinking: { type: "enabled" },
      reasoning_effort: "low",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  })
  if (!response.ok) {
    console.log("chat upstream", response.status)
    throw new HttpError(502, "upstream", "小黄鸭暂时想不起来，请稍后再试")
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content ?? ""
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) throw new HttpError(502, "upstream", "小黄鸭的回答看不懂")
  try {
    return JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    throw new HttpError(502, "upstream", "小黄鸭的回答看不懂")
  }
}

// 校验引用：去掉空白和首尾引号后，必须是逐字稿的连续片段。
function normalize(text: string): string {
  return text.replace(/\s+/g, "")
}

function cleanQuote(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw
    .trim()
    .replace(/^[「“"『'‘]+|[」”"』'’]+$/g, "")
    .replace(/^…+|…+$/g, "")
    .trim()
}

function quoteInTranscript(quote: string, transcript: string): boolean {
  const q = normalize(quote)
  return q.length >= 2 && normalize(transcript).includes(q)
}

function str(value: unknown, max = 600): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function score(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null
}

type Quoted = { quote: string; comment: string }

function keepQuoted(list: unknown, transcript: string, max: number): { kept: Quoted[]; dropped: number } {
  const items = Array.isArray(list) ? list : []
  const kept: Quoted[] = []
  let dropped = 0
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const quote = cleanQuote((item as { quote?: unknown }).quote)
    const comment = str((item as { comment?: unknown }).comment)
    if (!comment) continue
    if (!quoteInTranscript(quote, transcript)) {
      dropped++
      continue
    }
    if (kept.length < max) kept.push({ quote, comment })
  }
  return { kept, dropped }
}

function materialBrief(material: MaterialDef): string {
  return [
    `材料标题：${material.title}`,
    `材料原文：\n${material.paragraphs.join("\n")}`,
    `语境（讲给谁听）：${material.context}`,
    `你扮演的听众：${material.listener}。你没看过原文，只听到了逐字稿里的话。`,
    `要点：\n${material.keyPoints.map((p) => `- ${p}`).join("\n")}`,
    `前提清单（听众不知道、讲的人必须交代的背景；只有你知道这份清单）：\n${material.premises
      .map((p) => `- [${p.id}] ${p.label}`)
      .join("\n")}`,
  ].join("\n\n")
}

const QUOTE_RULE =
  "quote 必须从逐字稿里原样复制一段连续的文字（6 到 30 个字），一个字都不能改、不能省略、不能加省略号，不能改标点以外的任何字。"

function readBody(raw: string): Record<string, unknown> {
  if (raw.length > LIMITS.jsonBytes) throw new HttpError(413, "too_large", "内容太长")
  try {
    const body = JSON.parse(raw)
    if (body && typeof body === "object") return body as Record<string, unknown>
  } catch {
    // fallthrough
  }
  throw new HttpError(400, "bad_request", "请求格式不对")
}

function readTranscript(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) throw new HttpError(400, "bad_request", `${field}是空的`)
  if (text.length > LIMITS.transcriptChars) throw new HttpError(413, "too_large", `${field}太长（上限 ${LIMITS.transcriptChars} 字）`)
  return text
}

function readMaterial(body: Record<string, unknown>): MaterialDef {
  const material = findMaterialDef(String(body.materialId ?? ""))
  if (!material) throw new HttpError(400, "bad_request", "没有这篇材料")
  return material
}

async function withQuoteRetry<T>(
  run: (extra: string) => Promise<{ value: T; dropped: number; usable: boolean }>,
): Promise<T> {
  const first = await run("")
  if (first.usable && first.dropped === 0) return first.value
  const second = await run(
    "\n\n注意：你上一次给的引用有的不在逐字稿里。这次每个 quote 都必须是逐字稿里原样存在的连续文字。",
  )
  return second.usable || !first.usable ? second.value : first.value
}

async function feedback(raw: string, env: Env): Promise<unknown> {
  const body = readBody(raw)
  const material = readMaterial(body)
  const transcript = readTranscript(body.transcript, "逐字稿")
  const attempt = body.attempt === 2 ? 2 : 1
  const previous = attempt === 2 ? readTranscript(body.previousTranscript, "上一遍逐字稿") : ""

  const system = [
    "你是一只叫「小黄鸭」的听众，在表达训练里听用户复述一段材料。",
    "你说话用第一人称、听众的口吻，口语、具体、温和但直接，不说教，不打分，不夸张表扬，不用「建议你」「可以尝试」这类教练腔。",
    "你只根据逐字稿判断自己听懂了什么、哪里没跟上；材料原文和前提清单只用于你在心里核对。",
    "前提判定：逐字稿里讲到了这个前提的核心意思（不要求原话）才算 covered=true；只沾边或完全没提就是 false。",
    QUOTE_RULE,
    "comment 和 understood 里不要出现前提的 id（例如 [who]），也不要说「前提」这个词，用听众自己的话说缺了什么。",
    "只输出 JSON，不要任何其它文字。",
  ].join("\n")

  const shape =
    attempt === 1
      ? `{
  "understood": "一两句，用听众口吻说你听懂了哪些（只说逐字稿里真的讲到的）",
  "issues": [ { "quote": "逐字稿原文片段", "comment": "你作为听众在这句卡住的地方：用提问或困惑的口吻，说清你缺了什么背景、因此会怎样（60-120 字）" } ],
  "premises": [ { "id": "前提 id", "covered": true } ]
}
issues 给 1 到 2 条，优先落在漏掉前提的地方；如果逐字稿讲得很完整，就挑一处最可能让听众犹豫的地方。`
      : `{
  "improved": { "quote": "第二遍逐字稿原文片段", "comment": "这一遍你跟上了什么，比上一遍多懂了什么（40-100 字）" },
  "issues": [ { "quote": "第二遍逐字稿原文片段", "comment": "这一遍仍没跟上的地方（40-100 字）" } ],
  "premises": [ { "id": "前提 id", "covered": true } ]
}
improved 必须引用第二遍逐字稿；如果第二遍没有比第一遍更清楚的地方，improved 设为 null。issues 给 0 到 1 条，引用第二遍逐字稿；全都清楚就给空数组。premises 判断的是第二遍。`

  const user = [
    materialBrief(material),
    attempt === 2 ? `第一遍逐字稿（供对比）：\n${previous}` : "",
    `${attempt === 2 ? "第二遍" : ""}逐字稿（用户刚才讲的，未润色）：\n${transcript}`,
    `按这个 JSON 结构回答：\n${shape}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  return withQuoteRetry(async (extra) => {
    const out = await chatJson(env, system, user + extra)
    const issues = keepQuoted(out.issues, transcript, attempt === 1 ? 2 : 1)
    let dropped = issues.dropped
    let improved: Quoted | null = null
    if (attempt === 2 && out.improved && typeof out.improved === "object") {
      const one = keepQuoted([out.improved], transcript, 1)
      improved = one.kept[0] ?? null
      dropped += one.dropped
    }
    const covered = new Map<string, boolean>()
    if (Array.isArray(out.premises)) {
      for (const item of out.premises) {
        if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
          covered.set((item as { id: string }).id, (item as { covered?: unknown }).covered === true)
        }
      }
    }
    const premises = material.premises.map((p) => ({ id: p.id, label: p.label, covered: covered.get(p.id) === true }))
    const understood = str(out.understood)
    const usable = attempt === 1 ? issues.kept.length > 0 : improved !== null || issues.kept.length > 0
    return {
      value: { attempt, understood, issues: issues.kept, improved, premises, model: TEXT_MODEL },
      dropped,
      usable,
    }
  })
}

const FILLER_CANDIDATES = ["嗯", "啊", "呃", "额", "那个", "就是", "然后", "对吧", "反正", "怎么说", "其实", "基本上"]

function countFillers(transcript: string, words: unknown): Array<{ word: string; count: number }> {
  const asked = Array.isArray(words) ? words.filter((w): w is string => typeof w === "string") : []
  const list = [...new Set(asked.map((w) => w.trim()).filter((w) => FILLER_CANDIDATES.includes(w)))]
  return list
    .map((word) => ({ word, count: transcript.split(word).length - 1 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
}

type Dimension = { score: number; summary: string; quotes: Array<{ quote: string; note: string }> }

function dimension(raw: unknown, transcript: string): { value: Dimension & Record<string, unknown>; dropped: number; ok: boolean } {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const s = score(obj.score)
  const quotes: Array<{ quote: string; note: string }> = []
  let dropped = 0
  for (const item of Array.isArray(obj.quotes) ? obj.quotes : []) {
    if (!item || typeof item !== "object") continue
    const quote = cleanQuote((item as { quote?: unknown }).quote)
    const note = str((item as { note?: unknown }).note, 200)
    if (!note) continue
    if (!quoteInTranscript(quote, transcript)) {
      dropped++
      continue
    }
    if (quotes.length < 2) quotes.push({ quote, note })
  }
  const value: Dimension & Record<string, unknown> = { score: s ?? 0, summary: str(obj.summary, 200), quotes }
  for (const key of ["covered", "missed", "wrong", "order", "skipped", "premises", "repetition", "corrections"]) {
    if (key in obj) value[key] = str(obj[key], 300)
  }
  return { value, dropped, ok: s !== null && value.summary.length > 0 }
}

async function report(raw: string, env: Env): Promise<unknown> {
  const body = readBody(raw)
  const material = readMaterial(body)
  const transcript = readTranscript(body.transcript, "逐字稿")

  const system = [
    "你是表达训练里的复述评估员。评估一段口头复述的逐字稿（未润色，保留口头语）。",
    "三个维度，各给 0-100 的整数分：材料匹配度（要点和前提讲到多少、有没有讲错）、逻辑完整性（顺序是否让没看过原文的听众跟得上、前提是否先交代）、语言流畅度（口头禅、重复、改口）。",
    "评分要有区分度：漏掉一个前提，匹配度和逻辑分都不应高于 80；口头禅很多时流畅度不应高于 75。",
    "每个维度给 1-2 条逐字稿依据。" + QUOTE_RULE,
    "文字用中文、简短、具体，不说教，不鼓励打卡。文字里不要出现前提的 id（例如 [who]），直接用中文说是哪个前提。只输出 JSON。",
  ].join("\n")

  const user = [
    materialBrief(material),
    `逐字稿：\n${transcript}`,
    `按这个 JSON 结构回答：
{
  "match": { "score": 0, "covered": "讲到了哪些", "missed": "漏了哪些", "wrong": "讲错了哪些，没有就写「没有讲错的事实。」", "summary": "一句话总结", "quotes": [ { "quote": "逐字稿原文", "note": "依据说明" } ] },
  "logic": { "score": 0, "order": "实际讲述顺序", "skipped": "跳过的步骤", "premises": "前提交代情况", "summary": "一句话总结", "quotes": [ { "quote": "逐字稿原文", "note": "依据说明" } ] },
  "fluency": { "score": 0, "fillerWords": ["逐字稿里出现的口头禅，只从这些里选：${FILLER_CANDIDATES.join("、")}"], "repetition": "重复情况", "corrections": "改口情况", "summary": "一句话总结", "quotes": [ { "quote": "逐字稿原文", "note": "依据说明" } ] }
}`,
  ].join("\n\n")

  return withQuoteRetry(async (extra) => {
    const out = await chatJson(env, system, user + extra)
    const match = dimension(out.match, transcript)
    const logic = dimension(out.logic, transcript)
    const fluency = dimension(out.fluency, transcript)
    const fillers = countFillers(transcript, (out.fluency as Record<string, unknown> | undefined)?.fillerWords)
    return {
      value: {
        match: match.value,
        logic: logic.value,
        fluency: { ...fluency.value, fillers },
        model: TEXT_MODEL,
      },
      dropped: match.dropped + logic.dropped + fluency.dropped,
      usable: match.ok && logic.ok && fluency.ok,
    }
  }).then((value) => {
    const v = value as { match: Dimension; logic: Dimension; fluency: Dimension }
    if (!v.match.summary || !v.logic.summary || !v.fluency.summary) {
      throw new HttpError(502, "upstream", "报告没有生成完整，请再试一次")
    }
    return value
  })
}

// ---------- 入口 ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin")
    const cors = corsHeaders(origin, env)
    const url = new URL(request.url)

    if (request.method === "OPTIONS") {
      return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors })
    }
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "suntao-expression-api" }, 200, cors)
    }
    if (!origin || !allowedOrigins(env).includes(origin)) {
      return json({ error: "forbidden_origin", message: "来源不被允许" }, 403, {})
    }
    if (request.method !== "POST") return json({ error: "not_found", message: "没有这个接口" }, 404, cors)

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown"
    try {
      await requireCode(request, env, ip)
      if (url.pathname !== "/check" && !env.GLM_API_KEY) {
        throw new HttpError(503, "not_configured", "智谱接口还没配置好")
      }
      switch (url.pathname) {
        case "/check":
          return json({ ok: true }, 200, cors)
        case "/transcribe":
          await limit(env.RL_ASR, `asr:${ip}`)
          return json(await transcribe(request, env), 200, cors)
        case "/feedback": {
          const raw = await request.text()
          await limit(env.RL_LLM, `llm:${ip}`)
          return json(await feedback(raw, env), 200, cors)
        }
        case "/report": {
          const raw = await request.text()
          await limit(env.RL_LLM, `llm:${ip}`)
          return json(await report(raw, env), 200, cors)
        }
        default:
          return json({ error: "not_found", message: "没有这个接口" }, 404, cors)
      }
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status, cors)
      console.log("unexpected", error instanceof Error ? error.message : "unknown")
      return json({ error: "server", message: "服务出了点问题" }, 500, cors)
    }
  },
}
