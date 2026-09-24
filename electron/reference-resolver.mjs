import { readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { arxivId, referenceTitle } from './citations.mjs'
import { fetchPublic, searchArxiv } from './network.mjs'

const normalize = (value = '') =>
  String(value)
    .normalize('NFKD')
    .replace(/<[^>]+>|[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const doiOf = (value = '') =>
  String(value)
    .replace(/^https?:\/\/(?:dx\.)?doi.org\//i, '')
    .toLowerCase()
const fields = 'title,year,authors,externalIds,openAccessPdf,url'

export function directPdfUrl(input = '') {
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.protocol = 'https:'
    if (/(^|\.)arxiv.org$/.test(url.hostname) && arxivId(url.pathname))
      return `https://arxiv.org/pdf/${arxivId(url.pathname)}`
    if (url.hostname === 'doi.org' && /^\/10\.48550\/arxiv\./i.test(url.pathname))
      return `https://arxiv.org/pdf/${arxivId(url.pathname)}`
    if (url.hostname === 'doi.org' && url.pathname.startsWith('/10.18653/v1/'))
      return `https://aclanthology.org/${url.pathname.slice('/10.18653/v1/'.length)}.pdf`
    if (url.hostname === 'aclanthology.org' && /^\/[\w.-]+\/?$/.test(url.pathname))
      return url.href.replace(/\/$/, '').replace(/(?:\.pdf)?$/, '.pdf')
    if (url.hostname === 'openreview.net' && url.searchParams.has('id')) {
      url.pathname = '/pdf'
      return url.href
    }
    if (url.hostname === 'openaccess.thecvf.com' && url.pathname.includes('/html/'))
      return url.href.replace('/html/', '/papers/').replace(/\.html$/, '.pdf')
    if (url.hostname === 'proceedings.mlr.press' && /\.html$/.test(url.pathname)) {
      const stem = url.pathname
        .split('/')
        .at(-1)
        .replace(/\.html$/, '')
      return url.href.replace(/[^/]+\.html$/, `${stem}/${stem}.pdf`)
    }
    if (/\.pdf$/i.test(url.pathname) || /\/pdf\//.test(url.pathname)) return url.href
  } catch {
    /* Not a paper URL. */
  }
  return ''
}

function arxivResult(id, reference) {
  return {
    id,
    title: reference.title,
    authors: reference.authors || '',
    year: reference.year || '',
    abstract: '',
    url: `https://arxiv.org/abs/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    source: 'arXiv',
  }
}

export function matchReference(reference, candidates) {
  const target = normalize(reference.title)
  if (!target) return null
  const tokens = new Set(target.split(' '))
  const authorText = normalize(
    reference.surname || (reference.text || '').split(reference.title)[0],
  )
  const ranked = candidates
    .map((paper) => {
      const title = normalize(paper.title)
      const words = new Set(title.split(' '))
      const common = [...tokens].filter((token) => words.has(token)).length
      const similarity = (2 * common) / (tokens.size + words.size)
      const sameTitle = title.replaceAll(' ', '') === target.replaceAll(' ', '')
      const sameDoi = !!reference.doi && doiOf(paper.doi || paper.id) === doiOf(reference.doi)
      const authors = normalize(paper.authors)
        .split(' ')
        .filter((word) => word.length > 2)
      const authorMatch =
        !!authorText && authors.some((author) => authorText.split(' ').includes(author))
      const yearDiff = Math.abs(parseInt(paper.year) - parseInt(reference.year))
      const plausible =
        sameDoi ||
        (sameTitle && (authorMatch || !authorText || (!authors.length && tokens.size >= 4))) ||
        (similarity >= 0.9 && authorMatch && (!Number.isFinite(yearDiff) || yearDiff <= 2))
      return {
        paper,
        sameTitle,
        plausible,
        score:
          similarity + (sameDoi ? 1 : 0) + (authorMatch ? 0.15 : 0) + (yearDiff <= 1 ? 0.06 : 0),
      }
    })
    .filter((item) => item.plausible)
    .sort((a, b) => b.score - a.score || Number(!!b.paper.pdfUrl) - Number(!!a.paper.pdfUrl))
  const best = ranked[0]
  if (!best) return null
  if (
    !best.sameTitle &&
    ranked[1] &&
    best.score - ranked[1].score < 0.05 &&
    normalize(best.paper.title) !== normalize(ranked[1].paper.title)
  )
    return null
  return best.paper
}

function semanticPaper(work) {
  const id = work.externalIds?.ArXiv
  return {
    id: work.paperId || id || work.url,
    doi: work.externalIds?.DOI,
    title: work.title || '',
    authors: (work.authors || []).map((a) => a.name).join(', '),
    year: String(work.year || ''),
    abstract: '',
    url: id ? `https://arxiv.org/abs/${id}` : work.url,
    pdfUrl: id ? `https://arxiv.org/pdf/${id}` : work.openAccessPdf?.url || '',
    source: id ? 'arXiv' : 'Semantic Scholar',
  }
}
function crossrefPaper(work) {
  const url = work.resource?.primary?.URL || work.URL || `https://doi.org/${work.DOI}`
  return {
    id: work.DOI,
    doi: work.DOI,
    title: work.title?.[0] || '',
    authors: (work.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim()).join(', '),
    year: String(work.published?.['date-parts']?.[0]?.[0] || ''),
    abstract: '',
    url,
    pdfUrl:
      directPdfUrl(url) ||
      work.link?.find((link) => link['content-type'] === 'application/pdf')?.URL ||
      directPdfUrl(`https://doi.org/${work.DOI}`),
    source: 'Crossref',
  }
}
function openalexPaper(work) {
  const locations = [work.best_oa_location, ...(work.locations || [])].filter(Boolean)
  const pdfs = locations
    .map((location) => directPdfUrl(location.landing_page_url) || location.pdf_url)
    .filter(Boolean)
  return {
    id: work.id,
    doi: doiOf(work.doi),
    title: work.title || '',
    authors: (work.authorships || [])
      .map((a) => a.author?.display_name)
      .filter(Boolean)
      .join(', '),
    year: String(work.publication_year || ''),
    abstract: '',
    url: locations[0]?.landing_page_url || work.doi || work.id,
    pdfUrl: pdfs.find((pdf) => pdf.includes('arxiv.org/pdf/')) || pdfs[0] || '',
    source: 'OpenAlex',
  }
}

export class ReferenceResolver {
  constructor({
    cacheFile,
    fetcher = fetchPublic,
    arxivSearch = searchArxiv,
    timeoutMs = 7000,
  } = {}) {
    this.cacheFile = cacheFile
    this.fetcher = fetcher
    this.arxivSearch = arxivSearch
    this.timeoutMs = timeoutMs
    this.cache = new Map()
    this.pending = new Map()
    this.cooldowns = new Map()
    this.semanticQueue = Promise.resolve()
    this.lastSemanticRequest = 0
    this.writeQueue = Promise.resolve()
    this.ready = cacheFile
      ? readFile(cacheFile, 'utf8')
          .then((text) => {
            const saved = JSON.parse(text)
            if (saved.version === 1)
              for (const [key, entry] of saved.entries || [])
                if (entry.expires > Date.now()) this.cache.set(key, entry)
          })
          .catch(() => {})
      : Promise.resolve()
  }
  async json(source, url, signal) {
    if ((this.cooldowns.get(source) || 0) > Date.now()) throw new Error('Source cooling down')
    if (source === 'semantic') {
      const wait = this.semanticQueue
        .catch(() => {})
        .then(async () => {
          const delay = Math.max(0, 1100 - (Date.now() - this.lastSemanticRequest))
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
          signal.throwIfAborted()
          this.lastSemanticRequest = Date.now()
        })
      this.semanticQueue = wait
      await wait
    }
    signal.throwIfAborted()
    try {
      return JSON.parse(await this.fetcher(url, { text: true, maxBytes: 3_000_000, signal }))
    } catch (error) {
      if (error.status === 429) this.cooldowns.set(source, Date.now() + 60_000)
      throw error
    }
  }
  async pdf(paper, signal) {
    if (paper.pdfUrl) {
      try {
        const url = new URL(paper.pdfUrl)
        if (['http:', 'https:'].includes(url.protocol)) {
          url.protocol = 'https:'
          return { ...paper, pdfUrl: url.href }
        }
      } catch {
        /* Ignore malformed source URLs. */
      }
      paper = { ...paper, pdfUrl: '' }
    }
    const direct = directPdfUrl(paper.url) || directPdfUrl(`https://doi.org/${paper.doi || ''}`)
    if (direct) return { ...paper, pdfUrl: direct }
    if (!paper.url) return paper
    // The article identity has already been matched; only inspect its own landing page.
    try {
      const html = await this.fetcher(paper.url, { text: true, maxBytes: 2_000_000, signal })
      for (const tag of html.matchAll(/<meta\b[^>]+>/gi)) {
        const attributes = Object.fromEntries(
          [...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [
            match[1].toLowerCase(),
            match[2],
          ]),
        )
        if (attributes.name?.toLowerCase() === 'citation_pdf_url' && attributes.content) {
          const url = new URL(attributes.content.replace(/&amp;/g, '&'), paper.url)
          if (['https:', 'http:'].includes(url.protocol)) {
            url.protocol = 'https:'
            return { ...paper, pdfUrl: url.href }
          }
        }
      }
    } catch {
      /* Other indexes may have an open copy. */
    }
    return paper
  }
  async search(reference) {
    const controller = new AbortController()
    const signal = controller.signal
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const matches = []
    let successful = 0
    const semantic = async () => {
      const url = reference.doi
        ? `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(reference.doi)}?${new URLSearchParams({ fields })}`
        : `https://api.semanticscholar.org/graph/v1/paper/search/match?${new URLSearchParams({ query: reference.title, fields })}`
      const data = await this.json('semantic', url, signal)
      return (reference.doi ? [data] : data.data || []).map(semanticPaper)
    }
    const crossref = async () => {
      const url = reference.doi
        ? `https://api.crossref.org/works/${encodeURIComponent(reference.doi)}`
        : `https://api.crossref.org/works?${new URLSearchParams({ 'query.bibliographic': (reference.text || reference.title).slice(0, 700), rows: '8' })}`
      const data = await this.json('crossref', url, signal)
      return (reference.doi ? [data.message] : data.message?.items || [])
        .filter(Boolean)
        .map(crossrefPaper)
    }
    const openalex = async () => {
      const url = reference.doi
        ? `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(reference.doi)}`
        : `https://api.openalex.org/works?${new URLSearchParams({ search: reference.title, per_page: '5', select: 'id,doi,title,publication_year,authorships,best_oa_location,locations' })}`
      const data = await this.json('openalex', url, signal)
      return (reference.doi ? [data] : data.results || []).map(openalexPaper)
    }
    const fallback = () => matchReference(reference, matches)
    const attempts = [
      semantic,
      crossref,
      openalex,
      () => this.arxivSearch(reference.title, { signal, titleOnly: true }),
    ].map(async (source) => {
      const candidates = await source()
      successful++
      const match = matchReference(reference, candidates)
      if (!match) throw new Error('No confident match')
      matches.push(match)
      const paper = await this.pdf(match, signal)
      if (paper.pdfUrl) return paper
      throw new Error('No public PDF')
    })
    try {
      return await Promise.race([
        Promise.any(attempts).catch(() => {
          if (!successful) throw new Error('Paper search is temporarily unavailable. Please retry.')
          return fallback()
        }),
        new Promise((resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              if (successful) resolve(fallback())
              else reject(new Error('Paper search timed out. Please retry.'))
            },
            { once: true },
          ),
        ),
      ])
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
  async resolve(input, { refresh = false } = {}) {
    const reference = { ...input, title: input.text ? referenceTitle(input.text) : input.title }
    const urls = [...(input.urls || []), ...(input.text?.match(/https?:\/\/[^\s<>]+/g) || [])]
    const id =
      input.arxiv ||
      arxivId(input.text || '') ||
      urls
        .filter((url) => /arxiv.org|10\.48550\/arxiv/i.test(url))
        .map(arxivId)
        .find(Boolean)
    if (id) return arxivResult(id, reference)
    const direct =
      urls.map(directPdfUrl).find(Boolean) ||
      (input.doi && directPdfUrl(`https://doi.org/${input.doi}`))
    if (direct)
      return {
        id: direct,
        title: reference.title,
        authors: '',
        year: reference.year || '',
        abstract: '',
        url: urls[0] || direct,
        pdfUrl: direct,
        source: 'Reference link',
      }
    await this.ready
    const key = createHash('sha256')
      .update(
        JSON.stringify([normalize(reference.title), normalize(reference.text), reference.doi]),
      )
      .digest('hex')
    const cached = this.cache.get(key)
    if (!refresh && cached?.expires > Date.now()) return cached.paper
    if (this.pending.has(key)) return this.pending.get(key)
    const task = this.search(reference)
      .then((paper) => {
        if (paper?.pdfUrl) {
          this.cache.set(key, { paper, expires: Date.now() + 86400_000 })
          if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value)
          if (this.cacheFile) {
            const text = JSON.stringify({ version: 1, entries: [...this.cache] })
            this.writeQueue = this.writeQueue
              .catch(() => {})
              .then(async () => {
                await writeFile(this.cacheFile + '.tmp', text)
                await rename(this.cacheFile + '.tmp', this.cacheFile)
              })
            void this.writeQueue.catch(() => {})
          }
        }
        return paper
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }
  async close() {
    await this.writeQueue.catch(() => {})
  }
}
