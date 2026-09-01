import { createContext, useContext, useRef, type ReactNode } from 'react'

// Poe's 4D client tools (2026-09-01, per Maro: "in one run include all the
// server/proposal and client tools needed") — highlight_elements/
// isolate_elements/color_by_criteria/run_clash_detection only mean anything
// while the 4D module's own live viewport is mounted; that state lives in
// FourD.tsx, not the database, so there's nothing a backend query could
// ever answer these from (see backend/app/ai/tools.py's own header on the
// three tool kinds).
//
// Poe's own chat panel (PoePanel.tsx) is mounted globally in Layout.tsx —
// a sibling of whatever routed page is showing, never a descendant of
// FourD.tsx — so a normal top-down Context (provider owns the value,
// consumers below it read it) can't work here: FourD.tsx and PoePanel.tsx
// need to exchange data as *siblings*. This Provider is mounted once, at
// the Layout.tsx level, above both; its value is a stable ref FourD.tsx
// itself writes into (register on mount, delete on unmount) and PoePanel.tsx
// only ever reads from at the moment it needs to dispatch a tool call —
// a small mutable registry, not reactive state, since nothing here needs a
// re-render when the *set* of available tools changes mid-session.
//
// Checked directly, 2026-09-01, before choosing this shape: only 3
// `createContext` usages existed anywhere in this app before this one
// (ThemeContext/ProjectContext/CurrentUserContext, all frontend/src/lib/,
// all simple top-down global state) — none already solved "a module
// exposes live capabilities to something mounted elsewhere," so this is a
// genuinely new pattern, not a reuse of an existing bridge.
export type AiFourDToolName = 'highlight_elements' | 'isolate_elements' | 'color_by_criteria' | 'run_clash_detection' | 'get_selected_elements'

// execute_clash_test_proposal (2026-09-01, per Maro's own described flow:
// "select the requested elements, put them in their respective
// collections then run the clash test on those collections then show
// with the clash color toggled") — a real, deliberate exception to the
// rule the name AiFourDToolName above implies: this key is NEVER added to
// backend/app/ai/tools.py's own TOOLS list or CLIENT_TOOL_NAMES, so it is
// never offered to the model as a callable tool at all — Poe cannot call
// it directly, by design. It exists purely so PoePanel.tsx's own
// handleResolveProposal (approving a propose_clash_test proposal) can
// reach into FourD.tsx's real Collection/ClashTest-creation logic
// directly, bypassing the normal Messages-API tool-loop entirely, because
// this is the one proposal whose approval action needs to (a) create
// real Collections/a real ClashTest via the same endpoints every other
// proposal tool already uses, AND (b) actually *run* that test — which
// needs live loaded-model geometry (sceneClash.ts's own findClashes),
// something only FourD.tsx's own client-side code can do, not a plain
// REST call the way every other proposal's approval action already is.
type AiFourDInternalName = 'execute_clash_test_proposal'

export type AiFourDHandlers = Partial<Record<AiFourDToolName | AiFourDInternalName, (input: Record<string, unknown>) => Promise<unknown> | unknown>>

export interface AiFourDBridgeHandle {
  current: AiFourDHandlers
}

const AiFourDBridgeContext = createContext<AiFourDBridgeHandle | null>(null)

export function AiFourDBridgeProvider({ children }: { children: ReactNode }) {
  const ref = useRef<AiFourDHandlers>({})
  return <AiFourDBridgeContext.Provider value={ref}>{children}</AiFourDBridgeContext.Provider>
}

// Returns null outside the provider tree — never actually possible in this
// app (the provider wraps the whole Layout), but typed this way rather
// than a non-null assertion so a future refactor that moves PoePanel.tsx
// outside Layout's own tree fails loudly (a missing handler lookup) rather
// than silently.
export function useAiFourDBridge(): AiFourDBridgeHandle | null {
  return useContext(AiFourDBridgeContext)
}
