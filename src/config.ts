// 后端地址。前后端由同一个 Worker 提供，默认同源（空字符串）；构建时可用环境变量 VITE_API_BASE 覆盖（本地开发用 http://127.0.0.1:8787）。
const fallback = ""

export const API_BASE: string = (
  (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || fallback
).replace(/\/+$/, "")

export const TARGET_SAMPLE_RATE = 16000
