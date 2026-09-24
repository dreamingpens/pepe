export async function invoke<T>(method: string, data: unknown = {}): Promise<T> {
  if (!window.pepe)
    throw new Error('Open the Pepe desktop app to use the library and Codex connection.')
  return window.pepe.invoke<T>(method, data)
}
