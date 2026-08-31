import * as XLSX from 'xlsx'
import { presignAttachment, type AiContentBlock, type AttachmentStorageSource } from '@/lib/aiAssistant'
import { uploadDirectToStorage } from '@/lib/directUpload'

// Poe chat attachments (2026-08-31, per Maro: "add ability to add data,
// images, spreadsheets etc"). Two genuinely different paths, not one
// generic "upload anything" flow:
//
// - Images/PDF go straight to R2 via the same presigned-url pattern this
//   app already uses everywhere else (model3d_files.ts's own precedent —
//   see ai_attachments.py's own header for the Vercel 4.5MB body-cap
//   reason) — the message only ever carries a storage_key placeholder
//   (see aiAssistant.ts's own AttachmentStorageSource header), never the
//   real bytes or a real Anthropic url, resolved backend-side fresh on
//   every single turn.
// - Spreadsheets (csv/xlsx) never touch the backend at all — this app's
//   own backend deliberately dropped pandas/openpyxl for Vercel's 500MB
//   bundle cap (see backend/requirements.txt's own comment), so there's
//   nothing to reuse server-side. Parsed client-side into plain CSV text
//   instead and sent as an ordinary text block — cheap for a one-off
//   image/PDF url, but real, *recurring* token cost here since this whole
//   conversation resends every turn (no persisted history), hence the
//   truncation cap below.

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_SPREADSHEET_TEXT_CHARS = 50_000

// Every block this module produces carries this one extra field so
// PoePanel.tsx can render a filename chip for past turns instead of either
// losing the name entirely or (for a spreadsheet) dumping its raw CSV text
// straight into the visible bubble. `_poe`-prefixed rather than a plain
// `name` specifically so backend/app/ai/orchestrator.py's own
// _expand_attachment_blocks can strip it generically (any `_poe*` key) —
// this must never reach the real Anthropic API call, which has no concept
// of it and may reject an unrecognised field on a content block.
export const ATTACHMENT_NAME_FIELD = '_poeAttachmentName'

export interface PreparedAttachment {
  name: string
  kind: 'image' | 'document' | 'text'
  block: AiContentBlock
}

function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.xlsx') || name.endsWith('.xls')
    || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || file.type === 'application/vnd.ms-excel'
}

function isCsvFile(file: File): boolean {
  return file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
}

function spreadsheetTextBlock(name: string, content: string): AiContentBlock {
  const truncated = content.length > MAX_SPREADSHEET_TEXT_CHARS
  const body = truncated ? `${content.slice(0, MAX_SPREADSHEET_TEXT_CHARS)}\n…(truncated)` : content
  return { type: 'text', text: `Attached spreadsheet ${name}:\n\n${body}`, [ATTACHMENT_NAME_FIELD]: name }
}

async function prepareUploadAttachment(file: File, kind: 'image' | 'document'): Promise<PreparedAttachment> {
  const { storage_key, upload_url } = await presignAttachment(file.name, file.type)
  await uploadDirectToStorage(upload_url, file, file.type)
  const source: AttachmentStorageSource = { type: 'storage_key', key: storage_key }
  return { name: file.name, kind, block: { type: kind, source, [ATTACHMENT_NAME_FIELD]: file.name } }
}

async function prepareCsvAttachment(file: File): Promise<PreparedAttachment> {
  const text = await file.text()
  return { name: file.name, kind: 'text', block: spreadsheetTextBlock(file.name, text) }
}

// sheet_to_csv per sheet, joined with a header when there's more than one
// (2026-08-31) — a workbook's later sheets would otherwise silently vanish
// (XLSX.read parses the whole workbook, but naively reading just the first
// sheet is the easy mistake here) and a multi-sheet risk/cost export is a
// completely normal real-world spreadsheet shape to attach.
async function prepareXlsxAttachment(file: File): Promise<PreparedAttachment> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const parts = workbook.SheetNames.map(sheetName => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])
    return workbook.SheetNames.length > 1 ? `--- Sheet: ${sheetName} ---\n${csv}` : csv
  })
  return { name: file.name, kind: 'text', block: spreadsheetTextBlock(file.name, parts.join('\n\n')) }
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is too large (max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB).`)
  }
  if (file.type.startsWith('image/')) return prepareUploadAttachment(file, 'image')
  if (file.type === 'application/pdf') return prepareUploadAttachment(file, 'document')
  if (isCsvFile(file)) return prepareCsvAttachment(file)
  if (isSpreadsheetFile(file)) return prepareXlsxAttachment(file)
  throw new Error(`${file.name}: unsupported file type — attach an image, PDF, or spreadsheet (.csv/.xlsx).`)
}
