import { lazy, Suspense } from 'react'
import type { Source } from './types'
const Content = lazy(() => import('./AnswerContent'))
export function Answer(props: {
  text: string
  sources?: Source[]
  onSource?: (source: Source) => void
}) {
  return (
    <Suspense fallback={<div className="answer-markdown">{props.text}</div>}>
      <Content {...props} />
    </Suspense>
  )
}
