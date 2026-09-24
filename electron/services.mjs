import { Library } from './library.mjs'
import { Codex } from './codex.mjs'
import { Research } from './research.mjs'
import { searchPapers, resolveReference } from './network.mjs'
import { join } from 'node:path'

export async function createServices({ dataDir, root, sample, publish, dialog, shell, getWindow }) {
  const library = await new Library(dataDir, root).init()
  const codex = new Codex(join(dataDir, 'codex-workspace'))
  const research = new Research(library, codex, publish)
  library.on('change', () => publish({ type: 'library' }))
  library.on('problem', (error) => publish({ type: 'problem', error }))
  const actions = {
    'library/state': () => library.snapshot(),
    'library/refresh': async () => {
      await library.scan()
      return library.snapshot()
    },
    'library/root': async () => {
      const choice = await dialog.showOpenDialog(getWindow(), {
        title: 'Choose your paper library',
        properties: ['openDirectory', 'createDirectory'],
      })
      return choice.canceled ? library.snapshot() : library.setRoot(choice.filePaths[0])
    },
    'library/folder': (data) => library.folder(data.operation, data.name, data.next),
    'paper/sample': () => library.register(sample, { title: 'Attention Is All You Need' }),
    'paper/get': (data) => library.publicRecord(library.record(data.id)),
    'paper/index': (data) => library.index(data.id),
    'paper/save': (data) => library.save(data.id, data.folder),
    'paper/move': (data) => library.move(data.id, data.folder),
    'paper/download': (data) => library.download(data),
    'paper/search': (data) => searchPapers(String(data.query || '')),
    'paper/resolve': async (data) => {
      const index = await library.index(data.paperId)
      const reference = index.references.find((r) => r.id === data.referenceId)
      if (!reference) throw new Error('Reference not found.')
      return resolveReference(reference)
    },
    'paper/summary': (data) => research.summarize(data.id, data.format),
    'settings/save': (data) => {
      const settings = library.settings(data)
      if (settings.autoSummary) research.resumeSummaries()
      return settings
    },
    'ai/status': async () => {
      const status = await codex.status()
      if (status.connected) research.resumeSummaries()
      return status
    },
    'ai/login': async () => {
      const login = await codex.login()
      const url = new URL(login.authUrl)
      if (
        url.protocol !== 'https:' ||
        !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(url.hostname)
      )
        throw new Error('Codex returned an unexpected sign-in URL.')
      await shell.openExternal(url.href)
      return { loginId: login.loginId }
    },
    'ai/cancelLogin': (data) => codex.cancelLogin(data.loginId),
    'chat/list': (data) => research.chats(data.query, data.paperId),
    'chat/new': (data) => research.newChat(data.paperId, data.fromId),
    'chat/get': (data) => research.chat(data.id),
    'chat/send': (data) => research.send(data),
    'chat/stop': (data) => research.stop(data.requestId),
  }
  return {
    library,
    codex,
    research,
    async invoke(method, data = {}) {
      if (!Object.hasOwn(actions, method)) throw new Error('Unknown reader action.')
      return actions[method](data)
    },
    async close() {
      research.close()
      await codex.close()
      await library.close()
    },
  }
}
