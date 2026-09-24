import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electron from 'electron'

const server = await createServer()
await server.listen()
server.printUrls()
const env = { ...process.env, PEPE_DEV_URL: server.resolvedUrls.local[0] }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.'], { env, stdio: 'inherit' })
let stopping = false
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  child.kill()
  await server.close()
  process.exit(code)
}
child.on('exit', (code) => void stop(code ?? 0))
child.on('error', (error) => {
  console.error(error)
  void stop(1)
})
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
