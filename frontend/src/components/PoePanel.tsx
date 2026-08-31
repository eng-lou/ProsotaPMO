import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ATTACHMENT_NAME_FIELD, prepareAttachment } from '@/lib/aiAttachments'
import { api } from '@/lib/api'
import { sendChatTurn, type AiContentBlock, type AiMessage } from '@/lib/aiAssistant'
import { useAiFourDBridge } from '@/lib/aiFourDBridge'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'

// Proposal draft shapes (2026-08-31/2026-09-01) — each mirrors its own
// real backend schema field-for-field, since an approved draft gets sent
// straight to that exact real endpoint, never a bespoke creation path:
// RiskProposalDraft <-> risk_bulk_generate.py's BulkRiskInput,
// ActivityProposalDraft/RelationshipProposalDraft <->
// schedule_bulk_generate.py's BulkActivityInput/BulkRelationshipInput,
// LinkProposalDraft <-> record_link.py's RecordLinkCreate.
interface RiskProposalDraft {
  title: string
  category?: string | null
  area?: string | null
  risk_type: 'threat' | 'opportunity'
  response_strategy?: string | null
  cause?: string | null
  effect?: string | null
  rationale?: string | null
  probability?: number | null
  impact?: number | null
  cost_most_likely?: number | null
  schedule_most_likely_days?: number | null
}

interface ActivityProposalDraft {
  temp_id: string
  task_name: string
  parent_temp_id?: string | null
  duration_hours?: number | null
  activity_type?: 'task' | 'start_milestone' | 'finish_milestone'
  category?: string | null
  discipline?: string | null
}

interface RelationshipProposalDraft {
  predecessor_temp_id: string
  successor_temp_id: string
  relationship_type?: string | null
  lag_hours?: number | null
}

interface LinkProposalDraft {
  source_type: string
  source_id: string
  target_type: string
  target_id: string
  link_type: string
  note?: string | null
}

// A discriminated union, not three separate optional fields — only one
// proposal tool can ever be pending at once (findPendingProposal only
// looks at the single last message), so "which kind" and "which payload"
// should never be able to disagree.
type PendingProposal =
  | { kind: 'risks'; toolUseId: string; risks: RiskProposalDraft[] }
  | { kind: 'activities'; toolUseId: string; activities: ActivityProposalDraft[]; relationships: RelationshipProposalDraft[] }
  | { kind: 'links'; toolUseId: string; links: LinkProposalDraft[] }

// Only the LAST message can hold a genuinely still-pending proposal — the
// moment one gets resolved, a new user message carrying its tool_result is
// appended right after it (see handleResolveProposal below), so it's no
// longer last. Deriving this from `messages` on every render (rather than
// tracking it as separate local state) means it needs no extra
// bookkeeping to survive Close/reopen — it's already implied by whatever
// Layout.tsx's own lifted history currently holds.
function findPendingProposal(messages: AiMessage[]): PendingProposal | null {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return null
  const block = last.content.find(b =>
    b.type === 'tool_use'
    && (b.name === 'propose_create_risks' || b.name === 'propose_create_activities' || b.name === 'propose_link_records'),
  )
  if (!block) return null
  const toolUseId = block.id as string
  const input = block.input as Record<string, unknown>
  if (block.name === 'propose_create_risks') {
    return { kind: 'risks', toolUseId, risks: (input.risks as RiskProposalDraft[] | undefined) ?? [] }
  }
  if (block.name === 'propose_create_activities') {
    return {
      kind: 'activities', toolUseId,
      activities: (input.activities as ActivityProposalDraft[] | undefined) ?? [],
      relationships: (input.relationships as RelationshipProposalDraft[] | undefined) ?? [],
    }
  }
  return { kind: 'links', toolUseId, links: (input.links as LinkProposalDraft[] | undefined) ?? [] }
}

// Poe's own replies are real markdown (headers-as-bold, bullet/numbered
// lists, the system prompt's own tone leans on emphasis) — rendering them
// as a plain whitespace-pre-wrap string, same as a user's own typed text,
// left every `**heading**`/`- item` literally visible as asterisks and
// dashes (2026-08-31, per Maro's own screenshot: "it needs to read better
// somehow"). Only the assistant's bubble parses markdown — a user's own
// message stays untouched plain text, matching every chat-UI precedent
// (ChatGPT/Claude.ai included) of only ever rendering the *model's* output
// as rich text, never re-interpreting what a person typed. Component
// overrides below give each element this bubble's own sizing/spacing
// instead of react-markdown's unstyled default HTML — this app has no
// `@tailwindcss/typography` (`prose`) plugin installed, and adding one just
// for a handful of tags here isn't worth a second new dependency.
const poeMarkdownComponents = {
  p: (props: React.ComponentPropsWithoutRef<'p'>) => <p className="mb-2 last:mb-0" {...props} />,
  ul: (props: React.ComponentPropsWithoutRef<'ul'>) => <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-0.5" {...props} />,
  ol: (props: React.ComponentPropsWithoutRef<'ol'>) => <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-0.5" {...props} />,
  li: (props: React.ComponentPropsWithoutRef<'li'>) => <li {...props} />,
  strong: (props: React.ComponentPropsWithoutRef<'strong'>) => <strong className="font-semibold" {...props} />,
  a: (props: React.ComponentPropsWithoutRef<'a'>) => <a className="underline hover:no-underline" target="_blank" rel="noreferrer" {...props} />,
  code: (props: React.ComponentPropsWithoutRef<'code'>) => (
    <code className="bg-black/5 dark:bg-white/10 rounded px-1 py-0.5 text-[0.85em] font-mono" {...props} />
  ),
}

// Attachment-sourced text blocks (a spreadsheet's own raw CSV dump, see
// aiAttachments.ts's own ATTACHMENT_NAME_FIELD header) are deliberately
// excluded from the plain concatenated text here — shown instead as the
// filename chips attachmentNamesOf pulls out below, not a wall of raw CSV
// inline in the bubble.
function textOf(content: AiContentBlock[]): string {
  return content
    .filter(b => b.type === 'text' && typeof b.text === 'string' && !b[ATTACHMENT_NAME_FIELD])
    .map(b => b.text as string)
    .join('\n')
}

function attachmentNamesOf(content: AiContentBlock[]): string[] {
  return content
    .filter(b => typeof b[ATTACHMENT_NAME_FIELD] === 'string')
    .map(b => b[ATTACHMENT_NAME_FIELD] as string)
}

// Shared between handleSend and handleResolveProposal (2026-08-31) — both
// hit the same /ai/chat endpoint and so can both legitimately trip the
// same daily cap. ai_quota_exceeded (require_ai_quota, backend
// app/core/auth.py) returns a structured {code, limit} detail, same
// "machine-readable code, not a raw string" convention this app's own
// access_pending/forbidden 403s already use — the generic string-detail
// fallback below never matches it, so without this it silently fell
// through to "Could not reach Poe.", a confusing message for a user who's
// simply hit today's cap.
function describeChatError(err: unknown): string {
  const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null
  if (detail && typeof detail === 'object' && detail.code === 'ai_quota_exceeded') {
    return `You've reached today's limit of ${detail.limit} messages to Poe — it resets tomorrow.`
  }
  return typeof detail === 'string' ? detail : 'Could not reach Poe.'
}

// Default position (2026-08-31) — anchored near the launcher button
// (Layout.tsx's own bottom-6 right-6), not screen-centre: a floating
// assistant widget belongs near where you opened it, the same convention
// every chat-widget precedent (Intercom/Drift) already follows, and it's
// what makes "drag it somewhere else if you want" feel like moving a
// window rather than correcting a mistake.
const DEFAULT_POS = { right: 24, bottom: 96 }

const SIZE = {
  compact: { width: 380, height: 520 },
  expanded: { width: 620, height: 760 },
}

// Poe (2026-08-31, per Maro: named after Altered Carbon's Poe
// — https://altered-carbon.fandom.com/wiki/Poe — an eccentric, literary AI
// concierge; the quill icon and amber accent below are the visual nod to
// that, distinct from every other accent this app already uses (azure for
// primary actions/nav, the plain warning-orange chips elsewhere) so this
// reads as its own distinct feature rather than just another gray utility
// link — see Layout.tsx's own header for why the launcher itself moved
// there from Sidebar's bottom utility stack. "One unified assistant that
// answers questions and takes real actions across every pillar" per the
// approved plan — this is Phase 0 of that plan's own build sequence:
// plumbing + get_project_snapshot only, no proposal cards or client tools
// yet (those are later phases).
//
// messages/onMessagesChange are owned by Layout.tsx, not local state here
// (2026-08-31, per Maro: "when i hit close and reopen poe, the history is
// completely gone" — this component only mounts while open, so anything it
// held locally was destroyed on every Close, not just a genuine page
// refresh). draft/sending/error and the window chrome (position/size/
// minimized) stay local — resetting those on a fresh open is fine, only
// the conversation itself was the actual complaint.
//
// Floating window, not a centred modal (2026-08-31, per Maro: "the chat
// box is right in the middle, i cant even move it, minimize, expand" —
// the original modal-dialog treatment, copied from FeedbackPanel.tsx's own
// shape, fit a one-off form fine but not a chat widget meant to stay
// reachable alongside whatever page you're actually working in). Drag by
// the header (onHeaderPointerDown below); minimize collapses to just the
// header bar without losing the conversation (still lives in Layout, see
// above) or position; expand toggles between two fixed size presets
// (SIZE.compact/expanded) rather than freeform edge-resizing, which would
// need a lot more chrome (resize handles, min/max-size clamping) for a
// panel most people will only ever see at one of two sensible sizes.
// role="dialog" without aria-modal (2026-08-22 accessibility pass, revised
// here) — aria-modal asserts the rest of the page is inert, true for the
// old click-outside-to-close backdrop, no longer true for a
// non-blocking floating widget you can leave open while working elsewhere.
export function PoePanel({
  projectId, onClose, messages, onMessagesChange,
}: {
  projectId: string
  onClose: () => void
  messages: AiMessage[]
  onMessagesChange: (messages: AiMessage[]) => void
}) {
  // Resolved lazily, only once this panel actually mounts (2026-08-31) —
  // both hooks already no-op without a projectId, but calling them
  // unconditionally from Layout (mounted on every route) would add a
  // periods/schedule-variant bootstrap network call to every page load
  // whether or not Poe is ever opened. Same reused hooks every
  // period-scoped page already calls (usePeriod.ts/useScheduleVariant.ts's
  // own headers) — get_project_snapshot's schedule_period_id/period_id are
  // both optional server-side (see app/ai/context_tools.py), so a slow or
  // failed bootstrap here just means that pillar's stats are momentarily
  // left out of the snapshot, not a broken panel.
  const { period } = useActivePeriod(projectId)
  const { period: schedulePeriod } = useActiveScheduleVariant(projectId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  // Attachments (2026-08-31, per Maro: "add ability to add data, images,
  // spreadsheets etc") — each selected file starts preparing (uploading to
  // R2 for an image/PDF, or parsing to CSV text for a spreadsheet, see
  // aiAttachments.ts's own prepareAttachment) immediately on selection, not
  // deferred to Send, so a slow upload/parse is visible as its own chip
  // rather than a single opaque "sending" state covering both. Kept as
  // local state, not lifted to Layout.tsx alongside messages — an
  // in-progress attachment is composer state, not conversation history;
  // resetting it on Close is the same "fine to lose, not the actual
  // complaint" treatment draft/sending/error already get.
  const [attachments, setAttachments] = useState<{
    id: string; name: string; status: 'preparing' | 'ready' | 'error'; block?: AiContentBlock; error?: string
  }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Which items in the pending proposal are currently checked for approval
  // (2026-08-31/2026-09-01) — transient review-UI state, not conversation
  // history, so it stays local rather than living in Layout.tsx's own
  // lifted `messages`. Defaults to "everything checked" the moment a new
  // proposal actually appears (below), not on every render. Shared between
  // 'risks' and 'links' (both a flat list of independent items, checkbox
  // per row); 'activities' uses activitiesApproved instead — a schedule
  // chunk's own relationships reference *other draft activities in the
  // same proposal* by temp_id, so approving some activities but not others
  // could leave a relationship dangling on a rejected one. All-or-nothing
  // is the only choice that can't produce that half-broken state.
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [activitiesApproved, setActivitiesApproved] = useState(true)
  const [resolvingProposal, setResolvingProposal] = useState(false)
  const pendingProposal = findPendingProposal(messages)
  // 4D client tools (2026-09-01) — see aiFourDBridge.tsx's own header. Only
  // present (a non-null ref) at all because Layout.tsx wraps this panel in
  // the same AiFourDBridgeProvider FourD.tsx registers into; the ref's own
  // *current* contents (which handler names actually exist right now) are
  // only ever read at the moment a message is sent, never watched
  // reactively — there's nothing to re-render for when the set of
  // available tools changes mid-session.
  const aiFourDBridge = useAiFourDBridge()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!pendingProposal) return
    if (pendingProposal.kind === 'risks') setSelectedIndices(new Set(pendingProposal.risks.map((_, i) => i)))
    else if (pendingProposal.kind === 'links') setSelectedIndices(new Set(pendingProposal.links.map((_, i) => i)))
    else setActivitiesApproved(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProposal?.toolUseId])

  // Drag-by-header (2026-08-31) — plain pointer-event tracking, not a drag
  // library: a chat widget only ever needs "follow the cursor while the
  // header's held down," not sortable-list/drop-target semantics a real
  // DnD library is built for. Switches from the default bottom/right
  // anchor (DEFAULT_POS) to an explicit left/top pixel position the first
  // time it's dragged, computed from the panel's own current on-screen
  // rect so there's no jump at drag-start.
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top }
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return
      setPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`
      setAttachments(prev => [...prev, { id, name: file.name, status: 'preparing' }])
      prepareAttachment(file)
        .then(prepared => {
          setAttachments(prev => prev.map(a => (a.id === id ? { ...a, status: 'ready', block: prepared.block } : a)))
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Failed to attach'
          setAttachments(prev => prev.map(a => (a.id === id ? { ...a, status: 'error', error: message } : a)))
        })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id))

  const readyAttachments = attachments.filter(a => a.status === 'ready' && a.block)
  const hasPendingAttachment = attachments.some(a => a.status === 'preparing')

  // Sends one turn and, if the response comes back with pending_client_tool_calls
  // (2026-09-01), resolves each via the live 4D bridge and resends — looping
  // until a turn comes back with none (a normal reply, or a pending
  // *proposal* instead, which this never touches) or the iteration cap
  // trips. Shared by handleSend and handleResolveProposal below, both of
  // which used to call sendChatTurn/onMessagesChange directly with no
  // client-tool handling at all — that loop didn't exist anywhere before
  // this, since client_tools_available was always sent empty.
  //
  // A handler not existing (aiFourDBridge is null, or this particular tool
  // name was never registered — e.g. the 4D module got closed between
  // Poe deciding to call it and this loop actually running) becomes a real
  // tool_result Poe can see and explain, never a silent drop or a thrown
  // error — same "a tool failure becomes a tool_result the model sees, not
  // a 500" convention orchestrator.py's own server-tool dispatch already
  // follows.
  const continueConversation = async (startMessages: AiMessage[]) => {
    let currentMessages = startMessages
    for (let i = 0; i < 8; i++) {
      const res = await sendChatTurn({
        project_id: projectId, schedule_period_id: schedulePeriod?.id ?? null, period_id: period?.id ?? null,
        messages: currentMessages, client_tools_available: Object.keys(aiFourDBridge?.current ?? {}),
      })
      onMessagesChange(res.messages)
      if (res.pending_client_tool_calls.length === 0) return
      const handlers = aiFourDBridge?.current ?? {}
      const toolResults: AiContentBlock[] = []
      for (const block of res.pending_client_tool_calls) {
        const name = block.name as string
        const handler = handlers[name as keyof typeof handlers]
        let content: unknown
        try {
          content = handler
            ? await handler((block.input as Record<string, unknown>) ?? {})
            : { error: `${name} isn't available right now — the 4D module may not be open.` }
        } catch (err) {
          content = { error: err instanceof Error ? err.message : 'Tool call failed' }
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(content) })
      }
      currentMessages = [...res.messages, { role: 'user', content: toolResults }]
      onMessagesChange(currentMessages)
    }
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if ((!text && readyAttachments.length === 0) || sending || hasPendingAttachment) return
    const content: AiContentBlock[] = []
    if (text) content.push({ type: 'text', text })
    for (const a of readyAttachments) content.push(a.block as AiContentBlock)
    const userMessage: AiMessage = { role: 'user', content }
    const nextMessages = [...messages, userMessage]
    onMessagesChange(nextMessages)
    setAttachments([])
    setDraft('')
    setSending(true)
    setError(null)
    try {
      await continueConversation(nextMessages)
    } catch (err) {
      setError(describeChatError(err))
    } finally {
      setSending(false)
    }
  }

  // Resolving a proposal (2026-08-31/2026-09-01, per Maro's own precedent
  // pointer: "the generate risk register button in risk register") — each
  // kind's approved subset goes straight to its own *real* existing
  // endpoint, never a bespoke creation path: risks -> the same
  // /risk-bulk-generate/ the button itself calls (dedupe-by-title +
  // contingency-rollup for free); activities -> /schedule-bulk-generate/
  // (the real "Generate Schedule" endpoint, activities+relationships
  // created together in one real transaction+CPM pass, same as that flow);
  // links -> /record-links/, once per approved link — there's no bulk
  // version of that endpoint (checked directly), so N approved links is N
  // sequential real POSTs, each independently reporting success/failure
  // rather than one all-or-nothing call.
  //
  // The tool_use is only ever resolved by sending its own tool_result back
  // through the normal /ai/chat endpoint (never silently dropped) — the
  // Messages API requires exactly that before the conversation can
  // continue, and it's what lets Poe actually acknowledge what was
  // approved/rejected in its own next reply instead of the conversation
  // just going quiet.
  const handleResolveProposal = async () => {
    if (!pendingProposal || resolvingProposal) return
    setResolvingProposal(true)
    setError(null)
    try {
      let summary: string

      if (pendingProposal.kind === 'risks') {
        if (!period) { setResolvingProposal(false); return }
        const approved = pendingProposal.risks.filter((_, i) => selectedIndices.has(i))
        if (approved.length > 0) {
          const { data } = await api.post('/api/v1/risk-bulk-generate/', {
            project_id: projectId, period_id: period.id, risks: approved,
            dedupe_by_title: true, sync_contingency: true,
          })
          const rejectedCount = pendingProposal.risks.length - approved.length
          const contingencyNote = data.contingency_cost_element_id
            ? ` Contingency updated to ${(Number(data.contingency_rate) * 100).toFixed(1)}% of fixed costs.`
            : ''
          summary = `Created ${data.risk_count} of ${approved.length} approved risk(s)` +
            `${data.risk_count < approved.length ? ' (the rest already existed by title)' : ''}` +
            `${rejectedCount > 0 ? `; ${rejectedCount} rejected` : ''}.${contingencyNote}`
        } else {
          summary = 'Every proposed risk was rejected — nothing created.'
        }
      } else if (pendingProposal.kind === 'activities') {
        if (!schedulePeriod) { setResolvingProposal(false); return }
        if (activitiesApproved && pendingProposal.activities.length > 0) {
          const { data } = await api.post('/api/v1/schedule-bulk-generate/', {
            project_id: projectId, schedule_period_id: schedulePeriod.id,
            activities: pendingProposal.activities, relationships: pendingProposal.relationships,
          })
          summary = `Created ${data.activity_count} activity(ies) and ${data.relationship_count} relationship(s).`
        } else {
          summary = 'The proposed activities were rejected — nothing created.'
        }
      } else {
        const approved = pendingProposal.links.filter((_, i) => selectedIndices.has(i))
        let createdCount = 0
        let failedCount = 0
        for (const link of approved) {
          try {
            await api.post('/api/v1/record-links/', link)
            createdCount += 1
          } catch {
            failedCount += 1
          }
        }
        const rejectedCount = pendingProposal.links.length - approved.length
        summary = `Created ${createdCount} of ${approved.length} approved link(s)` +
          `${failedCount > 0 ? ` (${failedCount} failed — a source/target id likely no longer exists)` : ''}` +
          `${rejectedCount > 0 ? `; ${rejectedCount} rejected` : ''}.`
      }

      const nextMessages: AiMessage[] = [
        ...messages,
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: pendingProposal.toolUseId, content: summary }] },
      ]
      onMessagesChange(nextMessages)
      setSending(true)
      await continueConversation(nextMessages)
    } catch (err) {
      setError(describeChatError(err))
    } finally {
      setResolvingProposal(false)
      setSending(false)
    }
  }

  // Only turns that actually carry visible text or an attachment are
  // rendered — internal tool_use/tool_result blocks (the
  // get_project_snapshot round-trip) stay in the resent history but
  // aren't meant for direct display.
  const visibleTurns = messages
    .map(m => ({ role: m.role, text: textOf(m.content), attachmentNames: attachmentNamesOf(m.content) }))
    .filter(t => t.text.trim().length > 0 || t.attachmentNames.length > 0)

  const size = expanded ? SIZE.expanded : SIZE.compact
  const positionStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: DEFAULT_POS.right, bottom: DEFAULT_POS.bottom }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Poe — Planning Optimization Expert"
      style={{ ...positionStyle, width: size.width, height: minimized ? 'auto' : size.height }}
      className="fixed z-50 flex flex-col bg-white dark:bg-prosota-panel rounded-lg shadow-2xl shadow-black/30 border-t-4 border-prosota-amber overflow-hidden no-print"
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-gray-200 dark:border-prosota-line cursor-move select-none shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="text-xl leading-none">🪶</span>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-gray-900 dark:text-prosota-paper leading-tight">Poe</h2>
            <p className="text-[11px] text-gray-500 dark:text-prosota-muted leading-tight truncate">Planning Optimization Expert</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setMinimized(m => !m)}
            aria-label={minimized ? 'Restore Poe' : 'Minimize Poe'}
            title={minimized ? 'Restore' : 'Minimize'}
            className="text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper rounded px-1.5 py-1 text-sm leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-prosota-amber"
          >
            {minimized ? '▢' : '–'}
          </button>
          {!minimized && (
            <button
              onClick={() => setExpanded(x => !x)}
              aria-label={expanded ? 'Shrink Poe' : 'Expand Poe'}
              title={expanded ? 'Shrink' : 'Expand'}
              className="text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper rounded px-1.5 py-1 text-sm leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-prosota-amber"
            >
              {expanded ? '⤡' : '⤢'}
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close Poe"
            title="Close"
            className="text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper rounded px-1.5 py-1 text-sm leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-prosota-amber"
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <div className="flex-1 overflow-y-auto space-y-3 px-4 py-3 min-h-0">
            {visibleTurns.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-prosota-muted">
                Ask Poe about this project's schedule, risk, or ICD status.
              </p>
            ) : (
              visibleTurns.map((t, i) => (
                t.role === 'user' ? (
                  <div key={i} className="ml-auto max-w-[85%] flex flex-col items-end gap-1">
                    {t.text && (
                      <div className="bg-blue-600 dark:bg-prosota-azure text-white rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                        {t.text}
                      </div>
                    )}
                    {t.attachmentNames.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {t.attachmentNames.map((name, j) => (
                          <span key={j} className="text-[11px] rounded-full px-2 py-0.5 bg-blue-100 dark:bg-prosota-panel2 text-blue-800 dark:text-prosota-paper truncate max-w-[160px]">
                            📎 {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={i} className="mr-auto max-w-[85%] bg-amber-50 dark:bg-prosota-panel2 text-gray-900 dark:text-prosota-paper border border-amber-200 dark:border-prosota-line rounded-lg px-3 py-2 text-sm">
                    <ReactMarkdown components={poeMarkdownComponents}>{t.text}</ReactMarkdown>
                  </div>
                )
              ))
            )}
            {pendingProposal && (
              <div className="border border-amber-300 dark:border-prosota-line rounded-lg p-3 space-y-2 bg-white dark:bg-prosota-panel">
                {pendingProposal.kind === 'risks' && (
                  <>
                    <p className="text-xs font-medium text-gray-700 dark:text-prosota-paper">
                      {pendingProposal.risks.length} risk{pendingProposal.risks.length === 1 ? '' : 's'} proposed — review before creating:
                    </p>
                    {pendingProposal.risks.map((risk, i) => (
                      <label key={i} className="flex items-start gap-2 rounded-md border border-gray-200 dark:border-prosota-line px-2 py-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedIndices.has(i)}
                          onChange={e => setSelectedIndices(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(i); else next.delete(i)
                            return next
                          })}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-prosota-paper truncate">{risk.title}</span>
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${
                              risk.risk_type === 'threat'
                                ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                : 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                            }`}>
                              {risk.risk_type}
                            </span>
                          </div>
                          {risk.cause && <p className="text-xs text-gray-500 dark:text-prosota-muted">Cause: {risk.cause}</p>}
                          {risk.effect && <p className="text-xs text-gray-500 dark:text-prosota-muted">Effect: {risk.effect}</p>}
                          <p className="text-[11px] text-gray-400 dark:text-prosota-muted">
                            {risk.probability != null && `P ${risk.probability}`}
                            {risk.impact != null && ` · I ${risk.impact}`}
                            {risk.cost_most_likely != null && ` · Cost ${risk.cost_most_likely.toLocaleString()}`}
                            {risk.schedule_most_likely_days != null && ` · ${risk.schedule_most_likely_days}d`}
                          </p>
                        </div>
                      </label>
                    ))}
                  </>
                )}

                {pendingProposal.kind === 'activities' && (
                  <>
                    <p className="text-xs font-medium text-gray-700 dark:text-prosota-paper">
                      {pendingProposal.activities.length} activit{pendingProposal.activities.length === 1 ? 'y' : 'ies'}
                      {pendingProposal.relationships.length > 0 && ` + ${pendingProposal.relationships.length} link(s)`} proposed — review before creating:
                    </p>
                    {/* All-or-nothing, not per-row checkboxes (see handleResolveProposal's own
                        comment) — relationships reference other draft activities by temp_id, so
                        approving some but not others could leave one dangling. */}
                    <label className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-prosota-line px-2 py-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activitiesApproved}
                        onChange={e => setActivitiesApproved(e.target.checked)}
                        className="shrink-0"
                      />
                      <span className="text-xs text-gray-700 dark:text-prosota-paper">Create all of the below together</span>
                    </label>
                    {pendingProposal.activities.map((a, i) => (
                      <div key={i} className="rounded-md border border-gray-200 dark:border-prosota-line px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-prosota-paper truncate">{a.task_name}</span>
                          {a.activity_type && a.activity_type !== 'task' && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                              {a.activity_type === 'start_milestone' ? 'Start Milestone' : 'Finish Milestone'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-prosota-muted">
                          {a.duration_hours != null && `${a.duration_hours}h`}
                          {a.category && ` · ${a.category}`}
                          {a.discipline && ` · ${a.discipline}`}
                        </p>
                      </div>
                    ))}
                  </>
                )}

                {pendingProposal.kind === 'links' && (
                  <>
                    <p className="text-xs font-medium text-gray-700 dark:text-prosota-paper">
                      {pendingProposal.links.length} link{pendingProposal.links.length === 1 ? '' : 's'} proposed — review before creating:
                    </p>
                    {pendingProposal.links.map((link, i) => (
                      <label key={i} className="flex items-start gap-2 rounded-md border border-gray-200 dark:border-prosota-line px-2 py-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedIndices.has(i)}
                          onChange={e => setSelectedIndices(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(i); else next.delete(i)
                            return next
                          })}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 dark:text-prosota-paper">
                            <span className="font-medium">{link.source_type}</span>
                            {' '}<span className="text-gray-500 dark:text-prosota-muted">{link.link_type}</span>{' '}
                            <span className="font-medium">{link.target_type}</span>
                          </p>
                          {link.note && <p className="text-xs text-gray-500 dark:text-prosota-muted">{link.note}</p>}
                        </div>
                      </label>
                    ))}
                  </>
                )}

                <button
                  onClick={handleResolveProposal}
                  disabled={resolvingProposal}
                  className="w-full text-xs px-3 py-2 rounded-md bg-blue-600 dark:bg-prosota-azure text-white font-medium hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-prosota-amber"
                >
                  {resolvingProposal
                    ? 'Working…'
                    : pendingProposal.kind === 'activities'
                      ? (activitiesApproved ? 'Create these activities' : 'Reject')
                      : selectedIndices.size === 0
                        ? 'Reject all'
                        : `Create ${selectedIndices.size} selected`}
                </button>
              </div>
            )}
            {sending && <p className="text-xs text-gray-400 dark:text-prosota-muted">Poe is thinking…</p>}
          </div>

          {error && <p role="alert" className="text-xs text-red-600 px-4 pb-2 shrink-0">{error}</p>}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-1.5 shrink-0">
              {attachments.map(a => (
                <span
                  key={a.id}
                  className={`inline-flex items-center gap-1 text-[11px] rounded-full pl-2 pr-1 py-1 border truncate max-w-[180px] ${
                    a.status === 'error'
                      ? 'border-red-300 text-red-600 bg-red-50 dark:bg-red-950/30'
                      : 'border-amber-200 dark:border-prosota-line bg-amber-50 dark:bg-prosota-panel2 text-gray-700 dark:text-prosota-paper'
                  }`}
                  title={a.status === 'error' ? a.error : a.name}
                >
                  {a.status === 'preparing' && <span aria-hidden="true" className="animate-spin">⏳</span>}
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove attachment ${a.name}`}
                    className="shrink-0 rounded px-1 hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-prosota-amber"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <form onSubmit={handleSend} className="flex items-end gap-2 px-4 pb-3 pt-1 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.csv,.xlsx,.xls"
              onChange={e => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a file (image, PDF, or spreadsheet)"
              title="Attach a file (image, PDF, or spreadsheet)"
              className="shrink-0 text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper rounded px-2 py-2 text-sm leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-prosota-amber"
            >
              📎
            </button>
            <label htmlFor="poe-draft" className="sr-only">Message to Poe</label>
            <textarea
              id="poe-draft"
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e) } }}
              placeholder="Ask Poe a question…"
              rows={2}
              className="flex-1 min-w-0 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-prosota-amber resize-y"
            />
            <button
              type="submit"
              disabled={sending || hasPendingAttachment || (!draft.trim() && readyAttachments.length === 0)}
              className="shrink-0 text-xs px-3 py-2 rounded-md bg-blue-600 dark:bg-prosota-azure text-white font-medium hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-prosota-amber"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
