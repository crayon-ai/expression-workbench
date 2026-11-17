import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { Material, Sentence } from "./materials"
import { findSentenceId, getMaterial, materials, splitSentences, transcriptOf } from "./materials"
import { AccessPanel } from "./AccessPanel"
import { useAccessCode } from "./access"
import { ApiError, messageOf, requestFeedback, requestReport } from "./api"
import type { FeedbackData, ReportData } from "./api"
import { Duck } from "./duck"
import { useRecorder } from "./useRecorder"
import type { StopResult } from "./useRecorder"
import { decodeBlob, resample } from "./wav"
import { transcribeLocal } from "./asr/engine"
import { AsrStatusLine, useAsrState } from "./asr/AsrStatus"
import { TARGET_SAMPLE_RATE } from "./config"
import {
  Badge,
  EditNote,
  PremiseChecklist,
  Recording,
  SentenceList,
  SourceDrawer,
  TopBar,
  VoiceMeter,
  focusSentence,
  formatTime,
} from "./ui"

type Route =
  | { name: "home" }
  | { name: "pick" }
  | { name: "read"; id: string }
  | { name: "speak"; id: string; attempt: 1 | 2 }
  | { name: "transcript"; id: string }
  | { name: "feedback"; id: string }
  | { name: "compare"; id: string }
  | { name: "report"; id: string; attempt: 1 | 2 }
  | { name: "done"; id: string }
  | { name: "missing" }

type Take = {
  sentences: Sentence[] | null
  audioUrl: string | null
  manual: boolean
  transcribeError: string | null
}

type Bucket = {
  take1: Take
  take2: Take
}

type SpeakResult = {
  url: string | null
  sentences: Sentence[] | null
  error: string | null
}

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").split("?")[0] ?? ""
  const parts = path.split("/").filter(Boolean)
  if (parts.length === 0) return { name: "home" }
  if (parts[0] === "pick") return { name: "pick" }
  if (parts[0] === "read" && parts[1]) return { name: "read", id: parts[1] }
  if (parts[0] === "speak" && parts[1] && (parts[2] === "1" || parts[2] === "2")) {
    return { name: "speak", id: parts[1], attempt: parts[2] === "1" ? 1 : 2 }
  }
  if (parts[0] === "transcript" && parts[1]) return { name: "transcript", id: parts[1] }
  if (parts[0] === "feedback" && parts[1]) return { name: "feedback", id: parts[1] }
  if (parts[0] === "compare" && parts[1]) return { name: "compare", id: parts[1] }
  if (parts[0] === "report" && parts[1]) {
    return { name: "report", id: parts[1], attempt: parts[2] === "2" ? 2 : 1 }
  }
  if (parts[0] === "done" && parts[1]) return { name: "done", id: parts[1] }
  return { name: "missing" }
}

function routeKey(route: Route): string {
  if (route.name === "speak") return `speak-${route.id}-${route.attempt}`
  if (route.name === "report") return `report-${route.id}-${route.attempt}`
  if ("id" in route) return `${route.name}-${route.id}`
  return route.name
}

function blankTake(): Take {
  return { sentences: null, audioUrl: null, manual: false, transcribeError: null }
}

function revoke(url: string | null) {
  if (url) URL.revokeObjectURL(url)
}

const SEP = "\u001f"

function feedbackKey(materialId: string, attempt: 1 | 2, transcript: string, previous?: string) {
  return [materialId, String(attempt), transcript, previous ?? ""].join(SEP)
}

function reportKey(materialId: string, attempt: 1 | 2, transcript: string) {
  return [materialId, String(attempt), transcript].join(SEP)
}

// 反馈和报告按（材料，第几遍，逐字稿）缓存在内存里，切页不重复请求；刷新就没有了。
const feedbackCache = new Map<string, FeedbackData>()
const reportCache = new Map<string, ReportData>()

/** 解码录音 → 单声道 → 16kHz → 在本机按停顿切段识别（不上传）。 */
async function transcribeRecording(
  recording: { blob: Blob | null; pcm: Float32Array | null; rate: number },
  onProgress: (done: number, total: number) => void,
): Promise<string> {
  let mono: Float32Array | null = null
  let rate = recording.rate
  if (recording.blob) {
    try {
      const decoded = await decodeBlob(recording.blob)
      mono = decoded.mono
      rate = decoded.rate
    } catch {
      mono = null
    }
  }
  if (!mono) {
    if (!recording.pcm || recording.pcm.length === 0) {
      throw new ApiError("录音没能解码，也没有可用的备用音轨")
    }
    mono = recording.pcm
    if (!rate) rate = 48000
  }
  const resampled = resample(mono, rate, TARGET_SAMPLE_RATE)
  if (resampled.length < TARGET_SAMPLE_RATE * 0.3) throw new ApiError("没有录到声音")
  return transcribeLocal(resampled, onProgress)
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [buckets, setBuckets] = useState<Record<string, Bucket>>({})

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
    const titles: Record<Route["name"], string> = {
      home: "表达训练工作台",
      pick: "选一篇材料 · 表达训练工作台",
      read: "阅读材料 · 表达训练工作台",
      speak: "讲给小黄鸭听 · 表达训练工作台",
      transcript: "逐字稿 · 表达训练工作台",
      feedback: "小黄鸭的反馈 · 表达训练工作台",
      compare: "两遍放在一起 · 表达训练工作台",
      report: "复述报告 · 表达训练工作台",
      done: "这次就到这里 · 表达训练工作台",
      missing: "表达训练工作台",
    }
    document.title = titles[route.name]
  }, [route])

  function bucketFor(material: Material): Bucket {
    return buckets[material.id] ?? { take1: blankTake(), take2: blankTake() }
  }

  function update(id: string, recipe: (current: Bucket) => Bucket) {
    setBuckets((prev) => {
      const current = prev[id] ?? { take1: blankTake(), take2: blankTake() }
      return { ...prev, [id]: recipe(current) }
    })
  }

  function resetTake(id: string, attempt: 1 | 2) {
    update(id, (current) => {
      if (attempt === 1) {
        revoke(current.take1.audioUrl)
        return { ...current, take1: blankTake() }
      }
      revoke(current.take2.audioUrl)
      return { ...current, take2: blankTake() }
    })
  }

  function setText(id: string, attempt: 1 | 2, index: number, text: string) {
    update(id, (current) => {
      if (attempt === 1) {
        const sentences = current.take1.sentences
        if (!sentences) return current
        const next = sentences.slice()
        next[index] = { ...next[index], text }
        return { ...current, take1: { ...current.take1, sentences: next } }
      }
      const sentences = current.take2.sentences
      if (!sentences) return current
      const next = sentences.slice()
      next[index] = { ...next[index], text }
      return { ...current, take2: { ...current.take2, sentences: next } }
    })
  }

  function submitManual(id: string, attempt: 1 | 2, text: string) {
    update(id, (current) => {
      const sentences = splitSentences(text)
      if (attempt === 1) {
        return { ...current, take1: { ...current.take1, sentences, manual: true, transcribeError: null } }
      }
      return { ...current, take2: { ...current.take2, sentences, manual: true, transcribeError: null } }
    })
  }

  function finishSpeak(id: string, attempt: 1 | 2, result: SpeakResult) {
    update(id, (current) => {
      const take: Take = {
        sentences: result.sentences,
        audioUrl: result.url,
        manual: false,
        transcribeError: result.error,
      }
      if (attempt === 1) {
        revoke(current.take1.audioUrl)
        return { ...current, take1: take }
      }
      revoke(current.take2.audioUrl)
      return { ...current, take2: take }
    })
    window.location.hash = attempt === 1 ? `#/transcript/${id}` : `#/compare/${id}`
  }

  const material = "id" in route ? getMaterial(route.id) : undefined
  const needsMaterial = route.name !== "home" && route.name !== "pick" && route.name !== "missing"
  const screen =
    needsMaterial && !material ? (
      <Missing />
    ) : route.name === "home" ? (
      <Home />
    ) : route.name === "pick" ? (
      <Pick />
    ) : route.name === "read" && material ? (
      <Read
        material={material}
        onStart={() => {
          resetTake(material.id, 1)
          window.location.hash = `#/speak/${material.id}/1`
        }}
      />
    ) : route.name === "speak" && material ? (
      <Speak
        key={`${material.id}-${route.attempt}`}
        material={material}
        attempt={route.attempt}
        onFinish={(result) => finishSpeak(material.id, route.attempt, result)}
      />
    ) : route.name === "transcript" && material ? (
      <Transcript
        material={material}
        take={bucketFor(material).take1}
        onChange={(index, text) => setText(material.id, 1, index, text)}
        onManualSubmit={(text) => submitManual(material.id, 1, text)}
      />
    ) : route.name === "feedback" && material ? (
      <Feedback
        material={material}
        take={bucketFor(material).take1}
        onChange={(index, text) => setText(material.id, 1, index, text)}
        onAgain={() => {
          resetTake(material.id, 2)
          window.location.hash = `#/speak/${material.id}/2`
        }}
      />
    ) : route.name === "compare" && material ? (
      <Compare
        material={material}
        bucket={bucketFor(material)}
        onChange={(attempt, index, text) => setText(material.id, attempt, index, text)}
        onManualSubmit={(text) => submitManual(material.id, 2, text)}
      />
    ) : route.name === "report" && material ? (
      <ReportPage material={material} attempt={route.attempt} bucket={bucketFor(material)} />
    ) : route.name === "done" && material ? (
      <Done material={material} />
    ) : (
      <Missing />
    )

  return (
    <div className="app">
      <div key={routeKey(route)} className="screen" data-screen={route.name}>
        {screen}
      </div>
    </div>
  )
}

function Home() {
  return (
    <>
      <TopBar />
      <main className="page">
        <p className="kind">工作台</p>
        <h1>看懂了，不代表能讲清楚</h1>
        <p className="lede">
          先把一件短的事情讲出来。讲完的话原样留下，变成逐字稿。没接上的地方停在字面上，比停在感觉里更容易看见。
        </p>
        <div className="work-list">
          <a className="work-row" href="#/pick">
            <div>
              <h2>简单复述</h2>
              <p>把一段短材料，用自己的话讲给没看过原文的人听。</p>
            </div>
            <span className="work-go">进入</span>
          </a>
          <div className="work-row is-disabled" aria-disabled="true">
            <div>
              <h2>复杂表达</h2>
              <p>把同时想到的多个点，排成听众跟得上的顺序。</p>
            </div>
            <span className="work-soon">即将开始</span>
          </div>
        </div>
        <div className="home-note">
          <Duck size={64} pose="attentive" />
          <p>听众是小黄鸭。它没看过材料。你不是在完成一段录音，是在讲到它能听懂。</p>
        </div>
      </main>
    </>
  )
}

function Pick() {
  const code = useAccessCode()
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page">
        <a className="back" href="#/">
          ← 返回工作台
        </a>
        <h1>选一篇材料</h1>
        <p className="lede">三篇都很短。每篇都有一个要讲给谁听的情境。用自己的话讲，大约一分钟。</p>
        {code ? (
          <>
            <div className="work-list">
              {materials.map((item) => (
                <a className="pick-row" href={`#/read/${item.id}`} key={item.id}>
                  <div className="pick-meta">
                    <span>{item.kind}</span>
                    <span>{item.length}</span>
                  </div>
                  <h2>{item.title}</h2>
                  <p>{item.summary}</p>
                </a>
              ))}
            </div>
            <div className="pick-access">
              <AccessPanel compact />
            </div>
          </>
        ) : (
          <>
            <div className="work-list is-locked">
              {materials.map((item) => (
                <div className="pick-row is-locked-row" key={item.id}>
                  <div className="pick-meta">
                    <span>{item.kind}</span>
                    <span>{item.length}</span>
                  </div>
                  <h2>{item.title}</h2>
                  <p>{item.summary}</p>
                </div>
              ))}
            </div>
            <div className="pick-access">
              <AccessPanel />
            </div>
          </>
        )}
      </main>
    </>
  )
}

function Read({ material, onStart }: { material: Material; onStart: () => void }) {
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page">
        <a className="back" href="#/pick">
          ← 返回选材料
        </a>
        <p className="kind">
          {material.kind} · {material.length}
        </p>
        <h1>{material.title}</h1>
        <article className="sheet reading">
          {material.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </article>
        <section className="task">
          <h2>怎么讲</h2>
          <p className="context-line">{material.context}</p>
          <p>用自己的话讲。不要背原文，也不必照着原文顺序讲。</p>
        </section>
        <div className="listener">
          <Duck size={72} pose="attentive" />
          <p>
            <strong>小黄鸭这回是{material.listener}。</strong>
            它没看过这篇材料，你要讲到它能听懂。
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onStart}>
          开始复述
        </button>
      </main>
    </>
  )
}

function speakPose(hearing: boolean, live: boolean): "attentive" | "listening" | "tilted" {
  if (hearing) return "listening"
  if (live) return "tilted"
  return "attentive"
}

function Speak({
  material,
  attempt,
  onFinish,
}: {
  material: Material
  attempt: 1 | 2
  onFinish: (result: SpeakResult) => void
}) {
  const { phase, elapsed, micNote, demoMode, bands, hearing, heardVoice, startCheck, start, stop } =
    useRecorder()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recalling, setRecalling] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [stage, setStage] = useState<"check" | "idle" | "live">(attempt === 1 ? "check" : "idle")
  const cancelled = useRef(false)
  const asr = useAsrState(true)
  const asrLoading = asr.status === "downloading" || asr.status === "initializing"

  useEffect(() => {
    cancelled.current = false
    if (attempt === 1) void startCheck()
    return () => {
      cancelled.current = true
    }
    // Mount-only: start the mic check once when entering the first take.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recording = phase === "recording"
  const live = stage === "live" || recording
  const checking = stage === "check" && !recalling
  const speakPhase = recalling ? "recalling" : checking ? "check" : recording ? "speak" : "idle"
  const duckPose = recalling ? "attentive" : speakPose(hearing, live || checking)

  async function beginSpeak() {
    if (busy || recalling) return
    setStage("live")
    await start()
  }

  function skipCheck() {
    setStage("idle")
  }

  async function finish() {
    if (busy || recalling) return
    setBusy(true)
    setRecalling(true)
    const startedAt = Date.now()
    try {
      const recordingResult: StopResult = recording
        ? await stop()
        : { url: null, blob: null, pcm: null, rate: 0 }
      const result: SpeakResult = { url: recordingResult.url, sentences: null, error: null }
      if (recordingResult.blob || (recordingResult.pcm && recordingResult.pcm.length > 0)) {
        try {
          const text = await transcribeRecording(recordingResult, (done, total) => setProgress({ done, total }))
          const sentences = splitSentences(text)
          if (sentences.length === 0) result.error = "识别结果是空的"
          else result.sentences = sentences
        } catch (err) {
          result.error = messageOf(err)
        }
      } else {
        result.error = "没有录到声音"
      }
      const rest = 1500 - (Date.now() - startedAt)
      if (rest > 0) await new Promise((resolve) => window.setTimeout(resolve, rest))
      if (!cancelled.current) onFinish(result)
    } finally {
      if (!cancelled.current) setBusy(false)
    }
  }

  return (
    <>
      <TopBar
        aside={
          recalling ? (
            <span>简单复述</span>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>
              再看一眼材料
            </button>
          )
        }
      />
      <main
        className={recording ? "speak is-recording" : "speak"}
        data-recording={recording ? "1" : "0"}
        data-speak-phase={speakPhase}
      >
        {recalling ? (
          <>
            <p className="kind">{attempt === 2 ? "第二遍" : "第一遍"}</p>
            <h1>讲给小黄鸭听</h1>
            <div className="speak-duck">
              <Duck size={230} pose="attentive" />
            </div>
            <p className="speak-status recalling-status" role="status">
              小黄鸭正在回想你说的话…
            </p>
            {asrLoading ? (
              <AsrStatusLine state={asr} />
            ) : progress && progress.total > 1 ? (
              <p className="recall-progress">
                第 {Math.min(progress.done + 1, progress.total)} / {progress.total} 段
              </p>
            ) : null}
          </>
        ) : checking ? (
          <>
            <p className="kind">{attempt === 2 ? "第二遍 · 同一篇材料" : "第一遍"}</p>
            <h1>先让它听见你</h1>
            <div className="speak-duck">
              <Duck size={230} pose={duckPose} />
            </div>
            <VoiceMeter bands={bands} demo={demoMode} />
            <p className="speak-status" role="status">
              {heardVoice
                ? "声波在动，它听到了。可以开始复述。"
                : "先对小黄鸭说一句「你好」。声波一动，就说明收到了。"}
            </p>
            <div className="speak-actions">
              <button type="button" className="btn btn-primary" onClick={() => void beginSpeak()}>
                开始复述
              </button>
              <button type="button" className="btn btn-secondary" onClick={skipCheck}>
                跳过试音
              </button>
            </div>
            {micNote ? <p className="mic-note">{micNote}</p> : null}
            <AsrStatusLine state={asr} />
          </>
        ) : (
          <>
            <p className="kind">{attempt === 2 ? "第二遍 · 同一篇材料" : "第一遍"}</p>
            <h1>讲给小黄鸭听</h1>
            <div className="speak-duck">
              <Duck size={230} pose={duckPose} />
            </div>
            <VoiceMeter bands={bands} demo={demoMode} />
            <p className={recording ? "timer is-live" : "timer"}>{formatTime(elapsed)}</p>
            <p className="speak-status" role="status">
              {recording
                ? hearing
                  ? `它这回是${material.listener}。它在听，不会插话。`
                  : "它还在听。停顿久了，它会侧过头等你。"
                : attempt === 2
                  ? `还是这篇材料。它仍然是${material.listener}，仍然没看过原文，也不插话。`
                  : `它这回是${material.listener}。它只听，不插话。`}
            </p>
            <div className="speak-actions">
              {recording ? (
                <button type="button" className="btn btn-primary" onClick={() => void finish()} disabled={busy}>
                  <span className="rec-dot" aria-hidden="true" />
                  讲完了
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => void beginSpeak()}>
                    开始讲
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => void finish()} disabled={busy}>
                    讲完了
                  </button>
                </>
              )}
            </div>
            {micNote ? <p className="mic-note">{micNote}</p> : null}
            <AsrStatusLine state={asr} />
          </>
        )}
      </main>
      {open && !recalling ? <SourceDrawer material={material} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function PrivacyNote() {
  return (
    <p className="privacy-note">
      录音不上传：录音和转文字都在你这台设备上完成（第一次会下载约 74 MB 的识别模型，之后存在本机）。只有你点「看看小黄鸭听到了什么」时，逐字稿文字会发给智谱生成反馈，不保存。
    </p>
  )
}

function NoTranscript({ material, back, backLabel }: { material: Material; back: string; backLabel: string }) {
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page">
        <a className="back" href={back}>
          ← {backLabel}
        </a>
        <h1>这一遍还没有逐字稿</h1>
        <p className="lede">直接打开了这个页面，但这一遍还没有录音和逐字稿。回到材料重新讲一遍。</p>
        <a className="btn btn-primary" href={`#/read/${material.id}`}>
          回到材料
        </a>
      </main>
    </>
  )
}

function ManualEntry({
  take,
  onSubmit,
  inColumn = false,
}: {
  take: Take
  onSubmit: (text: string) => void
  inColumn?: boolean
}) {
  const [draft, setDraft] = useState("")
  return (
    <div className={inColumn ? "manual-entry" : undefined}>
      {!inColumn ? (
        <>
          <Badge>手动输入</Badge>
          <h1>你刚才讲的</h1>
          <p className="lede">
            语音转写没成功（{take.transcribeError ?? "原因不明"}）。这次改成手动输入：把你刚才讲的话照原样打出来。
          </p>
        </>
      ) : (
        <>
          <Badge>手动输入</Badge>
          <p className="lede">
            语音转写没成功（{take.transcribeError ?? "原因不明"}）。把你刚才讲的话照原样打出来，再继续对照。
          </p>
        </>
      )}
      <Recording src={take.audioUrl} playLabel={inColumn ? "播放第二遍" : "播放录音"} empty="这次没有录音。" />
      <textarea
        className="manual-input"
        value={draft}
        rows={inColumn ? 6 : 9}
        aria-label="手动输入逐字稿"
        placeholder="把刚才讲的话照原样打出来。口头语、重复都照写。"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!draft.trim()}
          onClick={() => onSubmit(draft.trim())}
        >
          用这段作为逐字稿
        </button>
      </div>
      {!inColumn ? <PrivacyNote /> : null}
    </div>
  )
}

function Transcript({
  material,
  take,
  onChange,
  onManualSubmit,
}: {
  material: Material
  take: Take
  onChange: (index: number, text: string) => void
  onManualSubmit: (text: string) => void
}) {
  if (!take.sentences) {
    if (take.transcribeError) {
      return (
        <>
          <TopBar aside={<span>简单复述</span>} />
          <main className="page">
            <a className="back" href={`#/read/${material.id}`}>
              ← 返回材料
            </a>
            <ManualEntry take={take} onSubmit={onManualSubmit} />
          </main>
        </>
      )
    }
    return <NoTranscript material={material} back={`#/read/${material.id}`} backLabel="返回材料" />
  }
  const sentences = take.sentences
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page">
        <a className="back" href={`#/read/${material.id}`}>
          ← 返回材料
        </a>
        <Badge>{take.manual ? "逐字稿 · 手动输入" : "逐字稿"}</Badge>
        <h1>你刚才讲的</h1>
        <p className="lede">
          逐字稿照你讲出来的样子留下，不替你改顺。口头语、重复、没说完的句子都还在。只看这段话，没接上的地方会自己露出来。
        </p>
        <Recording src={take.audioUrl} playLabel="播放录音" empty="这次没有录音。" />
        <SentenceList prefix="t1" sentences={sentences} onChange={onChange} />
        <p className="edit-hint">点某一句，可以改掉明显的识别错误。改字是在修正识别，不是把话说顺。</p>
        <PrivacyNote />
        <p className="prompt">如果你没看过原文，只看这段话，能听懂吗？</p>
        <a className="btn btn-primary" href={`#/feedback/${material.id}`}>
          看看小黄鸭听到了什么
        </a>
      </main>
    </>
  )
}

type FeedbackPanelState = { status: "loading" | "ok" | "error"; data?: FeedbackData; error?: string }

function FeedbackPanel({
  materialId,
  attempt,
  transcript,
  previousTranscript,
  badgeLabel,
  headNote,
  onFocusQuote,
  onData,
  children,
}: {
  materialId: string
  attempt: 1 | 2
  transcript: string
  previousTranscript?: string
  badgeLabel: string
  headNote: string
  onFocusQuote: (quote: string) => void
  onData?: (data: FeedbackData) => void
  children?: ReactNode
}) {
  const code = useAccessCode()
  const key = feedbackKey(materialId, attempt, transcript, previousTranscript)
  const cached = feedbackCache.get(key)
  const [requested, setRequested] = useState(key)
  const [state, setState] = useState<FeedbackPanelState>(() =>
    cached ? { status: "ok", data: cached } : { status: "loading" },
  )
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!code) return
    const hit = feedbackCache.get(requested)
    if (hit) {
      setState({ status: "ok", data: hit })
      return
    }
    setState({ status: "loading" })
    let live = true
    const parts = requested.split(SEP)
    requestFeedback({
      materialId: parts[0] ?? materialId,
      attempt: (parts[1] === "2" ? 2 : 1) as 1 | 2,
      transcript: parts[2] ?? "",
      ...(parts[1] === "2" ? { previousTranscript: parts[3] ?? "" } : {}),
    })
      .then((data) => {
        feedbackCache.set(requested, data)
        if (live) setState({ status: "ok", data })
      })
      .catch((err) => {
        if (live) setState({ status: "error", error: messageOf(err) })
      })
    return () => {
      live = false
    }
  }, [requested, tick, code, materialId])

  useEffect(() => {
    if (state.status === "ok" && state.data) onData?.(state.data)
  }, [state, onData])

  const stale = requested !== key

  return (
    <>
      <div className="feedback-head">
        <Duck size={52} pose="attentive" />
        <div>
          <Badge>{badgeLabel}</Badge>
          <p>{headNote}</p>
        </div>
      </div>
      {!code ? (
        <div className="feedback-waiting">
          <p className="access-line">需要访问口令，小黄鸭才能听这一遍。</p>
          <AccessPanel />
        </div>
      ) : state.status === "loading" ? (
        <div className="feedback-waiting">
          <p role="status">小黄鸭在想…</p>
        </div>
      ) : state.status === "error" ? (
        <div className="feedback-waiting">
          <p className="access-error">{state.error}</p>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              setRequested(key)
              setTick((value) => value + 1)
            }}
          >
            再试一次
          </button>
        </div>
      ) : state.data ? (
        <>
          {attempt === 1 ? (
            <>
              <h2>这里我听懂了</h2>
              <p>{state.data.understood}</p>
              {state.data.issues.map((issue, index) => (
                <div key={`${issue.quote}-${index}`}>
                  <h2>这里我没跟上</h2>
                  <button type="button" className="quote" onClick={() => onFocusQuote(issue.quote)}>
                    「{issue.quote}」
                  </button>
                  <p>{issue.comment}</p>
                </div>
              ))}
            </>
          ) : (
            <>
              {state.data.improved ? (
                <>
                  <h2>这里我跟上了</h2>
                  <button type="button" className="quote quote-clear" onClick={() => onFocusQuote(state.data!.improved!.quote)}>
                    「{state.data.improved.quote}」
                  </button>
                  <p>{state.data.improved.comment}</p>
                </>
              ) : null}
              <h2>这里我还是没跟上</h2>
              {state.data.issues[0] ? (
                <>
                  <button type="button" className="quote" onClick={() => onFocusQuote(state.data!.issues[0]!.quote)}>
                    「{state.data.issues[0].quote}」
                  </button>
                  <p>{state.data.issues[0].comment}</p>
                </>
              ) : (
                <p>这一遍我都跟上了。</p>
              )}
            </>
          )}
          <PremiseChecklist premises={state.data.premises} />
          <EditNote
            edited={stale}
            onRelisten={() => {
              setRequested(key)
              setTick((value) => value + 1)
            }}
          />
          {children}
        </>
      ) : null}
    </>
  )
}

function Feedback({
  material,
  take,
  onChange,
  onAgain,
}: {
  material: Material
  take: Take
  onChange: (index: number, text: string) => void
  onAgain: () => void
}) {
  const [feedback1, setFeedback1] = useState<FeedbackData | null>(null)
  if (!take.sentences) {
    return <NoTranscript material={material} back={`#/transcript/${material.id}`} backLabel="返回逐字稿" />
  }
  const sentences = take.sentences
  const transcript = transcriptOf(sentences)
  const focusQuote = (quote: string) => {
    const id = findSentenceId(sentences, quote)
    if (id) focusSentence(`sentence-t1-${id}`)
  }
  const markedIds = new Set<string>()
  const shown = feedback1 ?? feedbackCache.get(feedbackKey(material.id, 1, transcript))
  if (shown) {
    for (const issue of shown.issues) {
      const id = findSentenceId(sentences, issue.quote)
      if (id) markedIds.add(id)
    }
  }
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page page-wide">
        <a className="back" href={`#/transcript/${material.id}`}>
          ← 返回逐字稿
        </a>
        <Badge>{take.manual ? "逐字稿 · 手动输入" : "逐字稿"}</Badge>
        <h1>你刚才讲的</h1>
        <p className="lede">
          小黄鸭这回是{material.listener}，没看过原文，只听了这段话。先看逐字稿，再看它哪里没跟上。
        </p>
        <div className="feedback-layout">
          <div>
            <SentenceList prefix="t1" sentences={sentences} marked={markedIds} onChange={onChange} />
            <p className="edit-hint">点某一句，可以改掉明显的识别错误。</p>
          </div>
          <aside className="feedback-panel">
            <FeedbackPanel
              materialId={material.id}
              attempt={1}
              transcript={transcript}
              badgeLabel="小黄鸭的反馈"
              headNote={`它这回是${material.listener}。`}
              onFocusQuote={focusQuote}
              onData={setFeedback1}
            >
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={onAgain}>
                  再讲一遍
                </button>
                <a className="btn btn-secondary" href={`#/done/${material.id}`}>
                  这次就到这里
                </a>
                <a className="btn btn-secondary" href={`#/report/${material.id}/1`}>
                  获取复述报告
                </a>
              </div>
            </FeedbackPanel>
          </aside>
        </div>
      </main>
    </>
  )
}

function Compare({
  material,
  bucket,
  onChange,
  onManualSubmit,
}: {
  material: Material
  bucket: Bucket
  onChange: (attempt: 1 | 2, index: number, text: string) => void
  onManualSubmit: (text: string) => void
}) {
  const [feedback2, setFeedback2] = useState<FeedbackData | null>(null)
  if (!bucket.take1.sentences) {
    return <NoTranscript material={material} back={`#/feedback/${material.id}`} backLabel="返回反馈" />
  }
  const first = bucket.take1.sentences
  const second = bucket.take2.sentences
  const transcript1 = transcriptOf(first)
  const focusQuote = (quote: string) => {
    if (!second) return
    const id = findSentenceId(second, quote)
    if (id) focusSentence(`sentence-t2-${id}`)
  }
  const marked1 = new Set<string>()
  const cached1 = feedbackCache.get(feedbackKey(material.id, 1, transcript1))
  if (cached1) {
    for (const issue of cached1.issues) {
      const id = findSentenceId(first, issue.quote)
      if (id) marked1.add(id)
    }
  }
  const marked2 = new Set<string>()
  if (second && feedback2) {
    const quotes = [feedback2.improved?.quote, feedback2.issues[0]?.quote].filter(
      (quote): quote is string => !!quote,
    )
    for (const quote of quotes) {
      const id = findSentenceId(second, quote)
      if (id) marked2.add(id)
    }
  }
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page page-wide">
        <Badge>逐字稿</Badge>
        <h1>两遍放在一起</h1>
        <p className="lede">左边是第一遍，右边是第二遍，都可以播放，也可以点某一句改字。</p>
        <div className="compare-grid">
          <section>
            <h2 className="column-title">第一遍</h2>
            <Recording src={bucket.take1.audioUrl} playLabel="播放第一遍" empty="第一遍没有录音。" />
            <SentenceList
              prefix="t1"
              sentences={first}
              marked={marked1}
              onChange={(index, text) => onChange(1, index, text)}
            />
          </section>
          <section>
            <h2 className="column-title">第二遍</h2>
            {second ? (
              <>
                <Recording src={bucket.take2.audioUrl} playLabel="播放第二遍" empty="第二遍没有录音。" />
                <SentenceList
                  prefix="t2"
                  sentences={second}
                  marked={marked2}
                  onChange={(index, text) => onChange(2, index, text)}
                />
              </>
            ) : bucket.take2.transcribeError ? (
              <ManualEntry take={bucket.take2} onSubmit={onManualSubmit} inColumn />
            ) : (
              <p className="recording-empty">
                这一遍还没有逐字稿。<a href={`#/speak/${material.id}/2`}>回去讲第二遍</a>。
              </p>
            )}
          </section>
        </div>
        <aside className="feedback-panel compare-feedback">
          {second ? (
            <FeedbackPanel
              materialId={material.id}
              attempt={2}
              transcript={transcriptOf(second)}
              previousTranscript={transcript1}
              badgeLabel="小黄鸭的反馈"
              headNote={`仍是那个${material.listener}。`}
              onFocusQuote={focusQuote}
              onData={setFeedback2}
            >
              <div className="actions">
                <a className="btn btn-primary" href={`#/done/${material.id}`}>
                  结束这次练习
                </a>
                <a className="btn btn-secondary" href={`#/report/${material.id}/2`}>
                  获取复述报告
                </a>
              </div>
            </FeedbackPanel>
          ) : (
            <>
              <div className="feedback-head">
                <Duck size={52} pose="attentive" />
                <div>
                  <Badge>小黄鸭的反馈</Badge>
                  <p>仍是那个{material.listener}。</p>
                </div>
              </div>
              <p>第二遍的逐字稿还没有确认。填好之后，小黄鸭再来对照这两遍。</p>
            </>
          )}
        </aside>
      </main>
    </>
  )
}

type ReportPanelState = { status: "loading" | "ok" | "error"; data?: ReportData; previous?: ReportData | null; error?: string }

function ReportPage({
  material,
  attempt,
  bucket,
}: {
  material: Material
  attempt: 1 | 2
  bucket: Bucket
}) {
  const code = useAccessCode()
  const take = attempt === 1 ? bucket.take1 : bucket.take2
  const other = attempt === 1 ? bucket.take2 : bucket.take1
  const back = attempt === 1 ? `#/feedback/${material.id}` : `#/compare/${material.id}`
  if (!take.sentences) {
    return <NoTranscript material={material} back={back} backLabel={attempt === 1 ? "返回反馈" : "返回对照"} />
  }
  const transcript = transcriptOf(take.sentences)
  const prevTranscript = other.sentences ? transcriptOf(other.sentences) : ""
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page page-wide">
        <a className="back" href={back}>
          ← 返回{attempt === 1 ? "反馈" : "对照"}
        </a>
        <h1>{attempt === 2 ? "第二遍的复述报告" : "复述报告"}</h1>
        <p className="lede">
          这是按这一遍逐字稿算出来的评分。想认真复盘就看一看，只想随手练一下，也可以返回上一页。
        </p>
        <ReportView
          material={material}
          attempt={attempt}
          transcript={transcript}
          prevTranscript={attempt === 2 ? prevTranscript : ""}
          code={code}
        />
        <div className="actions">
          <a className="btn btn-primary" href={back}>
            返回{attempt === 1 ? "反馈" : "对照"}
          </a>
          <a className="btn btn-secondary" href={`#/done/${material.id}`}>
            {attempt === 1 ? "这次就到这里" : "结束这次练习"}
          </a>
        </div>
      </main>
    </>
  )
}

function ReportView({
  material,
  attempt,
  transcript,
  prevTranscript,
  code,
}: {
  material: Material
  attempt: 1 | 2
  transcript: string
  prevTranscript: string
  code: string
}) {
  const key = reportKey(material.id, attempt, transcript)
  const [requested, setRequested] = useState(key)
  const [state, setState] = useState<ReportPanelState>({ status: "loading" })

  useEffect(() => {
    if (!code) return
    const parts = requested.split(SEP)
    const reqAttempt = parts[1] === "2" ? 2 : 1
    const reqTranscript = parts[2] ?? ""
    const reqMaterial = parts[0] ?? material.id
    const reqPrev = reqAttempt === 2 ? prevTranscript : ""
    let live = true
    setState({ status: "loading" })
    const cachedMain = reportCache.get(requested)
    const mainPromise = cachedMain
      ? Promise.resolve(cachedMain)
      : requestReport({ materialId: reqMaterial, transcript: reqTranscript }).then((data) => {
          reportCache.set(requested, data)
          return data
        })
    const prevKey = reqPrev ? reportKey(reqMaterial, 1, reqPrev) : ""
    const cachedPrev = prevKey ? reportCache.get(prevKey) : undefined
    const prevPromise =
      reqAttempt === 2 && prevKey
        ? cachedPrev
          ? Promise.resolve(cachedPrev)
          : requestReport({ materialId: reqMaterial, transcript: reqPrev })
              .then((data) => {
                reportCache.set(prevKey, data)
                return data
              })
              .catch(() => null)
        : Promise.resolve(null)
    void Promise.all([mainPromise, prevPromise])
      .then(([data, previous]) => {
        if (live) setState({ status: "ok", data, previous })
      })
      .catch((err) => {
        if (live) setState({ status: "error", error: messageOf(err) })
      })
    return () => {
      live = false
    }
  }, [requested, code, material.id, prevTranscript])

  if (!code) {
    return (
      <div className="feedback-waiting">
        <p className="access-line">需要访问口令才能拿到报告。</p>
        <AccessPanel />
      </div>
    )
  }
  if (state.status === "loading") {
    return (
      <div className="feedback-waiting report-waiting">
        <Duck size={52} pose="attentive" />
        <p role="status">小黄鸭在算这一遍的分数…</p>
      </div>
    )
  }
  if (state.status === "error") {
    return (
      <div className="feedback-waiting">
        <p className="access-error">{state.error}</p>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => {
            setRequested(key)
            setState({ status: "loading" })
          }}
        >
          再试一次
        </button>
      </div>
    )
  }
  if (!state.data) return null
  const report = state.data
  const previous = attempt === 2 ? state.previous ?? null : null
  return (
    <>
      {previous ? (
        <p className="report-change">
          上一遍分数 → 这一遍分数：材料匹配度 {previous.match.score} → {report.match.score}，逻辑完整性{" "}
          {previous.logic.score} → {report.logic.score}，语言流畅度 {previous.fluency.score} →{" "}
          {report.fluency.score}。
        </p>
      ) : null}
      <div className="report-grid">
        <ReportBlock title="材料匹配度" score={report.match.score} previous={previous?.match.score} quotes={report.match.quotes}>
          <p>{report.match.summary}</p>
          <p>讲到了：{report.match.covered}</p>
          <p>漏了：{report.match.missed}</p>
          <p>讲错的地方：{report.match.wrong}</p>
        </ReportBlock>
        <ReportBlock title="逻辑完整性" score={report.logic.score} previous={previous?.logic.score} quotes={report.logic.quotes}>
          <p>{report.logic.summary}</p>
          <p>顺序：{report.logic.order}</p>
          <p>跳过的步骤：{report.logic.skipped}</p>
          <p>前提：{report.logic.premises}</p>
        </ReportBlock>
        <ReportBlock title="语言流畅度" score={report.fluency.score} previous={previous?.fluency.score} quotes={report.fluency.quotes}>
          <p>{report.fluency.summary}</p>
          <p>
            口头禅：
            {report.fluency.fillers.length === 0
              ? "几乎没有。"
              : report.fluency.fillers.map((item) => `${item.word} ${item.count} 次`).join("，") + "。"}
          </p>
          <p>重复：{report.fluency.repetition}</p>
          <p>改口：{report.fluency.corrections}</p>
        </ReportBlock>
      </div>
    </>
  )
}

function ReportBlock({
  title,
  score,
  previous,
  quotes,
  children,
}: {
  title: string
  score: number
  previous?: number
  quotes: ReportData["match"]["quotes"]
  children: ReactNode
}) {
  return (
    <section className="report-block">
      <header className="report-head">
        <h2>{title}</h2>
        <p className="report-score">
          {previous != null ? <span className="report-prev">{previous} → </span> : null}
          <span>{score}</span>
        </p>
      </header>
      {children}
      {quotes.map((quote, index) => (
        <blockquote key={`${quote.quote}-${index}`} className="report-quote">
          <p>「{quote.quote}」</p>
          <p>{quote.note}</p>
        </blockquote>
      ))}
    </section>
  )
}

function Done({ material }: { material: Material }) {
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page">
        <h1>这次就到这里</h1>
        <p className="lede">
          小黄鸭没看过原文。它听懂的，和没跟上的，都对着逐字稿写在上一页。想看综合评分，可以回去打开复述报告；也可以不看，直接回到工作台。
        </p>
        <div className="actions">
          <a className="btn btn-secondary" href={`#/compare/${material.id}`}>
            再看两遍逐字稿
          </a>
          <a className="btn btn-primary" href="#/">
            回到工作台
          </a>
        </div>
      </main>
    </>
  )
}

function Missing() {
  return (
    <>
      <TopBar />
      <main className="page">
        <h1>没有这篇材料</h1>
        <p className="lede">回到工作台，重新选一篇。</p>
        <a className="btn btn-primary" href="#/">
          回到工作台
        </a>
      </main>
    </>
  )
}
