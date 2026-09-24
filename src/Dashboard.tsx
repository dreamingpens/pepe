import { useState } from 'react'
import { invoke } from './api'
import { Icon } from './Icons'
import { Answer } from './Answer'
import { SettingsPanel } from './SettingsPanel'
import type { LibraryState, PaperRecord, SearchResult, Settings, Source } from './types'

export function Dashboard({
  library,
  error,
  onOpen,
  onFile,
  onSample,
  onRefresh,
  onSettings,
  onSource,
}: {
  library: LibraryState
  error: string
  onOpen: (paper: PaperRecord) => void
  onFile: () => void
  onSample: () => void
  onRefresh: () => void
  onSettings: (settings: Settings) => void
  onSource: (paper: PaperRecord, source: Source) => void
}) {
  const [tab, setTab] = useState<'saved' | 'search' | 'citations'>('saved'),
    [query, setQuery] = useState(''),
    [folder, setFolder] = useState('all'),
    [selected, setSelected] = useState('')
  const [results, setResults] = useState<SearchResult[]>([]),
    [busy, setBusy] = useState(''),
    [problem, setProblem] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false)
  const [dialog, setDialog] = useState<'download' | 'folder' | 'rename' | null>(null),
    [value, setValue] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const papers = library.papers
    .filter(
      (p) =>
        (p.saved || historyOpen) &&
        (tab !== 'citations' || p.citedBy.length || p.folder === 'citations') &&
        (folder === 'all' || p.folder === folder) &&
        `${p.title} ${p.author} ${p.filename} ${p.searchText || ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.addedAt - a.addedAt)
  const current = library.papers.find((p) => p.id === selected)
  const summary = current?.summary?.[library.settings.summaryFormat]
  async function task(name: string, work: () => Promise<unknown>) {
    setBusy(name)
    setProblem('')
    try {
      await work()
      onRefresh()
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setBusy('')
    }
  }
  const download = (result: SearchResult, save: boolean) =>
    task(result.id, async () => {
      const paper = await invoke<PaperRecord>('paper/download', {
        url: result.pdfUrl,
        title: result.title,
        save,
        folder: folder === 'all' ? '' : folder,
      })
      if (!save) onOpen(paper)
      else setSelected(paper.id)
    })
  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <span className="brand">pepe</span>
          <span className="brand-note">Your reading room</span>
        </div>
        <div className="dashboard-actions">
          <button className="secondary-button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              setValue('')
              setDialog('download')
            }}
          >
            Add from URL
          </button>
          <button className="primary-button" onClick={onFile}>
            <Icon name="open" size={15} />
            Open a paper
          </button>
        </div>
      </header>
      <div className="dashboard-intro">
        <h1>A little space to read.</h1>
        <p>Keep the papers that matter. Follow the ideas between them.</p>
      </div>
      <div className="library-toolbar">
        <nav aria-label="Library views">
          {(['saved', 'search', 'citations'] as const).map((item) => (
            <button
              key={item}
              aria-current={tab === item ? 'page' : undefined}
              onClick={() => {
                setTab(item)
                setQuery('')
                setFolder('all')
              }}
            >
              {item === 'saved' ? 'Your papers' : item === 'search' ? 'Discover' : 'Citations'}
            </button>
          ))}
        </nav>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (tab === 'search')
              void task('search', async () =>
                setResults(await invoke<SearchResult[]>('paper/search', { query })),
              )
          }}
        >
          <input
            aria-label={tab === 'search' ? 'Search online papers' : 'Search library'}
            placeholder={
              tab === 'search' ? 'Title, author, keywords, or arXiv ID' : 'Find a paper…'
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {tab === 'search' && (
            <button className="secondary-button" disabled={!!busy} type="submit">
              Search
            </button>
          )}
        </form>
      </div>
      {(error || problem) && (
        <p role="alert" className="inline-error dashboard-error">
          {problem || error}
        </p>
      )}
      <div className="library-layout">
        <aside className="folder-list">
          <div className="section-heading">
            <span className="section-label">FOLDERS</span>
            <button
              className="icon-button"
              title="New folder"
              aria-label="New folder"
              onClick={() => {
                setValue('')
                setDialog('folder')
              }}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>
          <button className={folder === 'all' ? 'active' : ''} onClick={() => setFolder('all')}>
            All papers<span>{library.papers.filter((p) => p.saved).length}</span>
          </button>
          {library.folders.map((name) => (
            <button
              key={name}
              className={folder === name ? 'active' : ''}
              onClick={() => setFolder(name)}
            >
              <span>{name || 'Unfiled'}</span>
              {name === 'citations' && <span>↗</span>}
            </button>
          ))}
          {folder !== 'all' && folder && folder !== 'citations' && (
            <div className="folder-tools">
              <button
                onClick={() => {
                  setValue(folder)
                  setDialog('rename')
                }}
              >
                Rename
              </button>
              <button
                onClick={() =>
                  void task('folder', async () => {
                    await invoke('library/folder', { operation: 'remove', name: folder })
                    setFolder('all')
                  })
                }
              >
                Remove empty folder
              </button>
            </div>
          )}
          <div className="folder-bottom">
            <button onClick={() => void task('refresh', () => invoke('library/refresh'))}>
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh library'}
            </button>
            <button onClick={() => void task('root', () => invoke('library/root'))}>
              Choose library folder
            </button>
            <p title={library.root}>{library.root || 'Open the desktop app for a local library'}</p>
            <label>
              <input
                type="checkbox"
                checked={historyOpen}
                onChange={(event) => setHistoryOpen(event.target.checked)}
              />
              Show opened papers
            </label>
          </div>
        </aside>
        <section className="paper-list" aria-label="Papers">
          {tab === 'search' ? (
            <>
              {busy === 'search' && <p className="muted">Searching for papers…</p>}
              {results.map((result) => (
                <article className="search-paper" key={result.id}>
                  <div className="result-meta">
                    {result.source} · {result.year}
                  </div>
                  <h2>{result.title}</h2>
                  <p className="paper-authors">{result.authors}</p>
                  <p className="result-abstract">{result.abstract}</p>
                  <div>
                    <button
                      className="secondary-button"
                      disabled={!!busy || !result.pdfUrl}
                      onClick={() => void download(result, false)}
                    >
                      Open
                    </button>
                    <button
                      className="primary-button"
                      disabled={!!busy || !result.pdfUrl}
                      onClick={() => void download(result, true)}
                    >
                      {busy === result.id ? 'Downloading…' : 'Download'}
                    </button>
                    {!result.pdfUrl && <span className="muted">No direct PDF available</span>}
                  </div>
                </article>
              ))}
              {!results.length && !busy && (
                <div className="library-empty">
                  <Icon name="paper" size={27} />
                  <h2>Follow your curiosity.</h2>
                  <p>Search by title, author, or a few keywords.</p>
                </div>
              )}
            </>
          ) : (
            <>
              {papers.map((paper) => (
                <article
                  key={paper.id}
                  className={`library-paper ${selected === paper.id ? 'selected' : ''}`}
                  tabIndex={0}
                  onFocus={() => setSelected(paper.id)}
                  onClick={() => setSelected(paper.id)}
                  onDoubleClick={() => onOpen(paper)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpen(paper)
                  }}
                >
                  <div className="paper-glyph">
                    <Icon name="paper" size={20} />
                  </div>
                  <div>
                    <h2>{paper.title}</h2>
                    <p>{paper.author || paper.filename}</p>
                    <span>
                      {paper.pageCount
                        ? `${paper.pageCount} pages`
                        : paper.status === 'indexing'
                          ? 'Indexing…'
                          : 'PDF'}{' '}
                      · {paper.folder || (paper.saved ? 'Unfiled' : 'Opened temporarily')}
                      {paper.summary?.[library.settings.summaryFormat]?.status === 'ready'
                        ? ' · Summary ready'
                        : ''}
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Open ${paper.title}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(paper)
                    }}
                  >
                    <Icon name="right" size={18} />
                  </button>
                </article>
              ))}
              {!papers.length && (
                <div className="library-empty">
                  <Icon name="paper" size={28} />
                  <h2>
                    {tab === 'citations' ? 'Ideas are connected.' : 'Your next idea starts here.'}
                  </h2>
                  <p>
                    {tab === 'citations'
                      ? 'Papers downloaded from citations appear here automatically.'
                      : 'Open a PDF, drop one here, or discover a paper online.'}
                  </p>
                  <button className="secondary-button" onClick={onSample}>
                    Read the sample paper
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        {current && tab !== 'search' && (
          <aside className="quick-summary">
            <span className="eyebrow">A CLOSER LOOK</span>
            <h2>{current.title}</h2>
            <div className="quick-actions">
              <button className="primary-button" onClick={() => onOpen(current)}>
                Read paper
              </button>
              {!current.saved && (
                <button
                  className="secondary-button"
                  disabled={!!busy}
                  onClick={() =>
                    void task('save', () =>
                      invoke('paper/save', {
                        id: current.id,
                        folder: folder === 'all' ? '' : folder,
                      }),
                    )
                  }
                >
                  Save to library
                </button>
              )}
            </div>
            {current.saved && !current.citedBy.length && (
              <label className="move-label">
                Folder
                <select
                  aria-label="Move paper to folder"
                  value={current.folder}
                  onChange={(event) =>
                    void task('move', () =>
                      invoke('paper/move', { id: current.id, folder: event.target.value }),
                    )
                  }
                >
                  {library.folders
                    .filter((name) => name !== 'citations')
                    .map((name) => (
                      <option key={name} value={name}>
                        {name || 'Unfiled'}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {current.citedBy.length > 0 && (
              <p className="muted">
                Cited by{' '}
                {current.citedBy
                  .map((id) => library.papers.find((p) => p.id === id)?.title || 'another paper')
                  .join(', ')}
              </p>
            )}
            <div className="summary-heading">
              <h3>Quick summary</h3>
              <select
                aria-label="Quick summary format"
                value={library.settings.summaryFormat}
                onChange={(event) =>
                  void invoke<Settings>('settings/save', {
                    summaryFormat: event.target.value,
                  }).then(onSettings)
                }
              >
                <option value="bullets">Bullets</option>
                <option value="paragraph">Paragraph</option>
              </select>
            </div>
            {summary?.text ? (
              <Answer
                text={summary.text}
                sources={summary.sources}
                onSource={(source) => onSource(current, source)}
              />
            ) : (
              <>
                <p className="muted">
                  {summary?.status === 'working'
                    ? 'Reading and summarizing in the background…'
                    : 'Get the question, method, and main findings at a glance.'}
                </p>
                {summary?.error && <p className="inline-error">{summary.error}</p>}
                <button
                  className="secondary-button"
                  disabled={summary?.status === 'working' || !!busy}
                  onClick={() =>
                    void task('summary', () =>
                      invoke('paper/summary', {
                        id: current.id,
                        format: library.settings.summaryFormat,
                      }),
                    )
                  }
                >
                  Summarize paper
                </button>
              </>
            )}
          </aside>
        )}
      </div>
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close settings"
              onClick={() => setSettingsOpen(false)}
            >
              <Icon name="close" />
            </button>
            <SettingsPanel settings={library.settings} onSettings={onSettings} />
          </section>
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop">
          <form
            className="simple-modal"
            role="dialog"
            aria-modal="true"
            aria-label={dialog === 'download' ? 'Add paper from URL' : 'Manage folder'}
            onSubmit={(event) => {
              event.preventDefault()
              void task(dialog, async () => {
                if (dialog === 'download') {
                  const paper = await invoke<PaperRecord>('paper/download', {
                    url: value,
                    save: true,
                    folder: folder === 'all' ? '' : folder,
                  })
                  setSelected(paper.id)
                } else {
                  await invoke('library/folder', {
                    operation: dialog === 'folder' ? 'create' : 'rename',
                    name: dialog === 'folder' ? value : folder,
                    next: value,
                  })
                  if (dialog === 'rename') setFolder(value)
                }
                setDialog(null)
              })
            }}
          >
            <h2>
              {dialog === 'download'
                ? 'Bring a paper to your desk.'
                : dialog === 'folder'
                  ? 'A home for related ideas.'
                  : 'Rename folder'}
            </h2>
            <label>
              {dialog === 'download' ? 'PDF URL or arXiv ID' : 'Folder name'}
              <input
                autoFocus
                required
                aria-label={dialog === 'download' ? 'Paper URL' : 'Folder name'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={
                  dialog === 'download' ? 'https://arxiv.org/abs/…' : 'e.g. Computer vision'
                }
              />
            </label>
            {problem && (
              <p role="alert" className="inline-error">
                {problem}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={!!busy}>
                {busy ? 'Working…' : dialog === 'download' ? 'Download paper' : 'Save folder'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
