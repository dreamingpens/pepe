import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import type { LibraryState, PaperIndex } from '../src/types'
import { resolve, join } from 'node:path'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
async function launch() {
  const base = await mkdtemp(join(tmpdir(), 'pepe-workflows-'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PEPE_DEV_URL
  Object.assign(env, {
    PEPE_DATA_DIR: join(base, 'data'),
    PEPE_LIBRARY_DIR: join(base, 'papers'),
    PEPE_CODEX_BIN: resolve('tests/fixtures/codex.cjs'),
    PEPE_TEST_RPC_LOG: join(base, 'rpc.jsonl'),
  })
  const app = await electron.launch({ args: [resolve('.')], env })
  const page = await app.firstWindow()
  return { app, page, base, env }
}
async function sample(page: Page) {
  await page.getByRole('button', { name: 'Read the sample paper' }).click()
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible()
}
async function close(app: ElectronApplication, base: string) {
  await app.close()
  await rm(base, { recursive: true, force: true })
}

test('dashboard folders, saved papers, keyword search, and cached summaries survive restart', async () => {
  const { app, page, base, env } = await launch()
  let restarted: ElectronApplication | null = null
  try {
    await page.getByRole('button', { name: 'New folder', exact: true }).click()
    await page.getByRole('textbox', { name: 'Folder name' }).fill('Sequence models')
    await page.getByRole('button', { name: 'Save folder' }).click()
    await expect(page.getByRole('button', { name: 'Sequence models', exact: true })).toBeVisible()
    await sample(page)
    await page.keyboard.press(`${modifier}+Shift+l`)
    await page.getByRole('button', { name: 'Save paper', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save paper', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '← Your library', exact: true }).click()
    await page.locator('.library-paper').click()
    await page.getByLabel('Move paper to folder').selectOption('Sequence models')
    await expect(page.locator('.library-paper')).toContainText('Sequence models')
    await page.getByRole('textbox', { name: 'Search library' }).fill('self-attention')
    await expect(page.locator('.library-paper')).toHaveCount(1)
    await page.getByRole('button', { name: 'Summarize paper' }).click()
    await expect(page.locator('.quick-summary .answer-markdown')).toContainText('Transformer')
    await expect(page.locator('.quick-summary .answer-markdown > ul > li')).toHaveCount(4)
    await expect(page.locator('.quick-summary .answer-markdown > ul > li > ul > li')).toHaveCount(8)
    await expect(page.locator('.quick-summary .answer-markdown ul ul ul > li')).toHaveCount(2)
    await page.screenshot({ path: 'artifacts/outline-summary.png' })
    await page.getByRole('button', { name: 'Regenerate summary', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Regenerate summary', exact: true }),
    ).toBeEnabled()
    const requests = (await readFile(join(base, 'rpc.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(requests.filter((request) => request.method === 'turn/start')).toHaveLength(2)
    await page.getByLabel('Quick summary format').selectOption('paragraph')
    await page.getByRole('button', { name: 'Summarize paper' }).click()
    await expect(page.locator('.quick-summary .answer-markdown')).toContainText('model sequences')
    await expect(page.locator('.quick-summary li')).toHaveCount(0)
    await page.screenshot({ path: 'artifacts/dashboard.png' })
    await app.close()
    restarted = await electron.launch({ args: [resolve('.')], env })
    const next = await restarted.firstWindow()
    await expect(next.locator('.library-paper')).toHaveCount(1)
    await next.locator('.library-paper').click()
    await expect(next.locator('.quick-summary .answer-markdown')).toContainText('model sequences')
    await next.getByRole('button', { name: 'Sequence models', exact: true }).click()
    await next.getByRole('button', { name: 'Rename', exact: true }).click()
    await next.getByLabel('Folder name').fill('Transformers')
    await next.getByRole('button', { name: 'Save folder' }).click()
    await next.getByRole('button', { name: 'All papers' }).click()
    await expect(next.locator('.library-paper')).toContainText('Transformers')
    await next.locator('.library-paper').click()
    await next.getByLabel('Move paper to folder').selectOption('')
    await next.getByRole('button', { name: 'Transformers', exact: true }).click()
    await next.getByRole('button', { name: 'Remove empty folder' }).click()
    await expect(next.getByRole('button', { name: 'Transformers', exact: true })).toHaveCount(0)
  } finally {
    if (restarted) await restarted.close()
    else if (app.process().exitCode === null) await app.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('Paper tab generates and reuses bullet summaries with working source links', async () => {
  const { app, page, base } = await launch()
  try {
    // The reader must request bullets even when the dashboard uses paragraphs.
    await page.evaluate(() => window.pepe!.invoke('settings/save', { summaryFormat: 'paragraph' }))
    await sample(page)
    await page.getByRole('button', { name: 'Open reading controls' }).click()
    const summary = page.getByRole('region', { name: 'Bullet summary' })
    await expect(summary.getByRole('button', { name: 'Summarize paper' })).toBeVisible()
    await summary.getByRole('button', { name: 'Summarize paper' }).click()
    await expect(summary.locator('.answer-markdown > ul > li')).toHaveCount(4)
    await expect(summary.locator('.answer-markdown ul ul ul > li')).toHaveCount(2)
    await expect(summary).toContainText('The Transformer uses attention.')
    await summary.getByRole('button', { name: 'Regenerate summary' }).click()
    await expect(summary.locator('.answer-markdown')).toContainText(
      'The Transformer uses attention.',
    )
    await expect(summary.getByRole('button', { name: 'Regenerate summary' })).toBeEnabled()
    await page.locator('.panel-scroll').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.screenshot({ path: 'artifacts/paper-summary.png' })
    await summary.getByRole('button', { name: 'p. 4', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Reading panel' })).toHaveCount(0)
    await expect(page.locator('.source-highlight')).toHaveAttribute('data-source-line', 'p4-l15')
    await expect(page.locator('.source-highlight')).toBeInViewport()
    await page.getByRole('button', { name: 'Open reading controls' }).click()
    await expect(summary.locator('.answer-markdown > ul > li')).toHaveCount(4)
    await page.getByRole('tab', { name: 'Assistant', exact: true }).click()
    await page.getByRole('tab', { name: 'Paper', exact: true }).click()
    await expect(summary.locator('.answer-markdown > ul > li')).toHaveCount(4)
    await summary.locator('summary').click()
    await expect(summary.locator('.answer-markdown')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open a paper' })).toBeInViewport()
    const state = (await page.evaluate(() => window.pepe!.invoke('library/state'))) as LibraryState
    expect(state.settings.summaryFormat).toBe('paragraph')
    expect(state.papers[0].summary.bullets.status).toBe('ready')
    const requests = (await readFile(join(base, 'rpc.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(requests.filter((request) => request.method === 'turn/start')).toHaveLength(2)
  } finally {
    await close(app, base)
  }
})

test('nested folders support parent selection, path creation, renaming, moves, and restart', async () => {
  const { app, page, base, env } = await launch()
  let restarted: ElectronApplication | null = null
  try {
    for (const [name, parent] of [
      ['Research', ''],
      ['Transformers', 'Research'],
      ['Attention/Self-attention', 'Research/Transformers'],
    ]) {
      await page.getByRole('button', { name: 'New folder', exact: true }).click()
      await expect(page.getByLabel('Parent folder', { exact: true })).toHaveValue(parent)
      await page.getByLabel('Folder name', { exact: true }).fill(name)
      await expect(page.locator('.folder-location')).toContainText(
        [parent, name].filter(Boolean).join('/'),
      )
      await page.getByRole('button', { name: 'Save folder', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    const original = 'Research/Transformers/Attention/Self-attention'
    await expect(page.getByRole('button', { name: original, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByRole('button', { name: original, exact: true })).toHaveText(
      'Self-attention',
    )
    await page.getByRole('button', { name: 'Collapse Research', exact: true }).click()
    await expect(page.getByRole('button', { name: original, exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand Research', exact: true }).click()
    await page.getByRole('button', { name: original, exact: true }).click()

    // A nested selection can still create a new top-level sibling.
    await page.getByRole('button', { name: 'New folder', exact: true }).click()
    await expect(page.getByLabel('Parent folder', { exact: true })).toHaveValue(original)
    await page.getByLabel('Parent folder', { exact: true }).selectOption('')
    await page.getByLabel('Folder name', { exact: true }).fill('all')
    await page.getByRole('button', { name: 'Save folder', exact: true }).click()
    await expect(page.getByRole('button', { name: 'all', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await sample(page)
    await page.keyboard.press(`${modifier}+Shift+l`)
    await page.getByRole('button', { name: 'Save paper', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save paper', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '← Your library', exact: true }).click()
    await page.locator('.library-paper').click()
    await page.getByLabel('Move paper to folder').selectOption(original)
    await expect(page.locator('.library-paper')).toContainText(original)

    await page.getByRole('button', { name: original, exact: true }).click()
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(page.getByLabel('Folder name', { exact: true })).toHaveValue('Self-attention')
    await page.getByLabel('Folder name', { exact: true }).fill('Mechanisms')
    await page.getByRole('button', { name: 'Save folder', exact: true }).click()
    await expect(page.locator('.library-paper')).toContainText(
      'Research/Transformers/Attention/Mechanisms',
    )
    await page.getByRole('button', { name: 'Research/Transformers', exact: true }).click()
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(page.getByLabel('Folder name', { exact: true })).toHaveValue('Transformers')
    await page.getByLabel('Folder name', { exact: true }).fill('Architectures')
    await page.getByRole('button', { name: 'Save folder', exact: true }).click()
    const renamed = 'Research/Architectures/Attention/Mechanisms'
    await page.getByRole('button', { name: renamed, exact: true }).click()
    await expect(page.locator('.library-paper')).toContainText(renamed)
    await page.screenshot({ path: 'artifacts/nested-folders.png' })
    const snapshot = await page.evaluate(() => window.pepe!.invoke<LibraryState>('library/state'))
    await readFile(join(snapshot.root, renamed, snapshot.papers[0].filename))

    await app.close()
    restarted = await electron.launch({ args: [resolve('.')], env })
    const next = await restarted.firstWindow()
    await next.getByRole('button', { name: 'all', exact: true }).click()
    await expect(next.locator('.library-paper')).toHaveCount(0)
    await next.getByRole('button', { name: renamed, exact: true }).click()
    await expect(next.locator('.library-paper')).toContainText(renamed)
    await next.locator('.library-paper').click()
    await next.getByLabel('Move paper to folder').selectOption('all')
    await next.getByRole('button', { name: 'all', exact: true }).click()
    await expect(next.locator('.library-paper')).toHaveCount(1)
    await next.getByRole('button', { name: renamed, exact: true }).click()
    await next.getByRole('button', { name: 'Remove empty folder', exact: true }).click()
    await expect(next.getByRole('button', { name: renamed, exact: true })).toHaveCount(0)
    await expect(
      next.getByRole('button', {
        name: 'Research/Architectures/Attention',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page')
  } finally {
    if (restarted) await restarted.close()
    else if (app.process().exitCode === null) await app.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('home controls and resizable summary panels work and remember the chosen size', async () => {
  const { app, page, base, env } = await launch()
  let restarted: ElectronApplication | null = null
  try {
    await sample(page)
    await page.keyboard.press(`${modifier}+Shift+l`)
    await expect(page.locator('.panel-home')).toContainText('Home')
    await page.getByRole('button', { name: 'Save paper', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save paper', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '← Your library', exact: true }).click()
    await page.locator('.library-paper').dblclick()
    await expect(page.locator('.pdf-page canvas').first()).toBeVisible()
    await page.keyboard.press(`${modifier}+l`)
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.focus()
      const modifiers: ('meta' | 'control' | 'shift')[] = [
        process.platform === 'darwin' ? 'meta' : 'control',
        'shift',
      ]
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers })
    })
    await expect(page.locator('.dashboard')).toBeVisible()
    await expect(page.locator('.side-panel')).toHaveCount(0)
    await page.locator('.library-paper').click()
    const panel = page.getByRole('complementary', { name: 'Paper summary' })
    const handle = page.getByRole('separator', { name: 'Resize summary panel' })
    const initial = (await panel.boundingBox())!.width
    const grip = (await handle.boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x - 130, grip.y + grip.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(initial + 100)
    await handle.focus()
    await handle.press('ArrowRight')
    const width = (await panel.boundingBox())!.width
    await page.screenshot({ path: 'artifacts/resizable-summary.png' })
    await app.close()
    restarted = await electron.launch({ args: [resolve('.')], env })
    const next = await restarted.firstWindow()
    await next.locator('.library-paper').click()
    const restored = next.getByRole('complementary', { name: 'Paper summary' })
    expect(Math.abs((await restored.boundingBox())!.width - width)).toBeLessThan(2)
    await next.setViewportSize({ width: 900, height: 850 })
    const vertical = next.getByRole('separator', { name: 'Resize summary panel' })
    await expect(vertical).toHaveAttribute('aria-orientation', 'horizontal')
    const before = (await restored.boundingBox())!.height
    await vertical.focus()
    await vertical.press('ArrowDown')
    expect((await restored.boundingBox())!.height).toBe(before + 24)
    await vertical.press('ArrowUp')
    expect((await restored.boundingBox())!.height).toBe(before)
    const lastPaper = (await next.locator('.library-paper').last().boundingBox())!
    expect((await restored.boundingBox())!.y).toBeGreaterThanOrEqual(lastPaper.y + lastPaper.height)
    await next.screenshot({ path: 'artifacts/resizable-summary-compact.png' })
  } finally {
    if (restarted) await restarted.close()
    else if (app.process().exitCode === null) await app.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('assistant settings, streaming, source jumps, cancellation, history, and visual explanations', async () => {
  const { app, page, base } = await launch()
  try {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await sample(page)
    await page.keyboard.press(`${modifier}+l`)
    await page.getByRole('button', { name: 'Assistant settings' }).click()
    await expect(page.getByText('Connected through Codex · test')).toBeVisible()
    await page.getByLabel('Thinking level').selectOption('high')
    await page.getByLabel('Verbosity').selectOption('low')
    await page.getByRole('checkbox', { name: /Fast mode/ }).check()
    await page.getByRole('button', { name: 'Assistant settings' }).click()
    const input = page.getByRole('textbox', { name: 'Ask about this paper' })
    await input.fill('Explain attention')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.chat-message.assistant .source-link')).toBeVisible()
    await page.locator('.chat-message.assistant .source-link').click()
    await expect(page.locator('.pdf-page[data-page-number="4"] canvas')).toBeVisible()
    await expect(page.locator('.source-highlight')).toBeVisible()
    await expect(page.locator('.katex')).toHaveCount(1)
    await input.fill('slow response: explain again')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await page.keyboard.press(`${modifier}+l`)
    await expect(page.getByRole('complementary')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+l`)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Response stopped')
    await page.getByRole('button', { name: 'Chat history', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search chat history' }).fill('attention')
    await expect(page.locator('.history-row')).toHaveCount(1)
    await page
      .getByRole('button', { name: 'Continue Explain attention in new chat', exact: true })
      .click()
    await expect(page.locator('.chat-message.user')).toHaveCount(2)
    await input.fill('How does that relate to values?')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.chat-message.assistant .source-link')).toHaveCount(2)
    await page.screenshot({ path: 'artifacts/assistant.png' })
    await page.keyboard.press(`${modifier}+l`)
    const paper = page.locator('.pdf-page[data-page-number="4"]')
    await paper.locator('.textLayer').click({ button: 'right', position: { x: 300, y: 420 } })
    await expect(page.getByRole('dialog', { name: 'Figure or formula explanation' })).toBeVisible()
    await page.getByRole('button', { name: 'Explain this' }).click()
    await expect(page.locator('.paper-popover .source-link')).toBeVisible()
    await page.screenshot({ path: 'artifacts/visual-explanation.png' })
    await page.getByRole('button', { name: 'Continue in assistant →' }).click()
    await expect(page.locator('.chat-message.assistant .source-link')).toBeVisible()
    await page.keyboard.press(`${modifier}+Shift+l`)
    await page.locator('.reference-list summary').click()
    await page.locator('.reference-list button').first().click()
    await expect(page.getByRole('dialog', { name: 'Cited paper' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
    await page.screenshot({ path: 'artifacts/citation.png' })
    const requests = (await readFile(join(base, 'rpc.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const turns = requests.filter((r) => r.method === 'turn/start')
    expect(
      turns.every((r) => r.params.effort === 'high' && r.params.serviceTierForTurn === 'fast'),
    ).toBe(true)
    expect(
      turns.some((r) => r.params.input.some((i: { type: string }) => i.type === 'localImage')),
    ).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await close(app, base)
  }
})

test('citations and equations open directly from the PDF', async () => {
  const { app, page, base } = await launch()
  try {
    await sample(page)
    await page.keyboard.press(`${modifier}+Shift+l`)
    await page.getByLabel('Page number').fill('3')
    await page.getByLabel('Page number').press('Enter')
    await page.keyboard.press('Escape')
    const link = await page.evaluate(async () => {
      const library = await window.pepe!.invoke<LibraryState>('library/state')
      const index = await window.pepe!.invoke<PaperIndex>('paper/index', {
        id: library.papers[0].id,
      })
      return index.pages[2].links.find((link) => link.dest === 'cite.layernorm2016')!
    })
    const citationPage = page.locator('.pdf-page[data-page-number="3"]')
    await expect(citationPage.locator('canvas')).toBeVisible()
    const size = await citationPage.boundingBox()
    await citationPage.click({
      position: {
        x: (link.x + link.width / 2) * size!.width,
        y: (link.y + link.height / 2) * size!.height,
      },
    })
    await expect(page.getByRole('dialog', { name: 'Cited paper' })).toBeVisible()
    await expect(page.locator('.paper-popover h2')).toHaveText('Layer normalization')
    await expect(page.getByRole('combobox', { name: 'Matching paper' })).toHaveCount(0)
    await expect(
      page
        .getByRole('dialog', { name: 'Cited paper' })
        .getByRole('button', { name: 'Open', exact: true }),
    ).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${modifier}+Shift+l`)
    await page.getByLabel('Page number').fill('4')
    await page.getByLabel('Page number').press('Enter')
    await page.keyboard.press('Escape')
    const equation = page
      .locator('.pdf-page[data-page-number="4"] .textLayer span')
      .filter({ hasText: /^\(1\)$/ })
      .first()
    await equation.scrollIntoViewIfNeeded()
    await equation.click()
    await expect(page.getByRole('dialog', { name: 'Figure or formula explanation' })).toBeVisible()
    await expect(page.locator('.paper-popover h2')).toHaveText('Equation (1)')
    await page.keyboard.press('Escape')
  } finally {
    await close(app, base)
  }
})

test('a 75-page paper keeps a small render window', async () => {
  const corpus = resolve('tests/corpus/2005.14165.pdf')
  test.skip(!existsSync(corpus), 'Run npm run test:corpus to fetch the real-paper benchmark.')
  const { app, page, base } = await launch()
  try {
    await expect(page.getByRole('button', { name: 'Open a paper', exact: true })).toBeVisible()
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press(`${modifier}+o`)
    const started = performance.now()
    await (await chooser).setFiles(corpus)
    await expect(page.locator('.pdf-page[data-page-number="1"] canvas')).toBeVisible()
    const firstPageMs = Math.round(performance.now() - started)
    await page.keyboard.press(`${modifier}+Shift+l`)
    await page.getByLabel('Page number').fill('70')
    await page.getByLabel('Page number').press('Enter')
    await page.keyboard.press('Escape')
    await expect(page.locator('.pdf-page[data-page-number="70"] canvas')).toBeVisible()
    expect(await page.locator('.pdf-page').count()).toBeLessThan(7)
    expect(await page.locator('.pdf-page canvas').count()).toBeLessThan(7)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      'artifacts/reader-performance.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          paper: '2005.14165',
          pages: 75,
          firstPageMs,
          mountedPagesAtPage70: await page.locator('.pdf-page').count(),
          renderedCanvasesAtPage70: await page.locator('.pdf-page canvas').count(),
        },
        null,
        2,
      ),
    )
  } finally {
    await close(app, base)
  }
})

test('source links navigate during token updates and remain usable when generation ends', async () => {
  const { app, page, base } = await launch()
  try {
    await sample(page)
    await page.keyboard.press(`${modifier}+l`)
    const input = page.getByRole('textbox', { name: 'Ask about this paper' })
    for (const ending of ['complete', 'stop', 'simulate failure']) {
      await page.getByRole('button', { name: 'New conversation', exact: true }).click()
      await input.fill(`reference regression ${ending}`)
      await page.getByRole('button', { name: 'Send message' }).click()
      const response = page.locator('.chat-message.assistant').last()
      const source4 = response.getByRole('button', { name: 'p. 4', exact: true })
      const source3 = response.getByRole('button', { name: 'p. 3', exact: true })
      await expect(source4).toBeVisible()
      await expect(response.getByRole('button', { name: 'Invalid source' })).toHaveCount(0)
      const target = await source4.boundingBox()
      await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2)
      await page.mouse.down()
      const before = await response.textContent()
      await expect.poll(() => response.textContent()).not.toBe(before)
      await page.mouse.up()
      await expect(page.locator('.source-highlight')).toBeInViewport()
      await expect(page.locator('.source-highlight')).toHaveAttribute('data-source-line', 'p4-l29')
      await expect
        .poll(() => page.locator('.reader').evaluate((reader) => reader.scrollTop))
        .toBeGreaterThan(3000)
      await source3.click()
      await expect(page.locator('.source-highlight')).toHaveAttribute('data-source-line', 'p3-l18')
      await expect(page.locator('.source-highlight')).toBeInViewport()
      if (ending === 'stop') await page.getByRole('button', { name: 'Stop', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
      await expect(source4).toBeVisible()
      await source4.click()
      await expect(page.locator('.source-highlight')).toHaveAttribute('data-source-line', 'p4-l29')
      await expect(page.locator('.source-highlight')).toBeInViewport()
      await page.keyboard.press(`${modifier}+l`)
      await page.keyboard.press(`${modifier}+l`)
      await response.getByRole('button', { name: 'p. 3', exact: true }).click()
      await expect(page.locator('.source-highlight')).toHaveAttribute('data-source-line', 'p3-l18')
      await expect(page.locator('.source-highlight')).toBeInViewport()
    }
  } finally {
    await close(app, base)
  }
})

test('old saved answers without source metadata regain working links after restart', async () => {
  const { app, page, base, env } = await launch()
  let restarted: ElectronApplication | null = null
  try {
    await sample(page)
    await page.keyboard.press(`${modifier}+l`)
    await page
      .getByRole('textbox', { name: 'Ask about this paper' })
      .fill('reference regression legacy answer')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByRole('button', { name: 'p. 4', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await app.close()
    const manifest = join(base, 'data/library.json')
    const data = JSON.parse(await readFile(manifest, 'utf8'))
    const message = data.chats[0].messages.find(
      (message: { role: string }) => message.role === 'assistant',
    )
    expect(message.sources).toHaveLength(2)
    // Reproduce messages written by the previous build, including its retained text.
    delete message.sources
    const { writeFile } = await import('node:fs/promises')
    await writeFile(manifest, JSON.stringify(data))
    restarted = await electron.launch({ args: [resolve('.')], env })
    const next = await restarted.firstWindow()
    await sample(next)
    await next.keyboard.press(`${modifier}+l`)
    await next.getByRole('button', { name: 'p. 3', exact: true }).click()
    await expect(next.locator('.source-highlight')).toHaveAttribute('data-source-line', 'p3-l18')
    await expect(next.locator('.source-highlight')).toBeInViewport()
    await expect(next.getByRole('button', { name: 'Invalid source' })).toHaveCount(0)
  } finally {
    if (restarted) await restarted.close()
    else if (app.process().exitCode === null) await app.close()
    await rm(base, { recursive: true, force: true })
  }
})
