import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  readdir,
  mkdir,
  copyFile,
  symlink,
  stat,
  utimes,
  rm,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { Library } from '../../electron/library.mjs'
import { Codex } from '../../electron/codex.mjs'
import { Research, answerSources, paperContext } from '../../electron/research.mjs'
import {
  extractReferences,
  citationMatches,
  arxivId,
  referenceTitle,
} from '../../electron/citations.mjs'
import { checkedUrl, paperUrl, validatePdf } from '../../electron/network.mjs'

const sample = resolve('public/attention-is-all-you-need.pdf')
const settings = { model: 'gpt-6-astra', effort: 'medium', verbosity: 'medium', fast: true }
const fixturePage = (number, items) => ({
  number,
  lines: items.map(([text, x = 0.176, y], i) => ({
    text,
    x,
    y: y ?? 0.1 + i * 0.023,
    id: `p${number}-l${i + 1}`,
    width: 0.6,
    height: 0.014,
  })),
})

async function libraryFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'pepe-backend-'))
  const library = await new Library(join(base, 'data'), join(base, 'papers')).init()
  t.after(async () => {
    await library.close()
    await rm(base, { recursive: true, force: true })
  })
  return { base, library }
}
function finished(events, chatId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      events.off('event', handle)
      reject(new Error('Answer timed out'))
    }, 10_000)
    const handle = (event) => {
      if (event.type === 'answer' && event.chatId === chatId && event.status !== 'streaming') {
        clearTimeout(timer)
        events.off('event', handle)
        resolve(event)
      }
    }
    events.on('event', handle)
  })
}

test('citation formats preserve hanging indents, initials, ranges, and bibliography keys', () => {
  const numeric = extractReferences([
    fixturePage(1, [
      ['R EFERENCES'],
      ['[1] J. Smith. A detailed paper title. 2020.'],
      ['[2] T. Brown. Another detailed paper title. 2021.'],
      ['[3] A. Lee. Third paper title. 2022.'],
    ]),
  ])
  assert.equal(numeric.length, 3)
  assert.deepEqual(
    citationMatches('See [ 1–3 ] and [2, 3].', numeric).map((m) => m.referenceIds.length),
    [3, 2],
  )
  assert.equal(numeric[0].title, 'A detailed paper title')
  const keyed = extractReferences([
    fixturePage(1, [
      ['References'],
      ['[ADG + 16] Marcin Andrychowicz, Misha Denil. Learning to learn. 2016.'],
      ['23. This is a continuation, not a new reference.', 0.21],
      ['[ABC20] Alex Brown. Another long title. 2020.'],
    ]),
  ])
  assert.equal(keyed.length, 2)
  assert.equal(citationMatches('As [ADG+16, ABC20] show.', keyed)[0].referenceIds.length, 2)
  const authors = extractReferences([
    fixturePage(1, [
      ['R EFERENCES'],
      ['Alan Akbik, Duncan Blythe, and Roland Vollgraf.'],
      ['2018. Contextual string embeddings for sequence labeling.', 0.193],
      ['M. Nilsback and A. Zisserman. Automated flower classification. 2008.'],
      ['Armen Aghajanyan, Luke Zettlemoyer. Intrinsic dimensionality.'],
      ['arXiv:2012.13255, December 2020.', 0.193],
      ['Jimmy Lei Ba, Jamie Ryan Kiros. Layer normalization. 2016.'],
      ['Appendix for this paper', 0.25],
      ['This text is not part of a reference.', 0.176],
    ]),
  ])
  assert.equal(authors.length, 4)
  assert.equal(authors[2].year, '2020')
  assert.equal(authors[2].arxiv, '2012.13255')
  assert.equal(
    citationMatches('Akbik et al. (2018), Nilsback & Zisserman (2008)', authors).length,
    2,
  )
  assert.ok(!authors.at(-1).text.includes('Appendix'))
  assert.equal(arxivId('http://arxiv.org/abs/1811. 03962'), '1811.03962')
  assert.equal(
    referenceTitle(
      '[1] Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. Layer normalization. 2016.',
    ),
    'Layer normalization',
  )
})

test('PDF indexing and page images preserve equations and validated source locations', async (t) => {
  const { library } = await libraryFixture(t)
  const paper = await library.register(sample)
  const index = await library.index(paper.id)
  assert.equal(index.pages.length, 15)
  assert.equal(index.references.length, 40)
  assert.match(index.title, /Attention Is All You Need/i)
  assert.ok(index.pages[3].visuals.some((v) => v.label === 'Equation (1)'))
  const path = await library.image(paper.id, 4)
  const bytes = await readFile(path)
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
  assert.ok(bytes.length > 100_000)
  const sources = answerSources(
    '[yes](paper://page/4#line=p4-l15) [bad](paper://page/4#line=p1-l1) [bad](paper://page/999)',
    index,
  )
  assert.equal(sources.length, 1)
  assert.equal(sources[0].line, 'p4-l15')
  assert.ok(paperContext(index, 'attention', 4).includes('[p4-l15]'))
})

test('library mutations are persistent, collision safe, and confined to ordinary folders', async (t) => {
  const { base, library } = await libraryFixture(t)
  const external = join(base, 'original.pdf')
  await copyFile(sample, external)
  const paper = await library.register(external)
  await library.index(paper.id)
  await library.folder('create', 'Learning/Transformers')
  await Promise.all([
    library.save(paper.id, 'Learning/Transformers'),
    library.save(paper.id, 'Learning/Transformers'),
  ])
  assert.equal((await readdir(join(library.data.root, 'Learning/Transformers'))).length, 1)
  await library.folder('rename', 'Learning', 'Research')
  assert.equal(library.publicRecord(library.record(paper.id)).folder, 'Research/Transformers')
  await library.move(paper.id, '')
  await assert.rejects(library.folder('remove', '.'), /ordinary subfolder/)
  await assert.rejects(
    library.folder('rename', 'Research', 'citations/../.'),
    /folder name|ordinary subfolder/,
  )
  await assert.rejects(library.safeFolder('../escape'), /inside/)
  await symlink(base, join(library.data.root, 'escape'))
  await assert.rejects(library.safeFolder('escape/other'), /outside/)
  const cached = library.record(paper.id)
  cached.summary.bullets = { text: 'Old summary' }
  await library.image(paper.id, 1)
  const info = await stat(cached.path)
  await utimes(cached.path, info.atime, new Date(info.mtimeMs + 5000))
  await library.scan()
  await library.index(paper.id)
  assert.deepEqual(cached.summary, {})
  assert.equal((await readdir(join(base, 'data/images'))).length, 0)
  const firstRoot = library.data.root
  await library.setRoot(join(base, 'other-papers'))
  assert.equal(library.record(paper.id).saved, false)
  await library.setRoot(firstRoot)
  await library.writeQueue
  assert.equal(library.record(paper.id).saved, true)
  const stored = JSON.parse(await readFile(join(base, 'data/library.json')))
  assert.equal(stored.papers[0].id, paper.id)
  assert.ok((await library.snapshot()).folders.includes('citations'))
})

test('concurrent temporary and citation downloads share bytes but honor each save request', async (t) => {
  const { library } = await libraryFixture(t)
  const parent = await library.register(sample)
  await library.index(parent.id)
  const bytes = await readFile(sample),
    originalFetch = globalThis.fetch
  let downloads = 0
  globalThis.fetch = async () => {
    downloads++
    await new Promise((resolve) => setTimeout(resolve, 20))
    return new Response(bytes, { headers: { 'content-type': 'application/pdf' } })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const [temporary, saved] = await Promise.all([
    library.download({ url: 'https://8.8.8.8/paper.pdf', save: false }),
    library.download({ url: 'https://8.8.8.8/paper.pdf', save: true, citedBy: parent.id }),
  ])
  assert.equal(downloads, 1)
  assert.equal(temporary.id, saved.id)
  assert.equal(saved.saved, true)
  assert.equal(saved.folder, 'citations')
  assert.deepEqual(saved.citedBy, [parent.id])
  await library.index(saved.id)
  await assert.rejects(library.move(saved.id, ''), /managed citations/)
})

test('public download validation rejects local endpoints and non-PDF responses', async () => {
  await assert.rejects(checkedUrl('http://example.com/paper.pdf'), /HTTPS/)
  await assert.rejects(checkedUrl('https://127.0.0.1/paper.pdf'), /Local network/)
  await assert.rejects(checkedUrl('https://name:password@example.com/paper.pdf'), /HTTPS/)
  assert.throws(() => validatePdf(Buffer.from('<html>not a paper</html>')), /instead of a PDF/)
  assert.equal(paperUrl('https://arxiv.org/abs/1706.03762v5'), 'https://arxiv.org/pdf/1706.03762v5')
})

test('Codex protocol streams, resumes, cancels, forks, summarizes, and persists source-backed conversations', async (t) => {
  const { base, library } = await libraryFixture(t)
  const oldBin = process.env.PEPE_CODEX_BIN,
    oldLog = process.env.PEPE_TEST_RPC_LOG
  process.env.PEPE_CODEX_BIN = resolve('tests/fixtures/codex.cjs')
  process.env.PEPE_TEST_RPC_LOG = join(base, 'rpc.jsonl')
  const codex = new Codex(join(base, 'data/codex-workspace')),
    events = new EventEmitter()
  const research = new Research(library, codex, (event) => events.emit('event', event))
  t.after(async () => {
    research.close()
    await codex.close()
    if (oldBin) process.env.PEPE_CODEX_BIN = oldBin
    else delete process.env.PEPE_CODEX_BIN
    if (oldLog) process.env.PEPE_TEST_RPC_LOG = oldLog
    else delete process.env.PEPE_TEST_RPC_LOG
  })
  const account = await codex.status()
  assert.equal(account.connected, true)
  assert.equal(account.models[0].id, 'gpt-6-astra')
  library.settings(settings)
  const paper = await library.register(sample)
  await library.index(paper.id)
  const chat = research.newChat(paper.id)
  let done = finished(events, chat.id)
  await research.send({
    chatId: chat.id,
    text: 'Explain attention',
    passage: { page: 4, text: 'Attention is all you need.' },
  })
  const answer = await done
  assert.equal(answer.status, 'complete')
  assert.equal(answer.message.sources[0].page, 4)
  done = finished(events, chat.id)
  await research.send({ chatId: chat.id, text: 'Explain equation 1', page: 4 })
  await done
  assert.equal(chat.messages.length, 4)
  const fork = research.newChat(paper.id, chat.id)
  assert.equal(fork.messages.length, 4)
  assert.equal(fork.threadId, null)
  done = finished(events, fork.id)
  await research.send({ chatId: fork.id, text: 'Continue explaining' })
  await done
  done = finished(events, fork.id)
  const slow = await research.send({ chatId: fork.id, text: 'reference regression slow response' })
  await new Promise((resolve) => setTimeout(resolve, 80))
  await research.stop(slow.requestId)
  const stopped = await done
  assert.match(stopped.error, /stopped/)
  assert.deepEqual(
    stopped.message.sources.map((source) => source.line),
    ['p4-l29', 'p3-l18'],
  )
  done = finished(events, fork.id)
  const early = await research.send({ chatId: fork.id, text: 'slow response' })
  await research.stop(early.requestId)
  assert.match((await done).error, /stopped/)
  done = finished(events, fork.id)
  await research.send({ chatId: fork.id, text: 'reference regression simulate failure' })
  const failed = await done
  assert.match(failed.error, /unavailable/)
  assert.deepEqual(
    failed.message.sources.map((source) => source.line),
    ['p4-l29', 'p3-l18'],
  )
  const [bulletA, bulletB] = await Promise.all([
    research.summarize(paper.id, 'bullets'),
    research.summarize(paper.id, 'bullets'),
  ])
  assert.equal(bulletA.text, bulletB.text)
  assert.match(bulletA.text, /^-/)
  const paragraph = await research.summarize(paper.id, 'paragraph')
  assert.ok(!paragraph.text.startsWith('-'))
  const requests = (await readFile(join(base, 'rpc.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse)
  const turns = requests.filter((r) => r.method === 'turn/start')
  assert.ok(requests.some((r) => r.method === 'thread/resume'))
  assert.ok(turns.some((r) => r.params.input.some((i) => i.type === 'localImage')))
  assert.ok(
    turns.some((r) => r.params.input.some((i) => i.text?.includes('Previous conversation:'))),
  )
  assert.ok(
    turns.every(
      (r) =>
        r.params.serviceTierForTurn === 'fast' && r.params.sandboxPolicy.networkAccess === false,
    ),
  )
  assert.equal(
    turns.filter((r) => r.params.input.some((i) => i.text?.includes('five concise bullet points')))
      .length,
    1,
  )
  await library.writeQueue
  const persisted = JSON.parse(await readFile(join(base, 'data/library.json')))
  assert.equal(persisted.chats.length, 2)
  assert.equal(persisted.chats[0].messages.length, 4)
  assert.equal(research.chats('attention', paper.id).length, 2)
  assert.equal(chat.activeRequestId, undefined)
  const originalFetch = globalThis.fetch,
    pdfBytes = await readFile(sample)
  globalThis.fetch = async () => new Response(pdfBytes)
  let downloaded
  try {
    downloaded = await library.download({ url: 'https://8.8.8.8/background.pdf', save: true })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(
    downloaded.summary.bullets?.text,
    undefined,
    'Download returns before the AI summary',
  )
  const deadline = Date.now() + 8000
  while (!library.record(downloaded.id).summary.bullets?.text && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 30))
  assert.match(library.record(downloaded.id).summary.bullets?.text || '', /^- The Transformer/)
})
