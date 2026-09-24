import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from './api'
import { Icon } from './Icons'
import { Answer } from './Answer'
import { SettingsPanel } from './SettingsPanel'
import type { Chat, PaperIndex, Settings, Source } from './types'
import type { Paper } from './usePaper'
import type { Passage } from './SidePanel'

export function ChatPanel({
  paper,
  index,
  page,
  passage,
  setPassage,
  draft,
  setDraft,
  settings,
  onSettings,
  onSource,
  commandKey,
  requestedChatId,
}: {
  paper: Paper | null
  index: PaperIndex | null
  page: number
  passage: Passage | null
  setPassage: (passage: Passage | null) => void
  draft: string
  setDraft: (draft: string) => void
  settings: Settings
  onSettings: (settings: Settings) => void
  onSource: (source: Source) => void
  commandKey: string
  requestedChatId?: string
}) {
  const [chat, setChat] = useState<Chat | null>(null),
    [history, setHistory] = useState<Chat[]>([])
  const [view, setView] = useState<'chat' | 'history' | 'settings'>('chat')
  const [query, setQuery] = useState(''),
    [stream, setStream] = useState(''),
    [requestId, setRequestId] = useState(''),
    [error, setError] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    stick = useRef(true)
  const paperId = paper?.record?.id
  const remember = (chat: Chat) => {
    setChat(chat)
    localStorage.setItem(`pepe:chat:${paperId}`, chat.id)
  }
  useEffect(() => {
    let cancelled = false
    const id = requestedChatId || (paperId && localStorage.getItem(`pepe:chat:${paperId}`))
    if (id)
      void invoke<Chat & { activeRequestId?: string }>('chat/get', { id })
        .then((chat) => {
          if (!cancelled) {
            setChat(chat)
            setRequestId(chat.activeRequestId || '')
            setStream('')
          }
        })
        .catch(() => {
          if (!cancelled) setChat(null)
        })
    else setChat(null)
    textarea.current?.focus()
    return () => {
      cancelled = true
    }
  }, [paperId, requestedChatId])
  useEffect(
    () =>
      window.pepe?.onEvent((event) => {
        if (event.type !== 'answer' || event.chatId !== chat?.id) return
        if (event.status === 'streaming') {
          setRequestId(event.requestId || '')
          setStream(event.text || '')
        } else {
          setStream('')
          setRequestId('')
          setError(event.error || '')
          void invoke<Chat>('chat/get', { id: event.chatId }).then(setChat)
        }
      }),
    [chat?.id],
  )
  useEffect(() => {
    if (stick.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight })
  }, [stream, chat?.messages.length])
  useEffect(() => {
    if (view !== 'history') return
    let cancelled = false
    const timer = setTimeout(
      () =>
        void invoke<Chat[]>('chat/list', { query, paperId })
          .then((value) => {
            if (!cancelled) setHistory(value)
          })
          .catch((error) => setError(error.message)),
      120,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [view, query, paperId])
  async function newChat(fromId?: string) {
    if (!paperId) return
    try {
      const value = await invoke<Chat>('chat/new', { paperId, fromId })
      remember(value)
      setView('chat')
      setStream('')
      setRequestId('')
      setError('')
      setDraft('')
      textarea.current?.focus()
    } catch (error) {
      setError((error as Error).message)
    }
  }
  async function send() {
    if (!draft.trim() || !paperId || requestId) return
    setError('')
    const request = crypto.randomUUID()
    setRequestId(request)
    stick.current = true
    try {
      const current = chat || (await invoke<Chat>('chat/new', { paperId }))
      if (!chat) remember(current)
      const text = draft
      setDraft('')
      const response = await invoke<{ requestId: string; chat: Chat }>('chat/send', {
        chatId: current.id,
        text,
        passage,
        page,
        requestId: request,
      })
      remember(response.chat)
      setPassage(null)
    } catch (error) {
      setError((error as Error).message)
      setRequestId('')
    }
  }
  // Resolve every answer against the same current paper index, including older
  // interrupted messages which were saved without a sources array.
  const indexedSources = useMemo(
    () =>
      index?.pages.flatMap((p) =>
        p.lines.map((line) => ({ page: p.number, line: line.id, y: line.y, text: line.text })),
      ) || [],
    [index],
  )
  return (
    <div className="chat-panel" id="chat-panel" role="tabpanel" aria-labelledby="chat-tab">
      <div className="chat-toolbar">
        <span title={paper?.title}>{paper?.title || 'Open a paper'}</span>
        <button
          title="Search chat history"
          aria-label="Chat history"
          onClick={() => setView(view === 'history' ? 'chat' : 'history')}
        >
          History
        </button>
        <button
          aria-label="Assistant settings"
          onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}
        >
          Settings
        </button>
        <button
          className="icon-button"
          title="New conversation"
          aria-label="New conversation"
          disabled={!paperId || !!requestId}
          onClick={() => void newChat()}
        >
          <Icon name="plus" size={17} />
        </button>
      </div>
      {view === 'settings' ? (
        <div className="panel-scroll">
          <SettingsPanel settings={settings} onSettings={onSettings} />
        </div>
      ) : view === 'history' ? (
        <div className="history-view">
          <input
            autoFocus
            placeholder="Search this paper’s conversations…"
            aria-label="Search chat history"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {history.map((item) => (
            <div className="history-row" key={item.id}>
              <button
                onClick={() => {
                  remember(item)
                  setView('chat')
                  setStream('')
                  setRequestId(item.activeRequestId || '')
                  setError('')
                }}
              >
                <strong>{item.title}</strong>
                <span>
                  {new Date(item.updatedAt).toLocaleDateString()} · {item.messages.length} messages
                </span>
              </button>
              <button
                title="Continue in new chat"
                aria-label={`Continue ${item.title} in new chat`}
                onClick={() => void newChat(item.id)}
              >
                <Icon name="right" size={15} />
              </button>
            </div>
          ))}
          {!history.length && <p className="muted">No conversations found.</p>}
        </div>
      ) : (
        <>
          <div
            className="chat-messages"
            ref={scroll}
            onScroll={() => {
              const root = scroll.current!
              stick.current = root.scrollHeight - root.scrollTop - root.clientHeight < 100
            }}
          >
            {!chat?.messages.length && (
              <div className="chat-empty">
                <div className="chat-mark">
                  <Icon name="chat" size={24} />
                </div>
                <h2>Room to think.</h2>
                <p>
                  A question, a connection,
                  <br />a passage worth a closer look.
                </p>
                <div className="selection-hint">
                  Select text, then press <kbd>{commandKey}L</kbd>.<br />
                  Answers link back to their source.
                </div>
              </div>
            )}
            {chat?.messages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <div className="message-byline">
                  {message.role === 'user' ? 'You' : 'Pepe'}
                  {message.model && <span>{message.model}</span>}
                </div>
                {message.passage && (
                  <blockquote className="message-passage">{message.passage.text}</blockquote>
                )}
                <Answer
                  text={message.text}
                  sources={index ? indexedSources : message.sources}
                  onSource={onSource}
                />
                {message.error && <p className="inline-error">{message.error}</p>}
              </article>
            ))}
            {requestId && (
              <article className="chat-message assistant" aria-live="polite">
                <div className="message-byline">
                  Pepe <span className="working-dot" />
                </div>
                {stream ? (
                  <Answer text={stream} sources={indexedSources} onSource={onSource} />
                ) : (
                  <p className="muted">Reading the paper…</p>
                )}
              </article>
            )}
          </div>
          <div className="composer-area">
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {passage && (
              <div className="selected-passage">
                <div className="passage-header">
                  <span>Selected passage · p. {passage.page}</span>
                  <button
                    className="icon-button"
                    onClick={() => setPassage(null)}
                    aria-label="Remove selected passage"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
                <blockquote>{passage.text}</blockquote>
              </div>
            )}
            <div className="composer">
              <textarea
                ref={textarea}
                aria-label="Ask about this paper"
                placeholder="Ask about this paper…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
                rows={3}
              />
              <div className="composer-tools">
                <span className="context-label">
                  {settings.model.replace('gpt-', 'GPT-')} ·{' '}
                  {settings.fast ? 'Fast' : settings.effort}
                </span>
                {requestId ? (
                  <button
                    className="stop-button"
                    onClick={() =>
                      void invoke('chat/stop', { requestId }).catch((error) =>
                        setError(error.message),
                      )
                    }
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    className="send-button"
                    aria-label="Send message"
                    disabled={!draft.trim() || !paperId}
                    onClick={() => void send()}
                  >
                    <Icon name="arrow" size={17} />
                  </button>
                )}
              </div>
            </div>
            {!window.pepe && <p className="preview-note">Use the desktop app to connect Codex.</p>}
          </div>
        </>
      )}
    </div>
  )
}
