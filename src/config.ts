// 后端地址。构建时可用环境变量 VITE_API_BASE 覆盖（本地开发用 http://127.0.0.1:8787）。
const fallback = "https://suntao-expression-api.suntao-preview.workers.dev"

export const API_BASE: string = (
  (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || fallback
).replace(/\/+$/, "")

/** 每段送去转写的音频上限（秒）。后端约定 ≤25s。 */
export const MAX_CHUNK_SECONDS = 25
export const TARGET_SAMPLE_RATE = 16000
