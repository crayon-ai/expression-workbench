import { API_BASE } from "./config"
import { getAccessCode, setAccessCode } from "./access"

export type ApiErrorKind =
  | "no_code"
  | "bad_code"
  | "forbidden_origin"
  | "too_large"
  | "rate_limited"
  | "unavailable"
  | "not_configured"
  | "upstream"
  | "network"
  | "server"

export class ApiError extends Error {
  kind: ApiErrorKind
  constructor(message: string, kind: ApiErrorKind = "server") {
    super(message)
    this.name = "ApiError"
    this.kind = kind
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "出了点问题，再试一次。"
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const code = getAccessCode()
  if (!code) throw new ApiError("还没有输入访问口令", "no_code")
  const headers = new Headers(init.headers)
  headers.set("X-Access-Code", code)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal })
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError"
    throw new ApiError(aborted ? "服务没有及时回应" : "连不上服务", "network")
  } finally {
    window.clearTimeout(timer)
  }
  if (response.ok) {
    try {
      return await response.json()
    } catch {
      throw new ApiError("服务返回的内容看不懂")
    }
  }
  let kind: ApiErrorKind = "server"
  let detail = ""
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === "string") detail = body.error
  } catch {
    // 错误体不是 JSON，就用状态码说话
  }
  if (response.status === 401 || detail === "bad_code") kind = "bad_code"
  else if (response.status === 403 || detail === "forbidden_origin") kind = "forbidden_origin"
  else if (response.status === 413 || detail === "too_large" || detail === "too_long") kind = "too_large"
  else if (response.status === 429 || detail === "rate_limited") kind = "rate_limited"
  else if (detail === "not_configured") kind = "not_configured"
  else if (response.status === 503 || detail === "asr_unavailable") kind = "unavailable"
  else if (response.status === 502 || detail === "upstream") kind = "upstream"
  throw new ApiError(kindMessage(kind, response.status), kind)
}

function kindMessage(kind: ApiErrorKind, status: number): string {
  switch (kind) {
    case "no_code":
      return "还没有输入访问口令"
    case "bad_code":
      return "口令不对"
    case "forbidden_origin":
      return "这个页面不被允许访问服务"
    case "too_large":
      return "这段录音太长，服务没有收"
    case "rate_limited":
      return "请求太频繁了，等一分钟再试"
    case "unavailable":
      return "语音识别暂时不可用"
    case "not_configured":
      return "小黄鸭的后台还没配置好"
    case "upstream":
      return "上游服务出了问题"
    default:
      return `服务返回了错误（${status}）`
  }
}

/** 校验访问口令：200 {ok:true} 才算通过。 */
export async function checkAccessCode(code: string): Promise<void> {
  const saved = getAccessCode()
  try {
    setAccessCode(code)
    const data = await request("/api/check", { method: "POST" }, 15000)
    if (!data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) {
      throw new ApiError("口令不对", "bad_code")
    }
  } catch (error) {
    // 校验没过就把刚填的撤掉，不把错口令留下
    if (getAccessCode() === code) setAccessCode(saved)
    throw error
  }
}

export type FeedbackData = {
  attempt: 1 | 2
  understood: string
  issues: Array<{ quote: string; comment: string }>
  improved: { quote: string; comment: string } | null
  premises: Array<{ id: string; label: string; covered: boolean }>
}

/** 逐段转写：按顺序送，每段把前面已识别文字的最后 200 字作为 prompt，保持用词连贯。 */
export async function transcribeChunks(
  chunks: Blob[],
  materialId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  let text = ""
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i, chunks.length)
    const form = new FormData()
    form.append("file", chunks[i] as Blob, `chunk-${i + 1}.wav`)
    form.append("prompt", text.slice(-200))
    form.append("materialId", materialId)
    const data = await request("/api/transcribe", { method: "POST", body: form }, 45000)
    const piece =
      data && typeof data === "object" && typeof (data as { text?: unknown }).text === "string"
        ? (data as { text: string }).text.trim()
        : null
    if (piece === null) throw new ApiError("服务返回的内容缺少 text")
    // 段与段之间补一个逗号（只补标点，不改字），免得两段话粘在一起
    if (text && piece && !/[，。！？；、,.!?;…]$/.test(text)) text += "，"
    text += piece
  }
  onProgress?.(chunks.length, chunks.length)
  return text
}

export async function requestFeedback(body: {
  materialId: string
  attempt: 1 | 2
  transcript: string
  previousTranscript?: string
}): Promise<FeedbackData> {
  const data = await request(
    "/api/feedback",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        materialId: body.materialId,
        attempt: body.attempt,
        transcript: body.transcript,
        ...(body.attempt === 2 ? { previousTranscript: body.previousTranscript ?? "" } : {}),
      }),
    },
    60000,
  )
  if (!data || typeof data !== "object" || !Array.isArray((data as FeedbackData).issues)) {
    throw new ApiError("服务返回的反馈格式不对")
  }
  const raw = data as FeedbackData
  return {
    attempt: body.attempt,
    understood: typeof raw.understood === "string" ? raw.understood : "",
    issues: raw.issues.filter((issue) => issue && typeof issue.quote === "string"),
    improved: raw.improved && typeof raw.improved.quote === "string" ? raw.improved : null,
    premises: Array.isArray(raw.premises) ? raw.premises : [],
  }
}

export type ReportDimension = {
  score: number
  summary: string
  quotes: Array<{ quote: string; note: string }>
}

export type ReportData = {
  match: ReportDimension & { covered: string; missed: string; wrong: string }
  logic: ReportDimension & { order: string; skipped: string; premises: string }
  fluency: ReportDimension & {
    fillers: Array<{ word: string; count: number }>
    repetition: string
    corrections: string
  }
}

export async function requestReport(body: { materialId: string; transcript: string }): Promise<ReportData> {
  const data = await request(
    "/api/report",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId: body.materialId, transcript: body.transcript }),
    },
    60000,
  )
  if (!data || typeof data !== "object") throw new ApiError("服务返回的报告格式不对")
  const raw = data as Partial<ReportData>
  if (!raw.match || !raw.logic || !raw.fluency) throw new ApiError("服务返回的报告格式不对")
  return raw as ReportData
}
