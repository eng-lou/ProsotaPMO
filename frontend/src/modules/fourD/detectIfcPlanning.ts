// Cheap, bounded-memory detection. The server validates the snapshot before
// offering counts or importing; this marker alone never authorises a write.
export async function hasProsotaPlanning(file: Blob): Promise<boolean> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  let tail = ''
  try {
    for (;;) {
      const {value, done} = await reader.read()
      if (done) return false
      const text = tail + decoder.decode(value, {stream: true})
      if (text.includes("'Prosota_Export'")) return true
      tail = text.slice(-64)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
}
