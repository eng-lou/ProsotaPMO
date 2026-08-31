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
export type AiFourDToolName = 'highlight_elements' | 'isolate_elements' | 'color_by_criteria' | 'run_clash_detection'

export type AiFourDHandlers = Partial<Record<AiFourDToolName, (input: Record<string, unknown>) => Promise<unknown> | unknown>>

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
