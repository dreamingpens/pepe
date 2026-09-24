import type { CSSProperties } from 'react'

const paths = {
  paper: (
    <>
      <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z" />
      <path d="M13 3v7h7M8 14h8M8 17h5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16m-5-11 3 3-3 3" />
    </>
  ),
  open: (
    <>
      <path d="M3 9V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 9h16a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </>
  ),
  arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M5 12h14M12 5v14" />,
  check: <path d="m5 12 4 4L19 6" />,
  quote: (
    <>
      <path d="M9 5H4v7h5v-2H5c0 4 1 6 4 7M20 5h-5v7h5v-2h-4c0 4 1 6 4 7" />
    </>
  ),
  chat: <path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />,
  shortcut: (
    <>
      <path d="M8 8h8v8H8z" />
      <path d="M8 8H5a3 3 0 1 1 3-3v3Zm8 0V5a3 3 0 1 1 3 3h-3Zm0 8h3a3 3 0 1 1-3 3v-3Zm-8 0v3a3 3 0 1 1-3-3h3Z" />
    </>
  ),
  down: <path d="m6 9 6 6 6-6" />,
} satisfies Record<string, React.ReactNode>

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: keyof typeof paths
  size?: number
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  )
}
