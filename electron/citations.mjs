const markerPattern = /^(?:\[([\p{L}\d+ −–-]{1,24})\]|(\d{1,3})[.)])\s+(.+)/u
const authorPattern =
  /^(?:[\p{Lu}]\.\s*[\p{Lu}][\p{L}'’-]+|[\p{Lu}][\p{Ll}'’-]+\.\s|[\p{Lu}][\p{L}'’´-]+(?:,\s*[\p{Lu}]|\s+[\p{Lu}](?:\.|(?=\s)|[\p{L}'’-]+)|\s+et al\.))/u
export const CITATION_INDEX_VERSION = 3
const years = /(?<![\d/])(?:19|20)\d{2}[a-z]?(?!\d|\.\d)/g
const normalizedKey = (value) => value.replace(/\s+/g, '').toLowerCase()
const isHeading = (text) =>
  /^(?:\d+)?(?:references|bibliography|literaturecited)$/i.test(text.replace(/\s+/g, ''))
const isSection = (text) =>
  /^(?:\d+)?(?:appendix|appendices|supplementary)/i.test(text.replace(/\s+/g, '')) ||
  (!text.includes(',') &&
    text.length < 100 &&
    /^[A-Z](?:\.\d+)?[.\s]\s*[A-Z][A-Za-z\s-]{4,}$/.test(text))

export function arxivId(value = '') {
  return (
    value
      .replace(/(\d{4})\.\s+(\d{4,5})/g, '$1.$2')
      .match(
        /(?:arxiv[:\s/]+|abs\/|pdf\/)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i,
      )?.[1] || null
  )
}

export function referenceTitle(text) {
  const cleaned = text.replace(markerPattern, '$3').replace(/\s+/g, ' ')
  const quoted = cleaned.match(/[“"]([^”"]{15,})[”"]/)?.[1]
  if (quoted) return quoted
  // Initials are not sentence boundaries. A year immediately after the authors is common in ACL papers.
  const sentences = cleaned.split(/(?<!\b[A-Z])\.\s+(?=[A-Z\d])/).filter((part) => part.trim())
  let title = sentences
    .slice(1)
    .find(
      (part) =>
        part.length > 12 && !/^(?:In |Proceedings|arXiv|https?:|CoRR|\d{4}[a-z]?$)/.test(part),
    )
  if (!title) title = sentences[0] || cleaned
  return title
    .split(/\.\s+(?:arXiv|https?:|CoRR)/i)[0]
    .replace(/^(?:19|20)\d{2}[a-z]?\.\s*/, '')
    .replace(/,\s*(?:19|20)\d{2}[a-z]?\.?$/, '')
    .replace(/\s+arxiv\s*[,.:]?\s*$/i, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 300)
}

export function extractReferences(pages) {
  const references = []
  let active = false,
    current = null,
    style = null
  const flush = () => {
    if (!current) return
    if (current.text.length >= 15) {
      current.text = current.text
        .replace(/-\s+(?=[a-z])/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const body = current.text.replace(markerPattern, '$3')
      current.year = [...body.matchAll(years)].at(-1)?.[0] || ''
      current.arxiv = arxivId(body)
      current.doi = body.match(/10\.\d{4,9}\/[^\s]+/)?.[0]?.replace(/[.,;)]+$/, '') || null
      current.urls = [...new Set([...current.urls, ...(body.match(/https?:\/\/[^\s<>]+/g) || [])])]
      current.arxiv ||=
        current.urls
          .filter((url) => /arxiv.org|10\.48550\/arxiv/i.test(url))
          .map(arxivId)
          .find(Boolean) || null
      current.doi ||=
        current.urls.map((url) => url.match(/10\.\d{4,9}\/[^\s]+/)?.[0]).find(Boolean) || null
      current.title = referenceTitle(current.text)
      const firstAuthor = body.split(/,|\s+and\s+|\s+et al\./)[0]
      current.surname =
        firstAuthor
          .match(/[\p{L}'’-]{2,}/gu)
          ?.at(-1)
          ?.toLowerCase() || ''
      current.key ||= `${current.surname}${current.year}`
      current.id = `ref-${references.length + 1}`
      references.push(current)
    }
    current = null
  }
  for (const page of pages) {
    const lines = page.lines
    const margins = [0, 1].map((column) =>
      Math.min(
        ...lines
          .filter(
            (l) =>
              l.y > 0.065 && l.y < 0.93 && l.text.length > 8 && (l.x < 0.45 ? 0 : 1) === column,
          )
          .map((l) => l.x),
      ),
    )
    // Floats sometimes precede an appendix heading in PDF reading order.
    const section = lines.findIndex((l) => isSection(l.text.trim()))
    if (
      active &&
      section >= 0 &&
      !lines
        .slice(0, section)
        .some((l) =>
          style === 'author'
            ? authorPattern.test(l.text) && Math.abs(l.x - margins[l.x < 0.45 ? 0 : 1]) < 0.006
            : markerPattern.test(l.text),
        )
    ) {
      flush()
      active = false
    }
    for (const line of lines) {
      const text = line.text.trim()
      if (isHeading(text)) {
        active = true
        continue
      }
      if (!active) continue
      if (
        references.length >= 3 &&
        isSection(text) &&
        (/^(?:\d+\s*)?(?:A\s*PPENDIX|Appendix|Supplementary)/i.test(text) ||
          Math.abs(line.x - margins[line.x < 0.45 ? 0 : 1]) < 0.008)
      ) {
        active = false
        flush()
        break
      }
      if (
        /^\d{1,3}$/.test(text) ||
        !text ||
        line.y < 0.065 ||
        line.y > 0.94 ||
        /^(?:Published as|Under review|Preprint\b)/.test(text)
      )
        continue
      const marker = text.match(markerPattern)
      const atMargin = Math.abs(line.x - margins[line.x < 0.45 ? 0 : 1]) < 0.006
      const authorStart = authorPattern.test(text) && atMargin
      if (!style && (marker || authorStart))
        style = marker ? (marker[1] ? 'bracket' : 'number') : 'author'
      const starts =
        style === 'bracket' ? marker?.[1] : style === 'number' ? marker?.[2] : authorStart
      if (starts) {
        flush()
        const key = marker ? normalizedKey(marker[1] || marker[2]) : ''
        current = {
          number: /^\d+$/.test(key) ? Number(key) : null,
          key,
          text,
          page: page.number,
          line: line.id,
          y: line.y,
          urls: [],
        }
      } else if (current) current.text += ' ' + text
      if (current) {
        for (const link of page.links || [])
          if (
            link.url &&
            link.y < line.y + line.height + 0.004 &&
            link.y + link.height > line.y - 0.004 &&
            link.x < line.x + line.width + 0.01 &&
            link.x + link.width > line.x - 0.01
          )
            current.urls.push(link.url)
      }
    }
  }
  flush()
  return references
}

export function citationMatches(text, references) {
  const matches = []
  const byNumber = new Map(references.filter((r) => r.number).map((r) => [r.number, r]))
  const byKey = new Map(references.map((r) => [normalizedKey(r.key), r]))
  for (const match of text.matchAll(/\[\s*([^\[\]]{1,100})\s*\]/g)) {
    const found = []
    for (const part of match[1].split(/[,;]/)) {
      const key = normalizedKey(part)
      if (byKey.has(key)) found.push(byKey.get(key))
      else if (/^\d+[–—-]\d+$/.test(key)) {
        const [start, end] = key.split(/[–—-]/).map(Number)
        if (end - start < 50)
          for (let n = start; n <= end; n++) if (byNumber.has(n)) found.push(byNumber.get(n))
      }
    }
    if (found.length)
      matches.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        referenceIds: [...new Set(found.map((r) => r.id))],
      })
  }
  for (const match of text.matchAll(
    /(?:\b[\p{Lu}][\p{L}'’-]+(?:\s+(?:et\s+al\.?|and\s+[\p{Lu}][\p{L}'’-]+|&\s*[\p{Lu}][\p{L}'’-]+))?\s*[,([]?\s*(?:19|20)\d{2}[a-z]?\)?)/gu,
  )) {
    const surname = match[0].match(/[\p{L}'’-]+/u)?.[0]?.toLowerCase()
    const year = match[0].match(/(?:19|20)\d{2}[a-z]?/)?.[0]
    const found = references.filter((r) => r.year === year && r.surname === surname)
    if (found.length)
      matches.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        referenceIds: found.map((r) => r.id),
      })
  }
  return matches
}

export function enrichIndex(index) {
  index.references = extractReferences(index.pages)
  for (const page of index.pages) {
    for (const line of page.lines) line.citations = citationMatches(line.text, index.references)
    page.visuals = []
    for (let i = 0; i < page.lines.length; i++) {
      const line = page.lines[i]
      const figure = line.text.match(/^(?:Figure|Fig\.|Table)\s*\d+[.:]/i)
      const nearby = page.lines.filter((other) => Math.abs(other.y - line.y) < 0.027)
      const equation =
        /^\(\d+[a-z]?\)$/.test(line.text.trim()) &&
        line.x > 0.65 &&
        /[=∑∫√≈≠≤≥⊕∈]|softmax|exp\(/.test(nearby.map((l) => l.text).join(' '))
      if (figure || equation) {
        const table = /^Table/i.test(figure?.[0] || '')
        const x = figure
          ? line.x < 0.4
            ? Math.max(0.02, line.x - 0.02)
            : 0.49
          : Math.max(0.03, Math.min(...nearby.map((l) => l.x)) - 0.02)
        const width = figure
          ? Math.min(1 - x - 0.03, Math.max(0.4, line.width))
          : Math.min(0.94 - x, line.x + line.width - x)
        page.visuals.push({
          id: line.id,
          kind: figure ? 'figure' : 'formula',
          label: figure?.[0] || `Equation ${line.text.trim()}`,
          page: page.number,
          y: figure
            ? Math.max(0.03, line.y - (table ? 0.015 : 0.3))
            : Math.max(0.02, line.y - 0.035),
          x,
          width,
          height: figure ? 0.35 : 0.08,
          line: line.id,
          text: page.lines
            .slice(Math.max(0, i - 8), i + 4)
            .map((l) => l.text)
            .join(' '),
        })
      }
    }
  }
  return index
}
