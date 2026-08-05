import { useState, useMemo } from 'react'
import { useSSE } from '@/client/hooks/useSSE'
import type { ChatMessage } from '@/client/hooks/useChat'
import type { ToolCallEntry, ToolDomain } from '@/shared/types'
import { getToolDomain as lookupToolDomain } from '@/client/lib/tool-domain-lookup'

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error'

export interface ToolCallViewItem {
  id: string
  messageId: string
  name: string
  domain: ToolDomain
  args: unknown
  result?: unknown
  status: ToolCallStatus
  timestamp: string
  /** Character offset in the message content where this tool call was triggered */
  offset?: number
  /** Args/result were capped in the list DTO — expand loads full details. */
  truncated?: boolean
}

function getToolDomain(toolName: string): ToolDomain {
  return lookupToolDomain(toolName)
}

function deriveStatus(entry: ToolCallEntry): ToolCallStatus {
  // Slim list DTOs may precompute status when result bodies were truncated.
  if (entry.status === 'pending' || entry.status === 'success' || entry.status === 'error') {
    return entry.status
  }
  // Historical tool calls (from saved messages) with no result were interrupted
  // (crash, abort, restart). Show as error, not pending spinner.
  if (entry.result === undefined) return 'error'
  if (
    typeof entry.result === 'object' &&
    entry.result !== null
  ) {
    const res = entry.result as Record<string, unknown>
    // If the result explicitly declares success (e.g. run_shell with exitCode 0),
    // trust that over the presence of an 'error' field
    if ('success' in res && res.success === true) return 'success'
    if ('error' in res) return 'error'
  }
  return 'success'
}

/**
 * Extract flat tool-call view items from fetched messages.
 * Pure/exported so it can be unit-tested. Guards against non-array `toolCalls`
 * (e.g. a corrupted/compacted row stored as `{"_compacted": true, …}`) so a
 * bad row can't throw "is not iterable" and crash the chat render.
 */
export function extractToolCallsFromMessages(messages: ChatMessage[]): ToolCallViewItem[] {
  const items: ToolCallViewItem[] = []
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.toolCalls)) {
      for (const tc of msg.toolCalls) {
        items.push({
          id: tc.id,
          messageId: msg.id,
          name: tc.name,
          domain: getToolDomain(tc.name),
          args: tc.args,
          result: tc.result,
          status: deriveStatus(tc),
          timestamp: msg.createdAt,
          offset: tc.offset,
          truncated: tc.truncated === true,
          })
        }
      }
    }
    return items
}

export function useToolCalls(agentId: string | null, messages: ChatMessage[]) {
  const [streamingToolCalls, setStreamingToolCalls] = useState<
    Map<string, ToolCallViewItem>
  >(new Map())

  // Extract historical tool calls from fetched messages
  const historicalToolCalls = useMemo(() => extractToolCallsFromMessages(messages), [messages])

  // SSE handlers for real-time updates during streaming
  useSSE({
    // Fires early — as soon as the LLM starts generating a tool call
    // (before arguments are fully parsed). Not all models emit this.
    'chat:tool-call-start': (data) => {
      if (data.agentId !== agentId) return
      const item: ToolCallViewItem = {
        id: data.toolCallId as string,
        messageId: data.messageId as string,
        name: data.toolName as string,
        domain: getToolDomain(data.toolName as string),
        args: undefined,
        status: 'pending',
        timestamp: new Date().toISOString(),
        offset: typeof data.contentOffset === 'number' ? data.contentOffset : undefined,
      }
      setStreamingToolCalls((prev) => new Map(prev).set(item.id, item))
    },

    // Fires when the full tool call is parsed (arguments complete), before execution.
    // Creates a new entry if tool-call-streaming-start was not emitted.
    'chat:tool-call': (data) => {
      if (data.agentId !== agentId) return
      setStreamingToolCalls((prev) => {
        const next = new Map(prev)
        const existing = next.get(data.toolCallId as string)
        if (existing) {
          // Update existing entry (from tool-call-streaming-start) with args and offset
          const updatedOffset = typeof data.contentOffset === 'number' ? data.contentOffset : existing.offset
          next.set(existing.id, { ...existing, args: data.args, offset: updatedOffset })
        } else {
          // No streaming-start was emitted — create entry now
          next.set(data.toolCallId as string, {
            id: data.toolCallId as string,
            messageId: data.messageId as string,
            name: data.toolName as string,
            domain: getToolDomain(data.toolName as string),
            args: data.args,
            status: 'pending',
            timestamp: new Date().toISOString(),
            offset: typeof data.contentOffset === 'number' ? data.contentOffset : undefined,
          })
        }
        return next
      })
    },

    // Fires when execution actually begins (after args are parsed). Distinguishes
    // a card that is still generating/queued from one that is actively running.
    'chat:tool-executing': (data) => {
      if (data.agentId !== agentId) return
      setStreamingToolCalls((prev) => {
        const next = new Map(prev)
        const existing = next.get(data.toolCallId as string)
        if (existing && (existing.status === 'pending' || existing.status === 'running')) {
          next.set(existing.id, { ...existing, status: 'running' })
        }
        return next
      })
    },

    'chat:tool-result': (data) => {
      if (data.agentId !== agentId) return
      setStreamingToolCalls((prev) => {
        const next = new Map(prev)
        const existing = next.get(data.toolCallId as string)
        if (existing) {
          const resultData = data.result as unknown
          next.set(existing.id, {
            ...existing,
            result: resultData,
            status: (() => {
              if (typeof resultData === 'object' && resultData !== null) {
                const r = resultData as Record<string, unknown>
                if ('success' in r && r.success === true) return 'success' as const
                if ('error' in r) return 'error' as const
              }
              return 'success' as const
            })(),
          })
        }
        return next
      })
    },

    'chat:done': (data) => {
      if (data.agentId !== agentId) return
      // Clear streaming tool calls — they'll be in the refreshed messages
      setStreamingToolCalls(new Map())
    },
  })

  // Merge: historical + streaming (streaming items not yet in history)
  const allToolCalls = useMemo(() => {
    const historicalIds = new Set(historicalToolCalls.map((tc) => tc.id))
    const streamingOnly = Array.from(streamingToolCalls.values()).filter(
      (tc) => !historicalIds.has(tc.id),
    )
    return [...historicalToolCalls, ...streamingOnly]
  }, [historicalToolCalls, streamingToolCalls])

  // Group tool calls by messageId for inline rendering in MessageBubble
  const toolCallsByMessage = useMemo(() => {
    const map = new Map<string, ToolCallViewItem[]>()
    for (const tc of allToolCalls) {
      const existing = map.get(tc.messageId)
      if (existing) {
        existing.push(tc)
      } else {
        map.set(tc.messageId, [tc])
      }
    }
    return map
  }, [allToolCalls])

  // Tool calls still running this turn (pending or executing) — excludes ones
  // already flipped to success/error via chat:tool-result. Drives the
  // "Running tools…" status so it clears once a batch finishes mid-turn.
  const activeToolCallCount = useMemo(() => {
    let n = 0
    for (const tc of streamingToolCalls.values()) {
      if (tc.status === 'pending' || tc.status === 'running') n++
    }
    return n
  }, [streamingToolCalls])

  return {
    toolCalls: allToolCalls,
    toolCallCount: allToolCalls.length,
    // Tool calls emitted during the current in-flight turn only (cleared on
    // `chat:done`). Drives the live counter in the thinking bubble — distinct
    // from `toolCallCount`, which spans the whole conversation.
    streamingToolCallCount: streamingToolCalls.size,
    // Tool calls still in flight this turn (pending or running). Use this for
    // the typing indicator status so "Running tools…" clears as batches finish.
    activeToolCallCount,
    toolCallsByMessage,
  }
}
