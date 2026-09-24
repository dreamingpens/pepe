/// <reference types="vite/client" />

type ReaderCommand =
  'toggle-chat' | 'toggle-paper' | 'open-paper' | 'zoom-in' | 'zoom-out' | 'reset-zoom'

interface Window {
  pepe?: {
    platform: string
    invoke: <T = unknown>(method: string, data?: unknown) => Promise<T>
    openFile: (file: File) => Promise<import('./types').PaperRecord>
    onEvent: (callback: (event: import('./types').ReaderEvent) => void) => () => void
    onCommand: (callback: (command: ReaderCommand) => void) => () => void
  }
}
