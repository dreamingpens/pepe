import { createContext, useContext, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Source } from './types'
import 'katex/dist/katex.min.css'

const SourceContext = createContext<{
  sources: Map<string, Source>
  onSource?: (source: Source) => void
}>({ sources: new Map() })

function PaperLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { sources, onSource } = useContext(SourceContext)
  const match = href?.match(/^paper:\/\/page\/(\d+)(?:#line=([\w-]+))?$/)
  const source = match && sources.get(`${Number(match[1])}:${match[2] || ''}`)
  return source && onSource ? (
    <button
      type="button"
      className="source-link"
      title={source.text}
      onClick={() => onSource(source)}
    >
      {children}
    </button>
  ) : (
    <span title={href}>{children}</span>
  )
}

// Keep component identity stable across tokens: replacing the button between
// pointer-down and pointer-up causes the browser to discard its click.
const components: Components = { a: PaperLink }

export default function AnswerContent({
  text,
  sources = [],
  onSource,
}: {
  text: string
  sources?: Source[]
  onSource?: (source: Source) => void
}) {
  const sourceMap = useMemo(() => {
    const map = new Map<string, Source>()
    for (const source of sources) {
      map.set(`${source.page}:${source.line}`, source)
      if (!map.has(`${source.page}:`)) map.set(`${source.page}:`, source)
    }
    return map
  }, [sources])
  const context = useMemo(() => ({ sources: sourceMap, onSource }), [sourceMap, onSource])
  return (
    <SourceContext.Provider value={context}>
      <div className="answer-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          urlTransform={(url) =>
            url.startsWith('paper://') ? url : /^https?:/.test(url) ? url : ''
          }
          components={components}
        >
          {text}
        </ReactMarkdown>
      </div>
    </SourceContext.Provider>
  )
}
