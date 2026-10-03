const pending = new Map<string, Promise<unknown>>()

// Share simultaneous reads only. Fulfilled values and failures are never
// cached, so reopening a module or refreshing after an edit stays fresh.
export function sharePendingRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = pending.get(key)
  if (existing) return existing as Promise<T>
  const promise = Promise.resolve().then(read)
  pending.set(key, promise)
  const clear = () => { if (pending.get(key) === promise) pending.delete(key) }
  void promise.then(clear, clear)
  return promise
}
