export type Source = { page: number; line: string; y: number; text: string }
export type Summary = {
  status: 'working' | 'ready' | 'error'
  text?: string
  error?: string
  sources?: Source[]
  model?: string
}
export type Settings = {
  model: string
  effort: string
  verbosity: 'low' | 'medium' | 'high'
  fast: boolean
  summaryFormat: 'bullets' | 'paragraph'
  autoSummary: boolean
}
export type PaperRecord = {
  id: string
  title: string
  author: string
  filename: string
  url: string
  folder: string
  saved: boolean
  searchText?: string
  downloaded?: boolean
  sourceUrl?: string
  addedAt: number
  pageCount?: number
  status: string
  error?: string
  referenceCount?: number
  citedBy: string[]
  summary: Record<string, Summary>
}
export type LibraryState = {
  root: string
  folders: string[]
  papers: PaperRecord[]
  settings: Settings
}
export type SearchResult = {
  id: string
  title: string
  authors: string
  year: string
  abstract: string
  url: string
  pdfUrl: string
  source: string
}
export type Model = {
  id: string
  name: string
  efforts: string[]
  defaultEffort: string
  modalities: string[]
}
export type Account = {
  connected: boolean
  models: Model[]
  error?: string
  accountType?: string
  plan?: string
}
export type Citation = {
  id: string
  number: number | null
  text: string
  title: string
  page: number
  line: string
  y: number
  year: string
  arxiv?: string
  doi?: string
}
export type Line = {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  citations: { text: string; start: number; end: number; referenceIds: string[] }[]
}
export type Visual = {
  id: string
  kind: string
  label: string
  page: number
  y: number
  x: number
  width: number
  height: number
  line: string
  text: string
  point?: { x: number; y: number }
}
export type PageIndex = {
  number: number
  width: number
  height: number
  lines: Line[]
  visuals: Visual[]
  links: {
    x: number
    y: number
    width: number
    height: number
    target: { page: number; pdfY: number } | null
    dest: string
    url: string
  }[]
}
export type PaperIndex = {
  title: string
  author: string
  pages: PageIndex[]
  references: Citation[]
  elapsedMs: number
}
export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  error?: string
  passage?: { text: string; page: number }
  sources?: Source[]
  model?: string
  createdAt: number
}
export type Chat = {
  id: string
  paperId: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
  activeRequestId?: string
}
export type ReaderEvent = {
  type: string
  requestId?: string
  chatId?: string
  text?: string
  status?: string
  error?: string
  message?: ChatMessage
}
