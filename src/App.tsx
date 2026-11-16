import { useEffect, useState } from "react"
import type { Material, Sentence } from "./materials"
import { getMaterial, materials } from "./materials"
import { Duck } from "./duck"
import { useRecorder } from "./useRecorder"
import {
  Badge,
  EditNote,
  Recording,
  SentenceList,
  SourceDrawer,
  TopBar,
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
  if (parts[0] === "done" && parts[1]) return { name: "done", id: parts[1] }
  return { name: "missing" }
}

function routeKey(route: Route): string {
  if (route.name === "speak") return `speak-${route.id}-${route.attempt}`
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
        <p className="lede">三篇都很短。用自己的话讲，大约一分钟。</p>
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
          <p>用自己的话，把这件事讲给一个没看过材料的人听。不要背原文，也不必照着原文顺序讲。</p>
        </section>
        <div className="listener">
          <Duck size={72} pose="attentive" />
          <p>
            <strong>讲给小黄鸭听。</strong>
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

function Speak({
  material,
  attempt,
  onFinish,
}: {
  material: Material
  attempt: 1 | 2
  onFinish: (url: string | null) => void
}) {
  const { phase, elapsed, micNote, start, stop } = useRecorder()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const recording = phase === "recording"

  async function finish() {
    if (busy) return
    setBusy(true)
    try {
      const url = recording ? await stop() : null
      onFinish(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar
        aside={
          <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>
            再看一眼材料
          </button>
        }
      />
      <main className={recording ? "speak is-recording" : "speak"} data-recording={recording ? "1" : "0"}>
        <p className="kind">{attempt === 2 ? "第二遍 · 同一篇材料" : "第一遍"}</p>
        <h1>讲给小黄鸭听</h1>
        <div className="speak-duck">
          <Duck size={230} pose={recording ? "listening" : "attentive"} />
        </div>
        <p className={recording ? "timer is-live" : "timer"}>{formatTime(elapsed)}</p>
        <p className="speak-status" role="status">
          {recording
            ? "小黄鸭在听。它不会插话。"
            : attempt === 2
              ? "还是这篇材料。它仍然没看过原文，也仍然不插话。"
              : "它只听，不插话。"}
        </p>
        <div className="speak-actions">
          {recording ? (
            <button type="button" className="btn btn-primary" onClick={() => void finish()} disabled={busy}>
              <span className="rec-dot" aria-hidden="true" />
              讲完了
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => void start()}>
                开始讲
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void finish()} disabled={busy}>
                讲完了
              </button>
            </>
          )}
        </div>
        {micNote ? <p className="mic-note">{micNote}</p> : null}
      </main>
      {open ? <SourceDrawer material={material} onClose={() => setOpen(false)} /> : null}
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
        <p className="lede">小黄鸭没看过原文，只听了这段话。先看逐字稿，再看它哪里没跟上。</p>
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
                <p>它没看过这篇材料。</p>
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
            <EditNote edited={edited} />
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={onAgain}>
                再讲一遍
              </button>
              <a className="btn btn-secondary" href={`#/done/${material.id}`}>
                这次就到这里
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
              <p>仍是那个没看过原文的听众。</p>
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
          <EditNote edited={edited} />
          <div className="actions">
            <a className="btn btn-primary" href={`#/done/${material.id}`}>
              结束这次练习
            </a>
          </div>
        </aside>
      </main>
    </>
  )
}

function Done({ material }: { material: Material }) {
  return (
    <>
      <TopBar aside={<span>简单复述</span>} />
      <main className="page">
        <h1>这次就到这里</h1>
        <p className="lede">
          小黄鸭没看过原文。它听懂的，和没跟上的，都对着逐字稿写在上一页。没有分数。想再看，就回去看那两段话。
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
