import { useEffect, useRef, useState, type CSSProperties } from 'react'

const defaults = { width: 380, height: 520 }
function savedSize() {
  try {
    const size = JSON.parse(localStorage.getItem('pepe:summary-size') || '{}')
    return {
      width: Number.isFinite(size.width)
        ? Math.max(280, Math.min(850, size.width))
        : defaults.width,
      height: Number.isFinite(size.height)
        ? Math.max(280, Math.min(1200, size.height))
        : defaults.height,
    }
  } catch {
    return defaults
  }
}

export function useSummarySize() {
  const [size, setSize] = useState(savedSize)
  const [stacked, setStacked] = useState(() => window.innerWidth <= 1100)
  const layout = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)')
    const change = () => setStacked(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('pepe:summary-size', JSON.stringify(size))
    } catch {
      /* Optional preference. */
    }
  }, [size])
  return {
    layout,
    style: {
      '--summary-width': `${size.width}px`,
      '--summary-height': `${size.height}px`,
    } as CSSProperties,
    resize: (
      <div
        className="summary-resize"
        role="separator"
        tabIndex={0}
        aria-label="Resize summary panel"
        aria-orientation={stacked ? 'horizontal' : 'vertical'}
        aria-valuemin={280}
        aria-valuemax={stacked ? 1200 : 850}
        aria-valuenow={stacked ? size.height : size.width}
        title="Drag to resize · Arrow keys to adjust · Double-click to reset"
        onDoubleClick={() => setSize(defaults)}
        onKeyDown={(event) => {
          const direction = stacked
            ? event.key === 'ArrowDown'
              ? 1
              : event.key === 'ArrowUp'
                ? -1
                : 0
            : event.key === 'ArrowLeft'
              ? 1
              : event.key === 'ArrowRight'
                ? -1
                : 0
          if (!direction) return
          event.preventDefault()
          const key = stacked ? 'height' : 'width'
          const max = stacked
            ? 1200
            : Math.min(850, (layout.current?.clientWidth || window.innerWidth) - 567)
          setSize((previous) => ({
            ...previous,
            [key]: Math.max(280, Math.min(max, previous[key] + direction * 24)),
          }))
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          const handle = event.currentTarget
          const initial = stacked ? event.clientY : event.clientX
          const box = handle.parentElement!.getBoundingClientRect()
          const start = stacked ? box.height : box.width
          const key = stacked ? 'height' : 'width'
          const max = stacked
            ? 1200
            : Math.min(850, (layout.current?.clientWidth || window.innerWidth) - 567)
          const move = (event: PointerEvent) => {
            const distance = stacked ? event.clientY - initial : initial - event.clientX
            setSize((previous) => ({
              ...previous,
              [key]: Math.max(280, Math.min(max, start + distance)),
            }))
          }
          const end = () => {
            handle.removeEventListener('pointermove', move)
            handle.removeEventListener('lostpointercapture', end)
          }
          handle.addEventListener('pointermove', move)
          handle.addEventListener('lostpointercapture', end)
        }}
      />
    ),
  }
}
