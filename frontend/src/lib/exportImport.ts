// Shared by SchedulingFiltersWidget/LayoutWidget/CalendarWidget/
// LetterheadEditorWidget (2026-07-05, per Maro — P6's own Copy/Paste,
// adapted to a file-based workflow since this is a web app across separate
// projects/browsers, not one shared local database). Entirely client-side —
// export just serialises whatever's already in memory; import feeds the
// parsed result straight into each widget's own existing create/save call,
// so a bad or malicious file still only ever reaches the same validation
// path a manual save already goes through.

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)))
      } catch {
        reject(new Error(`"${file.name}" isn't valid JSON.`))
      }
    }
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`))
    reader.readAsText(file)
  })
}
