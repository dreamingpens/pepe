import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icons'
import { PdfReader, type ReaderHandle } from './PdfReader'
import { SidePanel, type PanelTab, type Passage, type Tone } from './SidePanel'
import { usePaper } from './usePaper'

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
  const { paper, loading, error, openFile, clearError } = usePaper()
  const [panel, setPanel] = useState<PanelTab | null>(null)
  const [preferences, setPreferences] = useState(savedPreferences)
  const [page, setPage] = useState(1)
  const [passage, setPassage] = useState<Passage | null>(null)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const readerRef = useRef<ReaderHandle>(null)
  const isMac =
    window.pepe?.platform === 'darwin' || navigator.platform.toLowerCase().includes('mac')
  const commandKey = isMac ? '⌘' : 'Ctrl+'

  const closePanel = useCallback(() => {
    setPanel(null)
    requestAnimationFrame(() => readerRef.current?.focus())
  }, [])

  const toggleChat = useCallback(() => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    const pageElement = element?.closest<HTMLElement>('.pdf-page')
    const text = selection?.toString().trim()
    if (pageElement && text) {
      setPassage({ text, page: Number(pageElement.dataset.pageNumber) })
      selection?.removeAllRanges()
    }
    setPanel((current) => (current === 'chat' ? null : 'chat'))
  }, [])

  const openChooser = useCallback(() => inputRef.current?.click(), [])
  const setWidth = useCallback(
    (width: number) => setPreferences((value) => ({ ...value, width })),
    [],
  )
  const setTone = useCallback((tone: Tone) => setPreferences((value) => ({ ...value, tone })), [])

  const runCommand = useCallback(
    (command: ReaderCommand) => {
      if (command === 'toggle-chat') toggleChat()
      if (command === 'toggle-paper') setPanel((current) => (current === 'paper' ? null : 'paper'))
      if (command === 'open-paper') openChooser()
      if (command === 'zoom-in')
        setPreferences((value) => ({ ...value, width: Math.min(1600, value.width + 80) }))
      if (command === 'zoom-out')
        setPreferences((value) => ({ ...value, width: Math.max(480, value.width - 80) }))
      if (command === 'reset-zoom') setWidth(880)
    },
    [toggleChat, openChooser, setWidth],
  )

  useEffect(() => window.pepe?.onCommand(runCommand), [runCommand])
  useEffect(() => {
    if (panel !== null) return
    const frame = requestAnimationFrame(() => readerRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [panel])
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanel()
        return
      }
      if (!(isMac ? event.metaKey : event.ctrlKey)) return
      const key = event.key.toLowerCase()
      // Native input is consumed by Electron before reaching the page. This also handles
      // browser-preview input and accessibility/automation events delivered directly to the DOM.
      const command: ReaderCommand | undefined =
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
      /* Private browsing may block persistence. */
    }
  }, [preferences])
  useEffect(() => {
    if (error) setPanel('paper')
  }, [error])
  useEffect(() => {
    if (!paper) return
    document.title = `${paper.title} — Pepe`
    setPage(1)
    setPassage(null)
    setDraft('')
    setPanel(null)
    requestAnimationFrame(() => readerRef.current?.focus())
  }, [paper])

  const goToPage = useCallback(
    (number: number) => {
      if (paper && number >= 1 && number <= paper.pdf.numPages) readerRef.current?.goToPage(number)
    },
    [paper],
  )

  return (
    <div
      className={`app ${panel ? 'has-panel' : ''}`}
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
        if (file) void openFile(file)
      }}
    >
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
            <span>{paper?.title ?? 'Pepe'}</span>
            <Icon name="down" size={11} />
          </button>
        </header>
        {paper ? (
          <PdfReader
            key={paper.pdf.loadingTask.docId}
            ref={readerRef}
            paper={paper}
            preferredWidth={preferences.width}
            onPageChange={setPage}
          />
        ) : (
          <main className="empty-reader">
            <div>
              <span className="empty-wordmark">pepe</span>
              <h1>A little space to read.</h1>
              <p>{loading ? 'Opening your paper…' : 'Drop a PDF here, or open one to begin.'}</p>
              {!loading && (
                <button className="open-button" onClick={openChooser}>
                  <Icon name="open" size={17} />
                  Open a paper<kbd>{commandKey}O</kbd>
                </button>
              )}
            </div>
          </main>
        )}
        {loading && paper && (
          <div className="loading-indicator" role="status">
            Opening paper…
          </div>
        )}
      </div>

      {panel && (
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
            error={error}
            clearError={clearError}
            width={preferences.width}
            setWidth={setWidth}
            tone={preferences.tone}
            setTone={setTone}
            passage={passage}
            setPassage={setPassage}
            draft={draft}
            setDraft={setDraft}
            commandKey={commandKey}
            loading={loading}
          />
        </>
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
          if (file) void openFile(file)
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
        {paper ? `Page ${page} of ${paper.pdf.numPages}` : loading ? 'Loading paper' : ''}
      </div>
    </div>
  )
}
