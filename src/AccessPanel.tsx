import { useState } from "react"
import { ApiError, checkAccessCode, messageOf } from "./api"
import { useAccessCode } from "./access"

/**
 * 访问口令：输入 → POST /check 校验 → 只存这个标签页的 sessionStorage。
 * 校验没过就提示「口令不对」，让用户重输。
 */
export function AccessPanel({ compact = false }: { compact?: boolean }) {
  const code = useAccessCode()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const value = draft.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      await checkAccessCode(value)
      setDraft("")
      setOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.kind === "bad_code") setError("口令不对。检查一下有没有打错，再输一次。")
      else if (err instanceof ApiError && err.kind === "rate_limited") setError("试得太频繁了，等一会儿再试。")
      else setError(`现在连不上服务，没法校验（${messageOf(err)}）。`)
    } finally {
      setBusy(false)
    }
  }

  if (code && !open) {
    return (
      <div className={compact ? "access is-compact" : "access"}>
        <p className="access-line">转写和反馈：已连接。</p>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={() => {
            setError(null)
            setOpen(true)
          }}
        >
          换一个口令
        </button>
      </div>
    )
  }

  return (
    <div className={code ? "access is-compact" : "access is-card"}>
      {!code ? (
        <p className="access-line">
          <strong>进入前先输入访问口令。</strong>
          口令校验通过后，录音才会转成逐字稿，反馈也由小黄鸭的后台给出。口令只留在这个标签页里。
        </p>
      ) : null}
      <form
        className="access-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label className="access-label" htmlFor="access-code">
          访问口令
        </label>
        <input
          id="access-code"
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="输入口令"
        />
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || !draft.trim()}>
          {busy ? "校验中…" : "确定"}
        </button>
        {code ? (
          <button
            type="button"
            className="btn btn-quiet btn-small"
            onClick={() => {
              setOpen(false)
              setError(null)
            }}
          >
            取消
          </button>
        ) : null}
        {error ? <p className="access-error">{error}</p> : null}
      </form>
    </div>
  )
}
