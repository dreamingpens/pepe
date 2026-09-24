import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import type { Paper } from './usePaper'

export type ReaderHandle = { goToPage: (page: number) => void; focus: () => void }
type Position = { page: number; fraction: number }

export const PdfReader = forwardRef<
  ReaderHandle,
  {
    paper: Paper
    preferredWidth: number
    onPageChange: (page: number) => void
  }
>(function PdfReader({ paper, preferredWidth, onPageChange }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const position = useRef<Position>({ page: 1, fraction: 0 })
  const [availableWidth, setAvailableWidth] = useState(960)
  const width = Math.max(
    260,
    Math.min(preferredWidth, availableWidth - (availableWidth < 620 ? 28 : 88)),
  )
  const restoring = useRef(false)

  useImperativeHandle(
    ref,
    () => ({
      goToPage(number) {
        const root = scrollRef.current
        const page = root?.querySelector<HTMLElement>(`[data-page-number="${number}"]`)
        if (root && page) {
          root.scrollTop += page.getBoundingClientRect().top - root.getBoundingClientRect().top - 24
          root.focus({ preventScroll: true })
        }
      },
      focus() {
        scrollRef.current?.focus({ preventScroll: true })
      },
    }),
    [],
  )

  useEffect(() => {
    const root = scrollRef.current!
    const observer = new ResizeObserver(([entry]) =>
      setAvailableWidth(Math.floor(entry.contentRect.width)),
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const root = scrollRef.current!
    const page = root.querySelector<HTMLElement>(`[data-page-number="${position.current.page}"]`)
    if (!page) return
    restoring.current = true
    const top = page.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
    root.scrollTop = Math.max(0, top + page.offsetHeight * position.current.fraction - 24)
    const frame = requestAnimationFrame(() => {
      restoring.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [width])

  useEffect(() => {
    const root = scrollRef.current!
    let frame = 0
    const update = () => {
      if (restoring.current) return
      const top = root.getBoundingClientRect().top + 26
      const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-page-number]'))
      const current =
        pages.find((page) => page.getBoundingClientRect().bottom > top) ?? pages[pages.length - 1]
      if (!current) return
      const box = current.getBoundingClientRect()
      const page = Number(current.dataset.pageNumber)
      position.current = { page, fraction: Math.max(0, (top - box.top) / box.height) }
      onPageChange(page)
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      root.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [onPageChange])

  return (
    <main className="reader" ref={scrollRef} tabIndex={0} aria-label={`${paper.title}, paper`}>
      <div className="paper-stack">
        {Array.from({ length: paper.pdf.numPages }, (_, index) => (
          <PdfPage
            key={index + 1}
            pdf={paper.pdf}
            number={index + 1}
            width={width}
            initialSize={paper.firstPageSize}
            scrollRoot={scrollRef}
          />
        ))}
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
}: {
  pdf: PDFDocumentProxy
  number: number
  width: number
  initialSize: { width: number; height: number }
  scrollRoot: React.RefObject<HTMLDivElement | null>
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
