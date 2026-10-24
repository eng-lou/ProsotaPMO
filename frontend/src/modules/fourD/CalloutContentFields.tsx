import { prepareCalloutIcon } from './calloutIconUpload'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'
import { DEFAULT_CALLOUT, type Annotation, type AnnotationUpdate, type CalloutContent } from './annotations'

export function CalloutContentFields({ annotation, onUpdate }: { annotation: Annotation; onUpdate: (patch: AnnotationUpdate) => void }) {
  const content = { ...DEFAULT_CALLOUT, ...annotation.callout }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [symbolDraft, setSymbolDraft] = useState(content.symbol)
  useEffect(() => setSymbolDraft(content.symbol), [content.symbol])
  const change = (patch: Partial<CalloutContent>) => onUpdate({ callout: { ...content, ...patch } })
  const icon = content.mode === 'icon' || content.mode === 'icon_text'
  const media = content.mode === 'image' || content.mode === 'video'
  async function upload(file: File) {
    setError(''); setBusy(true)
    try {
      if (icon) file = await prepareCalloutIcon(file)
      const types = content.mode === 'video' ? ['video/mp4', 'video/webm'] : ['image/png', 'image/jpeg', 'image/webp']
      if (!types.includes(file.type) || file.size > 50 * 1024 * 1024) throw Error('Choose a supported file under 50 MB.')
      const { data } = await api.post('/api/v1/annotations/media', { project_id: annotation.project_id, name: file.name.slice(0, 200), content_type: file.type })
      await uploadDirectToStorage(data.upload_url, file, file.type, () => {})
      await api.post(`/api/v1/annotations/media/${data.id}/ready`)
      change({ media_id: data.id })
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed. Please retry.') }
    finally { setBusy(false) }
  }
  return <fieldset disabled={busy} className="space-y-2 text-xs [&_select]:border [&_select]:border-gray-300 [&_select]:rounded [&_select]:px-1 [&_select]:py-0.5 dark:[&_select]:border-prosota-line [&_select]:bg-white dark:[&_select]:bg-prosota-panel2 [&_input]:text-inherit border border-gray-200 dark:border-prosota-line rounded p-2">
    <legend>Callout content</legend>
    <label className="flex gap-2 items-center">Content
      <select aria-label="Callout content" value={content.mode} onChange={e => change({ mode: e.target.value as CalloutContent['mode'], media_id: (content.mode === 'video') === (e.target.value === 'video') ? content.media_id : null })}>
        <option value="text">Text</option><option value="icon">Icon only</option><option value="icon_text">Icon and text</option><option value="image">Still image</option><option value="video">Video</option>
      </select>
    </label>
    {!icon && <label className="flex gap-2 items-center">Shape
      <select aria-label="Callout shape" value={annotation.box_shape} onChange={e => onUpdate({ box_shape: e.target.value as Annotation['box_shape'] })}>
        <option value="rounded">Rounded rectangle</option><option value="rectangle">Rectangle</option><option value="circle">Circle</option>
      </select>
    </label>}
    {icon && <p className="text-gray-500">Diamond badge{content.mode === 'icon_text' ? ' with a horizontal text label on the left' : ''}. Enter the label in the Text field.</p>}
    <label className="flex gap-2 items-center"><input type="checkbox" checked={annotation.leader_visible} onChange={e => onUpdate({ leader_visible: e.target.checked })} />Show leader</label>
    {icon && <label className="block">Letter / number / symbol<input aria-label="Badge symbol" className="block w-full border border-gray-300 dark:border-prosota-line rounded px-1.5 py-1" maxLength={12} placeholder="e.g. A, 01, B2 (blank uses selected icon)" value={symbolDraft} onChange={e => setSymbolDraft(e.target.value)} onBlur={() => { if (symbolDraft !== content.symbol) change({ symbol: symbolDraft, media_id: null }) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>}
    {(media || icon) && <>
      <label className="block">{busy ? 'Uploading…' : content.media_id ? 'Replace media' : 'Choose media'}
        <input aria-label="Callout media" type="file" className="block w-full mt-1" accept={content.mode === 'video' ? 'video/mp4,video/webm' : icon ? 'image/svg+xml,image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp'} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file) }} />
      </label>
      <p className="text-gray-500">{content.mode === 'video' ? 'MP4 / WebM · muted · follows the timeline' : icon ? 'SVG / PNG / JPEG / WebP' : 'PNG / JPEG / WebP'} · up to 50 MB</p>
      {content.media_id && <button type="button" onClick={() => change({ media_id: null })}>Remove media</button>}
      {media && <label className="flex gap-2">Fit<select value={content.fit} onChange={e => change({ fit: e.target.value as 'cover' | 'contain' })}><option value="cover">Fill / crop</option><option value="contain">Fit whole image</option></select></label>}
    </>}
    {(!icon && (media || annotation.box_shape === 'circle')) && <div className="flex gap-2">
      <label>{annotation.box_shape === 'circle' ? 'Diameter' : 'Width'}<input aria-label="Callout width" className="w-16 block border border-gray-300 dark:border-prosota-line rounded px-1" type="number" min={32} max={1024} value={content.width} onChange={e => { const width = Number(e.target.value); if (width >= 32 && width <= 1024) change({ width }) }} /></label>
      {annotation.box_shape !== 'circle' && <label>Height<input aria-label="Callout height" className="w-16 block border border-gray-300 dark:border-prosota-line rounded px-1" type="number" min={32} max={1024} value={content.height} onChange={e => { const height = Number(e.target.value); if (height >= 32 && height <= 1024) change({ height }) }} /></label>}
    </div>}
    {content.mode === 'video' && <>
      <label className="flex gap-2"><input type="checkbox" checked={content.loop} onChange={e => change({ loop: e.target.checked })} />Loop video</label>
      <label className="block">Start delay (timeline seconds)<input className="w-20 ml-2" type="number" min={0} max={86400} step={0.1} value={content.start_seconds} onChange={e => { const v = Number(e.target.value); if (v >= 0 && v <= 86400) change({ start_seconds: v }) }} /></label>
      <p className="text-gray-500">Starts from the reveal start key, or timeline start if no key is set. Pausing and scrubbing also control the clip.</p>
    </>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
  </fieldset>
}
