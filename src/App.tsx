import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { Material, Report, Sentence } from "./materials"
import { getMaterial, materials } from "./materials"
import { Duck } from "./duck"
import { useRecorder } from "./useRecorder"
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
  texts: string[]
  audioUrl: string | null
}

type Bucket = {
  take1: Take
  take2: Take
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

function blankTake(sentences: Sentence[]): Take {
  return { texts: sentences.map((sentence) => sentence.text), audioUrl: null }
}

function revoke(url: string | null) {
  if (url) URL.revokeObjectURL(url)
}

function withSentences(sentences: Sentence[], texts: string[]): Sentence[] {
  return sentences.map((sentence, index) => ({
    id: sentence.id,
    text: texts[index] ?? sentence.text,
  }))
}

function isEdited(sentences: Sentence[], texts: string[]): boolean {
  return sentences.some((sentence, index) => (texts[index] ?? sentence.text) !== sentence.text)
}

function quoteOf(sentences: Sentence[], texts: string[], sentenceId: string): string {
  const index = sentences.findIndex((sentence) => sentence.id === sentenceId)
  if (index < 0) return ""
  const text = (texts[index] ?? sentences[index]?.text ?? "").trim()
  return text || "（这一句是空的）"
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
      transcript: "示例逐字稿 · 表达训练工作台",
      feedback: "示例反馈 · 表达训练工作台",
      compare: "两遍放在一起 · 表达训练工作台",
      report: "示例报告 · 表达训练工作台",
      done: "这次就到这里 · 表达训练工作台",
      missing: "表达训练工作台",
    }
    document.title = titles[route.name]
  }, [route])

  function bucketFor(material: Material): Bucket {
    return (
      buckets[material.id] ?? {
        take1: blankTake(material.attempt1),
        take2: blankTake(material.attempt2),
      }
    )
  }

  function update(id: string, recipe: (current: Bucket) => Bucket) {
    const material = getMaterial(id)
    if (!material) return
    setBuckets((prev) => {
      const current = prev[id] ?? {
        take1: blankTake(material.attempt1),
        take2: blankTake(material.attempt2),
      }
      return { ...prev, [id]: recipe(current) }
    })
  }

  function resetTake(id: string, attempt: 1 | 2) {
    const material = getMaterial(id)
    if (!material) return
    update(id, (current) => {
      if (attempt === 1) {
        revoke(current.take1.audioUrl)
        return { ...current, take1: blankTake(material.attempt1) }
      }
      revoke(current.take2.audioUrl)
      return { ...current, take2: blankTake(material.attempt2) }
    })
  }

  function setText(id: string, attempt: 1 | 2, index: number, text: string) {
    update(id, (current) => {
      if (attempt === 1) {
        const texts = current.take1.texts.slice()
        texts[index] = text
        return { ...current, take1: { ...current.take1, texts } }
      }
      const texts = current.take2.texts.slice()
      texts[index] = text
      return { ...current, take2: { ...current.take2, texts } }
    })
  }

  function finishSpeak(id: string, attempt: 1 | 2, url: string | null) {
    update(id, (current) => {
      if (attempt === 1) {
        revoke(current.take1.audioUrl)
        return { ...current, take1: { ...current.take1, audioUrl: url } }
      }
      revoke(current.take2.audioUrl)
      return { ...current, take2: { ...current.take2, audioUrl: url } }
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
        onFinish={(url) => finishSpeak(material.id, route.attempt, url)}
      />
    ) : route.name === "transcript" && material ? (
      <Transcript
        material={material}
        take={bucketFor(material).take1}
        onChange={(index, text) => setText(material.id, 1, index, text)}
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
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page">
        <a className="back" href="#/">
          ← 返回工作台
        </a>
        <h1>选一篇材料</h1>
        <p className="lede">三篇都很短。每篇都有一个要讲给谁听的情境。用自己的话讲，大约一分钟。</p>
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
  onFinish: (url: string | null) => void
}) {
  const { phase, elapsed, micNote, demoMode, bands, hearing, heardVoice, startCheck, start, stop } =
    useRecorder()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recalling, setRecalling] = useState(false)
  const [stage, setStage] = useState<"check" | "idle" | "live">(attempt === 1 ? "check" : "idle")
  const cancelled = useRef(false)

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
    try {
      const url = recording ? await stop() : null
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
      if (!cancelled.current) onFinish(url)
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
          </>
        )}
      </main>
      {open && !recalling ? <SourceDrawer material={material} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function Transcript({
  material,
  take,
  onChange,
}: {
  material: Material
  take: Take
  onChange: (index: number, text: string) => void
}) {
  const sentences = withSentences(material.attempt1, take.texts)
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page">
        <a className="back" href={`#/read/${material.id}`}>
          ← 返回材料
        </a>
        <Badge>示例逐字稿</Badge>
        <h1>你刚才讲的</h1>
        <p className="lede">
          逐字稿照你讲出来的样子留下，不替你改顺。口头语、重复、没说完的句子都还在。只看这段话，没接上的地方会自己露出来。
        </p>
        <p className="mock-note">这是预先写好的示例，不是刚才录音的识别结果。</p>
        <Recording
          src={take.audioUrl}
          playLabel="播放录音"
          empty="这次没有录音。下面仍用示例逐字稿，把流程走完。"
        />
        <SentenceList prefix="t1" sentences={sentences} onChange={onChange} />
        <p className="edit-hint">点某一句，可以改掉明显的识别错误。改字是在修正识别，不是把话说顺。</p>
        <p className="prompt">如果你没看过原文，只看这段话，能听懂吗？</p>
        <a className="btn btn-primary" href={`#/feedback/${material.id}`}>
          看看小黄鸭听到了什么
        </a>
      </main>
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
  const sentences = withSentences(material.attempt1, take.texts)
  const marked = new Set(material.feedback1.issues.map((issue) => issue.sentenceId))
  const edited = isEdited(material.attempt1, take.texts)
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page page-wide">
        <a className="back" href={`#/transcript/${material.id}`}>
          ← 返回逐字稿
        </a>
        <Badge>示例逐字稿</Badge>
        <h1>你刚才讲的</h1>
        <p className="lede">
          小黄鸭这回是{material.listener}，没看过原文，只听了这段话。先看逐字稿，再看它哪里没跟上。
        </p>
        <div className="feedback-layout">
          <div>
            <SentenceList prefix="t1" sentences={sentences} marked={marked} onChange={onChange} />
            <p className="edit-hint">点某一句，可以改掉明显的识别错误。</p>
          </div>
          <aside className="feedback-panel">
            <div className="feedback-head">
              <Duck size={52} pose="attentive" />
              <div>
                <Badge>示例反馈</Badge>
                <p>它这回是{material.listener}。</p>
              </div>
            </div>
            <h2>这里我听懂了</h2>
            <p>{material.feedback1.understood}</p>
            {material.feedback1.issues.map((issue) => (
              <div key={issue.sentenceId}>
                <h2>这里我没跟上</h2>
                <button
                  type="button"
                  className="quote"
                  onClick={() => focusSentence(`sentence-t1-${issue.sentenceId}`)}
                >
                  「{quoteOf(material.attempt1, take.texts, issue.sentenceId)}」
                </button>
                <p>{issue.comment}</p>
              </div>
            ))}
            <PremiseChecklist premises={material.premises} attempt={1} />
            <EditNote edited={edited} />
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
}: {
  material: Material
  bucket: Bucket
  onChange: (attempt: 1 | 2, index: number, text: string) => void
}) {
  const first = withSentences(material.attempt1, bucket.take1.texts)
  const second = withSentences(material.attempt2, bucket.take2.texts)
  const edited =
    isEdited(material.attempt1, bucket.take1.texts) || isEdited(material.attempt2, bucket.take2.texts)
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page page-wide">
        <Badge>示例逐字稿</Badge>
        <h1>两遍放在一起</h1>
        <p className="lede">两段都是示例逐字稿，不是录音的识别结果。可以分别播放。</p>
        <div className="compare-grid">
          <section>
            <h2 className="column-title">第一遍</h2>
            <Recording
              src={bucket.take1.audioUrl}
              playLabel="播放第一遍"
              empty="第一遍没有录音。"
            />
            <SentenceList
              prefix="t1"
              sentences={first}
              marked={new Set(material.feedback1.issues.map((issue) => issue.sentenceId))}
              onChange={(index, text) => onChange(1, index, text)}
            />
          </section>
          <section>
            <h2 className="column-title">第二遍</h2>
            <Recording
              src={bucket.take2.audioUrl}
              playLabel="播放第二遍"
              empty="第二遍没有录音。"
            />
            <SentenceList
              prefix="t2"
              sentences={second}
              marked={new Set([material.feedback2.stillSentenceId])}
              onChange={(index, text) => onChange(2, index, text)}
            />
          </section>
        </div>
        <aside className="feedback-panel compare-feedback">
          <div className="feedback-head">
            <Duck size={52} pose="attentive" />
            <div>
              <Badge>示例反馈</Badge>
              <p>仍是那个{material.listener}。</p>
            </div>
          </div>
          <h2>这里我跟上了</h2>
          <button
            type="button"
            className="quote quote-clear"
            onClick={() => focusSentence(`sentence-t2-${material.feedback2.improvedSentenceId}`)}
          >
            「{quoteOf(material.attempt2, bucket.take2.texts, material.feedback2.improvedSentenceId)}」
          </button>
          <p>{material.feedback2.improved}</p>
          <h2>这里我还是没跟上</h2>
          <button
            type="button"
            className="quote"
            onClick={() => focusSentence(`sentence-t2-${material.feedback2.stillSentenceId}`)}
          >
            「{quoteOf(material.attempt2, bucket.take2.texts, material.feedback2.stillSentenceId)}」
          </button>
          <p>{material.feedback2.still}</p>
          <PremiseChecklist premises={material.premises} attempt={2} />
          <EditNote edited={edited} />
          <div className="actions">
            <a className="btn btn-primary" href={`#/done/${material.id}`}>
              结束这次练习
            </a>
            <a className="btn btn-secondary" href={`#/report/${material.id}/2`}>
              获取复述报告
            </a>
          </div>
        </aside>
      </main>
    </>
  )
}

function ReportPage({
  material,
  attempt,
  bucket,
}: {
  material: Material
  attempt: 1 | 2
  bucket: Bucket
}) {
  const report = attempt === 1 ? material.report1 : material.report2
  const previous = attempt === 2 ? material.report1 : null
  const sentences = attempt === 1 ? material.attempt1 : material.attempt2
  const take = attempt === 1 ? bucket.take1 : bucket.take2
  const back = attempt === 1 ? `#/feedback/${material.id}` : `#/compare/${material.id}`

  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page page-wide">
        <a className="back" href={back}>
          ← 返回{attempt === 1 ? "反馈" : "对照"}
        </a>
        <Badge>示例报告</Badge>
        <h1>{attempt === 2 ? "第二遍的复述报告" : "复述报告"}</h1>
        <p className="lede">
          这是按示例逐字稿写好的评分，不是对刚才录音的计算。想认真复盘就看一看，只想随手练一下，也可以返回上一页。
        </p>
        <p className="mock-note">示例报告。分数是预先写好的，不会随你改字而重算。</p>
        {previous ? (
          <p className="report-change">
            和上一遍比：材料匹配度 {previous.match.score} → {report.match.score}，逻辑完整性{" "}
            {previous.logic.score} → {report.logic.score}，语言流畅度 {previous.fluency.score} →{" "}
            {report.fluency.score}。
          </p>
        ) : null}
        <div className="report-grid">
          <ReportBlock
            title="材料匹配度"
            score={report.match.score}
            previous={previous?.match.score}
            quotes={report.match.quotes}
            sentences={sentences}
            texts={take.texts}
          >
            <p>{report.match.summary}</p>
            <p>讲到了：{report.match.covered}</p>
            <p>漏了：{report.match.missed}</p>
            <p>讲错的地方：{report.match.wrong}</p>
          </ReportBlock>
          <ReportBlock
            title="逻辑完整性"
            score={report.logic.score}
            previous={previous?.logic.score}
            quotes={report.logic.quotes}
            sentences={sentences}
            texts={take.texts}
          >
            <p>{report.logic.summary}</p>
            <p>顺序：{report.logic.order}</p>
            <p>跳过的步骤：{report.logic.skipped}</p>
            <p>前提：{report.logic.premises}</p>
          </ReportBlock>
          <ReportBlock
            title="语言流畅度"
            score={report.fluency.score}
            previous={previous?.fluency.score}
            quotes={report.fluency.quotes}
            sentences={sentences}
            texts={take.texts}
          >
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
        <div className="actions">
          <a className="btn btn-primary" href={back}>
            返回{attempt === 1 ? "反馈" : "对照"}
          </a>
          {attempt === 1 ? (
            <a className="btn btn-secondary" href={`#/done/${material.id}`}>
              这次就到这里
            </a>
          ) : (
            <a className="btn btn-secondary" href={`#/done/${material.id}`}>
              结束这次练习
            </a>
          )}
        </div>
      </main>
    </>
  )
}

function ReportBlock({
  title,
  score,
  previous,
  quotes,
  sentences,
  texts,
  children,
}: {
  title: string
  score: number
  previous?: number
  quotes: Report["match"]["quotes"]
  sentences: Sentence[]
  texts: string[]
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
      {quotes.map((quote) => (
        <blockquote key={`${quote.sentenceId}-${quote.note}`} className="report-quote">
          <p>「{quoteOf(sentences, texts, quote.sentenceId)}」</p>
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
