import { randomUUID } from 'node:crypto'

const bulletSummaryInstructions = `Summarize the paper as a compact, hierarchical Markdown outline.
- Organize the summary into 3–6 meaningful topic groups, covering the problem, method, main findings, and limitations when supported by the paper.
- Each top-level bullet is a short bold topic label, not a sentence summarizing an entire section.
- Put 2–4 short child bullets under each topic. Each child expresses ONE idea in a short phrase or sentence; aim for 6–14 words, excluding source links.
- Split compound sentences into separate sibling bullets. Do not pack a section into one long bullet using commas or semicolons.
- Add a third level only when a mechanism, result, or caveat genuinely needs supporting details. Keep causes, evidence, and qualifications under the specific idea they explain.
- Use real Markdown nesting: two spaces per level, and a separate line for every bullet. Use at least two levels, at most three.
- Preserve important numbers, units, comparisons, and uncertainty. Do not shorten a claim so much that its meaning changes, or pad a group with unsupported details.
- Put precise paper:// source links next to the specific child or leaf claim they support, not on topic labels. If only partial content is available, include a short coverage caveat.
- Return only the outline, without an introduction, conclusion paragraph, or code fence. Keep the overall summary compact.
Structure example (replace every placeholder with content from this paper):
- **Method**
  - One short idea.
    - A supporting mechanism, only if needed.
  - Another distinct idea.
- **Findings**
  - A concrete result, with its comparison.
  - A separate qualification.`

export function paperContext(index, query = '', focusPage) {
  const terms = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
  const ranked = index.pages
    .map((page) => ({
      page,
      score: page.number === focusPage ? 1000 : page.number === 1 ? 200 : 0,
    }))
    .map((item) => ({
      ...item,
      score:
        item.score +
        item.page.lines.reduce(
          (sum, line) =>
            sum + [...terms].filter((word) => line.text.toLowerCase().includes(word)).length,
          0,
        ),
    }))
  ranked.sort((a, b) => b.score - a.score)
  let used = 0
  const selected = []
  for (const { page } of ranked) {
    const text = page.lines.map((line) => `[${line.id}] ${line.text}`).join('\n')
    if (used + text.length > 130_000) continue
    used += text.length
    selected.push({ number: page.number, text })
  }
  selected.sort((a, b) => a.number - b.number)
  return `Paper: ${index.title || 'Untitled'}\nCoverage: ${selected.length} of ${index.pages.length} pages. Only cite supplied page/line IDs.\n<untrusted-paper>\n${selected.map((page) => `PAGE ${page.number}\n${page.text}`).join('\n\n')}\n</untrusted-paper>`
}
export function answerSources(text, index) {
  const sources = []
  for (const match of text.matchAll(/paper:\/\/page\/(\d+)(?:#line=([\w-]+))?/g)) {
    const page = index.pages[Number(match[1]) - 1]
    if (!page) continue
    const line = match[2] ? page.lines.find((line) => line.id === match[2]) : page.lines[0]
    if (!line) continue
    if (!sources.some((source) => source.line === line.id))
      sources.push({ page: page.number, line: line.id, y: line.y, text: line.text })
  }
  return sources
}
export class Research {
  constructor(library, codex, publish) {
    this.library = library
    this.codex = codex
    this.publish = publish
    this.summaries = new Map()
    this.summaryQueue = []
    this.summarizing = false
    this.foreground = 0
    this.activeChats = new Set()
    this.cancelled = new Set()
    let recoveredSummary = false
    for (const paper of library.data.papers)
      for (const summary of Object.values(paper.summary || {}))
        if (summary.status === 'working' && summary.text) {
          // An interrupted regeneration must not leave the saved summary disabled after restart.
          summary.status = 'ready'
          recoveredSummary = true
        }
    if (recoveredSummary) library.changed()
    for (const chat of library.data.chats) delete chat.activeRequestId
    library.on('saved', (id) => {
      if (library.record(id).downloaded) this.queueSummary(id)
    })
    library.on('indexed', (id) => {
      const paper = library.record(id)
      if (paper.downloaded && paper.saved) this.queueSummary(id)
    })
    codex.on('notification', ({ method }) => {
      if (method === 'account/login/completed' || method === 'account/updated') {
        publish({ type: 'account' })
        this.resumeSummaries()
      }
    })
  }
  chats(query = '', paperId) {
    return this.library.data.chats
      .filter(
        (chat) =>
          (!paperId || chat.paperId === paperId) &&
          `${chat.title} ${chat.messages.map((m) => m.text).join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }
  chat(id) {
    const chat = this.library.data.chats.find((chat) => chat.id === id)
    if (!chat) throw new Error('Conversation not found.')
    return chat
  }
  newChat(paperId, fromId) {
    this.library.record(paperId)
    const previous = fromId ? this.chat(fromId) : null
    if (previous && previous.paperId !== paperId)
      throw new Error('Choose a conversation about this paper.')
    const chat = {
      id: randomUUID(),
      paperId,
      title: previous ? `${previous.title} (continued)` : 'New conversation',
      messages: previous ? structuredClone(previous.messages) : [],
      updatedAt: Date.now(),
      threadId: null,
    }
    this.library.data.chats.push(chat)
    this.library.changed()
    return chat
  }
  async send({ chatId, text, passage, page, visual, requestId = randomUUID() }) {
    const chat = this.chat(chatId)
    if (this.activeChats.has(chatId))
      throw new Error('Wait for the current response or stop it first.')
    if (typeof text !== 'string' || !text.trim() || text.length > 20_000)
      throw new Error('Enter a question under 20,000 characters.')
    this.activeChats.add(chatId)
    this.foreground++
    chat.activeRequestId = requestId
    const message = {
      id: randomUUID(),
      role: 'user',
      text: text.trim(),
      passage: passage || null,
      createdAt: Date.now(),
    }
    chat.messages.push(message)
    chat.title = chat.title === 'New conversation' ? text.trim().slice(0, 70) : chat.title
    chat.updatedAt = Date.now()
    this.library.changed()
    // Start asynchronously; IPC returns immediately and the event stream carries progress.
    void (async () => {
      let index
      try {
        index = await this.library.index(chat.paperId)
        const settings = { ...this.library.data.settings }
        const status = await this.codex.status()
        if (!status.connected)
          throw new Error(
            status.error || 'Sign in with ChatGPT in Settings to ask about this paper.',
          )
        const model = status.models.find((m) => m.id === settings.model)
        if (!model)
          throw new Error(
            `${settings.model} is not available for this account. Choose an available model in Settings.`,
          )
        if (!model.efforts.includes(settings.effort)) settings.effort = model.defaultEffort
        let visualPage = visual?.page
        if (
          !visualPage &&
          /figure|diagram|equation|formula|table|plot|graph|图|公式|그림|수식/i.test(text)
        ) {
          const mentioned = text.match(/(?:figure|fig\.?|equation|eq\.?|table)\s*(\d+)/i)
          const match =
            mentioned &&
            index.pages
              .flatMap((p) => p.visuals)
              .find((v) => v.label.match(/\d+/)?.[0] === mentioned[1])
          visualPage = match?.page || passage?.page || page || 1
        }
        if (visualPage && !model.modalities.includes('image'))
          throw new Error('Choose a model that supports images to explain this figure or formula.')
        const image = visualPage ? await this.library.image(chat.paperId, visualPage) : null
        const prior =
          !chat.threadId && chat.messages.length > 1
            ? `Previous conversation:\n${chat.messages
                .slice(0, -1)
                .map((m) => `${m.role}: ${m.text}`)
                .join('\n')}\n`
            : ''
        const prompt = `${paperContext(index, text, passage?.page || visualPage || page)}\n${prior}\n${passage ? `Selected passage, page ${passage.page}: <quote>${passage.text}</quote>\n` : ''}${visualPage ? `The attached image is the COMPLETE page ${visualPage}. ${visual?.text || ''} ${visual?.point ? `The reader clicked at x=${visual.point.x.toFixed(2)}, y=${visual.point.y.toFixed(2)} of the page; explain the nearby visual or formula.` : ''}\n` : ''}Response verbosity: ${settings.verbosity}.\nReader question: ${text}`
        if (this.cancelled.has(requestId)) throw new Error('Response stopped.')
        const result = await this.codex.answer({
          requestId,
          threadId: chat.threadId,
          text: prompt,
          image,
          settings,
          onThread: (threadId) => {
            chat.threadId = threadId
            this.library.changed()
          },
          onDelta: (text) =>
            this.publish({ type: 'answer', requestId, chatId, text, status: 'streaming' }),
        })
        const answer = {
          id: randomUUID(),
          role: 'assistant',
          text: result.text,
          sources: answerSources(result.text, index),
          createdAt: Date.now(),
          model: settings.model,
        }
        chat.messages.push(answer)
        chat.updatedAt = Date.now()
        this.library.changed()
        this.publish({ type: 'answer', requestId, chatId, status: 'complete', message: answer })
      } catch (error) {
        const message = {
          id: randomUUID(),
          role: 'assistant',
          text: error.partial || '',
          sources: index ? answerSources(error.partial || '', index) : [],
          error: error.message,
          createdAt: Date.now(),
        }
        chat.messages.push(message)
        this.library.changed()
        this.publish({
          type: 'answer',
          requestId,
          chatId,
          status: 'error',
          error: error.message,
          message,
        })
      } finally {
        this.activeChats.delete(chatId)
        delete chat.activeRequestId
        this.cancelled.delete(requestId)
        this.library.changed()
        this.foreground--
        void this.drainSummaries()
      }
    })()
    return { requestId, chat }
  }
  close() {
    this.closed = true
  }
  async stop(requestId) {
    this.cancelled.add(requestId)
    await this.codex.stop(requestId)
  }
  queueSummary(id, format = this.library.data.settings.summaryFormat) {
    if (this.closed || !this.library.data.settings.autoSummary) return
    const paper = this.library.record(id)
    if (
      paper.summary?.[format]?.text ||
      this.summaries.has(`${id}:${format}`) ||
      this.summaryQueue.some((item) => item.id === id && item.format === format)
    )
      return
    this.summaryQueue.push({ id, format })
    void this.drainSummaries()
  }
  resumeSummaries() {
    for (const paper of this.library.data.papers)
      if (paper.downloaded && paper.saved && paper.status === 'ready') this.queueSummary(paper.id)
    void this.drainSummaries()
  }
  async drainSummaries() {
    if (this.closed || this.summarizing || this.foreground || !this.summaryQueue.length) return
    this.summarizing = true
    let connected = false
    try {
      const status = await this.codex.status()
      if (!status.connected) return
      connected = true
      const next = this.summaryQueue.shift()
      await this.summarize(next.id, next.format).catch(() => {})
    } finally {
      this.summarizing = false
      if (!this.closed && connected && this.summaryQueue.length) {
        const timer = setTimeout(() => void this.drainSummaries(), 15_000)
        timer.unref?.()
      }
    }
  }
  async summarize(id, format = this.library.data.settings.summaryFormat, force = false) {
    if (!['bullets', 'paragraph'].includes(format))
      throw new Error('Choose bullets or paragraph for the summary.')
    const key = `${id}:${format}`,
      paper = this.library.record(id)
    if (this.summaries.has(key)) return this.summaries.get(key)
    if (!force && paper.summary?.[format]?.text) return paper.summary[format]
    const task = (async () => {
      paper.summary ||= {}
      const previous = paper.summary[format]
      const previousSignature = paper.signature
      paper.summary[format] = { ...previous, status: 'working', error: undefined }
      this.library.changed()
      try {
        const status = await this.codex.status()
        if (!status.connected) throw new Error('Sign in with ChatGPT to generate summaries.')
        const index = await this.library.index(id),
          settings = { ...this.library.data.settings }
        const model = status.models.find((model) => model.id === settings.model)
        if (!model) throw new Error('Choose an available model in Settings to generate summaries.')
        if (!model.efforts.includes(settings.effort)) settings.effort = model.defaultEffort
        const signature = paper.signature
        const result = await this.codex.answer({
          requestId: randomUUID(),
          text: `${paperContext(index, 'abstract methods results limitations conclusion')}\n${format === 'paragraph' ? 'Summarize the paper in one concise paragraph. Cover the problem, method, results, and limitations. Cite source lines using paper:// links. If only partial content is available, say so.' : bulletSummaryInstructions}`,
          settings,
        })
        if (paper.signature !== signature)
          throw new Error(
            'The PDF changed while its summary was being generated. Please summarize it again.',
          )
        paper.summary[format] = {
          text: result.text,
          sources: answerSources(result.text, index),
          model: settings.model,
          status: 'ready',
          createdAt: Date.now(),
        }
        return paper.summary[format]
      } catch (error) {
        paper.summary[format] = {
          ...(paper.signature === previousSignature ? previous : undefined),
          status: 'error',
          error: error.message,
        }
        throw error
      } finally {
        this.library.changed()
      }
    })().finally(() => this.summaries.delete(key))
    this.summaries.set(key, task)
    return task
  }
}
