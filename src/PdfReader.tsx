import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import type { Paper } from './usePaper'
import type { PaperIndex, PageIndex, Source, Visual } from './types'

export type ReaderHandle = {
  goToPage: (page: number) => void
  goToSource: (source: Source) => void
  focus: () => void
}
type Position = { page: number; fraction: number }
export type PaperInteraction =
  | { kind: 'citation'; referenceIds: string[]; x: number; y: number }
  | { kind: 'visual'; visual: Visual; x: number; y: number }

function pageAt(offsets: number[], top: number) {
  let low = 0,
    high = offsets.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (offsets[middle] <= top) low = middle
    else high = middle - 1
  }
  return low
}
export const PdfReader = forwardRef<
  ReaderHandle,
  {
    paper: Paper
    preferredWidth: number
    onPageChange: (page: number) => void
    index?: PaperIndex | null
    onInteraction?: (interaction: PaperInteraction) => void
  }
>(function PdfReader({ paper, preferredWidth, onPageChange, index, onInteraction }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const position = useRef<Position>({ page: 1, fraction: 0 })
  const [viewport, setViewport] = useState({ width: 960, height: 960, top: 0 })
  const [highlight, setHighlight] = useState<Source | null>(null)
  const width = Math.max(
    260,
    Math.min(preferredWidth, viewport.width - (viewport.width < 620 ? 28 : 88)),
  )
  const sizes = useMemo(
    () =>
      Array.from({ length: paper.pdf.numPages }, (_, i) => index?.pages[i] || paper.firstPageSize),
    [index, paper.pdf, paper.firstPageSize],
  )
  const { offsets, heights, total } = useMemo(() => {
    let top = 24
    const heights = sizes.map((size) => (width * size.height) / size.width)
    const offsets = heights.map((height) => {
      const offset = top
      top += height + 22
      return offset
    })
    return { offsets, heights, total: top + 56 }
  }, [width, sizes])
  const first = Math.max(0, pageAt(offsets, viewport.top - viewport.height))
  const last = Math.min(paper.pdf.numPages - 1, pageAt(offsets, viewport.top + viewport.height * 2))

  const go = (number: number, fraction = 0) => {
    const root = scrollRef.current
    if (!root || number < 1 || number > offsets.length) return
    root.scrollTop = offsets[number - 1] + heights[number - 1] * fraction - 24
    setViewport((v) => ({ ...v, top: root.scrollTop }))
    position.current = { page: number, fraction }
    onPageChange(number)
    root.focus({ preventScroll: true })
  }
  useImperativeHandle(ref, () => ({
    goToPage: (number) => go(number),
    goToSource: (source) => {
      go(source.page, Math.max(0, source.y - 0.08))
      setHighlight(source)
    },
    focus: () => scrollRef.current?.focus({ preventScroll: true }),
  }))
  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), 3500)
    return () => clearTimeout(timer)
  }, [highlight])
  useEffect(() => {
    const root = scrollRef.current!
    const observer = new ResizeObserver(([entry]) =>
      setViewport((v) => ({
        ...v,
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      })),
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const root = scrollRef.current!
    const i = Math.min(position.current.page - 1, offsets.length - 1)
    root.scrollTop = Math.max(0, offsets[i] + heights[i] * position.current.fraction - 24)
    setViewport((v) => ({ ...v, top: root.scrollTop }))
  }, [offsets, heights])
  useEffect(() => {
    const root = scrollRef.current!
    let frame = 0
    const update = () => {
      const top = root.scrollTop,
        i = pageAt(offsets, top + 25)
      position.current = {
        page: i + 1,
        fraction: Math.max(0, (top + 24 - offsets[i]) / heights[i]),
      }
      setViewport((v) => ({ ...v, top }))
      onPageChange(i + 1)
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [offsets, heights, onPageChange])

  return (
    <main className="reader" ref={scrollRef} tabIndex={0} aria-label={`${paper.title}, paper`}>
      <div className="virtual-paper-stack" style={{ height: total }}>
        {Array.from({ length: last - first + 1 }, (_, slot) => {
          const i = first + slot
          return (
            <div
              key={i + 1}
              className="virtual-page-slot"
              style={{ top: offsets[i], width, height: heights[i] }}
            >
              <PdfPage
                pdf={paper.pdf}
                number={i + 1}
                width={width}
                initialSize={sizes[i]}
                scrollRoot={scrollRef}
                pageIndex={index?.pages[i]}
                fullIndex={index}
                onInteraction={onInteraction}
              />
              {highlight?.page === i + 1 && (
                <div
                  className="source-highlight"
                  data-source-line={highlight.line}
                  style={{ top: `${highlight.y * 100}%` }}
                />
              )}
            </div>
          )
        })}
      </div>
    </main>
  )
})

function PdfPage({
  pdf,
  number,
  width,
  initialSize,
  scrollRoot,
  pageIndex,
  fullIndex,
  onInteraction,
}: {
  pdf: PDFDocumentProxy
  number: number
  width: number
  initialSize: { width: number; height: number }
  scrollRoot: React.RefObject<HTMLDivElement | null>
  pageIndex?: PageIndex
  fullIndex?: PaperIndex | null
  onInteraction?: (interaction: PaperInteraction) => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const paintLayer = useRef<HTMLDivElement>(null)
  const [nearby, setNearby] = useState(number === 1)
  const [size, setSize] = useState(initialSize)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const scale = width / size.width

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), {
      root: scrollRoot.current,
      rootMargin: '1000px 0px',
    })
    observer.observe(element.current!)
    return () => observer.disconnect()
  }, [scrollRoot])

  useEffect(() => {
    if (!nearby) {
      paintLayer.current?.replaceChildren()
      return
    }
    let disposed = false
    let render: RenderTask | undefined
    let text: TextLayer | undefined
    setError(false)
    async function draw() {
      try {
        const page = await pdf.getPage(number)
        if (disposed) return
        const natural = page.getViewport({ scale: 1 })
        if (natural.width !== size.width || natural.height !== size.height) {
          setSize({ width: natural.width, height: natural.height })
          return
        }
        const viewport = page.getViewport({ scale })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = document.createElement('canvas')
        canvas.setAttribute('aria-hidden', 'true')
        canvas.width = Math.ceil(viewport.width * pixelRatio)
        canvas.height = Math.ceil(viewport.height * pixelRatio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        render = page.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] })
        await render.promise
        if (disposed) return
        const textElement = document.createElement('div')
        textElement.className = 'textLayer'
        textElement.style.setProperty('--scale-factor', String(scale))
        textElement.style.setProperty('--total-scale-factor', String(scale))
        text = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textElement,
          viewport,
        })
        await text.render()
        if (disposed) return
        paintLayer.current?.replaceChildren(canvas, textElement)
        element.current?.setAttribute('data-rendered', 'true')
      } catch (cause) {
        if (
          !disposed &&
          (cause as Error).name !== 'RenderingCancelledException' &&
          (cause as Error).name !== 'AbortException'
        ) {
          setError(true)
          console.warn(`Could not render page ${number}:`, cause)
        }
      }
    }
    void draw()
    return () => {
      disposed = true
      render?.cancel()
      text?.cancel()
    }
  }, [pdf, number, nearby, scale, size, retry])

  return (
    <section
      ref={element}
      className="pdf-page"
      data-page-number={number}
      aria-label={`Page ${number}`}
      style={{ width, height: size.height * scale }}
      onClick={(event) => {
        if (window.getSelection()?.toString().trim() || !pageIndex || !onInteraction) return
        const box = event.currentTarget.getBoundingClientRect(),
          x = (event.clientX - box.left) / box.width,
          y = (event.clientY - box.top) / box.height
        const link = pageIndex.links.find(
          (link) =>
            x >= link.x - 0.005 &&
            x <= link.x + link.width + 0.005 &&
            y >= link.y - 0.005 &&
            y <= link.y + link.height + 0.005,
        )
        if (link?.target && fullIndex) {
          const target = link.target
          const targetPage = fullIndex.pages[target.page - 1]
          const targetY = target.pdfY && targetPage ? 1 - target.pdfY / targetPage.height : 0
          const refs = fullIndex.references
            .filter((r) => r.page === target.page)
            .sort((a, b) => Math.abs(a.y - targetY) - Math.abs(b.y - targetY))
          if (
            refs[0] &&
            (/cite|bib|ref/i.test(link.dest) || Math.abs(refs[0].y - targetY) < 0.045)
          ) {
            onInteraction({
              kind: 'citation',
              referenceIds: [refs[0].id],
              x: event.clientX,
              y: event.clientY,
            })
            return
          }
        }
        const line = pageIndex.lines.find(
          (line) =>
            y >= line.y - 0.004 &&
            y <= line.y + line.height + 0.006 &&
            x >= line.x &&
            x <= line.x + line.width,
        )
        if (line?.citations?.length) {
          const location = ((x - line.x) / Math.max(line.width, 0.001)) * line.text.length
          const citation = line.citations.find(
            (c) => location >= c.start - 3 && location <= c.end + 3,
          )
          if (citation) {
            onInteraction({
              kind: 'citation',
              referenceIds: citation.referenceIds,
              x: event.clientX,
              y: event.clientY,
            })
            return
          }
        }
        const visual = pageIndex.visuals.find(
          (visual) =>
            x >= visual.x &&
            x <= visual.x + visual.width &&
            y >= visual.y &&
            y <= visual.y + visual.height,
        )
        if (visual)
          onInteraction({
            kind: 'visual',
            visual: { ...visual, point: { x, y } },
            x: event.clientX,
            y: event.clientY,
          })
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        onInteraction?.({
          kind: 'visual',
          x: event.clientX,
          y: event.clientY,
          visual: {
            id: `page-${number}`,
            kind: 'visual',
            label: 'This part of the paper',
            page: number,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            line: `p${number}-l1`,
            text: '',
            point: {
              x: (event.clientX - box.left) / box.width,
              y: (event.clientY - box.top) / box.height,
            },
          },
        })
      }}
    >
      <div className="page-paint" ref={paintLayer} />
      {error && (
        <div className="page-error" role="alert">
          <p>This page couldn’t be displayed.</p>
          <button onClick={() => setRetry((value) => value + 1)}>Try again</button>
        </div>
      )}
    </section>
  )
}
