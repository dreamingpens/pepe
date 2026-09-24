import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number]
export type Paper = {
  pdf: PDFDocumentProxy
  title: string
  filename: string
  author: string
  outline: OutlineItem[]
  firstPageSize: { width: number; height: number }
}

function assetUrl(path: string) {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
}

export function usePaper() {
  const [paper, setPaper] = useState<Paper | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef<PDFDocumentLoadingTask | null>(null)
  const generation = useRef(0)

  const load = useCallback(
    async (source: { data?: Uint8Array; url?: string; filename: string; title?: string }) => {
      const current = ++generation.current
      void pending.current?.destroy()
      setLoading(true)
      setError('')
      let needsPassword = false
      const task = getDocument({
        ...(source.data ? { data: source.data } : { url: source.url }),
        cMapUrl: assetUrl('pdfjs/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
        wasmUrl: assetUrl('pdfjs/wasm/'),
      })
      pending.current = task
      task.onPassword = () => {
        needsPassword = true
        void task.destroy()
      }
      try {
        const pdf = await task.promise
        const [metadata, page, outline] = await Promise.all([
          pdf.getMetadata().catch(() => null),
          pdf.getPage(1),
          pdf.getOutline().catch(() => null),
        ])
        if (current !== generation.current) {
          void pdf.loadingTask.destroy()
          return
        }
        const info = metadata?.info as { Title?: string; Author?: string } | undefined
        const title = info?.Title?.trim()
        const viewport = page.getViewport({ scale: 1 })
        setPaper({
          pdf,
          filename: source.filename,
          title:
            source.title ||
            (title && title.toLowerCase() !== 'untitled'
              ? title
              : source.filename.replace(/\.pdf$/i, '')),
          author: info?.Author?.trim() || '',
          outline: outline ?? [],
          firstPageSize: { width: viewport.width, height: viewport.height },
        })
        pending.current = null
      } catch (cause) {
        if (current !== generation.current) return
        pending.current = null
        void task.destroy()
        setError(
          needsPassword
            ? 'This PDF needs a password. Please open an unlocked copy.'
            : 'This paper couldn’t be opened. Choose a valid PDF and try again.',
        )
        console.warn('Could not open PDF:', cause)
      } finally {
        if (current === generation.current) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void load({
      url: assetUrl('attention-is-all-you-need.pdf'),
      filename: 'attention-is-all-you-need.pdf',
      title: 'Attention Is All You Need',
    })
    return () => {
      generation.current++
      void pending.current?.destroy()
    }
  }, [load])

  useEffect(
    () => () => {
      void paper?.pdf.loadingTask.destroy()
    },
    [paper],
  )

  const openFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        setError('Choose a PDF file to start reading.')
        return
      }
      try {
        await load({ data: new Uint8Array(await file.arrayBuffer()), filename: file.name })
      } catch {
        setError('This file couldn’t be read. Please choose it again.')
      }
    },
    [load],
  )

  return { paper, loading, error, openFile, clearError: () => setError('') }
}
