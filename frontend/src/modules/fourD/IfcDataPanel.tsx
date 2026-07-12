import { useEffect, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import { ElementLinkFields } from './ElementLinkFields'
// Type-only — erased at compile time, doesn't pull web-ifc into this
// chunk. The actual functions are dynamic-import()ed at call sites below so
// web-ifc's real weight only loads once an IFC file is actually imported
// (2026-07-10 fix, per the same "keep it out of the main bundle" commitment
// made in ifcModel.ts's own header comment — build initially showed the
// main bundle jump from ~1.9MB to ~6.5MB because this file's static import
// defeated FourD.tsx's own dynamic one).
import type { IfcElementInfo, IfcModelHandle, IfcTreeNode } from './ifcModel'
import type { AnimationProfile } from './animationProfiles'
import type { ModelElementLink, SourceKind } from './modelElementLinks'
import { isFeetUnit, toDisplayLength, type IfcUnitDisplay } from './ifcUnitDisplay'

interface Props {
  // Every currently-loaded IFC model (2026-07-09, per federated/assembly
  // modeling — "allow me to import more than one IFC model... currently
  // loading another replaces what i have") — was a single
  // `handle: IfcModelHandle | null`; now one collapsible ModelItem per
  // loaded model, mirroring MeshDataPanel.tsx's own list-of-items pattern.
  handles: IfcModelHandle[]
  // Which scene object (mesh or IFC model) is "active" — used to decide
  // *which* model's Object Information section should reflect
  // selectedExpressId, since expressIDs are only unique within their own
  // model's web-ifc session (modelID 1's expressID 5 is unrelated to
  // modelID 2's expressID 5).
  activeObjectId: string | null
  selectedExpressId: number | null
  selectedExpressIds: Set<number>
  onSelect: (expressID: number | null, additive: boolean, objectId: string) => void
  // Bulk sibling of onSelect above (2026-07-11, per Maro: "select all the
  // doors" — Select by Type / Select by Storey). Shared by both: type-count
  // rows below and the spatial tree's own per-storey "Select Storey"
  // button both resolve to a plain expressID list, just via different
  // means (a web-ifc type-code lookup vs. walking the already-fetched
  // spatial tree's own leaves) — no reason for two near-identical props.
  onSelectMany: (expressIDs: number[], additive: boolean, objectId: string) => void
  onUnload: (id: string) => void
  selectedObjectIds: Set<string>
  // Selects "the whole model" rather than one specific element (2026-07-09
  // fix, per Maro: "I selected the parent and its still showing 1 object,1
  // element selected... apply transform isnt working") — used for
  // *container* tree nodes (IFCPROJECT/IfcSite/IfcBuilding/IfcBuildingStorey
  // — spatial-structure organisational nodes with no geometry of their
  // own, per web-ifc's own getSpatialStructure), never leaf building
  // elements. Clicking one of these used to call plain onSelect with that
  // node's own real expressID same as any leaf element — since a container
  // node's expressID essentially never matches any mesh's own tag, the
  // Transform/Apply Transform target correctly fell back to the whole
  // model either way, but the *selection state* itself still recorded that
  // one container's expressID as "1 element selected" instead of clearing
  // to a true whole-model selection — same root cause the checkbox
  // (onToggleSelected) was already fixed for, just not yet for tree clicks.
  onSelectWholeModel: (id: string, additive: boolean) => void
  // Lifted up to FourD.tsx (2026-07-11, per Maro: "rewire units" — the same
  // Auto/ft/m preference now also drives TransformPanel's Location fields,
  // a sibling panel this component knows nothing about) so both panels
  // share one live value instead of each owning/persisting their own copy,
  // which would only agree after a remount. This panel no longer loads or
  // saves it itself — see FourD.tsx's own ifcUnitDisplay state.
  unitDisplay: IfcUnitDisplay
  onUnitDisplayChange: (value: IfcUnitDisplay) => void
  activities: Activity[]
  links: ModelElementLink[]
  animationProfiles: AnimationProfile[]
  onLinkElement: (sourceKind: SourceKind, elementRef: string, elementLabel: string, activityId: string) => void
  onUnlinkElement: (linkId: string) => void
  onAssignProfile: (linkId: string, profileId: string | null) => void
}

// Every leaf (no-children) expressID under a spatial-tree node, recursively
// (2026-07-11, for Select by Storey) — walks whatever's already been
// fetched into the tree, no web-ifc calls of its own. A storey's own
// direct children are normally the contained elements themselves, but this
// recurses regardless in case any intermediate container ever sits between
// a storey and its elements — either way, only real geometry-bearing
// leaves end up selected, never a container's own (meaningless) expressID.
function collectLeafExpressIds(node: IfcTreeNode): number[] {
  if (node.children.length === 0) return [node.expressID]
  return node.children.flatMap(collectLeafExpressIds)
}

// Every IFCBUILDINGSTOREY node anywhere in the tree, at whatever depth
// (2026-07-11, for Select by Storey's own button list — see ModelItem's
// storeys useEffect below for why these live as a flat list of real
// buttons rather than something found by browsing the tree itself: an
// earlier version put a "Select Storey" link directly on each storey's own
// tree row, but that meant it was invisible unless the tree happened to be
// expanded that far down first, and per Maro ("give me an actual button...
// not working") a small inline text link buried in a collapsed tree
// doesn't read as a real, discoverable control anyway).
// 2026-07-11 fix, verified against a real file (2018_Hospital_Structural.ifc,
// the same one Maro had open side-by-side in Bonsai) — this used to check
// against 'IFCBUILDINGSTOREY' (all caps), but web-ifc's own
// getSpatialStructure returns node.type as 'IfcBuildingStorey' (PascalCase)
// for every spatial-container child; only the tree's own root node comes
// back as 'IFCPROJECT' (all caps — an inconsistency inside web-ifc itself,
// confirmed with a Node smoke test directly against the real file, not
// assumed from docs). The all-caps check meant this — and everything built
// on it, storeys/scoped selection — silently matched zero storeys against
// every real IFC file tested, the root cause of "still no easy way to
// select storeys or levels."
function collectStoreyNodes(node: IfcTreeNode): IfcTreeNode[] {
  const own = node.type === 'IfcBuildingStorey' ? [node] : []
  return [...own, ...node.children.flatMap(collectStoreyNodes)]
}

// A raw Elevation value (already in the project's own declared unit — see
// getLengthUnitToMetres's header) formatted architecturally, matching
// Bonsai/Blender's own feet-inch display for the same file when the
// project turns out to be imperial (2026-07-11, verified against
// 2018_Hospital_Structural.ifc: LENGTHUNIT="FOOT", ConversionFactor≈0.3048,
// so `raw` there is already whole/half feet — no further conversion, just
// formatting). Always converts to metres first via the file's own verified
// factor, then either shows metres or converts metres->feet for the
// feet-inch display — so `preference` correctly overrides the file's own
// native unit either direction (2026-07-11, per Maro: "add a unit
// conversion toggle for people who prefer metric system" — a metric viewer
// opening an imperial-authored file, or vice versa, shouldn't be stuck with
// whatever the file's own author happened to use). 'auto' keeps the
// original per-file detection: feet display only when toMetres is close to
// one real foot (0.3048m, allowing for the file storing it as a decimal
// like 0.30480000000000002), metres for everything else rather than
// guessing a feet display that would be wrong for a metric project.
function formatElevation(raw: string, toMetres: number, preference: IfcUnitDisplay): string {
  const n = Number(raw)
  if (Number.isNaN(n)) return raw
  const showFeet = preference === 'imperial' || (preference === 'auto' && isFeetUnit(toMetres))
  const display = toDisplayLength(n, toMetres, preference)
  return showFeet ? formatFeetInches(display) : `${Number.isInteger(display) ? display : display.toFixed(2)} m`
}

// Nearest-1/16" feet-and-inches, e.g. 19.5 (feet) -> "19'-6"". Bonsai's own
// display for the same file goes to a much finer 1/256" (its own default
// precision setting) — 1/16" was chosen here as the more commonly-read
// architectural convention, not an attempt to match Bonsai's fraction
// denominator exactly.
function formatFeetInches(feet: number): string {
  const totalSixteenths = Math.round(feet * 12 * 16)
  const sign = totalSixteenths < 0 ? '-' : ''
  const abs = Math.abs(totalSixteenths)
  const wholeFeet = Math.floor(abs / (12 * 16))
  const remainder = abs % (12 * 16)
  const wholeInches = Math.floor(remainder / 16)
  const sixteenths = remainder % 16
  let fracStr = ''
  if (sixteenths > 0) {
    let num = sixteenths
    let den = 16
    while (num % 2 === 0) { num /= 2; den /= 2 }
    fracStr = ` ${num}/${den}`
  }
  return `${sign}${wholeFeet}'-${wholeInches}${fracStr}"`
}

function findNodeByExpressId(node: IfcTreeNode, expressID: number): IfcTreeNode | null {
  if (node.expressID === expressID) return node
  for (const child of node.children) {
    const found = findNodeByExpressId(child, expressID)
    if (found) return found
  }
  return null
}

function TreeNode({ node, depth, selectedExpressId, selectedExpressIds, onSelect, onSelectWholeModel }: {
  node: IfcTreeNode; depth: number; selectedExpressId: number | null; selectedExpressIds: Set<number>
  onSelect: (id: number, additive: boolean) => void
  onSelectWholeModel: (additive: boolean) => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = node.children.length > 0
  const isPrimary = node.expressID === selectedExpressId
  const isSelected = selectedExpressIds.has(node.expressID)
  return (
    <div>
      <div
        onClick={e => (hasChildren ? onSelectWholeModel(e.ctrlKey || e.metaKey) : onSelect(node.expressID, e.ctrlKey || e.metaKey))}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={
          hasChildren ? 'Spatial container (no geometry of its own) — click to select the whole model'
          : isSelected ? 'Ctrl/Cmd+click to remove from selection'
          : 'Click to select, Ctrl/Cmd+click to add to selection'
        }
        className={`flex items-center gap-1 py-1 px-1 text-xs cursor-pointer hover:bg-gray-50 ${
          isPrimary ? 'bg-blue-50 text-blue-700 font-medium'
          : isSelected ? 'bg-amber-50 text-amber-700 font-medium'
          : 'text-gray-600'
        }`}
      >
        {hasChildren ? (
          <button onClick={e => { e.stopPropagation(); setExpanded(v => !v) }} className="text-gray-400 w-3 shrink-0">
            {expanded ? '▾' : '▸'}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <span className="truncate">{node.type}</span>
      </div>
      {hasChildren && expanded && node.children.map((child, i) => (
        <TreeNode
          key={`${child.expressID}-${i}`} node={child} depth={depth + 1}
          selectedExpressId={selectedExpressId} selectedExpressIds={selectedExpressIds}
          onSelect={onSelect} onSelectWholeModel={onSelectWholeModel}
        />
      ))}
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide border-t border-gray-100 first:border-t-0">{label}</div>
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-700 truncate">{value}</span>
    </div>
  )
}

// One loaded IFC model's own collapsible section — spatial structure +
// Class/Type/Occurrence always shown when expanded, Object Information only
// once this specific model owns the current selection (isActiveModel),
// since expressIDs aren't comparable across different models' own web-ifc
// sessions (2026-07-09, per multi-model support).
function ModelItem({
  handle, isActiveModel, selectedExpressId, selectedExpressIds, onSelect, onSelectMany, onUnload,
  selected, onToggleSelected, onSelectWholeModel, unitDisplay,
  activities, links, animationProfiles, onLinkElement, onUnlinkElement, onAssignProfile,
}: {
  handle: IfcModelHandle; isActiveModel: boolean
  selectedExpressId: number | null; selectedExpressIds: Set<number>
  onSelect: (id: number, additive: boolean) => void
  onSelectMany: (expressIDs: number[], additive: boolean) => void
  onUnload: () => void
  selected: boolean; onToggleSelected: () => void
  onSelectWholeModel: (additive: boolean) => void
  unitDisplay: IfcUnitDisplay
  activities: Activity[]; links: ModelElementLink[]; animationProfiles: AnimationProfile[]
  onLinkElement: (sourceKind: SourceKind, elementRef: string, elementLabel: string, activityId: string) => void
  onUnlinkElement: (linkId: string) => void
  onAssignProfile: (linkId: string, profileId: string | null) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [tree, setTree] = useState<IfcTreeNode | null>(null)
  const [typeCounts, setTypeCounts] = useState<{ typeName: string; count: number }[]>([])
  const [elementInfo, setElementInfo] = useState<IfcElementInfo | null>(null)
  const [loadingElement, setLoadingElement] = useState(false)
  // Spatial Decomposition (2026-07-11) — a flat list of real buttons/rows,
  // one per storey, not something buried in the spatial tree (see
  // collectStoreyNodes' own header for why that first attempt didn't
  // work). Names/elevations load in a second pass once the tree itself is
  // in — getSpatialTree's own nodes carry no Name or Elevation (see
  // getElementName's own header), so each storey's real name ("Ground
  // Floor") and height are fetched separately, a handful of cheap calls
  // rather than slowing down the whole tree fetch for every element just
  // to get a few storeys' attributes.
  const [storeys, setStoreys] = useState<{ expressID: number; name: string; elevation: string | null }[]>([])
  // Which storey (if any) the Class>Type>Occurrence list below is scoped
  // to (2026-07-11, per Maro comparing against Bonsai/Blender's own IFC
  // panel — "when the chosen level is selected you can simply pick the
  // ifc column then find/isolate", which this codebase's Select-by-Storey
  // buttons didn't support: they could select *everything* on a storey,
  // but not "just the columns on this storey", since the type-count list
  // was always computed over the whole model). null = unscoped (today's
  // whole-model behaviour, unchanged).
  const [activeStoreyId, setActiveStoreyId] = useState<number | null>(null)
  const [scopedTypeGroups, setScopedTypeGroups] = useState<{ typeName: string; ids: number[] }[] | null>(null)
  // Metres-per-raw-unit for this model's own declared LENGTHUNIT (2026-07-11
  // — see getLengthUnitToMetres's own header for how this was verified
  // against a real file rather than assumed). Defaults to 1 (assume metres)
  // until the project's own units are read, same fallback
  // getLengthUnitToMetres itself uses when it can't find a LENGTHUNIT entry.
  const [lengthUnitToMetres, setLengthUnitToMetres] = useState(1)

  useEffect(() => {
    let cancelled = false
    setTree(null)
    setTypeCounts([])
    setStoreys([])
    setActiveStoreyId(null)
    setLengthUnitToMetres(1)
    import('./ifcModel').then(({ getSpatialTree, getTypeCounts, getElementName, getElementElevation, getLengthUnitToMetres }) => {
      if (cancelled) return
      getSpatialTree(handle).then(t => {
        if (cancelled) return
        setTree(t)
        setLengthUnitToMetres(getLengthUnitToMetres(handle, t.expressID))
        const storeyNodes = collectStoreyNodes(t)
        setStoreys(storeyNodes.map(n => ({ expressID: n.expressID, name: `Storey ${n.expressID}`, elevation: null })))
        for (const node of storeyNodes) {
          getElementName(handle, node.expressID).then(name => {
            if (cancelled || name === '—') return
            setStoreys(prev => prev.map(s => (s.expressID === node.expressID ? { ...s, name } : s)))
          })
          getElementElevation(handle, node.expressID).then(elevation => {
            if (cancelled) return
            setStoreys(prev => prev.map(s => (s.expressID === node.expressID ? { ...s, elevation } : s)))
          })
        }
      })
      setTypeCounts(getTypeCounts(handle))
    })
    return () => { cancelled = true }
  }, [handle])

  // Recomputes the Class>Type>Occurrence scope whenever a storey is picked
  // (or cleared) below — walks collectLeafExpressIds off whatever's already
  // in `tree` (no new web-ifc spatial-structure call), then groups those by
  // type via groupExpressIdsByType. Dynamic-imported same as every other
  // ifcModel call in this file, to keep web-ifc out of the main bundle.
  useEffect(() => {
    if (activeStoreyId === null || !tree) { setScopedTypeGroups(null); return }
    const node = findNodeByExpressId(tree, activeStoreyId)
    if (!node) { setScopedTypeGroups(null); return }
    let cancelled = false
    setScopedTypeGroups(null)
    import('./ifcModel').then(({ groupExpressIdsByType }) => {
      if (cancelled) return
      setScopedTypeGroups(groupExpressIdsByType(handle, collectLeafExpressIds(node)))
    })
    return () => { cancelled = true }
  }, [activeStoreyId, tree, handle])

  useEffect(() => {
    setElementInfo(null)
    if (!isActiveModel || selectedExpressId === null) return
    let cancelled = false
    setLoadingElement(true)
    import('./ifcModel')
      .then(({ getElementInfo }) => getElementInfo(handle, selectedExpressId))
      .then(info => { if (!cancelled) setElementInfo(info) })
      .finally(() => { if (!cancelled) setLoadingElement(false) })
    return () => { cancelled = true }
  }, [handle, selectedExpressId, isActiveModel])

  return (
    <div>
      <div className="px-3 py-2 sticky top-0 bg-white flex items-center gap-2 z-10">
        <button onClick={() => setExpanded(v => !v)} title={expanded ? 'Collapse' : 'Expand'} className="text-gray-400 w-3 shrink-0">
          {expanded ? '▾' : '▸'}
        </button>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          title={selected ? 'Selected — click to deselect' : 'Select this model'}
        />
        <span className="text-xs text-gray-500 truncate" title={handle.object.name}>{handle.object.name || 'IFC model'}</span>
        <button onClick={onUnload} title="Unload IFC model" className="ml-auto text-xs text-gray-400 hover:text-red-600 shrink-0">
          Unload
        </button>
      </div>
      {expanded && (
        <div>
          <SectionHeader label="Project Overview" />
          <div className="max-h-52 overflow-y-auto border-b border-gray-100">
            {tree ? (
              <TreeNode
                node={tree} depth={0} selectedExpressId={isActiveModel ? selectedExpressId : null}
                selectedExpressIds={isActiveModel ? selectedExpressIds : new Set()}
                onSelect={onSelect} onSelectWholeModel={onSelectWholeModel}
              />
            ) : (
              <p className="px-3 py-2 text-xs text-gray-400">Loading spatial structure…</p>
            )}
          </div>

          {storeys.length > 0 && (
            <>
              <SectionHeader label="Spatial Decomposition" />
              <div className="pb-1">
                {[...storeys]
                  .sort((a, b) => (a.elevation === null ? Infinity : Number(a.elevation)) - (b.elevation === null ? Infinity : Number(b.elevation)))
                  .map(s => {
                    const isActive = s.expressID === activeStoreyId
                    return (
                      <div
                        key={s.expressID}
                        onClick={() => setActiveStoreyId(prev => (prev === s.expressID ? null : s.expressID))}
                        title={isActive
                          ? `${s.name} is the active scope — click to clear it and show the whole model below again`
                          : `Set ${s.name} as the active scope — Class > Type > Occurrence below will only count/select elements on this storey`}
                        className={`flex items-center justify-between gap-2 px-3 py-1 text-xs cursor-pointer ${
                          isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className="truncate">{s.name}</span>
                        {s.elevation !== null && <span className="text-gray-400 shrink-0">{formatElevation(s.elevation, lengthUnitToMetres, unitDisplay)}</span>}
                      </div>
                    )
                  })}
              </div>
              {activeStoreyId !== null && tree && (
                <div className="px-3 pb-2">
                  <button
                    onClick={e => {
                      const node = findNodeByExpressId(tree, activeStoreyId)
                      if (node) onSelectMany(collectLeafExpressIds(node), e.ctrlKey || e.metaKey)
                    }}
                    title="Select every element on this storey, Ctrl/Cmd+click to add to the current selection"
                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-blue-400 hover:text-blue-700"
                  >
                    Select All on This Storey
                  </button>
                </div>
              )}
            </>
          )}

          <SectionHeader
            label={activeStoreyId !== null
              ? `Class > Type > Occurrence — ${storeys.find(s => s.expressID === activeStoreyId)?.name ?? 'storey'}`
              : 'Class > Type > Occurrence'}
          />
          {activeStoreyId !== null && (
            <div className="px-3 -mt-1 pb-1">
              <button onClick={() => setActiveStoreyId(null)} className="text-[10px] text-blue-600 hover:underline">
                Clear storey scope — show whole model
              </button>
            </div>
          )}
          <div className="max-h-40 overflow-y-auto px-3 pb-2 space-y-0.5">
            {activeStoreyId !== null && !scopedTypeGroups && (
              <p className="text-xs text-gray-400 py-1">Loading…</p>
            )}
            {(activeStoreyId !== null
              ? (scopedTypeGroups ?? []).map(g => ({ typeName: g.typeName, count: g.ids.length }))
              : typeCounts
            ).map(t => (
              <div
                key={t.typeName}
                onClick={async e => {
                  if (activeStoreyId !== null) {
                    const group = scopedTypeGroups?.find(g => g.typeName === t.typeName)
                    if (group) onSelectMany(group.ids, e.ctrlKey || e.metaKey)
                    return
                  }
                  const { getExpressIdsForType } = await import('./ifcModel')
                  onSelectMany(getExpressIdsForType(handle, t.typeName), e.ctrlKey || e.metaKey)
                }}
                title={`Select by Type — select every ${t.typeName} element (${t.count})${activeStoreyId !== null ? ' on this storey' : ''}, Ctrl/Cmd+click to add to the current selection`}
                className="flex items-center justify-between text-xs text-gray-600 cursor-pointer hover:bg-gray-50 hover:text-blue-700 rounded px-1 -mx-1"
              >
                <span className="truncate">{t.typeName}</span>
                <span className="text-gray-400">{t.count}</span>
              </div>
            ))}
          </div>

          <SectionHeader label="Object Information" />
          {(!isActiveModel || selectedExpressId === null) && (
            <p className="px-3 py-2 text-xs text-gray-400">Click an element in the 3D view (or the tree above) to see its properties.</p>
          )}
          {isActiveModel && selectedExpressId !== null && loadingElement && (
            <p className="px-3 py-2 text-xs text-gray-400">Loading…</p>
          )}
          {isActiveModel && elementInfo && !loadingElement && (
            <div className="px-3 pb-3 space-y-2">
              <div className="text-xs space-y-0.5">
                <div className="font-medium text-gray-800 truncate">{elementInfo.type}</div>
                <Field label="Name" value={elementInfo.name} />
                <Field label="GlobalId" value={elementInfo.globalId} />
                <Field label="ObjectType" value={elementInfo.objectType} />
                <Field label="Tag" value={elementInfo.tag} />
                <Field label="PredefinedType" value={elementInfo.predefinedType} />
              </div>
              {elementInfo.propertySets.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Property Sets</div>
                  {elementInfo.propertySets.map((pset, i) => (
                    <div key={`${pset.name}-${i}`} className="border border-gray-100 rounded">
                      <div className="px-2 py-1 bg-gray-50 text-xs font-medium text-gray-700 truncate">{pset.name}</div>
                      {pset.properties.map((p, j) => (
                        <div key={`${p.name}-${j}`} className="flex items-center justify-between px-2 py-0.5 text-xs">
                          <span className="text-gray-500 truncate">{p.name}</span>
                          <span className="text-gray-700 truncate ml-2">{p.value}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Activity Link</div>
                <ElementLinkFields
                  activities={activities}
                  links={links.filter(l => l.source_kind === 'ifc' && l.element_ref === elementInfo.globalId)}
                  animationProfiles={animationProfiles}
                  onLink={activityId => onLinkElement('ifc', elementInfo.globalId, `${elementInfo.type}: ${elementInfo.name}`, activityId)}
                  onUnlink={onUnlinkElement}
                  onAssignProfile={onAssignProfile}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// IFC tab content of the right-side DataPanel (2026-07-10, per Maro:
// "another panel but with a mix of these two [Project Overview / Object
// Information]"; tabbed alongside MeshDataPanel as of 2026-07-11) — spatial
// structure + Class/Type/Occurrence counts always shown once an IFC model is
// loaded (Project Overview half of the reference screenshots), Object
// Information (attributes + property sets) shown once something's selected
// (the second half). Only populated for IFC imports — plain "Import 3D"
// files (GLTF/OBJ/FBX) have no IFC property data, so they get MeshDataPanel's
// simpler list view instead. Content-only (no outer w-72/border chrome) —
// DataPanel.tsx owns that plus the tab bar.
//
// One collapsible ModelItem per loaded model (2026-07-09, per federated/
// assembly modeling — "allow me to import more than one IFC model... so I
// can start building an assembly or federated model"), mirroring
// MeshDataPanel.tsx's own list-of-items pattern rather than assuming a
// single global handle.
//
// Activity Link (2026-07-11) — Activity↔model-element linking's frontend,
// the backend (model_element_link.py) having been built earlier this
// session with no UI until now. Keyed by the selected element's GlobalId —
// see ElementLinkFields.tsx's own header for the shared shape with
// MeshDataPanel.tsx's equivalent.
export function IfcDataPanel({
  handles, activeObjectId, selectedExpressId, selectedExpressIds, onSelect, onSelectMany, onUnload,
  selectedObjectIds, onSelectWholeModel, unitDisplay, onUnitDisplayChange,
  activities, links, animationProfiles, onLinkElement, onUnlinkElement, onAssignProfile,
}: Props) {
  if (handles.length === 0) {
    return (
      <div className="flex-1 p-3 text-xs text-gray-400">
        Import an IFC file to see its structure and properties.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Units</span>
        <div className="flex rounded border border-gray-300 overflow-hidden">
          {(['auto', 'imperial', 'metric'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => onUnitDisplayChange(opt)}
              title={opt === 'auto' ? "Match the loaded file's own declared unit" : opt === 'imperial' ? 'Always show feet-inches, regardless of the file\'s own unit' : 'Always show metres, regardless of the file\'s own unit'}
              className={`px-2 py-0.5 text-[10px] ${
                unitDisplay === opt ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'
              } ${opt !== 'auto' ? 'border-l border-gray-300' : ''}`}
            >
              {opt === 'auto' ? 'Auto' : opt === 'imperial' ? 'ft' : 'm'}
            </button>
          ))}
        </div>
      </div>
      {handles.map(handle => {
        const id = `ifc-${handle.modelID}`
        return (
          <ModelItem
            key={id}
            handle={handle}
            isActiveModel={id === activeObjectId}
            selectedExpressId={selectedExpressId}
            selectedExpressIds={selectedExpressIds}
            onSelect={(exprId, additive) => onSelect(exprId, additive, id)}
            onSelectMany={(exprIds, additive) => onSelectMany(exprIds, additive, id)}
            onUnload={() => onUnload(id)}
            selected={selectedObjectIds.has(id)}
            onToggleSelected={() => { onSelectWholeModel(id, true) }}
            onSelectWholeModel={additive => onSelectWholeModel(id, additive)}
            unitDisplay={unitDisplay}
            activities={activities}
            links={links}
            animationProfiles={animationProfiles}
            onLinkElement={onLinkElement}
            onUnlinkElement={onUnlinkElement}
            onAssignProfile={onAssignProfile}
          />
        )
      })}
    </div>
  )
}
