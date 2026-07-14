import axios from 'axios'
import { useState } from 'react'
import { api } from '@/lib/api'
import type { Calendar } from '@/modules/scheduling/types'
import type { Collection } from './collections'
import type { IfcModelHandle } from './ifcModel'
import { extractScheduleElements, type ExtractedElement } from './ifcScheduleExtraction'
import {
  buildStagedSchedule, groupByStorey, groupFromCollections,
  usedCategoryNames, usedPhaseRows, type CategoryRate, type PhaseRow, type ProposedScheduleSummary, type StoreyGroup,
} from './scheduleGeneration'

interface Props {
  handle: IfcModelHandle | null
  modelName: string
  collections: Collection[]
  calendars: Calendar[]
  projectId: string
  schedulePeriodId: string
  onCancel: () => void
  onGenerated: () => void
}

type Source = 'scan' | 'collections'
type Step = 'source' | 'extract' | 'rates' | 'review'

// "Generate a resource loaded schedule based on an imported ifc"
// (2026-07-13, per Maro) — a wizard modelled on ImportModelDialog.tsx's
// own overlay/panel conventions, the first wizard-shaped dialog in this
// module. Two ways to arrive at the same reviewable WBS
// (scheduleGeneration.ts's own StoreyGroup[] shape), picked in the new
// Source step:
// - Scan Model: automatic, off ifcScheduleExtraction.ts's IFC-type scan.
// - Use My Collections: manual, off a Collections tree Maro organised by
//   hand (Pit > Footings, Level 1 > Columns, ...) — added 2026-07-13 after
//   the automatic scan mis-bucketed this file's pile caps (exported as
//   IfcSlab with PredefinedType=BASESLAB, not IfcFooting) as ordinary
//   floor slabs; Maro's own words: "a controlled way to do this better...
//   then with that you can generate the schedule". The auto-scan's own
//   classifier got a real fix for that specific case too (see
//   ifcScheduleExtraction.ts), but a hand-curated Collections tree stays
//   available as a deliberate, always-correct alternative for whatever the
//   next heuristic gap turns out to be, and isn't limited to the five
//   structural types either, since a collection can hold anything.
// Both paths converge on the same Rates & Crews / Review & Commit steps.
export function IfcScheduleWizard({ handle, modelName, collections, calendars, projectId, schedulePeriodId, onCancel, onGenerated }: Props) {
  const [step, setStep] = useState<Step>('source')
  const [source, setSource] = useState<Source | null>(null)

  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [elements, setElements] = useState<ExtractedElement[] | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  const [storeys, setStoreys] = useState<StoreyGroup[] | null>(null)
  const [collectionWarnings, setCollectionWarnings] = useState<string[]>([])

  const [rates, setRates] = useState<Record<string, CategoryRate>>({})
  // null = the project's own default calendar (2026-07-13, per Maro:
  // "prompt the user to pick the calendar they want, by default the
  // standard calendar but options to pick specific calendars"). Resource-
  // level calendars were deliberately left out — Resource.calendar_id
  // exists in the schema but nothing in the CPM engine reads it yet
  // (resource_assignment_spread.py's own docstring is explicit about
  // this), so a picker there would look like it works and silently do
  // nothing.
  const [calendarId, setCalendarId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const topLevelCollections = collections.filter(c => c.parent_collection_id === null)

  const seedRates = (grouped: StoreyGroup[]) => {
    setRates(Object.fromEntries(usedPhaseRows(grouped).map(row => [row.id, row.phase.rate])))
  }

  const chooseScan = () => {
    setSource('scan')
    setStep('extract')
  }

  const chooseCollections = () => {
    setSource('collections')
    const { storeys: grouped, warnings } = groupFromCollections(collections)
    setStoreys(grouped)
    setCollectionWarnings(warnings)
    seedRates(grouped)
    setStep('rates')
  }

  const runExtract = async () => {
    if (!handle) return
    setExtracting(true)
    setExtractError(null)
    setProgress({ done: 0, total: 0 })
    try {
      const found = await extractScheduleElements(handle, (done, total) => setProgress({ done, total }))
      setElements(found)
      const grouped = groupByStorey(found)
      setStoreys(grouped)
      seedRates(grouped)
      setStep('rates')
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract schedule elements')
    } finally {
      setExtracting(false)
    }
  }

  const categoryNames = storeys ? usedCategoryNames(storeys) : []
  const phaseRows: PhaseRow[] = storeys ? usedPhaseRows(storeys) : []
  const { staged, summary }: { staged: ReturnType<typeof buildStagedSchedule>['staged']; summary: ProposedScheduleSummary } =
    storeys ? buildStagedSchedule(projectId, schedulePeriodId, storeys, rates, modelName, calendarId) : {
      staged: { project_id: projectId, schedule_period_id: schedulePeriodId, calendar_id: null, activities: [], resources: [], assignments: [], relationships: [] },
      summary: { storeyCount: 0, activityCount: 0, resourceCount: 0, relationshipCount: 0, elementCount: 0 },
    }

  const updateRate = (rowId: string, patch: Partial<CategoryRate>) => {
    setRates(prev => ({ ...prev, [rowId]: { ...prev[rowId], ...patch } }))
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setGenerateError(null)
    try {
      await api.post('/api/v1/schedule-bulk-generate/', staged)
      onGenerated()
    } catch (err) {
      // Same axios.isAxiosError-then-fall-back-to-message shape every other
      // error handler in this module uses (MaterialPresetPicker.tsx's own
      // handleSave, FourD.tsx's collectionErrorMessage/clashErrorMessage).
      const detail = axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string' ? err.response.data.detail : null
      setGenerateError(detail ? `Failed to generate schedule: ${detail}` : 'Failed to generate schedule')
    } finally {
      setGenerating(false)
    }
  }

  const stepOrder: Step[] = source === 'collections' ? ['source', 'rates', 'review'] : ['source', 'extract', 'rates', 'review']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="w-[640px] max-h-[80vh] flex flex-col bg-white rounded-lg shadow-xl border border-gray-200" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">Generate Schedule from IFC Model</h3>
          <div className="flex gap-1">
            {stepOrder.map(s => (
              <div key={s} className={`w-1.5 h-1.5 rounded-full ${step === s ? 'bg-gray-900' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>

        <div className="px-4 py-3 flex-1 overflow-y-auto">
          {step === 'source' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-2">
                How should the first-draft WBS be built?
              </p>
              <button
                onClick={chooseScan}
                disabled={!handle}
                title={handle ? undefined : 'No IFC model is currently loaded/selected'}
                className="w-full text-left px-3 py-2.5 rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="text-xs font-bold text-gray-800">Scan Model (automatic)</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  Scans the loaded IFC model for structural elements (columns, beams, slabs, footings, foundation
                  walls) and architectural elements (curtain walls, doors, windows, roofs, stairs, railings, interior
                  finishes) and groups them by storey. Fast, but only as accurate as the model's own IFC typing.
                </div>
              </button>
              <button
                onClick={chooseCollections}
                disabled={topLevelCollections.length === 0}
                title={topLevelCollections.length === 0 ? 'No Collections exist in this project yet' : undefined}
                className="w-full text-left px-3 py-2.5 rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="text-xs font-bold text-gray-800">Use My Collections (controlled)</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  Builds the WBS from a Collections tree you've organised by hand — one top-level Collection per
                  storey (e.g. "Pit", "Level 1"), each with sub-Collections for its trades (e.g. "Footings",
                  "Columns"). Full control over grouping when the automatic scan isn't reliable enough.
                  {topLevelCollections.length === 0 && ' Create a Collection first (IFC Data panel) to use this.'}
                </div>
              </button>
            </div>
          )}

          {step === 'extract' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Scans this model for structural and architectural elements (columns, beams, slabs, footings, walls,
                curtain walls, doors, windows, roofs, stairs, railings, finishes) and groups them by storey — a
                first-draft WBS you'll review and adjust before anything is created.
              </p>
              {extracting && progress && (
                <div className="space-y-1">
                  <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-gray-900 transition-all"
                      style={{ width: progress.total > 0 ? `${(100 * progress.done) / progress.total}%` : '0%' }}
                    />
                  </div>
                  <div className="text-[11px] text-gray-400">{progress.done} / {progress.total} elements scanned</div>
                </div>
              )}
              {extractError && <div className="text-xs text-red-600">{extractError}</div>}
              {elements && !extracting && storeys && (
                <div className="text-xs text-gray-600">
                  Found {elements.length} elements across {storeys.length} storeys:
                  {' '}{categoryNames.map(c => `${elements.filter(el => el.category === c).length} ${c}`).join(', ')}.
                </div>
              )}
            </div>
          )}

          {step === 'rates' && storeys && (
            <div className="space-y-3">
              {source === 'collections' && (
                <div className="text-xs text-gray-600">
                  Found {storeys.length} storeys with {categoryNames.length} categories from your Collections tree
                  ({summary.elementCount} linked elements).
                  {collectionWarnings.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-700">
                      {collectionWarnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                    </ul>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500">
                {source === 'collections'
                  ? 'Starting productivity rates — edit crew, equipment, output per crew-day, and day rates for any phase before generating durations and budgets.'
                  : 'Typical industry productivity rates — edit crew, equipment, output per crew-day, and day rates for any phase before generating durations and budgets.'}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                      <th className="text-left pb-1">Category / Phase</th>
                      <th className="text-left pb-1">Crew</th>
                      <th className="text-right pb-1">Size</th>
                      <th className="text-right pb-1">Output/Day</th>
                      <th className="text-right pb-1">Crew $/Day</th>
                      <th className="text-left pb-1">Equipment</th>
                      <th className="text-right pb-1">Equip. $/Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phaseRows.map(row => {
                      const rate = rates[row.id] ?? row.phase.rate
                      return (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="py-1.5 text-gray-700 whitespace-nowrap">{row.category} — {row.phase.label}</td>
                          <td className="py-1.5">
                            <input
                              value={rate.crewName}
                              onChange={e => updateRate(row.id, { crewName: e.target.value })}
                              className="w-32 border border-gray-300 rounded px-1 py-0.5"
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            <input
                              type="number" min={1} value={rate.crewSize}
                              onChange={e => updateRate(row.id, { crewSize: Math.max(1, Number(e.target.value) || 1) })}
                              className="w-12 text-right border border-gray-300 rounded px-1 py-0.5"
                            />
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            <input
                              type="number" min={0.1} step={0.1} value={rate.productivityPerCrewDay}
                              onChange={e => updateRate(row.id, { productivityPerCrewDay: Math.max(0.1, Number(e.target.value) || 0.1) })}
                              className="w-16 text-right border border-gray-300 rounded px-1 py-0.5"
                            />
                            <span className="text-gray-400 ml-1">{rate.unit}</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <input
                              type="number" min={0} value={rate.costPerCrewDay}
                              onChange={e => updateRate(row.id, { costPerCrewDay: Math.max(0, Number(e.target.value) || 0) })}
                              className="w-20 text-right border border-gray-300 rounded px-1 py-0.5"
                            />
                          </td>
                          <td className="py-1.5">
                            <input
                              value={rate.equipmentName ?? ''}
                              placeholder="—"
                              onChange={e => updateRate(row.id, { equipmentName: e.target.value || undefined })}
                              className="w-28 border border-gray-300 rounded px-1 py-0.5"
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            {rate.equipmentName && (
                              <input
                                type="number" min={0} value={rate.equipmentCostPerDay ?? 0}
                                onChange={e => updateRate(row.id, { equipmentCostPerDay: Math.max(0, Number(e.target.value) || 0) })}
                                className="w-20 text-right border border-gray-300 rounded px-1 py-0.5"
                              />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'review' && storeys && (
            <div className="space-y-3">
              <div className="text-xs text-gray-600 space-y-1">
                <div>Source: {source === 'collections' ? 'Your Collections tree' : 'Automatic IFC scan'}</div>
                <div>1 root WBS ("{modelName}") + {summary.storeyCount} storey summary activities</div>
                <div>{summary.activityCount - summary.storeyCount - 1} work activities across {categoryNames.length} categories, {phaseRows.length} construction phases</div>
                <div>{summary.resourceCount} crews &amp; equipment, {summary.relationshipCount} sequencing links</div>
                <div>{summary.elementCount} IFC elements will be linked to their completion activities</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Calendar</div>
                <select
                  value={calendarId ?? ''}
                  onChange={e => setCalendarId(e.target.value || null)}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                >
                  <option value="">Project default {calendars.find(c => c.is_project_default) ? `(${calendars.find(c => c.is_project_default)!.name})` : ''}</option>
                  {calendars.filter(c => !c.is_project_default).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <div className="text-[11px] text-gray-400 mt-0.5">Applied to every generated activity — editable per-activity afterward in Scheduling.</div>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                {source === 'collections'
                  ? 'Grouping and element counts come straight from your Collections; durations and costs are still a first draft off the rates above, freely editable afterward in Scheduling.'
                  : "Quantities are bounding-box estimates from the loaded geometry, not a certified takeoff — durations and costs are a first draft, freely editable afterward in Scheduling."}
              </p>
              {generateError && <div className="text-xs text-red-600">{generateError}</div>}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 flex justify-between items-center">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <div className="flex gap-2">
            {step === 'extract' && (
              <button
                onClick={() => setStep('source')}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              >
                Back
              </button>
            )}
            {step === 'rates' && (
              <button
                onClick={() => setStep(source === 'scan' ? 'extract' : 'source')}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              >
                Back
              </button>
            )}
            {step === 'review' && (
              <button
                onClick={() => setStep('rates')}
                disabled={generating}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Back
              </button>
            )}
            {step === 'extract' && !elements && (
              <button
                onClick={runExtract}
                disabled={extracting || !handle}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {extracting ? 'Scanning…' : 'Scan Model'}
              </button>
            )}
            {step === 'extract' && elements && (
              <button
                onClick={() => setStep('rates')}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
              >
                Next: Rates & Crews
              </button>
            )}
            {step === 'rates' && (
              <button
                onClick={() => setStep('review')}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
              >
                Next: Review
              </button>
            )}
            {step === 'review' && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {generating ? 'Generating…' : 'Generate Schedule'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
