import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icons'
import type { ReaderHandle, PaperInteraction } from './PdfReader'
const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
)
import { SidePanel, type PanelTab, type Passage, type Tone } from './SidePanel'
import { usePaper } from './usePaper'
import { Dashboard } from './Dashboard'
import { ChatPanel } from './ChatPanel'
import { PaperPopover } from './PaperPopover'
import { invoke } from './api'
import type { LibraryState, PaperIndex, PaperRecord, Settings, Source } from './types'

const initialLibrary: LibraryState = {
  root: '',
  folders: ['', 'citations'],
  papers: [],
  settings: {
    model: 'gpt-6-astra',
    effort: 'medium',
    verbosity: 'medium',
    fast: false,
    autoSummary: true,
    summaryFormat: 'bullets',
  },
}
function savedPreferences(): { width: number; tone: Tone } {
  try {
    const value = JSON.parse(localStorage.getItem('pepe:reading-preferences') || '{}')
    return {
      width: Number.isFinite(value.width) ? Math.max(480, Math.min(1600, value.width)) : 880,
      tone: ['warm', 'light', 'night'].includes(value.tone) ? value.tone : 'warm',
    }
  } catch {
    return { width: 880, tone: 'warm' }
  }
}
export function App() {
  const { paper, loading, error, openFile, openRecord, openSample, close, clearError } = usePaper()
  const [library, setLibrary] = useState<LibraryState>(initialLibrary)
  const [problem, setProblem] = useState(''),
    [index, setIndex] = useState<PaperIndex | null>(null)
  const [panel, setPanel] = useState<PanelTab | null>(null),
    [preferences, setPreferences] = useState(savedPreferences)
  const [page, setPage] = useState(1),
    [passage, setPassage] = useState<Passage | null>(null),
    [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false),
    [interaction, setInteraction] = useState<PaperInteraction | null>(null),
    [requestedChatId, setRequestedChatId] = useState('')
  const [backStack, setBackStack] = useState<PaperRecord[]>([])
  const dragDepth = useRef(0),
    inputRef = useRef<HTMLInputElement>(null),
    readerRef = useRef<ReaderHandle>(null),
    pendingSource = useRef<Source | null>(null)
  const attachReader = useCallback((reader: ReaderHandle | null) => {
    readerRef.current = reader
    if (reader && pendingSource.current) {
      const source = pendingSource.current
      pendingSource.current = null
      requestAnimationFrame(() => reader.goToSource(source))
    }
  }, [])
  const isMac =
      window.pepe?.platform === 'darwin' || navigator.platform.toLowerCase().includes('mac'),
    commandKey = isMac ? '⌘' : 'Ctrl+'
  const record = library.papers.find((p) => p.id === paper?.record?.id) || paper?.record
  const refresh = useCallback(() => {
    if (window.pepe)
      void invoke<LibraryState>('library/state')
        .then(setLibrary)
        .catch((error) => setProblem(error.message))
  }, [])
  useEffect(() => {
    refresh()
    let timer: ReturnType<typeof setTimeout>
    const off = window.pepe?.onEvent((event) => {
      if (event.type === 'library') {
        clearTimeout(timer)
        timer = setTimeout(refresh, 100)
      }
      if (event.type === 'problem') setProblem(event.error || '')
    })
    return () => {
      off?.()
      clearTimeout(timer)
    }
  }, [refresh])
  useEffect(() => {
    let cancelled = false
    setIndex(null)
    if (paper?.record)
      void invoke<PaperIndex>('paper/index', { id: paper.record.id })
        .then((value) => {
          if (!cancelled) setIndex(value)
        })
        .catch((error) => {
          if (!cancelled) setProblem(`Paper indexing: ${error.message}`)
        })
    return () => {
      cancelled = true
    }
  }, [paper?.record?.id])
  const closePanel = useCallback(() => {
    setPanel(null)
    requestAnimationFrame(() => readerRef.current?.focus())
  }, [])
  const closePopover = useCallback(() => setInteraction(null), [])
  const showPaper = useCallback(
    async (next: PaperRecord) => {
      if (paper?.record && next.id !== paper.record.id)
        setBackStack((stack) => [...stack.slice(-19), paper.record!])
      setInteraction(null)
      setProblem('')
      await openRecord(next)
    },
    [paper?.record, openRecord],
  )
  const sample = async () => {
    try {
      if (window.pepe) await showPaper(await invoke<PaperRecord>('paper/sample'))
      else await openSample()
    } catch (error) {
      setProblem((error as Error).message)
    }
  }
  const local = async (file: File) => {
    setProblem('')
    try {
      if (window.pepe) await showPaper(await window.pepe.openFile(file))
      else await openFile(file)
    } catch (error) {
      setProblem((error as Error).message)
      if (paper) setPanel('paper')
    }
  }
  const onSource = useCallback((source: Source) => {
    setInteraction(null)
    readerRef.current?.goToSource(source)
  }, [])
  const onSettings = useCallback(
    (settings: Settings) => setLibrary((value) => ({ ...value, settings })),
    [],
  )
  const toggleChat = useCallback(() => {
    if (!paper) return
    const selection = window.getSelection(),
      node = selection?.anchorNode,
      element = node instanceof Element ? node : node?.parentElement,
      pageElement = element?.closest<HTMLElement>('.pdf-page'),
      text = selection?.toString().trim()
    if (pageElement && text) {
      setPassage({ text, page: Number(pageElement.dataset.pageNumber) })
      selection?.removeAllRanges()
    }
    setInteraction(null)
    setPanel((current) => (current === 'chat' ? null : 'chat'))
  }, [paper])
  const openChooser = useCallback(() => inputRef.current?.click(), [])
  const setWidth = useCallback(
    (width: number) => setPreferences((value) => ({ ...value, width })),
    [],
  )
  const setTone = useCallback((tone: Tone) => setPreferences((value) => ({ ...value, tone })), [])
  const runCommand = useCallback(
    (command: ReaderCommand) => {
      if (command === 'toggle-chat') toggleChat()
      if (command === 'toggle-paper' && paper)
        setPanel((current) => (current === 'paper' ? null : 'paper'))
      if (command === 'open-paper') openChooser()
      if (command === 'zoom-in')
        setPreferences((value) => ({ ...value, width: Math.min(1600, value.width + 80) }))
      if (command === 'zoom-out')
        setPreferences((value) => ({ ...value, width: Math.max(480, value.width - 80) }))
      if (command === 'reset-zoom') setWidth(880)
    },
    [toggleChat, paper, openChooser, setWidth],
  )
  useEffect(() => window.pepe?.onCommand(runCommand), [runCommand])
  useEffect(() => {
    if (panel !== null || !paper) return
    const frame = requestAnimationFrame(() => readerRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [panel, paper?.pdf])
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        setInteraction(null)
        closePanel()
        return
      }
      if (!(isMac ? event.metaKey : event.ctrlKey)) return
      const key = event.key.toLowerCase(),
        command: ReaderCommand | undefined =
          key === 'l'
            ? event.shiftKey
              ? 'toggle-paper'
              : 'toggle-chat'
            : key === 'o'
              ? 'open-paper'
              : key === '+' || key === '='
                ? 'zoom-in'
                : key === '-'
                  ? 'zoom-out'
                  : key === '0'
                    ? 'reset-zoom'
                    : undefined
      if (command) {
        event.preventDefault()
        runCommand(command)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [closePanel, isMac, runCommand])
  useEffect(() => {
    try {
      localStorage.setItem('pepe:reading-preferences', JSON.stringify(preferences))
    } catch {
      /* Optional local preference storage. */
    }
  }, [preferences])
  useEffect(() => {
    if (error && paper) setPanel('paper')
  }, [error, paper])
  useEffect(() => {
    if (!paper) {
      document.title = 'Pepe — Your reading room'
      return
    }
    document.title = `${paper.title} — Pepe`
    setPage(1)
    setPassage(null)
    setDraft('')
    setPanel(null)
    setRequestedChatId('')
    setInteraction(null)
    requestAnimationFrame(() => {
      readerRef.current?.focus()
      if (pendingSource.current && readerRef.current) {
        readerRef.current.goToSource(pendingSource.current)
        pendingSource.current = null
      }
    })
  }, [paper?.pdf])
  const goToPage = useCallback(
    (number: number) => {
      if (paper && number >= 1 && number <= paper.pdf.numPages) readerRef.current?.goToPage(number)
    },
    [paper],
  )
  const home = () => {
    close()
    setPanel(null)
    setInteraction(null)
    refresh()
  }
  return (
    <div
      className={`app ${panel && paper ? 'has-panel' : ''}`}
      data-tone={preferences.tone}
      onDragEnter={(event) => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) {
          dragDepth.current++
          setDragging(true)
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        dragDepth.current = 0
        const file = event.dataTransfer.files[0]
        if (file) void local(file)
      }}
    >
      {paper ? (
        <div className="reading-workspace">
          <header className="titlebar">
            <button
              className="paper-tab"
              aria-label="Open reading controls"
              aria-expanded={panel === 'paper'}
              title={`Reading controls · ${commandKey}⇧L`}
              onClick={() => (panel === 'paper' ? closePanel() : setPanel('paper'))}
            >
              <Icon name="paper" size={14} />
              <span>{record?.title || paper.title}</span>
              <Icon name="down" size={11} />
            </button>
          </header>
          <Suspense fallback={<div className="loading-indicator">Opening paper…</div>}>
            <PdfReader
              key={paper.pdf.loadingTask.docId}
              ref={attachReader}
              paper={paper}
              preferredWidth={preferences.width}
              onPageChange={setPage}
              index={index}
              onInteraction={(interaction) => {
                if (record) setInteraction(interaction)
              }}
            />
          </Suspense>
        </div>
      ) : (
        <Dashboard
          library={library}
          error={problem || error}
          onOpen={(record) => void showPaper(record)}
          onFile={openChooser}
          onSample={() => void sample()}
          onRefresh={refresh}
          onSettings={onSettings}
          onSource={(record, source) => {
            pendingSource.current = source
            void showPaper(record)
          }}
        />
      )}
      {loading && (
        <div className="loading-indicator" role="status">
          Opening paper…
        </div>
      )}
      {panel && paper && (
        <>
          <button
            className="panel-scrim"
            tabIndex={-1}
            aria-label="Return to paper"
            onClick={closePanel}
          />
          <SidePanel
            tab={panel}
            setTab={setPanel}
            onClose={closePanel}
            paper={paper}
            page={page}
            goToPage={goToPage}
            openFile={openChooser}
            error={problem || error}
            clearError={() => {
              clearError()
              setProblem('')
            }}
            width={preferences.width}
            setWidth={setWidth}
            tone={preferences.tone}
            setTone={setTone}
            commandKey={commandKey}
            loading={loading}
            actions={
              <div className="reader-actions">
                <button className="secondary-button" onClick={home}>
                  ← Your library
                </button>
                {record && !record.saved && (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void invoke('paper/save', { id: record.id })
                        .then(refresh)
                        .catch((error) => setProblem(error.message))
                    }
                  >
                    Save paper
                  </button>
                )}
                {backStack.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() => {
                      const previous = backStack[backStack.length - 1]
                      setBackStack((stack) => stack.slice(0, -1))
                      void openRecord(previous)
                    }}
                  >
                    ← Previous paper
                  </button>
                )}
              </div>
            }
            references={
              index && index.references.length > 0 ? (
                <details className="reference-list">
                  <summary>References · {index.references.length}</summary>
                  {index.references.map((reference) => (
                    <button
                      key={reference.id}
                      onClick={(event) => {
                        const box = event.currentTarget.getBoundingClientRect()
                        setInteraction({
                          kind: 'citation',
                          referenceIds: [reference.id],
                          x: box.left - 400,
                          y: box.top,
                        })
                      }}
                    >
                      {reference.number ? `[${reference.number}] ` : ''}
                      {reference.title}
                    </button>
                  ))}
                </details>
              ) : null
            }
            chat={
              <ChatPanel
                paper={paper}
                index={index}
                page={page}
                passage={passage}
                setPassage={setPassage}
                draft={draft}
                setDraft={setDraft}
                settings={library.settings}
                onSettings={onSettings}
                onSource={onSource}
                commandKey={commandKey}
                requestedChatId={requestedChatId}
              />
            }
          />
        </>
      )}
      {interaction && record && (
        <PaperPopover
          key={
            interaction.kind === 'citation'
              ? interaction.referenceIds.join(',')
              : interaction.visual.id
          }
          interaction={interaction}
          paper={record}
          index={index}
          onClose={closePopover}
          onOpen={(record) => void showPaper(record)}
          onSource={onSource}
          onContinue={(chatId) => {
            setRequestedChatId(chatId)
            localStorage.setItem(`pepe:chat:${record.id}`, chatId)
            setInteraction(null)
            setPanel('chat')
          }}
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="file-input"
        aria-label="Choose a PDF"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void local(file)
        }}
      />
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Icon name="paper" size={30} />
            <h2>Make room for a new idea.</h2>
            <p>Drop your PDF to start reading.</p>
          </div>
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {paper ? `Page ${page} of ${paper.pdf.numPages}` : ''}
      </div>
    </div>
  )
}
