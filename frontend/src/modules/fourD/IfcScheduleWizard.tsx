import axios from 'axios'
import { useState } from 'react'
import { api } from '@/lib/api'
import type { Calendar } from '@/modules/scheduling/types'
import type { IfcModelHandle } from './ifcModel'
import { extractScheduleElements, type ExtractedElement } from './ifcScheduleExtraction'
import {
  buildStagedSchedule, groupByStorey,
  usedCategoryNames, usedPhaseRows, type CategoryRate, type PhaseRow, type ProposedScheduleSummary, type StoreyGroup,
} from './scheduleGeneration'

interface Props {
  // Every currently-loaded IFC model, not just the active one (2026-07-15,
  // per Maro: "assuming i add two ifc files and i hit generate, give me the
  // option of generating from both or one... it scans both but only
  // generated the architectural. cant i do both?" — the wizard used to be
  // handed a single `handle`, hardcoded in FourD.tsx to whichever model was
  // active or else just ifcHandles[0], so a second imported file was never
  // reachable at all regardless of what the user picked). The Source step
  // below lets the user check/uncheck which of these actually get scanned.
  models: { handle: IfcModelHandle; name: string }[]
  calendars: Calendar[]
  projectId: string
  // The generated root WBS's own name (2026-07-17, per Maro: "you dont need
  // to append the names of all the IFC. Just use the name of the Project as
  // the overall parent name" — this used to be every checked model's own
  // name joined together, e.g. "Structural + Electrical + Facades +
  // Architectural + HVAC + Plumbing", unreadable past 2-3 files).
  projectName: string
  schedulePeriodId: string
  onCancel: () => void
  onGenerated: () => void
}

// No 'rates' step (2026-07-17, per Maro: "I dont want to see the rate and
// crew settings when I'm generating the schedule" — that UI moves to a
// separate "Generate Resources" flow in the Resources tab, operating on an
// already-committed schedule instead of this one). seedRates below still
// runs internally either way — computeDurationHours still needs *some*
// CategoryRate to estimate a realistic duration from, just DEFAULT_
// CATEGORY_PHASES' own typical-industry defaults now, silently, with no
// user-facing editing step at all.
type Step = 'source' | 'extract' | 'review'

// "Generate a resource loaded schedule based on an imported ifc"
// (2026-07-13, per Maro) — a wizard modelled on ImportModelDialog.tsx's
// own overlay/panel conventions, the first wizard-shaped dialog in this
// module. Builds a reviewable WBS (scheduleGeneration.ts's own
// StoreyGroup[] shape) off ifcScheduleExtraction.ts's automatic IFC-type
// scan. (A second "Use My Collections (controlled)" source — building the
// same WBS off a hand-curated Collections tree instead — existed
// 2026-07-13 through 2026-07-19 and was removed per Maro: the auto-scan's
// own classifier got real fixes for the specific mis-bucketing cases that
// motivated it at the time, and the extra path wasn't worth keeping
// alongside that; see scheduleGeneration.ts's own git history for
// groupFromCollections if this ever needs resurrecting.)
export function IfcScheduleWizard({ models, calendars, projectId, projectName, schedulePeriodId, onCancel, onGenerated }: Props) {
  const [step, setStep] = useState<Step>('source')
  // Defaults to every loaded model selected — matches this app's usual
  // "editable default, not forced choice" convention (same shape as the
  // rates table below defaulting to industry-typical values): the common
  // case (one file, or "yes, scan everything I've imported") needs zero
  // extra clicks, and unchecking one is a single click for the "just the
  // architectural" case.
  const [selectedModelIds, setSelectedModelIds] = useState<Set<number>>(() => new Set(models.map(m => m.handle.modelID)))
  const toggleModel = (modelID: number) => {
    setSelectedModelIds(prev => {
      const next = new Set(prev)
      if (next.has(modelID)) next.delete(modelID); else next.add(modelID)
      return next
    })
  }
  const selectedModels = models.filter(m => selectedModelIds.has(m.handle.modelID))

  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [elements, setElements] = useState<ExtractedElement[] | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  const [storeys, setStoreys] = useState<StoreyGroup[] | null>(null)

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

  const seedRates = (grouped: StoreyGroup[]) => {
    setRates(Object.fromEntries(usedPhaseRows(grouped).map(row => [row.id, row.phase.rate])))
  }

  const chooseScan = () => {
    setStep('extract')
  }

  // Scans every *checked* model in turn, not just the first/active one
  // (2026-07-15, per Maro), concatenating their elements before grouping —
  // GlobalId is unique across files (verified: web-ifc's own GUID
  // generation follows the IFC spec's global-uniqueness guarantee, not
  // scoped per-file), so a structural + architectural pair's elements
  // merge safely into one combined list with no risk of one file's
  // expressID colliding with another's (findMeshesForExpressId inside
  // extractScheduleElements is always scoped to its own handle.object, and
  // downstream linking always resolves by globalId, never a bare
  // expressID, across every loaded handle — see linkedElements.ts).
  // groupByStorey then buckets by storeyName string, so same-named storeys
  // across the two files (e.g. both call it "Level 1") merge into one
  // group for free; differently-named storeys just land as separate
  // groups, same "first draft, freely reorganised after" contract this
  // wizard already has for everything else.
  const runExtract = async () => {
    if (selectedModels.length === 0) return
    setExtracting(true)
    setExtractError(null)
    setProgress({ done: 0, total: 0 })
    try {
      // Each model's own progress callback only knows its own candidate
      // count — tracked per-model here and summed on every tick so the one
      // progress bar reads as "N of the combined total across every
      // checked file," not resetting/jumping between files.
      const perModelProgress = selectedModels.map(() => ({ done: 0, total: 0 }))
      const reportCombined = () => {
        setProgress({
          done: perModelProgress.reduce((sum, p) => sum + p.done, 0),
          total: perModelProgress.reduce((sum, p) => sum + p.total, 0),
        })
      }
      const found: ExtractedElement[] = []
      for (let i = 0; i < selectedModels.length; i++) {
        const fromThisModel = await extractScheduleElements(selectedModels[i].handle, (done, total) => {
          perModelProgress[i] = { done, total }
          reportCombined()
        })
        found.push(...fromThisModel)
      }
      setElements(found)
      const grouped = groupByStorey(found)
      setStoreys(grouped)
      seedRates(grouped)
      setStep('review')
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract schedule elements')
    } finally {
      setExtracting(false)
    }
  }

  // The root WBS activity's own name — the project's own name (2026-07-17,
  // per Maro: "just use the name of the Project as the overall parent
  // name"), not every checked model's own name joined together (the old
  // 2026-07-15 behaviour — unreadable past 2-3 files, e.g. "Structural +
  // Electrical + Facades + Architectural + HVAC + Plumbing").
  const rootName = projectName

  const categoryNames = storeys ? usedCategoryNames(storeys) : []
  const phaseRows: PhaseRow[] = storeys ? usedPhaseRows(storeys) : []
  const { staged, summary }: { staged: ReturnType<typeof buildStagedSchedule>['staged']; summary: ProposedScheduleSummary } =
    storeys ? buildStagedSchedule(projectId, schedulePeriodId, storeys, rates, rootName, calendarId) : {
      staged: { project_id: projectId, schedule_period_id: schedulePeriodId, calendar_id: null, activities: [], resources: [], assignments: [], relationships: [] },
      summary: { storeyCount: 0, activityCount: 0, relationshipCount: 0, elementCount: 0 },
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

  const stepOrder: Step[] = ['source', 'extract', 'review']

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
              {models.length === 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  No IFC model is currently loaded.
                </p>
              )}
              {models.length > 1 && (
                <div className="border border-gray-200 rounded-md px-2.5 py-2 space-y-1">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    Models to scan
                  </div>
                  {models.map(m => (
                    <label key={m.handle.modelID} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedModelIds.has(m.handle.modelID)}
                        onChange={() => toggleModel(m.handle.modelID)}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              )}
              <button
                onClick={chooseScan}
                disabled={selectedModels.length === 0}
                title={selectedModels.length === 0 ? 'Check at least one model above' : undefined}
                className="w-full text-left px-3 py-2.5 rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="text-xs font-bold text-gray-800">
                  Scan Model{selectedModels.length > 1 ? 's' : ''} (automatic)
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  Scans the {selectedModels.length > 1 ? 'checked models' : 'loaded IFC model'} for structural
                  elements (columns, beams, slabs, footings, foundation walls) and architectural elements (curtain
                  walls, doors, windows, roofs, stairs, railings, interior finishes) and groups them by storey.
                  {selectedModels.length > 1 && ' Same-named storeys across models are combined into one group.'}
                  {' '}Fast, but only as accurate as the model's own IFC typing.
                </div>
              </button>
            </div>
          )}

          {step === 'extract' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Scans every checked model for structural, architectural, MEP, and facade-detailing elements
                (columns, beams, slabs, footings, walls, curtain walls, facade trim, doors, windows, roofs, stairs,
                ductwork, air terminals, piping, plumbing fixtures, electrical containment, lighting, electrical
                devices, railings, finishes) and groups them by storey — a first-draft WBS you'll review and adjust
                before anything is created.
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


          {step === 'review' && storeys && (
            <div className="space-y-3">
              <div className="text-xs text-gray-600 space-y-1">
                <div>1 root WBS ("{rootName}") + {summary.storeyCount} storey summary activities</div>
                <div>{summary.activityCount - summary.storeyCount - 1} work activities across {categoryNames.length} categories, {phaseRows.length} construction phases</div>
                <div>{summary.relationshipCount} sequencing links</div>
                <div>{summary.elementCount} IFC elements will be linked to their completion activities</div>
                {/* No Resource/ResourceAssignment rows generated here
                    (2026-07-17, per Maro's phased-generation plan) — typical
                    industry crew/productivity DEFAULTS (DEFAULT_CATEGORY_
                    PHASES, scheduleGeneration.ts) still drive these
                    durations behind the scenes, just with no rates-editing
                    step shown here at all (2026-07-17, per Maro: "I dont
                    want to see the rate and crew settings when I'm
                    generating the schedule") — that editing UI, and the
                    real Resource Pool rows it drives, move to a separate
                    "Generate Resources" flow in the Resources tab, off this
                    now-committed schedule. */}
                <div className="text-gray-400">Durations use typical industry crew/productivity defaults — the Resource Pool isn't populated by this step; generate resources separately from the Resources tab afterward.</div>
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
                Quantities are bounding-box estimates from the loaded geometry, not a certified takeoff — durations are a first draft, freely editable afterward in Scheduling.
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
            {step === 'review' && (
              <button
                onClick={() => setStep('extract')}
                disabled={generating}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Back
              </button>
            )}
            {step === 'extract' && !elements && (
              <button
                onClick={runExtract}
                disabled={extracting || selectedModels.length === 0}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {extracting ? 'Scanning…' : 'Scan Model'}
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
