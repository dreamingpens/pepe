import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ReferenceResolver,
  directPdfUrl,
  matchReference,
} from '../../electron/reference-resolver.mjs'
import { extractReferences } from '../../electron/citations.mjs'
import { searchArxiv } from '../../electron/network.mjs'

const reference = {
  title: 'A simple framework for contrastive learning of visual representations',
  text: 'Ting Chen, Simon Kornblith, Mohammad Norouzi, and Geoffrey Hinton. A simple framework for contrastive learning of visual representations. In ICML, 2020a.',
  surname: 'chen',
  year: '2020a',
}
const semantic = {
  paperId: 'simclr',
  title: reference.title,
  year: 2020,
  authors: [{ name: 'Ting Chen' }],
  externalIds: { ArXiv: '2002.05709' },
}
const stalled = (signal) =>
  new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'))
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })

test('explicit reference identifiers and publisher PDF links resolve without a search', async () => {
  const resolver = new ReferenceResolver({
    fetcher: () => {
      throw new Error('Must not search')
    },
    arxivSearch: () => {
      throw new Error('Must not search')
    },
  })
  assert.equal(
    (await resolver.resolve({ ...reference, arxiv: '2002.05709' })).pdfUrl,
    'https://arxiv.org/pdf/2002.05709',
  )
  assert.equal(
    (await resolver.resolve({ ...reference, doi: '10.18653/v1/2020.acl-main.385' })).pdfUrl,
    'https://aclanthology.org/2020.acl-main.385.pdf',
  )
  assert.equal(
    (await resolver.resolve({ ...reference, urls: ['https://openreview.net/forum?id=example'] }))
      .pdfUrl,
    'https://openreview.net/pdf?id=example',
  )
  assert.equal(
    directPdfUrl('https://proceedings.mlr.press/v119/chen20j.html'),
    'https://proceedings.mlr.press/v119/chen20j/chen20j.pdf',
  )
  assert.equal(directPdfUrl('file:///etc/passwd'), '')
})

test('parallel resolution returns one confident paper without waiting for stalled indexes', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'pepe-resolver-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const calls = []
  const cacheFile = join(base, 'matches.json')
  const resolver = new ReferenceResolver({
    cacheFile,
    fetcher: async (url, { signal }) => {
      calls.push(new URL(url).hostname)
      if (url.includes('semanticscholar')) return JSON.stringify({ data: [semantic] })
      return stalled(signal)
    },
    arxivSearch: async (_, { signal }) => {
      calls.push('arxiv')
      return stalled(signal)
    },
  })
  const [a, b] = await Promise.all([resolver.resolve(reference), resolver.resolve(reference)])
  assert.equal(a.pdfUrl, 'https://arxiv.org/pdf/2002.05709')
  assert.equal(a.id, b.id)
  assert.equal(Array.isArray(a), false)
  assert.equal(calls.length, 4)
  await resolver.resolve(reference)
  assert.equal(calls.length, 4, 'Repeated clicks use the cache')
  await resolver.close()
  const restarted = new ReferenceResolver({
    cacheFile,
    fetcher: () => {
      throw new Error('Cache should survive restart')
    },
  })
  assert.equal((await restarted.resolve(reference)).id, a.id)
  await restarted.close()
})

test('matching rejects similar papers and uses authors to disambiguate identical titles', () => {
  const correct = {
    id: 'correct',
    title: reference.title,
    authors: 'Ting Chen',
    year: '2020',
    pdfUrl: 'https://example.org/correct.pdf',
  }
  const wrong = { ...correct, id: 'wrong', authors: 'Another Researcher' }
  assert.equal(matchReference(reference, [wrong, correct]).id, 'correct')
  assert.equal(matchReference(reference, [wrong]), null)
  assert.equal(
    matchReference(reference, [
      { ...correct, title: 'A framework for collaborative filtering with graph representations' },
    ]),
    null,
  )
  assert.equal(
    matchReference({ ...reference, title: 'Selfsupervised learning' }, [
      { ...correct, title: 'Self-supervised learning' },
    ]).id,
    'correct',
  )
})

test('DOI metadata is looked up directly and the article page supplies a PDF', async () => {
  const calls = []
  const resolver = new ReferenceResolver({
    fetcher: async (url) => {
      calls.push(url)
      if (url.includes('api.crossref.org/works/'))
        return JSON.stringify({
          message: {
            DOI: '10.1234/example',
            title: [reference.title],
            author: [{ given: 'Ting', family: 'Chen' }],
            resource: { primary: { URL: 'https://publisher.example/article' } },
          },
        })
      if (url === 'https://publisher.example/article')
        return '<meta content="/paper.pdf" name="citation_pdf_url">'
      throw new Error('Source unavailable')
    },
    arxivSearch: async () => [],
  })
  const result = await resolver.resolve({ ...reference, doi: '10.1234/example' })
  assert.equal(result.pdfUrl, 'https://publisher.example/paper.pdf')
  assert.ok(calls.includes('https://api.crossref.org/works/10.1234%2Fexample'))
  assert.ok(!calls.some((url) => url.includes('query.bibliographic')))
})

test('failed lookups can retry and rate-limited providers do not block alternatives', async () => {
  let semanticCalls = 0
  const resolver = new ReferenceResolver({
    fetcher: async (url) => {
      if (url.includes('semanticscholar')) {
        semanticCalls++
        throw Object.assign(new Error('rate limit'), { status: 429 })
      }
      if (url.includes('crossref')) return JSON.stringify({ message: { items: [] } })
      return JSON.stringify({ results: [] })
    },
    arxivSearch: async () => [],
  })
  assert.equal(await resolver.resolve(reference), null)
  assert.equal(await resolver.resolve(reference), null)
  assert.equal(semanticCalls, 1)
  resolver.arxivSearch = async () => [
    {
      id: '2002.05709',
      title: reference.title,
      authors: 'Ting Chen',
      year: '2020',
      pdfUrl: 'https://arxiv.org/pdf/2002.05709',
    },
  ]
  assert.equal((await resolver.resolve(reference)).id, '2002.05709')
})

test('citation lookup has an overall deadline even when a provider ignores cancellation', async () => {
  const resolver = new ReferenceResolver({
    timeoutMs: 50,
    fetcher: () => new Promise(() => {}),
    arxivSearch: () => new Promise(() => {}),
  })
  await assert.rejects(resolver.resolve(reference), /timed out/)
  assert.equal(resolver.pending.size, 0)
})

test('bibliography extraction separates middle initials and captures embedded article links', () => {
  const texts = [
    'References',
    'Samuel R. Bowman, Gabor Angeli. 2015. A large annotated corpus.',
    'Peter F Brown, Peter V Desouza. 1992. Class-based n-gram models.',
    'Ting Chen, Simon Kornblith. 2020. A simple framework for contrastive learning.',
  ]
  const page = {
    number: 20,
    lines: texts.map((text, i) => ({
      text,
      id: `p20-l${i + 1}`,
      x: 0.1,
      y: 0.1 + i * 0.05,
      width: 0.7,
      height: 0.02,
    })),
    links: [{ url: 'https://arxiv.org/abs/2002.05709', x: 0.2, y: 0.25, width: 0.4, height: 0.02 }],
  }
  const refs = extractReferences([page])
  assert.equal(refs.length, 3)
  assert.equal(refs[0].year, '2015')
  assert.equal(refs[1].surname, 'brown')
  assert.equal(refs[2].arxiv, '2002.05709')
  assert.deepEqual(refs[2].urls, ['https://arxiv.org/abs/2002.05709'])
  assert.deepEqual(refs[0].urls, [])
})

test('arXiv title searches ignore unindexed stop words and split hyphenated terms', async () => {
  const papers = await searchArxiv('Emerging properties in self-supervised vision transformers', {
    titleOnly: true,
    fetcher: async (input) => {
      const query = new URL(input).searchParams.get('search_query')
      assert.ok(!query.includes('ti:"in"'))
      assert.ok(query.includes('ti:"self" AND ti:"supervised"'))
      return '<feed><entry><id>http://arxiv.org/abs/2104.14294v2</id><title>Emerging Properties in Self-Supervised Vision Transformers</title><author><name>Mathilde Caron</name></author><published>2021-04-29</published></entry></feed>'
    },
  })
  assert.equal(papers[0].pdfUrl, 'https://arxiv.org/pdf/2104.14294v2')
  assert.equal(papers[0].authors, 'Mathilde Caron')
})
