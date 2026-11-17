import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { Material, Premise, Sentence } from "./materials"
import { Duck } from "./duck"

export function formatTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export function TopBar({ aside }: { aside?: ReactNode }) {
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <Duck size={28} />
        <span>表达训练工作台</span>
      </a>
      <div className="topbar-aside">{aside}</div>
    </header>
  )
}

export function Badge({ children }: { children: string }) {
  return <span className="badge">{children}</span>
}

export function Recording({
  src,
  playLabel,
  empty,
}: {
  src: string | null
  playLabel: string
  empty: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)

  if (!src) {
    return <p className="recording-empty">{empty}</p>
  }

  const known = Number.isFinite(duration) && duration > 0.2

  return (
    <div className="recording">
      <button
        type="button"
        className="recording-btn"
        onClick={() => {
          const el = audioRef.current
          if (!el) return
          if (el.paused) void el.play()
          else el.pause()
        }}
      >
        {playing ? "暂停" : playLabel}
      </button>
      <span className="recording-time">
        {known ? `${formatTime(time)} / ${formatTime(duration)}` : "录音"}
      </span>
      {known ? (
        <input
          className="recording-range"
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(time, duration)}
          aria-label="播放进度"
          onChange={(event) => {
            const el = audioRef.current
            if (!el) return
            const next = Number(event.target.value)
            el.currentTime = next
            setTime(next)
          }}
        />
      ) : null}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
      />
    </div>
  )
}

export function SentenceList({
  prefix,
  sentences,
  marked,
  onChange,
}: {
  prefix: string
  sentences: Sentence[]
  marked?: ReadonlySet<string>
  onChange: (index: number, text: string) => void
}) {
  return (
    <div className="transcript">
      {sentences.map((sentence, index) => (
        <SentenceEditor
          key={sentence.id}
          domId={`sentence-${prefix}-${sentence.id}`}
          text={sentence.text}
          marked={marked?.has(sentence.id) ?? false}
          onChange={(text) => onChange(index, text)}
        />
      ))}
    </div>
  )
}

function SentenceEditor({
  domId,
  text,
  marked,
  onChange,
}: {
  domId: string
  text: string
  marked: boolean
  onChange: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <textarea
        id={domId}
        className="sentence-edit"
        value={text}
        autoFocus
        aria-label="改正这一句"
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 18)))}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "Escape") {
            event.preventDefault()
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      id={domId}
      className={marked ? "sentence is-marked" : "sentence"}
      onClick={() => setEditing(true)}
    >
      {marked ? <span className="mark-label">没跟上</span> : null}
      <span>{text || "（这一句是空的）"}</span>
    </button>
  )
}

export function focusSentence(domId: string) {
  const el = document.getElementById(domId)
  if (!el) return
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" })
  el.classList.add("is-pulse")
  window.setTimeout(() => el.classList.remove("is-pulse"), 700)
}

export function SourceDrawer({
  material,
  onClose,
}: {
  material: Material
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  return (
    <div className="drawer-root">
      <button type="button" className="drawer-backdrop" aria-label="收回材料" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="source-title">
        <div className="drawer-bar">
          <p className="kind">再看一眼</p>
          <button ref={closeRef} type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            收回
          </button>
        </div>
        <h2 id="source-title">{material.title}</h2>
        <p className="context-line">{material.context}</p>
        <p className="drawer-note">这不是背诵。看一眼可以，讲的时候用自己的话。</p>
        {material.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </aside>
    </div>
  )
}

export function EditNote({ edited }: { edited: boolean }) {
  if (!edited) return null
  return (
    <p className="edit-note">你改过示例逐字稿。示例反馈仍按改之前的稿子写，不会跟着重算。</p>
  )
}


export function VoiceMeter({
  bands,
  demo,
}: {
  bands: number[]
  demo?: boolean
}) {
  return (
    <div className={demo ? "voice-meter is-demo" : "voice-meter"} aria-hidden="true">
      {bands.map((value, index) => (
        <span
          key={index}
          style={{ height: `${Math.max(10, Math.round(value * 100))}%` }}
        />
      ))}
    </div>
  )
}

export function PremiseChecklist({
  premises,
  attempt,
}: {
  premises: Premise[]
  attempt: 1 | 2
}) {
  return (
    <section className="premise-reveal">
      <h3>讲给它听，这些前提交代清楚了没有</h3>
      <ul>
        {premises.map((premise) => {
          const covered = premise.coveredIn.includes(attempt)
          return (
            <li key={premise.id} className={covered ? "is-covered" : "is-missed"}>
              <span className="premise-flag">{covered ? "有讲到" : "没讲到"}</span>
              <span>{premise.label}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
