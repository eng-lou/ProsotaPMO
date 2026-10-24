import { useEffect, useRef } from 'react'
import { downloadLargeBlob } from '@/lib/api'
import { markRenderActivity } from './IdleRenderDriver'

export interface CalloutMediaState {
  source: HTMLImageElement | HTMLVideoElement | null
  error: string
  ready: Promise<void>
}

export function useCalloutMedia(id: string | null, video: boolean) {
  const state = useRef<CalloutMediaState>({ source: null, error: '', ready: Promise.resolve() })
  useEffect(() => {
    let disposed = false, url = ''
    const current: CalloutMediaState = { source: null, error: '', ready: Promise.resolve() }
    state.current = current
    if (!id) return
    current.ready = (async () => {
      try {
        const blob = await downloadLargeBlob(`/api/v1/annotations/media/${id}/download`)
        if (disposed) return
        url = URL.createObjectURL(blob)
        const source = video ? document.createElement('video') : new Image()
        current.source = source
        if (source instanceof HTMLVideoElement) { source.muted = true; source.playsInline = true; source.preload = 'auto' }
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => { cleanup(); reject(Error('Media loading timed out')) }, 30000)
          const cleanup = () => { clearTimeout(timeout); source.removeEventListener(video ? 'loadeddata' : 'load', loaded); source.removeEventListener('error', failed) }
          const loaded = () => { cleanup(); resolve() }
          const failed = () => { cleanup(); reject(Error('Cannot decode this media. Try PNG, JPEG, or an H.264 MP4.')) }
          source.addEventListener(video ? 'loadeddata' : 'load', loaded)
          source.addEventListener('error', failed)
          source.src = url
        })
      } catch (error) { if (!disposed) current.error = error instanceof Error ? error.message : 'Media unavailable' }
      markRenderActivity()
    })()
    return () => {
      disposed = true
      if (current.source instanceof HTMLVideoElement) { current.source.pause(); current.source.removeAttribute('src'); current.source.load() }
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, video])
  return state
}

export function calloutVideoTime(seconds: number, duration: number, loop: boolean): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  const time = Math.max(0, seconds)
  return loop ? time % duration : Math.min(time, Math.max(0, duration - .001))
}

// Paused videos seek to timeline time. Export awaits decoding rather than
// copying a stale frame while the offline renderer races ahead.
const seekJobs = new WeakMap<HTMLVideoElement, Promise<void>>()
export function seekCalloutVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const job = (seekJobs.get(video) ?? Promise.resolve()).catch(() => {}).then(() => seekDecoded(video, time))
  seekJobs.set(video, job)
  return job
}

async function seekDecoded(video: HTMLVideoElement, time: number): Promise<void> {
  if (video.readyState < 2) return
  if (!video.seeking && Math.abs(video.currentTime - time) < .001) return
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(Error('Callout video frame timed out')) }, 15000)
    const cleanup = () => { clearTimeout(timeout); video.removeEventListener('seeked', done); video.removeEventListener('error', failed) }
    const done = () => { cleanup(); markRenderActivity(); resolve() }
    const failed = () => { cleanup(); reject(Error('Callout video cannot be decoded')) }
    video.addEventListener('seeked', done); video.addEventListener('error', failed)
    if (!video.seeking) video.currentTime = time
  })
  if (Math.abs(video.currentTime - time) >= .001) await seekDecoded(video, time)
}
