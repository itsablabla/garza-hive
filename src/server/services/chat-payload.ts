/**
 * Slim chat history payloads for the browser.
 *
 * Full `tool_calls` / `reasoning` blobs can be hundreds of KB per page (thinking
 * models + shell dumps). The list endpoints return capped previews; clients
 * fetch the complete blobs from the message details route when the user expands
 * a tool card or thinking block.
 */

import type { ToolCallEntry } from '@/shared/types'

/** Max JSON/string chars kept per tool args or result in list responses. */
export const CHAT_TOOL_FIELD_PREVIEW_CHARS = 400

/** Max total reasoning characters kept across all segments in list responses. */
export const CHAT_REASONING_PREVIEW_CHARS = 800

export type ChatReasoning =
  | string
  | Array<{ offset: number; text: string }>

export interface SlimChatPayload {
  toolCalls: ToolCallEntry[] | null
  reasoning: ChatReasoning | null
  /** True when tool and/or reasoning bodies were truncated for the list DTO. */
  detailsTruncated: boolean
}

function toolResultStatus(result: unknown): 'success' | 'error' | 'pending' {
  if (result === undefined) return 'error'
  if (typeof result === 'object' && result !== null) {
    const res = result as Record<string, unknown>
    if ('success' in res && res.success === true) return 'success'
    if ('error' in res) return 'error'
  }
  return 'success'
}

/** Cap a JSON-serializable value to a short preview string or passthrough. */
export function previewJsonValue(value: unknown, maxChars: number): { value: unknown; truncated: boolean } {
  if (value === undefined) return { value: undefined, truncated: false }
  if (typeof value === 'string') {
    if (value.length <= maxChars) return { value, truncated: false }
    return { value: `${value.slice(0, maxChars)}…[+${value.length - maxChars}]`, truncated: true }
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    const fallback = String(value)
    if (fallback.length <= maxChars) return { value: fallback, truncated: false }
    return { value: `${fallback.slice(0, maxChars)}…[+${fallback.length - maxChars}]`, truncated: true }
  }
  if (serialized.length <= maxChars) return { value, truncated: false }
  return { value: `${serialized.slice(0, maxChars)}…[+${serialized.length - maxChars}]`, truncated: true }
}

export function slimToolCalls(raw: unknown): { toolCalls: ToolCallEntry[] | null; truncated: boolean } {
  if (!Array.isArray(raw) || raw.length === 0) return { toolCalls: null, truncated: false }

  let truncated = false
  const toolCalls: ToolCallEntry[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const tc = item as Record<string, unknown>
    const id = typeof tc.id === 'string' ? tc.id : typeof tc.toolCallId === 'string' ? tc.toolCallId : ''
    const name = typeof tc.name === 'string' ? tc.name : typeof tc.toolName === 'string' ? tc.toolName : 'tool'
    if (!id && !name) continue

    const argsIn = 'args' in tc ? tc.args : 'arguments' in tc ? tc.arguments : undefined
    const resultIn = 'result' in tc ? tc.result : 'output' in tc ? tc.output : undefined
    const argsPreview = previewJsonValue(argsIn, CHAT_TOOL_FIELD_PREVIEW_CHARS)
    const resultPreview = previewJsonValue(resultIn, CHAT_TOOL_FIELD_PREVIEW_CHARS)
    const entryTruncated = argsPreview.truncated || resultPreview.truncated
    if (entryTruncated) truncated = true

    const entry: ToolCallEntry = {
      id: id || `anon-${toolCalls.length}`,
      name,
      args: argsPreview.value === undefined ? {} : argsPreview.value,
      offset: typeof tc.offset === 'number' ? tc.offset : undefined,
      status: toolResultStatus(resultIn),
    }
    if (resultPreview.value !== undefined) entry.result = resultPreview.value
    if (entryTruncated) entry.truncated = true
    toolCalls.push(entry)
  }

  return { toolCalls: toolCalls.length > 0 ? toolCalls : null, truncated }
}

export function slimReasoning(raw: unknown): { reasoning: ChatReasoning | null; truncated: boolean } {
  if (raw == null) return { reasoning: null, truncated: false }

  // Stored as JSON: either a plain string, or [{ offset, text }, ...]
  if (typeof raw === 'string') {
    if (raw.length <= CHAT_REASONING_PREVIEW_CHARS) return { reasoning: raw, truncated: false }
    return {
      reasoning: `${raw.slice(0, CHAT_REASONING_PREVIEW_CHARS)}…[+${raw.length - CHAT_REASONING_PREVIEW_CHARS}]`,
      truncated: true,
    }
  }

  if (Array.isArray(raw)) {
    let budget = CHAT_REASONING_PREVIEW_CHARS
    let truncated = false
    const out: Array<{ offset: number; text: string }> = []
    for (const seg of raw) {
      if (!seg || typeof seg !== 'object') continue
      const s = seg as { offset?: unknown; text?: unknown }
      const offset = typeof s.offset === 'number' ? s.offset : 0
      const text = typeof s.text === 'string' ? s.text : ''
      if (!text) {
        out.push({ offset, text: '' })
        continue
      }
      if (budget <= 0) {
        truncated = true
        break
      }
      if (text.length <= budget) {
        out.push({ offset, text })
        budget -= text.length
      } else {
        out.push({ offset, text: `${text.slice(0, budget)}…[+${text.length - budget}]` })
        budget = 0
        truncated = true
        break
      }
    }
    // If we dropped trailing segments, mark truncated
    if (out.length < raw.length) truncated = true
    return { reasoning: out.length > 0 ? out : null, truncated }
  }

  // Unexpected shape — stringify and cap
  try {
    const s = JSON.stringify(raw)
    if (s.length <= CHAT_REASONING_PREVIEW_CHARS) return { reasoning: s, truncated: false }
    return {
      reasoning: `${s.slice(0, CHAT_REASONING_PREVIEW_CHARS)}…[+${s.length - CHAT_REASONING_PREVIEW_CHARS}]`,
      truncated: true,
    }
  } catch {
    return { reasoning: null, truncated: false }
  }
}

/**
 * Parse stored tool_calls / reasoning JSON and optionally slim them for list DTOs.
 * `full: true` returns the parsed values unchanged (export / details endpoint).
 */
export function buildChatMessagePayload(
  toolCallsRaw: string | null | undefined,
  reasoningRaw: string | null | undefined,
  opts: { full?: boolean } = {},
): SlimChatPayload {
  let toolCallsParsed: unknown = null
  let reasoningParsed: unknown = null
  try {
    toolCallsParsed = toolCallsRaw ? JSON.parse(toolCallsRaw) : null
  } catch { /* corrupted */ }
  try {
    reasoningParsed = reasoningRaw ? JSON.parse(reasoningRaw) : null
  } catch {
    // Some rows may store plain text rather than JSON
    reasoningParsed = reasoningRaw ?? null
  }

  if (opts.full) {
    return {
      toolCalls: Array.isArray(toolCallsParsed) ? (toolCallsParsed as ToolCallEntry[]) : null,
      reasoning: (reasoningParsed as ChatReasoning | null) ?? null,
      detailsTruncated: false,
    }
  }

  const tools = slimToolCalls(toolCallsParsed)
  const reasoning = slimReasoning(reasoningParsed)
  return {
    toolCalls: tools.toolCalls,
    reasoning: reasoning.reasoning,
    detailsTruncated: tools.truncated || reasoning.truncated,
  }
}
