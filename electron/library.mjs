import { EventEmitter } from 'node:events'
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  copyFile,
  stat,
  realpath,
  rmdir,
  access,
  unlink,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, basename, resolve, join, relative, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { PdfPool } from './pdf-pool.mjs'
import { fetchPublic, paperUrl, validatePdf } from './network.mjs'
import { enrichIndex, CITATION_INDEX_VERSION } from './citations.mjs'

async function jsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`Could not read ${basename(path)}: ${error.message}`)
  }
}
export class Library extends EventEmitter {
  constructor(dataDir, defaultRoot) {
    super()
    this.dataDir = dataDir
    this.defaultRoot = defaultRoot
    this.pool = new PdfPool()
    this.indexing = new Map()
    this.writeQueue = Promise.resolve()
    this.downloads = new Map()
    this.mutations = new Map()
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true })
    for (const folder of ['cache', 'indexes', 'images', 'codex-workspace'])
      await mkdir(join(this.dataDir, folder), { recursive: true })
    this.file = join(this.dataDir, 'library.json')
    this.data = await jsonFile(this.file, {
      version: 1,
      root: this.defaultRoot,
      papers: [],
      chats: [],
      settings: {
        model: 'gpt-6-astra',
        effort: 'medium',
        verbosity: 'medium',
        fast: false,
        summaryFormat: 'bullets',
        autoSummary: true,
      },
    })
    await mkdir(join(this.data.root, 'citations'), { recursive: true })
    this.data.root = await realpath(this.data.root)
    await this.scan()
    return this
  }
  persist() {
    const snapshot = JSON.stringify(this.data)
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await writeFile(this.file + '.tmp', snapshot, { mode: 0o600 })
        await rename(this.file + '.tmp', this.file)
      })
    return this.writeQueue
  }
  changed() {
    this.emit('change')
    void this.persist().catch((error) => this.emit('problem', error.message))
  }
  record(id) {
    const paper = this.data.papers.find((p) => p.id === id)
    if (!paper) throw new Error('This paper is no longer available. Refresh the library.')
    return paper
  }
  publicRecord(paper) {
    const { path, signature, ...visible } = paper
    return {
      ...visible,
      filename: basename(path),
      folder: paper.saved ? dirname(relative(this.data.root, path)).replace(/^\.$/, '') : '',
      url: `pepe://paper/${paper.id}`,
    }
  }
  async snapshot() {
    return {
      root: this.data.root,
      folders: await this.folders(),
      papers: this.data.papers.map((p) => this.publicRecord(p)),
      settings: this.data.settings,
    }
  }
  async folders() {
    const results = ['']
    const visit = async (folder) => {
      for (const entry of await readdir(join(this.data.root, folder), { withFileTypes: true }))
        if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')) {
          const next = join(folder, entry.name)
          results.push(next)
          await visit(next)
        }
    }
    await visit('')
    return results
  }
  async safeFolder(folder = '') {
    if (typeof folder !== 'string' || folder.includes('\0')) throw new Error('Invalid folder name.')
    const target = resolve(this.data.root, folder)
    if (target !== this.data.root && !target.startsWith(this.data.root + sep))
      throw new Error('Choose a folder inside your paper library.')
    // Check all existing ancestors, so symlinks cannot escape the chosen root.
    let ancestor = target
    while (true) {
      try {
        const actual = await realpath(ancestor)
        if (actual !== this.data.root && !actual.startsWith(this.data.root + sep))
          throw new Error('This folder points outside your library.')
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        ancestor = dirname(ancestor)
      }
    }
    return target
  }
  async scan() {
    const known = new Map(this.data.papers.map((p) => [p.path, p])),
      found = new Set()
    const visit = async (folder) => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue
        const path = join(folder, entry.name)
        if (entry.isDirectory()) await visit(path)
        else if (/\.pdf$/i.test(entry.name)) {
          found.add(path)
          const info = await stat(path),
            signature = `${info.size}:${info.mtimeMs}`
          let record = known.get(path)
          if (!record) {
            record = {
              id: randomUUID(),
              path,
              title: basename(path, '.pdf'),
              author: '',
              saved: true,
              addedAt: Date.now(),
              status: 'queued',
              summary: {},
              citedBy: [],
            }
            this.data.papers.push(record)
          }
          record.saved = true
          if (record.signature !== signature || record.status !== 'ready') {
            if (record.signature && record.signature !== signature) await this.invalidate(record)
            record.signature = signature
            this.queueIndex(record)
          }
        }
      }
    }
    await visit(this.data.root)
    this.data.papers = this.data.papers.filter((paper) => !paper.saved || found.has(paper.path))
    this.changed()
  }
  async register(path, extra = {}) {
    path = await realpath(path)
    const existing = this.data.papers.find((p) => p.path === path)
    if (existing) {
      if (extra.sourceUrl) existing.sourceUrl = extra.sourceUrl
      if (extra.downloaded) existing.downloaded = true
      existing.citedBy = [...new Set([...existing.citedBy, ...(extra.citedBy || [])])]
      this.changed()
      return this.publicRecord(existing)
    }
    const info = await stat(path)
    if (info.size > 100 * 1024 * 1024) throw new Error('Choose a PDF smaller than 100 MB.')
    const handle = await import('node:fs/promises').then((fs) => fs.open(path, 'r'))
    try {
      const header = Buffer.alloc(1024)
      await handle.read(header, 0, 1024, 0)
      validatePdf(header)
    } finally {
      await handle.close()
    }
    const paper = {
      id: randomUUID(),
      path,
      title: basename(path, '.pdf'),
      author: '',
      saved: path.startsWith(this.data.root + sep),
      addedAt: Date.now(),
      status: 'queued',
      summary: {},
      citedBy: [],
      signature: `${info.size}:${info.mtimeMs}`,
      ...extra,
    }
    this.data.papers.push(paper)
    this.queueIndex(paper)
    this.changed()
    return this.publicRecord(paper)
  }
  queueIndex(paper) {
    if (this.indexing.has(paper.id)) return this.indexing.get(paper.id)
    paper.status = 'indexing'
    paper.error = ''
    const promise = this.pool
      .run('index', paper.path)
      .then(async (index) => {
        await writeFile(join(this.dataDir, 'indexes', paper.id + '.json'), JSON.stringify(index))
        paper.searchText = index.pages
          .map((page) => page.lines.map((l) => l.text).join(' '))
          .join(' ')
          .slice(0, 60_000)
        paper.title = index.title?.trim() || paper.title
        paper.author = index.author || paper.author
        paper.pageCount = index.pages.length
        paper.referenceCount = index.references.length
        paper.status = 'ready'
        this.changed()
        this.emit('indexed', paper.id)
        return index
      })
      .catch((error) => {
        paper.status = 'error'
        paper.error = error.message
        this.changed()
        throw error
      })
      .finally(() => this.indexing.delete(paper.id))
    this.indexing.set(paper.id, promise)
    promise.catch(() => {})
    return promise
  }
  async index(id) {
    const paper = this.record(id)
    if (this.indexing.has(id)) return this.indexing.get(id)
    const cached = await jsonFile(join(this.dataDir, 'indexes', id + '.json'), null)
    if (cached?.version === 2) {
      enrichIndex(cached)
      cached.version = CITATION_INDEX_VERSION
      await writeFile(join(this.dataDir, 'indexes', id + '.json'), JSON.stringify(cached))
    }
    return cached?.version === CITATION_INDEX_VERSION ? cached : this.queueIndex(paper)
  }
  async image(id, page) {
    const index = await this.index(id)
    if (!Number.isInteger(page) || page < 1 || page > index.pages.length)
      throw new Error('Invalid paper page.')
    const path = join(this.dataDir, 'images', `${id}-${page}.png`)
    try {
      await access(path)
      return path
    } catch {
      /* Render the complete page to preserve figures and formulas. */
    }
    const image = await this.pool.run('render', this.record(id).path, page)
    await writeFile(path, image)
    return path
  }
  async download({ url, title, folder = '', save = true, citedBy }) {
    if (typeof url !== 'string' || !url.trim())
      throw new Error('Enter a direct PDF URL or arXiv ID.')
    if (citedBy) this.record(citedBy)
    url = paperUrl(url)
    let paper = this.data.papers.find((p) => p.sourceUrl === url)
    if (!paper) {
      if (!this.downloads.has(url)) {
        const promise = (async () => {
          const bytes = await fetchPublic(url)
          validatePdf(bytes)
          const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
          const path = join(this.dataDir, 'cache', hash + '.pdf')
          await writeFile(path, bytes)
          return this.register(path, {
            ...(title ? { title: String(title).slice(0, 300) } : {}),
            sourceUrl: url,
            downloaded: true,
          })
        })().finally(() => this.downloads.delete(url))
        this.downloads.set(url, promise)
      }
      paper = this.record((await this.downloads.get(url)).id)
    }
    if (citedBy && !paper.citedBy.includes(citedBy)) {
      paper.citedBy.push(citedBy)
      this.changed()
    }
    if (save) await this.save(paper.id, citedBy ? 'citations' : folder)
    return this.publicRecord(paper)
  }
  mutate(id, action) {
    const task = (this.mutations.get(id) || Promise.resolve()).catch(() => {}).then(action)
    this.mutations.set(id, task)
    void task
      .finally(() => {
        if (this.mutations.get(id) === task) this.mutations.delete(id)
      })
      .catch(() => {})
    return task
  }
  async invalidate(paper) {
    await this.indexing.get(paper.id)?.catch(() => {})
    paper.summary = {}
    await unlink(join(this.dataDir, 'indexes', paper.id + '.json')).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
    for (const filename of await readdir(join(this.dataDir, 'images')))
      if (filename.startsWith(paper.id + '-')) await unlink(join(this.dataDir, 'images', filename))
  }
  save(id, folder = '') {
    return this.mutate(id, () => this.savePaper(id, folder))
  }
  async savePaper(id, folder) {
    const paper = this.record(id)
    if (paper.citedBy.length) folder = 'citations'
    const directory = await this.safeFolder(folder)
    if (paper.saved && dirname(paper.path) === directory) return this.publicRecord(paper)
    await mkdir(directory, { recursive: true })
    const filename =
      paper.title
        .replace(/[^\p{L}\p{N} _.,()-]/gu, '')
        .trim()
        .slice(0, 120) || 'Paper'
    let target = join(directory, filename + '.pdf'),
      suffix = 1
    if (paper.path === target) return this.publicRecord(paper)
    while (true) {
      try {
        await copyFile(paper.path, target, constants.COPYFILE_EXCL)
        break
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        target = join(directory, `${filename} (${++suffix}).pdf`)
      }
    }
    paper.path = target
    paper.saved = true
    const info = await stat(target)
    paper.signature = `${info.size}:${info.mtimeMs}`
    this.changed()
    this.emit('saved', id)
    return this.publicRecord(paper)
  }
  move(id, folder) {
    return this.mutate(id, () => this.movePaper(id, folder))
  }
  async movePaper(id, folder) {
    const paper = this.record(id)
    if (!paper.saved) return this.savePaper(id, folder)
    if (paper.citedBy.length) throw new Error('Cited papers stay in the managed citations folder.')
    const directory = await this.safeFolder(folder)
    await mkdir(directory, { recursive: true })
    const target = join(directory, basename(paper.path))
    if (target === paper.path) return this.publicRecord(paper)
    try {
      await access(target)
      throw new Error('A paper with that filename already exists in this folder.')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await rename(paper.path, target)
    paper.path = target
    this.changed()
    return this.publicRecord(paper)
  }
  async folder(operation, name, next) {
    if (!name || name === 'citations' || name.startsWith('citations/'))
      throw new Error('The citations folder is managed automatically.')
    const path = await this.safeFolder(name)
    const local = relative(this.data.root, path)
    if (!local || local === 'citations' || local.startsWith('citations' + sep))
      throw new Error('Choose an ordinary subfolder of your library.')
    if (operation === 'create') await mkdir(path, { recursive: true })
    else if (operation === 'remove')
      await rmdir(path) // Empty folders only; never remove papers.
    else if (operation === 'rename') {
      if (!next || next === 'citations' || next.startsWith('citations/'))
        throw new Error('Choose another folder name.')
      const target = await this.safeFolder(next)
      const localTarget = relative(this.data.root, target)
      if (!localTarget || localTarget === 'citations' || localTarget.startsWith('citations' + sep))
        throw new Error('Choose an ordinary subfolder of your library.')
      try {
        await access(target)
        throw new Error('That folder already exists.')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await rename(path, target)
      for (const paper of this.data.papers)
        if (paper.path.startsWith(path + sep)) paper.path = target + paper.path.slice(path.length)
    } else throw new Error('Unknown folder action.')
    this.changed()
    return this.snapshot()
  }
  async setRoot(root) {
    await mkdir(root, { recursive: true })
    const next = await realpath(root)
    await mkdir(join(next, 'citations'), { recursive: true })
    this.data.root = next
    for (const paper of this.data.papers) paper.saved = false
    await this.scan()
    return this.snapshot()
  }
  settings(value) {
    for (const key of ['model', 'effort', 'verbosity', 'summaryFormat'])
      if (typeof value?.[key] === 'string' && value[key].length < 100)
        this.data.settings[key] = value[key]
    for (const key of ['fast', 'autoSummary'])
      if (typeof value?.[key] === 'boolean') this.data.settings[key] = value[key]
    if (!['low', 'medium', 'high'].includes(this.data.settings.verbosity))
      this.data.settings.verbosity = 'medium'
    if (!['bullets', 'paragraph'].includes(this.data.settings.summaryFormat))
      this.data.settings.summaryFormat = 'bullets'
    this.changed()
    return this.data.settings
  }
  async close() {
    this.pool.close()
    await Promise.allSettled([...this.indexing.values(), ...this.mutations.values()])
    await this.writeQueue
  }
}
