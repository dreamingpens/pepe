/// <reference types="vite/client" />

type ReaderCommand =
  'toggle-chat' | 'toggle-paper' | 'open-paper' | 'zoom-in' | 'zoom-out' | 'reset-zoom'

interface Window {
  pepe?: {
    platform: string
    onCommand: (callback: (command: ReaderCommand) => void) => () => void
  }
}
