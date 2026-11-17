import { useEffect, useState } from "react"
import { formatMB, getAsrState, prepareAsr, subscribeAsr } from "./engine"
import type { AsrState } from "./engine"

export function useAsrState(autoPrepare = false): AsrState {
  const [state, setState] = useState<AsrState>(getAsrState)
  useEffect(() => {
    const off = subscribeAsr(setState)
    if (autoPrepare) prepareAsr()
    return off
  }, [autoPrepare])
  return state
}

/** 识别模型状态：第一次下载显示进度和总大小；之后从本机缓存读取。 */
export function AsrStatusLine({ state }: { state: AsrState }) {
  if (state.status === "downloading") {
    const pct = state.total > 0 ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : 0
    return (
      <div className="asr-note" role="status" data-asr="downloading">
        <p>
          正在下载语音识别模型 {formatMB(state.loaded)} / {formatMB(state.total)}（{pct}%）· 只下载这一次，之后存在这台设备上
        </p>
        <div className="asr-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  if (state.status === "initializing") {
    return (
      <div className="asr-note" role="status" data-asr="initializing">
        <p>语音识别模型已下载（{formatMB(state.total)}），正在这台设备上启动…</p>
      </div>
    )
  }
  if (state.status === "ready") {
    return (
      <div className="asr-note" role="status" data-asr="ready">
        <p>语音识别在这台设备上运行，录音不上传。</p>
      </div>
    )
  }
  if (state.status === "error" || state.status === "unsupported") {
    return (
      <div className="asr-note is-problem" role="status" data-asr={state.status}>
        <p>语音识别模型用不了（{state.message}）。讲完之后会改成手动输入。</p>
      </div>
    )
  }
  return null
}
