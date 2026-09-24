import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icons'
import type { OutlineItem, Paper } from './usePaper'

export type PanelTab = 'paper' | 'chat'
export type Tone = 'warm' | 'light' | 'night'
export type Passage = { text: string; page: number }

export function SidePanel({
  tab,
  setTab,
  onClose,
  paper,
  page,
  goToPage,
  openFile,
  error,
  clearError,
  width,
  setWidth,
  tone,
  setTone,
  chat,
  actions,
  references,
  commandKey,
  loading,
}: {
  tab: PanelTab
  setTab: (tab: PanelTab) => void
  onClose: () => void
  paper: Paper | null
  page: number
  goToPage: (page: number) => void
  openFile: () => void
  error: string
  clearError: () => void
  width: number
  setWidth: (width: number) => void
  tone: Tone
  setTone: (tone: Tone) => void
  chat: ReactNode
  actions: ReactNode
  references: ReactNode
  commandKey: string
  loading: boolean
}) {
  const panelRef = useRef<HTMLElement>(null)
  const focusTab = useRef(false)
  const [jumpPage, setJumpPage] = useState(String(page))

  useEffect(() => setJumpPage(String(page)), [page])
  useEffect(() => {
    if (focusTab.current) {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
        ?.focus()
      focusTab.current = false
    } else if (tab === 'chat')
      panelRef.current
        ?.querySelector<HTMLTextAreaElement>('textarea')
        ?.focus({ preventScroll: true })
    else panelRef.current?.focus({ preventScroll: true })
  }, [tab])

  async function navigate(item: OutlineItem) {
    if (!paper || !item.dest) return
    try {
      const destination =
        typeof item.dest === 'string' ? await paper.pdf.getDestination(item.dest) : item.dest
      if (!destination) return
      const reference = destination[0]
      const index =
        typeof reference === 'number' ? reference : await paper.pdf.getPageIndex(reference)
      goToPage(index + 1)
    } catch {
      /* A malformed PDF bookmark must not interrupt reading. */
    }
  }

  return (
    <aside ref={panelRef} className="side-panel" tabIndex={-1} aria-label="Reading panel">
      <header className="panel-header">
        <div className="panel-tabs" role="tablist" aria-label="Reading tools">
          <button
            id="paper-tab"
            role="tab"
            aria-selected={tab === 'paper'}
            aria-controls="paper-panel"
            tabIndex={tab === 'paper' ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault()
                focusTab.current = true
                setTab('chat')
              }
            }}
            onClick={() => setTab('paper')}
          >
            Paper
          </button>
          <button
            id="chat-tab"
            role="tab"
            aria-selected={tab === 'chat'}
            aria-controls="chat-panel"
            tabIndex={tab === 'chat' ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault()
                focusTab.current = true
                setTab('paper')
              }
            }}
            onClick={() => setTab('chat')}
          >
            Assistant
          </button>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close panel"
          title="Back to reading · Esc"
        >
          <Icon name="panel" />
        </button>
      </header>

      {tab === 'paper' ? (
        <div className="paper-panel" id="paper-panel" role="tabpanel" aria-labelledby="paper-tab">
          <div className="panel-scroll">
            <div className="paper-info">
              <span className="eyebrow">ON YOUR DESK</span>
              <h1>{paper?.title ?? 'A little space to read.'}</h1>
              <p>
                {paper
                  ? `${paper.pdf.numPages} pages · PDF document`
                  : 'Open a paper and settle in.'}
              </p>
            </div>
            <button className="open-button" onClick={openFile} disabled={loading}>
              <Icon name="open" />
              <span>{loading ? 'Opening paper…' : 'Open a paper'}</span>
              <kbd>{commandKey}O</kbd>
            </button>
            <p className="drop-hint">You can also drop a PDF anywhere.</p>
            {actions}
            {error && (
              <div className="file-error" role="alert">
                <p>{error}</p>
                <button onClick={clearError} aria-label="Dismiss error">
                  <Icon name="close" size={15} />
                </button>
              </div>
            )}

            {paper && (
              <section className="control-section">
                <div className="section-label">PAGE</div>
                <div className="page-navigation">
                  <button
                    className="icon-button"
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1}
                    aria-label="Previous page"
                  >
                    <Icon name="left" size={17} />
                  </button>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      const number = Number(jumpPage)
                      if (Number.isInteger(number) && number >= 1 && number <= paper.pdf.numPages)
                        goToPage(number)
                      else setJumpPage(String(page))
                    }}
                  >
                    <input
                      aria-label="Page number"
                      type="number"
                      min={1}
                      max={paper.pdf.numPages}
                      value={jumpPage}
                      onChange={(event) => setJumpPage(event.target.value)}
                    />
                    <span>of {paper.pdf.numPages}</span>
                    <button type="submit" className="page-go" title="Go to page">
                      Go
                    </button>
                  </form>
                  <button
                    className="icon-button"
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= paper.pdf.numPages}
                    aria-label="Next page"
                  >
                    <Icon name="right" size={17} />
                  </button>
                </div>
              </section>
            )}

            <section className="control-section">
              <div className="section-heading">
                <span className="section-label">PAPER SIZE</span>
                <div className="size-buttons">
                  <button
                    className="icon-button"
                    disabled={width <= 480}
                    onClick={() => setWidth(Math.max(480, width - 80))}
                    aria-label="Smaller paper"
                  >
                    <Icon name="minus" size={15} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={width >= 1600}
                    onClick={() => setWidth(Math.min(1600, width + 80))}
                    aria-label="Larger paper"
                  >
                    <Icon name="plus" size={15} />
                  </button>
                </div>
              </div>
              <div className="segmented-control">
                {[
                  { label: 'Compact', width: 720 },
                  { label: 'Comfort', width: 880 },
                  { label: 'Fit width', width: 1600 },
                ].map((item) => (
                  <button
                    key={item.label}
                    aria-pressed={width === item.width}
                    onClick={() => setWidth(item.width)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
            <section className="control-section">
              <div className="section-label">CANVAS</div>
              <div className="tone-options" role="group" aria-label="Canvas appearance">
                {(['warm', 'light', 'night'] as const).map((value) => (
                  <button
                    key={value}
                    className="tone-option"
                    aria-pressed={tone === value}
                    onClick={() => setTone(value)}
                  >
                    <span className={`tone-swatch ${value}`}>
                      {tone === value && <Icon name="check" size={14} />}
                    </span>
                    <span>{value === 'warm' ? 'Warm' : value === 'light' ? 'Light' : 'Night'}</span>
                  </button>
                ))}
              </div>
            </section>

            {paper && (
              <section className="control-section contents-section">
                <div className="section-label">CONTENTS</div>
                {paper.outline.length ? (
                  <Outline items={paper.outline} navigate={navigate} />
                ) : (
                  <p className="empty-contents">
                    This PDF has no section bookmarks.
                    <br />
                    Use the page number to move around.
                  </p>
                )}
              </section>
            )}
            {references}
          </div>
          <footer className="panel-footer">
            <details className="shortcuts">
              <summary>
                <Icon name="shortcut" size={15} />
                <span>Keyboard shortcuts</span>
                <Icon name="down" size={14} />
              </summary>
              <dl>
                <div>
                  <dt>Open a paper</dt>
                  <dd>
                    <kbd>{commandKey}O</kbd>
                  </dd>
                </div>
                <div>
                  <dt>Toggle assistant</dt>
                  <dd>
                    <kbd>{commandKey}L</kbd>
                  </dd>
                </div>
                <div>
                  <dt>Reading controls</dt>
                  <dd>
                    <kbd>{commandKey}⇧L</kbd>
                  </dd>
                </div>
                <div>
                  <dt>Return to paper</dt>
                  <dd>
                    <kbd>Esc</kbd>
                  </dd>
                </div>
                <div>
                  <dt>Paper size</dt>
                  <dd>
                    <kbd>{commandKey}+ / −</kbd>
                  </dd>
                </div>
                <div>
                  <dt>Reset size</dt>
                  <dd>
                    <kbd>{commandKey}0</kbd>
                  </dd>
                </div>
              </dl>
            </details>
            <div className="footer-note">
              <span>pepe</span>
              <span>A little space to read.</span>
            </div>
          </footer>
        </div>
      ) : (
        chat
      )}
    </aside>
  )
}

function Outline({
  items,
  navigate,
  depth = 0,
}: {
  items: OutlineItem[]
  navigate: (item: OutlineItem) => void
  depth?: number
}) {
  return (
    <ul className="outline">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          <button
            disabled={!item.dest}
            style={{ paddingLeft: 10 + depth * 12 }}
            onClick={() => navigate(item)}
          >
            {item.title}
          </button>
          {item.items.length > 0 && (
            <Outline items={item.items} navigate={navigate} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  )
}
