import { Worker } from 'node:worker_threads'
export class PdfPool {
  constructor() {
    this.queue = []
    this.active = false
    this.nextId = 0
    this.worker = null
  }
  run(operation, path, page) {
    if (this.closed) return Promise.reject(new Error('Reader closed'))
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.nextId, operation, path, page, resolve, reject })
      this.drain()
    })
  }
  drain() {
    if (this.closed || this.active || !this.queue.length) return
    this.active = true
    const job = this.queue.shift()
    if (!this.worker)
      this.worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), { execArgv: [] })
    const worker = this.worker
    let finished = false
    const finish = (error, result) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      worker.off('message', message)
      worker.off('error', failed)
      worker.off('exit', exited)
      this.active = false
      error ? job.reject(error) : job.resolve(result)
      this.drain()
    }
    const failed = (error) => {
      this.worker = null
      void worker.terminate()
      finish(error)
    }
    const exited = () =>
      failed(new Error('PDF processing stopped unexpectedly. Please reopen the paper.'))
    this.failActive = failed
    const message = (value) => {
      if (value.id === job.id) finish(value.error ? new Error(value.error) : null, value.result)
    }
    const timer = setTimeout(
      () => failed(new Error('PDF processing took too long. Try a smaller or unlocked PDF.')),
      120_000,
    )
    worker.on('message', message)
    worker.once('error', failed)
    worker.once('exit', exited)
    worker.postMessage({ id: job.id, operation: job.operation, path: job.path, page: job.page })
  }
  close() {
    this.closed = true
    for (const job of this.queue.splice(0)) job.reject(new Error('Reader closed'))
    if (this.active) this.failActive?.(new Error('Reader closed'))
    void this.worker?.terminate()
  }
}
