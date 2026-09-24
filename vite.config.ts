import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'))

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    {
      name: 'development-csp',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          command === 'serve'
            ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            : html,
      },
    },
    react(),
    viteStaticCopy({
      targets: ['cmaps', 'standard_fonts', 'wasm'].map((folder) => ({
        src: join(pdfjs, folder),
        dest: 'pdfjs',
      })),
    }),
  ],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022' },
}))
