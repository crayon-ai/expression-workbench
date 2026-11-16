type Pose = "still" | "attentive" | "listening"

export function Duck({
  size = 180,
  pose = "still",
}: {
  size?: number
  pose?: Pose
}) {
  const poseClass =
    pose === "listening" ? "is-listening" : pose === "attentive" ? "is-attentive" : ""
  return (
    <svg
      width={size}
      height={Math.round(size * (190 / 240))}
      viewBox="0 0 240 190"
      className={poseClass ? `duck ${poseClass}` : "duck"}
      aria-hidden="true"
    >
      <ellipse cx="118" cy="174" rx="72" ry="8" fill="#E4D3AE" />
      <g className="duck-body">
        <path
          d="M58 124c-20-4-30 16-16 28 12-10 24-14 36-12-8-4-14-10-20-16z"
          fill="#E2B03A"
        />
        <ellipse cx="112" cy="128" rx="70" ry="42" fill="#F0C14A" />
        <ellipse cx="120" cy="136" rx="42" ry="24" fill="#F6D56A" />
        <path
          d="M102 116c22 6 34 24 22 40-18-6-30-20-28-36 2-2 4-4 6-4z"
          fill="#E2B03A"
        />
      </g>
      <g className="duck-head">
        <ellipse cx="150" cy="108" rx="22" ry="16" fill="#F0C14A" />
        <circle cx="168" cy="74" r="32" fill="#F0C14A" />
        <path
          d="M190 66c24 2 40 12 40 20s-18 16-40 12c-2-10 0-26 0-32z"
          fill="#E08A2C"
        />
        <path
          d="M194 84h32"
          stroke="#C56E16"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <ellipse cx="156" cy="62" rx="9" ry="5" fill="#FFF6D0" opacity="0.8" />
        <circle cx="178" cy="68" r="3.5" fill="#1C1B19" />
        <circle cx="179.2" cy="66.8" r="1.15" fill="#FFFFFF" />
      </g>
    </svg>
  )
}
