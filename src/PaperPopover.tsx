import { useEffect, useRef, useState } from 'react'
import { invoke } from './api'
import { Answer } from './Answer'
import { Icon } from './Icons'
import type { PaperInteraction } from './PdfReader'
import type { Chat, PaperIndex, PaperRecord, SearchResult, Source, Summary } from './types'

export function PaperPopover({
  interaction,
  paper,
  index,
  onClose,
  onOpen,
  onSource,
  onContinue,
}: {
  interaction: PaperInteraction
  paper: PaperRecord
  index: PaperIndex | null
  onClose: () => void
  onOpen: (paper: PaperRecord) => void
  onSource: (source: Source) => void
  onContinue: (chatId: string) => void
}) {
  const [referenceId, setReferenceId] = useState(
    interaction.kind === 'citation' ? interaction.referenceIds[0] : '',
  )
  const reference = index?.references.find((reference) => reference.id === referenceId)
  const [result, setResult] = useState<SearchResult | null>(null),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [answer, setAnswer] = useState(''),
    [sources, setSources] = useState<Source[]>([]),
    [chatId, setChatId] = useState(''),
    [summaryPaper, setSummaryPaper] = useState<PaperRecord | null>(null)
  const [url, setUrl] = useState('')
  const popup = useRef<HTMLElement>(null)
  useEffect(() => {
    popup.current?.focus()
    const dismiss = (event: MouseEvent) => {
      if (!popup.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', escape, true)
    }
  }, [onClose])
  useEffect(() => {
    if (!referenceId) return
    let cancelled = false
    setBusy('resolve')
    setError('')
    setAnswer('')
    setSources([])
    setSummaryPaper(null)
    setResult(null)
    setUrl('')
    void invoke<SearchResult | null>('paper/resolve', {
      paperId: paper.id,
      referenceId,
      refresh: attempt > 0,
    })
      .then((value) => {
        if (!cancelled) setResult(value)
      })
      .catch((error) => {
        if (!cancelled) setError(error.message)
      })
      .finally(() => {
        if (!cancelled) setBusy('')
      })
    return () => {
      cancelled = true
    }
  }, [referenceId, paper.id, attempt])
  useEffect(
    () =>
      window.pepe?.onEvent((event) => {
        if (event.type !== 'answer' || event.chatId !== chatId) return
        if (event.status === 'streaming') setAnswer(event.text || '')
        else {
          setBusy('')
          setAnswer(event.message?.text || '')
          setSources(event.message?.sources || [])
          setError(event.error || '')
        }
      }),
    [chatId],
  )
  async function citationAction(action: 'open' | 'save' | 'summary') {
    setBusy(action)
    setError('')
    try {
      const opened = await invoke<PaperRecord>('paper/download', {
        url: url || result?.pdfUrl,
        title: result?.title || reference?.title,
        save: action === 'save',
        citedBy: paper.id,
      })
      if (action === 'open') onOpen(opened)
      if (action === 'save') {
        setAnswer('Saved to your citations folder.')
        setSources([])
        setSummaryPaper(null)
      }
      if (action === 'summary') {
        const summary = await invoke<Summary>('paper/summary', { id: opened.id })
        setAnswer(summary.text || '')
        setSources(summary.sources || [])
        setSummaryPaper(opened)
      }
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy('')
    }
  }
  async function explain() {
    if (interaction.kind !== 'visual') return
    setBusy('explain')
    setError('')
    try {
      const chat = await invoke<Chat>('chat/new', { paperId: paper.id })
      setChatId(chat.id)
      await invoke('chat/send', {
        chatId: chat.id,
        text: `Explain ${interaction.visual.label} on page ${interaction.visual.page}. Describe its components, notation, and what it demonstrates, grounded in the paper.`,
        page: interaction.visual.page,
        visual: interaction.visual,
      })
    } catch (error) {
      setError((error as Error).message)
      setBusy('')
    }
  }
  const liveSources =
    index?.pages.flatMap((page) =>
      page.lines.map((line) => ({ page: page.number, line: line.id, y: line.y, text: line.text })),
    ) || []
  return (
    <section
      className="paper-popover"
      ref={popup}
      tabIndex={-1}
      role="dialog"
      aria-label={interaction.kind === 'citation' ? 'Cited paper' : 'Figure or formula explanation'}
      style={{
        left: Math.max(12, Math.min(interaction.x + 12, window.innerWidth - 422)),
        top: Math.max(12, Math.min(interaction.y + 12, window.innerHeight - 510)),
      }}
    >
      <header>
        <span className="eyebrow">
          {interaction.kind === 'citation'
            ? 'FOLLOW THE REFERENCE'
            : `A CLOSER LOOK · PAGE ${interaction.visual.page}`}
        </span>
        <button className="icon-button" aria-label="Close popup" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>
      {interaction.kind === 'citation' ? (
        <>
          {interaction.referenceIds.length > 1 && (
            <nav className="citation-navigation" aria-label="Cited papers">
              <button
                className="icon-button"
                aria-label="Previous citation"
                disabled={
                  interaction.referenceIds.indexOf(referenceId) === 0 ||
                  (!!busy && busy !== 'resolve')
                }
                onClick={() =>
                  setReferenceId(
                    interaction.referenceIds[interaction.referenceIds.indexOf(referenceId) - 1],
                  )
                }
              >
                <Icon name="left" size={15} />
              </button>
              <span>
                {interaction.referenceIds.indexOf(referenceId) + 1} of{' '}
                {interaction.referenceIds.length} references
              </span>
              <button
                className="icon-button"
                aria-label="Next citation"
                disabled={
                  interaction.referenceIds.indexOf(referenceId) ===
                    interaction.referenceIds.length - 1 ||
                  (!!busy && busy !== 'resolve')
                }
                onClick={() =>
                  setReferenceId(
                    interaction.referenceIds[interaction.referenceIds.indexOf(referenceId) + 1],
                  )
                }
              >
                <Icon name="right" size={15} />
              </button>
            </nav>
          )}
          <h2>{result?.title || reference?.title || 'Cited paper'}</h2>
          {result && (
            <p className="citation-match">
              {result.authors && <span>{result.authors}</span>}
              <span>{[result.year, result.source].filter(Boolean).join(' · ')}</span>
            </p>
          )}
          <details className="citation-original">
            <summary>Citation in this paper</summary>
            <p className="citation-bibliography">{reference?.text}</p>
          </details>
          {busy === 'resolve' && (
            <p className="muted" role="status">
              Finding the cited paper…
            </p>
          )}
          {!result?.pdfUrl && busy !== 'resolve' && (
            <>
              <p className="muted">
                {result
                  ? 'The paper was identified, but no public PDF was found.'
                  : 'No confident match found for this citation.'}
              </p>
              <button
                className="text-button"
                onClick={() => setAttempt((value) => value + 1)}
                disabled={!!busy}
              >
                Retry search
              </button>
              <details className="citation-original">
                <summary>Use a PDF link</summary>
                <input
                  aria-label="Citation PDF URL"
                  value={url}
                  placeholder="https://…/paper.pdf"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </details>
            </>
          )}
          <div className="popover-actions">
            <button
              className="secondary-button"
              disabled={!!busy || (!url && !result?.pdfUrl)}
              onClick={() => void citationAction('open')}
            >
              Open
            </button>
            <button
              className="secondary-button"
              disabled={!!busy || (!url && !result?.pdfUrl)}
              onClick={() => void citationAction('summary')}
            >
              Summarize
            </button>
            <button
              className="primary-button"
              disabled={!!busy || (!url && !result?.pdfUrl)}
              onClick={() => void citationAction('save')}
            >
              Download
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>{interaction.visual.label}</h2>
          <p className="muted">
            The assistant will inspect the complete page, including the surrounding text and
            mathematical notation.
          </p>
          <button className="primary-button" disabled={!!busy} onClick={() => void explain()}>
            {answer ? 'Explain again' : 'Explain this'}
          </button>
        </>
      )}
      {busy && busy !== 'resolve' && (
        <p className="muted" role="status">
          {busy === 'explain'
            ? 'Inspecting the page…'
            : busy === 'summary'
              ? 'Reading the cited paper…'
              : 'Downloading paper…'}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <Answer
          text={answer}
          sources={
            interaction.kind === 'citation' ? sources : sources.length ? sources : liveSources
          }
          onSource={summaryPaper ? undefined : onSource}
        />
      )}
      {summaryPaper && (
        <button className="text-button" onClick={() => onOpen(summaryPaper)}>
          Read the cited paper →
        </button>
      )}
      {chatId && (
        <button className="text-button" onClick={() => onContinue(chatId)}>
          Continue in assistant →
        </button>
      )}
    </section>
  )
}
