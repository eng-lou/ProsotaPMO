import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { addCollectionMember, createCollection, type Collection } from './collections'
import { createElementSplit, deleteElementSplit, updateElementSplit, type ElementSplit } from './elementSplits'
import { buildSplitElementRef } from './splitElementRefs'
import type { IfcModelHandle, IfcTreeNode } from './ifcModel'

interface StoreyOption {
  expressID: number
  name: string
  // A *derived* world-space elevation, in the scene's own raw units (the
  // file's declared unit, e.g. feet — see elementSplitTargets.ts's own
  // header on why scene units stay raw, never rescaled to metres at
  // import), read along whichever world axis `upAxis` currently is.
  //
  // Deliberately NOT the IFC file's own IfcBuildingStorey.Elevation
  // attribute (2026-07-15, per a real bug: on the actual Snowdon file, that
  // raw attribute turned out to live in a completely different reference
  // frame from where elements actually render — off by tens of thousands
  // of units, confirmed empirically, not assumed — likely a site/survey
  // placement offset baked into IfcSite's own ObjectPlacement that the
  // Elevation attribute alone doesn't carry). Instead, derived from where
  // this storey's own *contained elements* actually render
  // (worldElevationForExpressIds below) — the same matrixWorld transform
  // that already correctly renders everything else on screen, so "which
  // levels does this element span" always matches what the user visually
  // sees, regardless of any one file's own placement quirks.
  worldElevation: number
}

// Copied from IfcDataPanel.tsx's own collectStoreyNodes/collectLeafExpressIds
// (2026-07-15) rather than exported/shared — matches this codebase's own
// established convention for a tiny, self-contained tree-walk helper (see
// backend/app/services/collection.py's _validate_no_cycle, copied from
// activity.py's own for the identical reason).
function collectStoreyNodes(node: IfcTreeNode): IfcTreeNode[] {
  const own = node.type === 'IfcBuildingStorey' ? [node] : []
  return [...own, ...node.children.flatMap(collectStoreyNodes)]
}
function collectLeafExpressIds(node: IfcTreeNode): number[] {
  if (node.children.length === 0) return [node.expressID]
  return node.children.flatMap(collectLeafExpressIds)
}

function verticalComponent(v: THREE.Vector3, upAxis: 'y' | 'z'): number {
  return upAxis === 'y' ? v.y : v.z
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// Every already-loaded mesh for a given set of expressIDs, keyed by
// expressID (2026-07-15) — one traverse of handle.object shared across
// every storey/element lookup this panel needs, rather than a fresh
// traverse per lookup (a real file can have a dozen storeys × hundreds of
// elements each — see this panel's own header on why only a bounded sample
// per storey is used).
function meshesByExpressId(handle: IfcModelHandle, wantedIds: Set<number>): Map<number, THREE.Mesh[]> {
  const found = new Map<number, THREE.Mesh[]>()
  handle.object.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.userData.isSplitClone || child.userData.isSplitPreview) return
    const id = child.userData.expressID as number | undefined
    if (id === undefined || !wantedIds.has(id)) return
    const list = found.get(id)
    if (list) list.push(child); else found.set(id, [child])
  })
  return found
}

// A set of expressIDs' own combined WORLD-space bounds (2026-07-15) — full
// matrixWorld, the same transform that already correctly renders everything
// on screen (unlike an earlier version of this panel, which compared a
// mesh's own *local* bounds against the IFC file's raw Elevation attribute
// and got real, empirically-confirmed wrong answers on a real file — see
// StoreyOption's own header).
function worldBoundsFor(byId: Map<number, THREE.Mesh[]>, expressIds: Iterable<number>): THREE.Box3 | null {
  const box = new THREE.Box3()
  let found = false
  for (const id of expressIds) {
    for (const mesh of byId.get(id) ?? []) {
      mesh.updateMatrixWorld(true)
      box.union(new THREE.Box3().setFromObject(mesh))
      found = true
    }
  }
  return found ? box : null
}

// Only a bounded sample of a storey's own (potentially hundreds of)
// contained elements is scanned — cheap enough to stay responsive, and the
// median below is already robust against the occasional outlier (a
// foundation element extending below the true floor line, say) a small
// sample might include.
const STOREY_ELEMENT_SAMPLE_LIMIT = 40

interface Props {
  projectId: string
  handle: IfcModelHandle | null
  selectedExpressIds: Set<number>
  elementSplits: ElementSplit[]
  // Auto-collection on split (2026-07-15, per Maro: "add the original its
  // slices in a collection") — needs the project's current Collections tree
  // to find-or-reuse the shared "Splits" root rather than creating a new
  // one on every single split, and a way to tell FourD.tsx's own
  // `collections` state to refetch afterward (the same split-second-source-
  // of-truth pattern elementSplits/onSplitsChanged already use).
  collections: Collection[]
  onCollectionsChanged: () => void
  upAxis: 'y' | 'z'
  onClose: () => void
  onSplitsChanged: () => void
}

// "Split an element by level" (2026-07-15, per Maro) — the wizard-free UI
// half of this feature: pick which of the selected element(s)' own spanned
// storeys to cut at, see a live preview plane per checked level, commit.
// See elementSplitTargets.ts's own header for the full "clipped virtual
// slice" design this drives, and ElementSplit's own backend docstring for
// why only elevations (never derived geometry) get persisted.
export function SplitByLevelPanel({
  projectId, handle, selectedExpressIds, elementSplits, collections, onCollectionsChanged, upAxis, onClose, onSplitsChanged,
}: Props) {
  const [storeys, setStoreys] = useState<StoreyOption[] | null>(null)
  const [checkedElevations, setCheckedElevations] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A stable string key for the selection (2026-07-15) — selectedExpressIds
  // itself is a new Set instance on almost every unrelated selection-driven
  // render elsewhere in this app, which would otherwise re-trigger the
  // storey-scan effect below constantly; the sorted-ids string only
  // actually changes when the *membership* does.
  const selectionKey = [...selectedExpressIds].sort((a, b) => a - b).join(',')

  useEffect(() => {
    setStoreys(null)
    setCheckedElevations(new Set())
    setError(null)
    if (!handle || selectedExpressIds.size === 0) return
    let cancelled = false
    ;(async () => {
      const ifcModel = await import('./ifcModel')
      const tree = await ifcModel.getSpatialTree(handle)
      const storeyNodes = collectStoreyNodes(tree)
      const namesByStorey = await Promise.all(storeyNodes.map(n => ifcModel.getElementName(handle, n.expressID)))
      if (cancelled) return

      const sampledLeavesByStorey = storeyNodes.map(n => collectLeafExpressIds(n).slice(0, STOREY_ELEMENT_SAMPLE_LIMIT))
      const allWantedIds = new Set<number>([...selectedExpressIds, ...sampledLeavesByStorey.flat()])
      const byId = meshesByExpressId(handle, allWantedIds)

      const selectionBounds = worldBoundsFor(byId, selectedExpressIds)
      if (!selectionBounds) { setStoreys([]); return }
      const selMin = verticalComponent(selectionBounds.min, upAxis)
      const selMax = verticalComponent(selectionBounds.max, upAxis)

      const resolved: StoreyOption[] = []
      storeyNodes.forEach((n, i) => {
        const values: number[] = []
        for (const leafId of sampledLeavesByStorey[i]) {
          const meshes = byId.get(leafId)
          if (!meshes) continue
          for (const mesh of meshes) {
            mesh.updateMatrixWorld(true)
            values.push(verticalComponent(new THREE.Box3().setFromObject(mesh).min, upAxis))
          }
        }
        if (values.length === 0) return
        resolved.push({ expressID: n.expressID, name: namesByStorey[i], worldElevation: median(values) })
      })

      // Strictly *inside* the selection's own vertical span — a storey
      // sitting exactly at an element's own top/bottom face wouldn't
      // actually split it into two non-empty pieces.
      const inRange = resolved.filter(s => s.worldElevation > selMin + 1e-6 && s.worldElevation < selMax - 1e-6)
      setStoreys(inRange.sort((a, b) => a.worldElevation - b.worldElevation))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, selectionKey, upAxis])

  // Live preview — one translucent horizontal plane per checked storey,
  // sized to the selection's own footprint (2026-07-15). Added directly to
  // the scene root (the outermost ancestor of handle.object — normally the
  // R3F Canvas's own untransformed Scene) rather than under handle.object
  // itself: the plane's position/orientation are already fully-resolved
  // WORLD values (matching worldSlicePlanes' own world-space design in
  // elementSplitTargets.ts), so parenting under handle.object would double
  // up whatever transform the axis-correction wrapper/handle.object itself
  // carries instead of landing at the intended real position.
  useEffect(() => {
    if (!handle || checkedElevations.size === 0) return
    let root: THREE.Object3D = handle.object
    while (root.parent) root = root.parent

    const byId = meshesByExpressId(handle, selectedExpressIds)
    const bounds = worldBoundsFor(byId, selectedExpressIds)
    if (!bounds) return

    const previewGroup = new THREE.Group()
    previewGroup.userData.isSplitPreview = true
    root.add(previewGroup)

    // A flat quad in its own default (XY-plane, +Z normal) orientation,
    // rotated so its normal points along upAxis in world space, then sized
    // to the selection's own horizontal footprint (the two axes that
    // *aren't* upAxis).
    const horizontalAxes: ('x' | 'y' | 'z')[] = upAxis === 'y' ? ['x', 'z'] : ['x', 'y']
    const width = Math.max(0.01, bounds.max[horizontalAxes[0]] - bounds.min[horizontalAxes[0]])
    const depth = Math.max(0.01, bounds.max[horizontalAxes[1]] - bounds.min[horizontalAxes[1]])
    const center = new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2,
    )
    const worldNormal = upAxis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
    const planeQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal)

    const geometry = new THREE.PlaneGeometry(width, depth)
    const material = new THREE.MeshBasicMaterial({
      color: 0x3b82f6, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
    })
    for (const elevation of checkedElevations) {
      const plane = new THREE.Mesh(geometry, material)
      plane.quaternion.copy(planeQuaternion)
      plane.position.copy(center)
      if (upAxis === 'y') plane.position.y = elevation; else plane.position.z = elevation
      // Tagged on the mesh itself, not just its parent previewGroup —
      // Viewport3D.tsx's own ModelObjects effect traverses every
      // descendant mesh individually and only checks each one's own
      // userData for this flag, not its ancestors'.
      plane.userData.isSplitPreview = true
      previewGroup.add(plane)
    }

    return () => {
      previewGroup.parent?.remove(previewGroup)
      geometry.dispose()
      material.dispose()
    }
  }, [handle, checkedElevations, selectionKey, upAxis])

  const toggleElevation = (worldElevation: number) => {
    setCheckedElevations(prev => {
      const next = new Set(prev)
      if (next.has(worldElevation)) next.delete(worldElevation); else next.add(worldElevation)
      return next
    })
  }

  const handleCommit = async () => {
    if (!handle || checkedElevations.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const ifcModel = await import('./ifcModel')
      const tree = await ifcModel.getSpatialTree(handle)
      const toMetres = ifcModel.getLengthUnitToMetres(handle, tree.expressID)
      const sortedElevations = [...checkedElevations].sort((a, b) => a - b)
      const byId = meshesByExpressId(handle, selectedExpressIds)

      // find-or-create the shared top-level "Splits" collection once,
      // reused across every element in this one commit rather than
      // re-created per element (2026-07-15, per Maro: "add the original
      // its slices in a collection") — knownCollections tracks anything
      // created *during* this call too, since the `collections` prop
      // itself won't reflect a same-call creation until FourD.tsx's own
      // state catches up via onCollectionsChanged after this returns.
      let splitsRoot = collections.find(c => c.parent_collection_id === null && c.name === 'Splits') ?? null
      let knownCollections = collections

      // Per element independently (2026-07-15, per Maro: "I can select more
      // than one element for this") — only the checked cuts that actually
      // fall within *this* element's own span are applied; a shorter
      // element among the selection just gets skipped for a level it never
      // reaches, same "editable defaults, not forced uniformity" contract
      // the rest of this app already applies to bulk actions.
      let anyApplied = false
      for (const expressId of selectedExpressIds) {
        const globalId = ifcModel.getGuidFromExpressId(handle, expressId)
        if (!globalId) continue
        const bounds = worldBoundsFor(byId, [expressId])
        if (!bounds) continue
        const min = verticalComponent(bounds.min, upAxis)
        const max = verticalComponent(bounds.max, upAxis)
        const cutsForThisElement = sortedElevations.filter(e => e > min + 1e-6 && e < max - 1e-6)
        if (cutsForThisElement.length === 0) continue
        const cutsM = cutsForThisElement.map(e => e * toMetres)

        const existing = elementSplits.find(s => s.source_kind === 'ifc' && s.element_ref === globalId)
        if (existing) await updateElementSplit(existing.id, cutsM)
        else await createElementSplit({ project_id: projectId, source_kind: 'ifc', element_ref: globalId, cut_elevations_m: cutsM })
        anyApplied = true

        // Group the original + every resulting slice into a Collection —
        // best-effort: a failure here (e.g. a member already added by a
        // prior split of this same element) shouldn't undo the split
        // itself, which already succeeded above.
        try {
          if (!splitsRoot) {
            splitsRoot = await createCollection({ project_id: projectId, name: 'Splits' })
            knownCollections = [...knownCollections, splitsRoot]
          }
          const info = await ifcModel.getElementInfo(handle, expressId)
          const elementLabel = `${info.type}: ${info.name || globalId.slice(0, 8)}`
          let sub = knownCollections.find(c => c.parent_collection_id === splitsRoot!.id && c.name === elementLabel)
          if (!sub) {
            sub = await createCollection({ project_id: projectId, name: elementLabel, parent_collection_id: splitsRoot.id })
            knownCollections = [...knownCollections, sub]
          }
          await addCollectionMember({ collection_id: sub.id, source_kind: 'ifc', element_ref: globalId, element_label: elementLabel })
          for (let i = 0; i < cutsForThisElement.length + 1; i++) {
            await addCollectionMember({
              collection_id: sub.id, source_kind: 'ifc_split', element_ref: buildSplitElementRef(globalId, i),
              element_label: `${info.type} — Level Slice ${i + 1}`,
            })
          }
        } catch {
          // See this block's own comment above — non-fatal.
        }
      }
      if (!anyApplied) { setError('None of the checked levels fall within any selected element’s own height.'); return }
      onSplitsChanged()
      onCollectionsChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to split element(s)')
    } finally {
      setBusy(false)
    }
  }

  // Unsplit (2026-07-15, per Maro: "allow me to delete/unload selected
  // elements because now i have all these unnecessary slices") — deletes
  // the ElementSplit row outright; elementSplitTargets.ts's own
  // regenerateSplitTargets (FourD.tsx's own effect, re-triggered once
  // onSplitsChanged's refetch lands) already removes that element's clones
  // and restores its original mesh's visibility as an ordinary side effect
  // of "rebuild from whatever `splits` currently says" — no separate
  // restore step needed here.
  const [removingSplitId, setRemovingSplitId] = useState<string | null>(null)
  const handleUnsplit = async (splitId: string) => {
    setRemovingSplitId(splitId)
    setError(null)
    try {
      await deleteElementSplit(splitId)
      onSplitsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove split')
    } finally {
      setRemovingSplitId(null)
    }
  }

  // Human-readable labels for the "Existing Splits" list below — resolved
  // lazily off whichever handle is currently active, since an ElementSplit
  // row only carries a bare GlobalId. Falls back to a truncated ref if the
  // owning model isn't currently loaded (still deletable either way — the
  // label is cosmetic only).
  const [splitLabels, setSplitLabels] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!handle || elementSplits.length === 0) return
    let cancelled = false
    ;(async () => {
      const ifcModel = await import('./ifcModel')
      const next: Record<string, string> = {}
      for (const split of elementSplits) {
        if (split.source_kind !== 'ifc') continue
        const expressId = ifcModel.getExpressIdFromGuid(handle, split.element_ref)
        if (expressId === undefined) continue
        const info = await ifcModel.getElementInfo(handle, expressId)
        next[split.id] = `${info.type}: ${info.name || split.element_ref.slice(0, 8)}`
      }
      if (!cancelled) setSplitLabels(prev => ({ ...prev, ...next }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, elementSplits])

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
        <span className="text-xs text-gray-500">Split by Level</span>
        <button onClick={onClose} title="Close" className="text-xs text-gray-400 hover:text-gray-700">✕</button>
      </div>
      {!handle || selectedExpressIds.size === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400">Select one or more IFC elements in the viewport first.</p>
      ) : storeys === null ? (
        <p className="px-3 py-3 text-xs text-gray-400">Loading storeys…</p>
      ) : storeys.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400">
          No storey sits strictly within the selected element(s)' own height — nothing to cut.
        </p>
      ) : (
        <>
          <p className="px-3 py-2 text-xs text-gray-500">
            {selectedExpressIds.size} element{selectedExpressIds.size === 1 ? '' : 's'} selected. Pick which levels to cut at:
          </p>
          <div className="px-3 space-y-1 pb-2">
            {storeys.map(s => (
              <label key={s.expressID} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input type="checkbox" checked={checkedElevations.has(s.worldElevation)} onChange={() => toggleElevation(s.worldElevation)} />
                {s.name}
              </label>
            ))}
          </div>
          {error && <p className="px-3 pb-2 text-xs text-red-600">{error}</p>}
          <div className="px-3 pb-3">
            <button
              onClick={handleCommit}
              disabled={busy || checkedElevations.size === 0}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Splitting…' : `Split at ${checkedElevations.size} level${checkedElevations.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
      {/* Existing Splits — independent of the current selection above, so a
          split made earlier (or by a different element) can always be
          cleaned up here (2026-07-15, per Maro: "allow me to delete/unload
          selected elements because now i have all these unnecessary
          slices"). Removing one deletes the ElementSplit row outright,
          which elementSplitTargets.ts's own regenerateSplitTargets then
          picks up as an ordinary "rebuild from what `splits` currently
          says" pass — the element's clones disappear and its original
          mesh becomes visible/selectable again with no separate restore
          step. */}
      {elementSplits.length > 0 && (
        <div className="border-t border-gray-100 mt-2 pt-2">
          <p className="px-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Existing Splits</p>
          <div className="px-3 space-y-1 pb-3">
            {elementSplits.map(split => (
              <div key={split.id} className="flex items-center justify-between gap-2 text-xs text-gray-700">
                <span className="truncate" title={split.element_ref}>
                  {splitLabels[split.id] ?? `${split.element_ref.slice(0, 12)}…`}
                  <span className="text-gray-400 ml-1">({split.cut_elevations_m.length} cuts)</span>
                </span>
                <button
                  onClick={() => handleUnsplit(split.id)}
                  disabled={removingSplitId === split.id}
                  title="Remove this split — restores the original whole element"
                  className="text-gray-400 hover:text-red-600 shrink-0 disabled:opacity-40"
                >
                  {removingSplitId === split.id ? '…' : '✕'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
