import { api } from '@/lib/api'

// Raw Anthropic Messages API content blocks, not a custom shape — see
// backend/app/schemas/ai_chat.py's own header for why this stays a
// passthrough rather than a modeled union (this app has no persisted
// conversation history yet, 2026-08-31 v1 deviation — the caller holds and
// resends the full array each turn).
//
// One deliberate exception (2026-08-31, per Maro: "add ability to add
// data, images, spreadsheets etc") — an image/PDF attachment block carries
// this placeholder `source` shape, never a real Anthropic one and never
// inline base64 bytes. See aiAttachments.ts's own header for the full
// upload flow and orchestrator.py's own _expand_attachment_blocks for why:
// resolving storage_key -> a real, freshly-presigned url happens only
// backend-side, immediately before each actual Anthropic call, specifically
// so nothing sitting in this resent-every-turn `messages` array ever holds
// a time-limited url that could go stale.
export interface AttachmentStorageSource {
  type: 'storage_key'
  key: string
}

export type AiContentBlock = Record<string, unknown>

export interface AiMessage {
  role: 'user' | 'assistant'
  content: AiContentBlock[]
}

export interface AiChatRequest {
  project_id: string
  schedule_period_id: string | null
  period_id: string | null
  messages: AiMessage[]
  client_tools_available: string[]
}

export interface AiChatResponse {
  assistant_content: AiContentBlock[]
  stop_reason: string | null
  pending_client_tool_calls: AiContentBlock[]
  // Proposal tool_use blocks awaiting human approve/reject (e.g.
  // propose_create_risks) — see orchestrator.py's own AgentTurnResult
  // header for why this stays separate from pending_client_tool_calls.
  pending_proposals: AiContentBlock[]
  messages: AiMessage[]
}

export async function sendChatTurn(payload: AiChatRequest): Promise<AiChatResponse> {
  const res = await api.post<AiChatResponse>('/api/v1/ai/chat', payload)
  return res.data
}

// Loaded once when Poe's panel first mounts for a project (2026-09-06, per
// Maro: "the chat history needs to persist") — ai/chat itself persists the
// updated list after every turn, this is just the read side for picking a
// conversation back up on reload.
export async function getPersistedConversation(projectId: string): Promise<AiMessage[]> {
  const res = await api.get<{ messages: AiMessage[] }>(`/api/v1/poe-conversations/${projectId}`)
  return res.data.messages
}

export async function clearPersistedConversation(projectId: string): Promise<void> {
  await api.delete(`/api/v1/poe-conversations/${projectId}`)
}

export interface AttachmentPresign {
  storage_key: string
  upload_url: string
}

// Step 1 of the direct-to-R2 upload for a chat attachment — see
// backend/app/api/ai_attachments.py's own header (same Vercel-4.5MB-body-cap
// reasoning as model3d_files.py's own /presign, reused as-is).
export async function presignAttachment(name: string, contentType: string): Promise<AttachmentPresign> {
  const res = await api.post<AttachmentPresign>('/api/v1/ai/attachments/presign', { name, content_type: contentType })
  return res.data
}
