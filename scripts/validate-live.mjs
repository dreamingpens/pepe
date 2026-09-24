import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Library } from '../electron/library.mjs'
import { Codex } from '../electron/codex.mjs'
import { Research } from '../electron/research.mjs'

const dir = await mkdtemp(join(tmpdir(), 'pepe-live-'))
const library = await new Library(join(dir, 'data'), join(dir, 'papers')).init()
const codex = new Codex(join(dir, 'data', 'codex-workspace'))
const events = []
const research = new Research(library, codex, (event) => events.push(event))
const report = { date: new Date().toISOString(), checks: [] }
async function waitFor(requestId) {
  const start = Date.now()
  while (Date.now() - start < 120000) {
    const event = events.find(
      (e) => e.requestId === requestId && ['complete', 'error'].includes(e.status),
    )
    if (event) {
      if (event.status === 'error') throw new Error(event.error)
      return event.message
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Live validation timed out.')
}
try {
  const paper = await library.register(resolve('public/attention-is-all-you-need.pdf'))
  await library.index(paper.id)
  library.settings({ model: 'gpt-6-astra', effort: 'low', verbosity: 'low', autoSummary: false })
  const chat = research.newChat(paper.id)
  const first = await research.send({
    chatId: chat.id,
    text: 'In one sentence, what is the main architectural contribution of this paper? Include a source link.',
    page: 1,
  })
  const answer = await waitFor(first.requestId)
  if (!answer.sources.length) throw new Error('Answer lacked valid source links.')
  report.checks.push({
    name: 'Astra chat with valid paper sources',
    passed: true,
    sources: answer.sources.length,
  })
  console.log('PASS grounded answer:', answer.text.slice(0, 260))
  const second = await research.send({
    chatId: chat.id,
    text: 'Explain the scaled dot-product attention equation shown on this page in two sentences, building on your previous answer. Include source links.',
    page: 4,
    visual: { page: 4, text: 'Inspect the full page, including equation (1).' },
  })
  const followup = await waitFor(second.requestId)
  if (!followup.sources.length) throw new Error('Visual answer lacked valid source links.')
  report.checks.push({
    name: 'Multiturn continuation with full page vision and formulas',
    passed: true,
    sources: followup.sources.length,
    imageBytes: (
      await import('node:fs/promises').then((fs) =>
        fs.stat(join(dir, 'data', 'images', `${paper.id}-4.png`)),
      )
    ).size,
  })
  console.log('PASS visual followup:', followup.text.slice(0, 400))
  library.settings({ fast: true })
  const summary = await research.summarize(paper.id, 'bullets')
  if (!summary.text || !summary.sources.length)
    throw new Error('Summary lacked content or sources.')
  report.checks.push({ name: 'Fast mode summary', passed: true, sources: summary.sources.length })
  console.log('PASS fast summary:', summary.text.slice(0, 260))
  await mkdir('artifacts', { recursive: true })
  await writeFile('artifacts/live-validation.json', JSON.stringify(report, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  research.close()
  await codex.close()
  await library.close()
  await rm(dir, { recursive: true, force: true })
}
