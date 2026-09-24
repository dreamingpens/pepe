import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { PaperRecord } from './types'

export type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number]
export type Paper = {
  pdf: PDFDocumentProxy
  title: string
  filename: string
  author: string
  outline: OutlineItem[]
  firstPageSize: { width: number; height: number }
  record?: PaperRecord
}

function assetUrl(path: string) {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
}

export function usePaper() {
  const [paper, setPaper] = useState<Paper | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<PDFDocumentLoadingTask | null>(null)
  const generation = useRef(0)

  const load = useCallback(
    async (source: {
      data?: Uint8Array
      url?: string
      filename: string
      title?: string
      record?: PaperRecord
    }) => {
      const current = ++generation.current
      void pending.current?.destroy()
      setLoading(true)
      setError('')
      let needsPassword = false
      const { getDocument } = await import('./pdf')
      if (current !== generation.current) return
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
        const page = await pdf.getPage(1)
        if (current !== generation.current) {
          void pdf.loadingTask.destroy()
          return
        }
        const viewport = page.getViewport({ scale: 1 })
        setPaper({
          pdf,
          filename: source.filename,
          title: source.title || source.filename.replace(/\.pdf$/i, ''),
          author: source.record?.author || '',
          record: source.record,
          outline: [],
          firstPageSize: { width: viewport.width, height: viewport.height },
        })
        pending.current = null
        // Optional metadata never delays the first visible page.
        void pdf
          .getOutline()
          .then((outline) => {
            if (current === generation.current)
              setPaper((paper) =>
                paper?.pdf === pdf ? { ...paper, outline: outline || [] } : paper,
              )
          })
          .catch(() => {})
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
    if (new URLSearchParams(location.search).has('sample'))
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
    [paper?.pdf],
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

  const openRecord = useCallback(
    (record: PaperRecord) =>
      load({ url: record.url, filename: record.filename, title: record.title, record }),
    [load],
  )
  const openSample = useCallback(
    () =>
      load({
        url: assetUrl('attention-is-all-you-need.pdf'),
        filename: 'attention-is-all-you-need.pdf',
        title: 'Attention Is All You Need',
      }),
    [load],
  )
  const close = useCallback(() => {
    generation.current++
    void pending.current?.destroy()
    pending.current = null
    setPaper(null)
    setLoading(false)
  }, [])
  return {
    paper,
    loading,
    error,
    openFile,
    openRecord,
    openSample,
    close,
    clearError: () => setError(''),
  }
}
