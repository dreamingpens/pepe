import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { XMLParser } from 'fast-xml-parser'
import { arxivId } from './citations.mjs'

function privateAddress(ip) {
  return /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80|::ffff:)/i.test(
    ip,
  )
}
export async function checkedUrl(input) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Use a public HTTPS paper URL.')
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address)))
    throw new Error('Local network addresses are not paper sources.')
  return url
}
export async function fetchPublic(
  input,
  { signal, maxBytes = 100 * 1024 * 1024, text = false } = {},
) {
  let url = input
  for (let redirects = 0; redirects < 6; redirects++) {
    url = (await checkedUrl(url)).href
    const response = await fetch(url, {
      redirect: 'manual',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45_000)])
        : AbortSignal.timeout(45_000),
      headers: { 'User-Agent': 'Pepe-PaperReader/0.2 (local academic reader)' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location')
      await response.body?.cancel()
      if (!next) break
      url = new URL(next, url).href
      continue
    }
    if (!response.ok)
      throw new Error(`The paper source returned ${response.status}. Please try again later.`)
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel()
      throw new Error('This download is too large (100 MB limit).')
    }
    const chunks = []
    let length = 0
    for await (const chunk of response.body) {
      length += chunk.length
      if (length > maxBytes) {
        await response.body.cancel().catch(() => {})
        throw new Error('This download is too large.')
      }
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    return text ? bytes.toString('utf8') : bytes
  }
  throw new Error('The paper link redirected too many times.')
}

export function paperUrl(input) {
  const id = arxivId(input)
  if (id && /arxiv\.org|^\d{4}\.|^[a-z-]+\//i.test(input.trim()))
    return `https://arxiv.org/pdf/${id}`
  return input.trim()
}
export function validatePdf(bytes) {
  if (!Buffer.from(bytes).subarray(0, 1024).includes(Buffer.from('%PDF-')))
    throw new Error('The link returned a web page instead of a PDF. Use its direct PDF link.')
}
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
})
const cache = new Map()
let arxivQueue = Promise.resolve(),
  lastRequest = 0

export async function searchArxiv(query) {
  query = query.trim().slice(0, 500)
  if (!query) return []
  if (cache.has(query) && Date.now() - cache.get(query).time < 300_000)
    return cache.get(query).value
  const task = arxivQueue
    .catch(() => {})
    .then(async () => {
      const delay = Math.max(0, 3000 - (Date.now() - lastRequest))
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      lastRequest = Date.now()
      const id = arxivId(query)
      const url = new URL('https://export.arxiv.org/api/query')
      if (id && /^(?:https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(?:\d{4}\.|[a-z-]+\/)/i.test(query))
        url.searchParams.set('id_list', id)
      else
        url.searchParams.set(
          'search_query',
          query
            .split(/\s+/)
            .filter(Boolean)
            .map((word) => `all:"${word.replace(/["\\:]/g, '')}"`)
            .join(' AND '),
        )
      url.searchParams.set('max_results', '12')
      const data = parser.parse(await fetchPublic(url.href, { text: true, maxBytes: 2_000_000 }))
      const entries = data.feed?.entry
        ? Array.isArray(data.feed.entry)
          ? data.feed.entry
          : [data.feed.entry]
        : []
      const results = entries
        .filter((entry) => arxivId(entry.id))
        .map((entry) => {
          const authors = Array.isArray(entry.author) ? entry.author : [entry.author]
          const id = arxivId(entry.id)
          return {
            id,
            title: String(entry.title || '')
              .replace(/\s+/g, ' ')
              .trim(),
            authors: authors
              .map((author) => author?.name)
              .filter(Boolean)
              .join(', '),
            year: String(entry.published || '').slice(0, 4),
            abstract: String(entry.summary || '')
              .replace(/\s+/g, ' ')
              .trim(),
            url: `https://arxiv.org/abs/${id}`,
            pdfUrl: `https://arxiv.org/pdf/${id}`,
            source: 'arXiv',
          }
        })
      cache.set(query, { time: Date.now(), value: results })
      return results
    })
  arxivQueue = task
  return task
}

export async function searchPapers(query) {
  try {
    return await searchArxiv(query)
  } catch (error) {
    const fallback = await searchCrossref(query).catch(() => [])
    if (fallback.length) return fallback
    throw error
  }
}
async function searchCrossref(query) {
  const url = new URL('https://api.crossref.org/works')
  url.searchParams.set('query.bibliographic', query.slice(0, 700))
  url.searchParams.set('rows', '8')
  const data = JSON.parse(await fetchPublic(url.href, { text: true, maxBytes: 3_000_000 }))
  return (data.message?.items || []).map((work) => ({
    id: work.DOI,
    title: work.title?.[0] || '',
    authors: (work.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim()).join(', '),
    year: String(work.published?.['date-parts']?.[0]?.[0] || ''),
    abstract: String(work.abstract || '').replace(/<[^>]+>/g, ''),
    url: `https://doi.org/${work.DOI}`,
    pdfUrl: work.link?.find((link) => link['content-type'] === 'application/pdf')?.URL || '',
    source: 'Crossref',
  }))
}

export async function resolveReference(reference) {
  if (reference.arxiv)
    return [
      {
        id: reference.arxiv,
        title: reference.title,
        authors: '',
        year: reference.year,
        abstract: '',
        url: `https://arxiv.org/abs/${reference.arxiv}`,
        pdfUrl: `https://arxiv.org/pdf/${reference.arxiv}`,
        source: 'arXiv',
      },
    ]
  const query = reference.title || reference.text
  let results = await searchArxiv(query).catch(() => [])
  if (!results.length) results = await searchCrossref(reference.text || query)
  // The user sees candidates and chooses; a weak metadata match is never silently downloaded.
  return results
}
