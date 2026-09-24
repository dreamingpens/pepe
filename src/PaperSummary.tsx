import { useState } from 'react'
import { Answer } from './Answer'
import { Icon } from './Icons'
import { invoke } from './api'
import type { PaperRecord, Source } from './types'

export function PaperSummary({
  paper,
  onSource,
  onRefresh,
}: {
  paper: PaperRecord
  onSource: (source: Source) => void
  onRefresh: () => void
}) {
  const summary = paper.summary?.bullets
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  const working = requesting || summary?.status === 'working'

  async function summarize() {
    setRequesting(true)
    setError('')
    try {
      await invoke('paper/summary', {
        id: paper.id,
        format: 'bullets',
        force: !!summary?.text,
      })
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setRequesting(false)
      onRefresh()
    }
  }

  return (
    <section className="paper-summary" aria-label="Bullet summary">
      <details open>
        <summary>
          <span>Bullet summary</span>
          <Icon name="down" size={14} />
        </summary>
        {summary?.text && (
          <Answer text={summary.text} sources={summary.sources} onSource={onSource} />
        )}
        {(working || !summary?.text) && (
          <p className="muted" role={working ? 'status' : undefined}>
            {working
              ? summary?.text
                ? 'Updating summary…'
                : 'Reading and summarizing in the background…'
              : 'A short outline of the question, method, and findings.'}
          </p>
        )}
        {(error || summary?.error) && (
          <p className="inline-error" role="alert">
            {error || summary?.error}
          </p>
        )}
        <button
          className={summary?.text ? 'text-button summary-regenerate' : 'secondary-button'}
          disabled={working}
          onClick={() => void summarize()}
        >
          {summary?.text ? 'Regenerate summary' : 'Summarize paper'}
        </button>
      </details>
    </section>
  )
}
