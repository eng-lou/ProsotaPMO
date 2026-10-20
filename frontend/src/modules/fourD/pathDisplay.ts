import type { Path } from './paths'

/** Display-only: never used to filter paths supplied to followers. */
export function showPath(path: Pick<Path, 'visible' | 'opacity' | 'show_in_viewport' | 'show_in_render'>, rendering: boolean) {
  return path.visible && (path.opacity ?? 1) > 0 &&
    (rendering ? path.show_in_render ?? true : path.show_in_viewport ?? true)
}
