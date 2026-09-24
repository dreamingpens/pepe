import { useEffect, useRef, useState } from 'react'
import { invoke } from './api'
import type { Account, Settings } from './types'

export function SettingsPanel({
  settings,
  onSettings,
}: {
  settings: Settings
  onSettings: (settings: Settings) => void
}) {
  const [account, setAccount] = useState<Account>({ connected: false, models: [] })
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [loginId, setLoginId] = useState('')
  const revision = useRef(0)
  const refresh = () => {
    setBusy(true)
    setError('')
    void invoke<Account>('ai/status')
      .then(setAccount)
      .catch((error) => setError(error.message))
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    refresh()
    return window.pepe?.onEvent((event) => {
      if (event.type === 'account') {
        setLoginId('')
        refresh()
      }
    })
  }, [])
  const update = async (value: Partial<Settings>) => {
    const current = ++revision.current
    onSettings({ ...settings, ...value })
    try {
      const saved = await invoke<Settings>('settings/save', value)
      if (current === revision.current) onSettings(saved)
    } catch (error) {
      if (current === revision.current) {
        onSettings(settings)
        setError((error as Error).message)
      }
    }
  }
  const selected = account.models.find((model) => model.id === settings.model)
  return (
    <section className="settings-form">
      <h2>Your reading assistant</h2>
      <p className="muted">
        {busy
          ? 'Connecting to Codex…'
          : account.connected
            ? `Connected through Codex · ${account.plan || account.accountType}`
            : 'Use your ChatGPT subscription through Codex.'}
      </p>
      <div className="settings-actions">
        {!account.connected && (
          <button
            className="primary-button"
            disabled={busy || !!loginId}
            onClick={async () => {
              try {
                setError('')
                const result = await invoke<{ loginId: string }>('ai/login')
                setLoginId(result.loginId)
              } catch (error) {
                setError((error as Error).message)
              }
            }}
          >
            {loginId ? 'Finish sign-in in your browser' : 'Sign in with ChatGPT'}
          </button>
        )}
        {loginId && (
          <button
            onClick={async () => {
              try {
                await invoke('ai/cancelLogin', { loginId })
                setLoginId('')
              } catch (error) {
                setError((error as Error).message)
              }
            }}
          >
            Cancel sign-in
          </button>
        )}
        <button className="secondary-button" disabled={busy} onClick={refresh}>
          Reconnect
        </button>
      </div>
      {(error || account.error) && (
        <p className="inline-error" role="alert">
          {error || account.error}
        </p>
      )}
      <label>
        Model
        <select
          aria-label="AI model"
          value={settings.model}
          onChange={(event) => {
            const model = account.models.find((m) => m.id === event.target.value)
            void update({ model: event.target.value, effort: model?.defaultEffort || 'medium' })
          }}
        >
          {!selected && (
            <option value={settings.model}>
              {settings.model}
              {account.connected ? ' (unavailable)' : ''}
            </option>
          )}
          {account.models.map((model) => (
            <option value={model.id} key={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Thinking level
        <select
          aria-label="Thinking level"
          value={settings.effort}
          onChange={(event) => void update({ effort: event.target.value })}
        >
          {(selected?.efforts || ['medium']).map((effort) => (
            <option key={effort}>{effort}</option>
          ))}
        </select>
      </label>
      <label>
        Answer length
        <select
          aria-label="Verbosity"
          value={settings.verbosity}
          onChange={(event) =>
            void update({ verbosity: event.target.value as Settings['verbosity'] })
          }
        >
          <option value="low">Concise</option>
          <option value="medium">Balanced</option>
          <option value="high">Detailed</option>
        </select>
      </label>
      <label className="toggle-label">
        <input
          type="checkbox"
          checked={settings.fast}
          onChange={(event) => void update({ fast: event.target.checked })}
        />
        Fast mode <span className="muted">Uses more subscription capacity</span>
      </label>
      <label>
        Summary format
        <select
          aria-label="Summary format"
          value={settings.summaryFormat}
          onChange={(event) =>
            void update({ summaryFormat: event.target.value as Settings['summaryFormat'] })
          }
        >
          <option value="bullets">Bullet points</option>
          <option value="paragraph">Paragraph</option>
        </select>
      </label>
      <label className="toggle-label">
        <input
          type="checkbox"
          checked={settings.autoSummary}
          onChange={(event) => void update({ autoSummary: event.target.checked })}
        />
        Summarize downloaded papers in the background
      </label>
      <p className="settings-footnote">
        Paper text and requested page images are sent to Codex when you ask a question or generate a
        summary. Files and chat history stay in your local library. Codex manages authentication.
      </p>
    </section>
  )
}
