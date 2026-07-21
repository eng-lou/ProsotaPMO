import { memo, useEffect, useRef, useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useActiveDashboardConfig, useDashboardLayouts, type DashboardWidgetConfig } from '@/lib/dashboardLayouts'
import { WIDGET_CATEGORIES, WIDGET_REGISTRY, type WidgetProps } from './widgets'

interface DashboardGridProps {
  projectId: string | undefined
  widgetProps: WidgetProps
}

// Memoized (2026-07-20, optimization pass) — none of the ~45 widgets in
// widgets.tsx memoize their own filter/sort/reduce work, and dragging/
// resizing any one widget re-renders this whole grid on every animation
// frame (see the rAF-throttled mousemove handler below). Without this,
// every OTHER mounted widget was re-running its own data processing on
// every one of those re-renders too, even though widgetProps/renderFn keep
// the same reference throughout a drag (WIDGET_REGISTRY is a module-level
// constant, and Overview.tsx's own widgetProps object doesn't change just
// because this component's internal drag state does) — one wrapper here
// gets the same effect as memoizing all 45 widgets individually.
const MemoWidget = memo(function MemoWidget(
  { renderFn, widgetProps }: { renderFn: (props: WidgetProps) => React.ReactNode; widgetProps: WidgetProps },
) {
  return <>{renderFn(widgetProps)}</>
})

// A small, fully self-written grid (2026-07-20) — replaces an earlier
// react-grid-layout integration that proved unreliable in practice (its
// own width-tracking hook stayed stuck at a hardcoded fallback, and its
// internal layout state repeatedly drifted out of sync with widget
// add/remove). react-grid-layout is a brand-new (weeks-old) major rewrite
// with no live browser available here to verify fixes against, so rather
// than keep chasing opaque library-internal state bugs, this reimplements
// the same simple grid math directly — full visibility, no hidden state.
const COLS = 12
const ROW_HEIGHT = 60
const MARGIN = 16

function colWidthFor(containerWidth: number) {
  return (containerWidth - MARGIN * (COLS - 1)) / COLS
}

function pixelRect(containerWidth: number, x: number, y: number, w: number, h: number) {
  const colWidth = colWidthFor(containerWidth)
  return {
    left: Math.round((colWidth + MARGIN) * x),
    top: Math.round((ROW_HEIGHT + MARGIN) * y),
    width: Math.max(0, Math.round(colWidth * w + MARGIN * (w - 1))),
    height: Math.max(0, Math.round(ROW_HEIGHT * h + MARGIN * (h - 1))),
  }
}

function pixelsToGrid(containerWidth: number, left: number, top: number) {
  const colWidth = colWidthFor(containerWidth)
  return {
    x: Math.round(left / (colWidth + MARGIN)),
    y: Math.round(top / (ROW_HEIGHT + MARGIN)),
  }
}

function pixelsToSize(containerWidth: number, width: number, height: number) {
  const colWidth = colWidthFor(containerWidth)
  return {
    w: Math.max(1, Math.round((width + MARGIN) / (colWidth + MARGIN))),
    h: Math.max(1, Math.round((height + MARGIN) / (ROW_HEIGHT + MARGIN))),
  }
}

function overlaps(a: DashboardWidgetConfig, b: DashboardWidgetConfig): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

// Settles every widget as high as it can go without overlapping anything
// already placed (processed top-to-bottom, left-to-right), then pushes
// straight down past any remaining collision. Runs after every drag/
// resize/add/remove so widgets never overlap.
function compact(widgets: DashboardWidgetConfig[]): DashboardWidgetConfig[] {
  const sorted = [...widgets].sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const placed: DashboardWidgetConfig[] = []
  for (const w of sorted) {
    let y = Math.max(0, w.y)
    while (y > 0 && !placed.some(p => overlaps(p, { ...w, y: y - 1 }))) y--
    while (placed.some(p => overlaps(p, { ...w, y }))) y++
    placed.push({ ...w, y })
  }
  return widgets.map(w => placed.find(p => p.id === w.id)!)
}

// Sidebar.tsx's own fixed w-60 (15rem), and Dashboard.tsx's own p-6
// (1.5rem each side) around the page content.
const SIDEBAR_WIDTH = 240
const CONTENT_PADDING = 48

function estimateWidth() {
  if (typeof window === 'undefined') return 1200
  return Math.max(320, window.innerWidth - SIDEBAR_WIDTH - CONTENT_PADDING)
}

// Measuring this specific container's own offsetWidth came back stuck at 0
// indefinitely in this app — tried both react-grid-layout's own width hook
// and a hand-written ResizeObserver-plus-retry-loop version, neither ever
// resolved to a real value (confirmed via console diagnostics both times).
// Sidestepping the mystery entirely: derive width from the *window's* own
// size and the app's known fixed layout chrome instead, which is always
// synchronously available with no dependency on this element's own layout
// timing. Still attaches a ResizeObserver as a best-effort refinement (a
// free upgrade to a more precise value if that measurement ever does
// resolve), but never blocks rendering on it.
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(estimateWidth)

  useEffect(() => {
    const onResize = () => setWidth(estimateWidth())
    window.addEventListener('resize', onResize)

    const node = ref.current
    const observer = node ? new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    }) : null
    if (node && observer) observer.observe(node)

    return () => {
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [])

  return { ref, width }
}

interface DragState {
  id: string
  mode: 'move' | 'resize'
  startClientX: number
  startClientY: number
  startLeft: number
  startTop: number
  startWidth: number
  startHeight: number
}

// PowerBI-style dashboard canvas (2026-07-20, per Maro: "the controls
// dashboards needs dockable visuals not perm. think powerbi") — free
// drag/resize/add/remove of the widgets in ./widgets.tsx's own
// WIDGET_REGISTRY, with named saved arrangements persisted the same
// create-then-apply way DockLayout already does for the 4D viewport
// (frontend/src/lib/dashboardLayouts.ts mirrors dockLayouts.ts exactly).
export function DashboardGrid({ projectId, widgetProps }: DashboardGridProps) {
  const { config, loading: configLoading, refetch: refetchActiveConfig } = useActiveDashboardConfig(projectId)
  const { layouts, create, apply, remove, reset } = useDashboardLayouts(projectId)
  const { ref: containerRef, width: containerWidth } = useMeasuredWidth()

  const [widgets, setWidgets] = useState<DashboardWidgetConfig[]>([])
  const [seeded, setSeeded] = useState(false)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [drag, setDrag] = useState<DragState | null>(null)
  const [livePixels, setLivePixels] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  // Seeds the working grid state from whichever layout is active — re-seeds
  // whenever a fresh config actually loads (project switch, apply, reset),
  // not just once — this is the only place widgets ever gets set from
  // server data, everything else (drag/resize/add/remove) is local until
  // explicitly saved, same "editing doesn't persist until you save"
  // discipline as the 4D dock's own DockLayoutMenu.
  useEffect(() => {
    if (!configLoading) {
      setWidgets(config.widgets)
      setSeeded(true)
    }
  }, [configLoading, config])

  // rAF-throttled (2026-07-20, optimization pass) — a raw mousemove fires far
  // more often than the screen actually repaints, and every mounted widget
  // re-renders (and re-runs its own filter/sort/reduce data processing) on
  // every setLivePixels call; at most one state update per animation frame
  // caps that to the display's own refresh rate instead of the mouse
  // driver's. pendingPixelsRef holds the latest computed rect between
  // frames; rafIdRef guards against scheduling more than one flush per frame.
  const pendingPixelsRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null)
  const rafIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!drag) return
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - drag.startClientX
      const dy = e.clientY - drag.startClientY
      pendingPixelsRef.current = drag.mode === 'move'
        ? {
          left: Math.max(0, drag.startLeft + dx),
          top: Math.max(0, drag.startTop + dy),
          width: drag.startWidth,
          height: drag.startHeight,
        }
        : {
          left: drag.startLeft,
          top: drag.startTop,
          width: Math.max(80, drag.startWidth + dx),
          height: Math.max(60, drag.startHeight + dy),
        }
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null
          setLivePixels(pendingPixelsRef.current)
        })
      }
    }
    const onUp = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      const finalPixels = pendingPixelsRef.current
      pendingPixelsRef.current = null
      if (finalPixels) {
        if (drag.mode === 'move') {
          const { x, y } = pixelsToGrid(containerWidth, finalPixels.left, finalPixels.top)
          setWidgets(prev => compact(prev.map(w => (w.id === drag.id ? { ...w, x: Math.max(0, x), y: Math.max(0, y) } : w))))
        } else {
          const { w: newW, h: newH } = pixelsToSize(containerWidth, finalPixels.width, finalPixels.height)
          setWidgets(prev => compact(prev.map(w => (w.id === drag.id ? { ...w, w: Math.min(12, newW), h: newH } : w))))
        }
      }
      setLivePixels(null)
      setDrag(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, containerWidth])

  const startDrag = (w: DashboardWidgetConfig, mode: 'move' | 'resize') => (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = pixelRect(containerWidth, w.x, w.y, w.w, w.h)
    setDrag({
      id: w.id, mode,
      startClientX: e.clientX, startClientY: e.clientY,
      startLeft: rect.left, startTop: rect.top, startWidth: rect.width, startHeight: rect.height,
    })
  }

  const removeWidget = (id: string) => setWidgets(prev => prev.filter(w => w.id !== id))

  const addWidget = (widgetType: string) => {
    const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
    const size = WIDGET_REGISTRY[widgetType]?.defaultSize ?? { w: 6, h: 4 }
    setWidgets(prev => compact([...prev, { id: widgetType, widget_type: widgetType, x: 0, y: maxY, ...size }]))
    setAddMenuOpen(false)
  }

  const handleSaveAs = async () => {
    if (!saveAsName.trim()) return
    const created = await create(saveAsName.trim(), { widgets })
    await apply(created.id)
    await refetchActiveConfig()
    setSaveAsName('')
    setLayoutMenuOpen(false)
  }

  const handleApply = async (layoutId: string) => {
    await apply(layoutId)
    await refetchActiveConfig()
    setLayoutMenuOpen(false)
  }

  const handleReset = async () => {
    await reset()
    await refetchActiveConfig()
    setLayoutMenuOpen(false)
  }

  // Local-only, same as drag/resize/add/remove — doesn't touch the saved
  // layout until you explicitly "Save current as…", so a reload or switching
  // layouts brings back whatever was last actually saved.
  const handleClearAll = async () => {
    if (widgets.length === 0) return
    const ok = await confirmWithDontAsk(
      'dashboard.clear-all-widgets',
      'Remove all widgets from the board?\n\nThis only clears your current editing session — nothing is saved until you use "Save current as…", so reloading or applying a different layout brings back the last saved arrangement.',
    )
    if (!ok) return
    setWidgets([])
    setLayoutMenuOpen(false)
  }

  const availableToAdd = Object.entries(WIDGET_REGISTRY).filter(([type]) => !widgets.some(w => w.widget_type === type))
  // Grouped by discipline (2026-07-21, per Maro) rather than alphabetised or
  // by chart/table/KPI shape — when hunting for a widget a PM thinks "I want
  // a Risk one" long before "I want a table", and this mirrors the app's own
  // Scheduling/Cost/Risk/ICD module split. WIDGET_CATEGORIES fixes the group
  // order; groups with nothing left to add (already all on the board) are
  // skipped rather than shown empty.
  const availableByCategory = WIDGET_CATEGORIES
    .map(category => [category, availableToAdd.filter(([, def]) => def.category === category)] as const)
    .filter(([, items]) => items.length > 0)
  const containerHeight = Math.max(200, ...widgets.map(w => pixelRect(containerWidth, w.x, w.y, w.w, w.h).top + pixelRect(containerWidth, w.x, w.y, w.w, w.h).height)) + MARGIN

  if (configLoading || !seeded) {
    return <div className="p-8 text-gray-400 text-sm">Loading…</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 text-sm relative">
        <div className="relative">
          <button
            className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            onClick={() => { setAddMenuOpen(v => !v); setLayoutMenuOpen(false) }}
          >
            + Add Widget
          </button>
          {addMenuOpen && (
            <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[220px] max-h-[70vh] overflow-y-auto py-1">
              {availableToAdd.length === 0 && <div className="px-3 py-1.5 text-xs text-gray-400">All widgets on the board</div>}
              {availableByCategory.map(([category, items]) => (
                <div key={category}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-gray-400 uppercase">{category}</div>
                  {items.map(([type, def]) => (
                    <button
                      key={type}
                      className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                      onClick={() => addWidget(type)}
                    >
                      {def.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button
            className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            onClick={() => { setLayoutMenuOpen(v => !v); setAddMenuOpen(false) }}
          >
            Layouts ▾
          </button>
          {layoutMenuOpen && (
            <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[240px] py-2 px-3 text-xs">
              <div className="flex items-center gap-1.5 mb-2">
                <input
                  className="flex-1 border border-gray-300 rounded-md px-2 py-1"
                  placeholder="Save current as…"
                  value={saveAsName}
                  onChange={e => setSaveAsName(e.target.value)}
                />
                <button
                  className="bg-blue-600 text-white px-2 py-1 rounded-md disabled:opacity-40"
                  disabled={!saveAsName.trim()}
                  onClick={handleSaveAs}
                >
                  Save
                </button>
              </div>
              {layouts.length > 0 && <div className="border-t border-gray-100 my-1" />}
              {layouts.map(l => (
                <div key={l.id} className="flex items-center justify-between py-1">
                  <button className={`text-left ${l.is_active ? 'font-semibold text-blue-600' : ''}`} onClick={() => handleApply(l.id)}>
                    {l.name}
                  </button>
                  <button className="text-gray-400 hover:text-red-600" onClick={() => remove(l.id)}>✕</button>
                </div>
              ))}
              <div className="border-t border-gray-100 mt-1 pt-1 space-y-1 flex flex-col items-start">
                <button className="text-gray-500 hover:text-gray-700" onClick={handleReset}>Reset to default</button>
                <button className="text-gray-500 hover:text-red-600" onClick={handleClearAll}>Clear all widgets</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div ref={containerRef} className="relative" style={{ height: containerHeight }}>
        {widgets.length === 0 && (
          <div className="text-xs text-gray-400 py-4">No widgets on the board — use "+ Add Widget" above.</div>
        )}
        {widgets.map(w => {
          const isDragging = drag?.id === w.id
          const rect = isDragging && livePixels ? livePixels : pixelRect(containerWidth, w.x, w.y, w.w, w.h)
          return (
            <div
              key={w.id}
              className={`absolute bg-white border border-gray-200 rounded-lg flex flex-col overflow-hidden ${isDragging ? 'shadow-lg z-10' : ''}`}
              style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, transition: isDragging ? 'none' : 'left 120ms, top 120ms' }}
            >
              <div
                className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-gray-50 shrink-0 cursor-move select-none"
                onMouseDown={startDrag(w, 'move')}
              >
                <span className="text-xs font-bold text-gray-700">{WIDGET_REGISTRY[w.widget_type]?.label ?? w.widget_type}</span>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => removeWidget(w.id)}
                  title="Remove"
                  className="ml-auto text-gray-400 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-3">
                {WIDGET_REGISTRY[w.widget_type]
                  ? <MemoWidget renderFn={WIDGET_REGISTRY[w.widget_type].render} widgetProps={widgetProps} />
                  : <span className="text-xs text-gray-400">Unknown widget</span>}
              </div>
              <div
                className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                onMouseDown={startDrag(w, 'resize')}
                title="Drag to resize"
              >
                <div className="absolute bottom-0.5 right-0.5 w-2 h-2 border-r-2 border-b-2 border-gray-300" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
