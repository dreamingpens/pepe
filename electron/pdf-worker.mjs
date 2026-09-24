import { parentPort } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { enrichIndex } from './citations.mjs'

const require = createRequire(import.meta.url)
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'))

export async function loadPdf(path) {
  const task = getDocument({
    data: new Uint8Array(await readFile(path)),
    useSystemFonts: false,
    standardFontDataUrl: join(pdfRoot, 'standard_fonts/'),
    cMapUrl: join(pdfRoot, 'cmaps/'),
    cMapPacked: true,
    wasmUrl: join(pdfRoot, 'wasm/'),
  })
  task.onPassword = () => void task.destroy()
  return { task, pdf: await task.promise }
}

export async function indexPdf(path) {
  const start = performance.now()
  const { pdf, task } = await loadPdf(path)
  try {
    const metadata = await pdf.getMetadata().catch(() => ({ info: {} }))
    const pages = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number),
        view = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const lines = []
      let line = null
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const [x, y] = view.convertToViewportPoint(item.transform[4], item.transform[5])
        const height = Math.max(item.height, Math.abs(item.transform[3]), 4)
        const box = {
          x: x / view.width,
          y: (y - height) / view.height,
          width: item.width / view.width,
          height: height / view.height,
        }
        if (
          !line ||
          Math.abs(line.y - box.y) > 0.006 ||
          box.x < line.x - 0.02 ||
          box.x > line.x + line.width + 0.12
        ) {
          line = { id: `p${number}-l${lines.length + 1}`, text: item.str, ...box }
          lines.push(line)
        } else {
          line.text += `${item.str.startsWith(' ') || line.text.endsWith(' ') ? '' : ' '}${item.str}`
          line.width = Math.max(line.width, box.x + box.width - line.x)
          line.height = Math.max(line.height, box.height)
        }
        if (item.hasEOL) line = null
      }
      const links = []
      for (const annotation of await page.getAnnotations()) {
        if (annotation.subtype !== 'Link') continue
        const rect = [
          ...view.convertToViewportPoint(annotation.rect[0], annotation.rect[1]),
          ...view.convertToViewportPoint(annotation.rect[2], annotation.rect[3]),
        ]
        let target = null
        try {
          const destination =
            typeof annotation.dest === 'string'
              ? await pdf.getDestination(annotation.dest)
              : annotation.dest
          if (destination)
            target = {
              page:
                (typeof destination[0] === 'number'
                  ? destination[0]
                  : await pdf.getPageIndex(destination[0])) + 1,
              pdfY: destination[3],
            }
        } catch {
          /* Broken destinations are left as text-only references. */
        }
        links.push({
          x: Math.min(rect[0], rect[2]) / view.width,
          y: Math.min(rect[1], rect[3]) / view.height,
          width: Math.abs(rect[2] - rect[0]) / view.width,
          height: Math.abs(rect[3] - rect[1]) / view.height,
          target,
          dest: typeof annotation.dest === 'string' ? annotation.dest : '',
          url: annotation.url || '',
        })
      }
      pages.push({ number, width: view.width, height: view.height, lines, links })
      page.cleanup()
    }
    const first = pages[0]?.lines || []
    const candidates = first.filter(
      (l) =>
        l.y > 0.045 &&
        l.y < 0.4 &&
        l.text.length > 10 &&
        !/arxiv|preprint|conference|published|under review/i.test(l.text),
    )
    const largest = Math.max(...candidates.map((l) => l.height))
    const titleLines = candidates.filter((l) => l.height >= largest * 0.9)
    const inferredTitle = titleLines.map((l) => l.text).join(' ')
    const titleEnd = Math.max(...titleLines.map((l) => l.y + l.height))
    const abstractY =
      first.find((l) => /^abstract$/i.test(l.text.trim()))?.y || Math.min(0.45, titleEnd + 0.18)
    const inferredAuthors = first
      .filter(
        (l) =>
          l.y > titleEnd &&
          l.y < abstractY &&
          !/@|university|institute|department|google|research|openai|microsoft|laboratory|correspondence|equal contribution|^\d+$/i.test(
            l.text,
          ),
      )
      .map((l) => l.text)
      .join(', ')
      .slice(0, 1500)
    return enrichIndex({
      version: 2,
      title: metadata.info.Title?.trim() || inferredTitle,
      author: metadata.info.Author?.trim() || inferredAuthors,
      pages,
      elapsedMs: performance.now() - start,
    })
  } finally {
    await task.destroy()
  }
}

export async function renderPage(path, number) {
  const { pdf, task } = await loadPdf(path)
  try {
    const page = await pdf.getPage(number)
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(2.5, 1800 / natural.width) })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
    return canvas.toBuffer('image/png')
  } finally {
    await task.destroy()
  }
}

parentPort?.on('message', async ({ id, operation, path, page }) => {
  try {
    parentPort.postMessage({
      id,
      result: operation === 'render' ? await renderPage(path, page) : await indexPdf(path),
    })
  } catch (error) {
    parentPort.postMessage({ id, error: error.message })
  }
})
