import { useCallback, useState } from 'react'
import { api } from '@/client/lib/api'
import type { ToolCallEntry } from '@/shared/types'
import type { ChatMessage } from '@/client/hooks/useChat'

export interface MessageDetailsPayload {
  messageId: string
  toolCalls: ToolCallEntry[] | null
  reasoning: ChatMessage['reasoning']
}

/**
 * Full toolCalls + reasoning for a message, fetched on demand from
 * `GET /agents/:id/messages/:id/details` and shared across every consumer
 * (reasoning blocks + inline/panel tool cards) so expanding N cards in one
 * message costs ONE network round-trip, not N.
 *
 * The cache is module-level (keyed by `agentId:messageId`) so distinct
 * component instances — a MessageBubble and its sibling InlineToolCall cards,
 * or two ToolCallItem cards in the side panel — all read the same entry and
 * dedupe in-flight requests. A per-instance `version` state re-renders the
 * caller that triggered the fetch; later consumers hit the cache synchronously.
 */
const detailsCache = new Map<string, MessageDetailsPayload>()
const inflight = new Map<string, Promise<MessageDetailsPayload | null>>()
const CACHE_CAP = 200

function cacheKey(agentId: string, messageId: string): string {
  return `${agentId}:${messageId}`
}

/** Synchronous read of the cache (null if not yet fetched). */
export function getCachedDetails(agentId: string | null | undefined, messageId: string | null | undefined): MessageDetailsPayload | null {
  if (!agentId || !messageId) return null
  return detailsCache.get(cacheKey(agentId, messageId)) ?? null
}

/** Fetch (or reuse in-flight / cached) details for one message. Network-safe. */
export function fetchMessageDetails(agentId: string | null | undefined, messageId: string | null | undefined): Promise<MessageDetailsPayload | null> {
  if (!agentId || !messageId) return Promise.resolve(null)
  const key = cacheKey(agentId, messageId)
  const cached = detailsCache.get(key)
  if (cached) return Promise.resolve(cached)
  const existing = inflight.get(key)
  if (existing) return existing

  const req = api
    .get<MessageDetailsPayload>(`/agents/${agentId}/messages/${messageId}/details`)
    .then((data) => {
      if (detailsCache.size >= CACHE_CAP) {
        const firstKey = detailsCache.keys().next().value
        if (firstKey) detailsCache.delete(firstKey)
      }
      detailsCache.set(key, data)
      inflight.delete(key)
      return data
    })
    .catch((err) => {
      inflight.delete(key)
      console.error('[useMessageDetails] failed to load details', err)
      return null
    })

  inflight.set(key, req)
  return req
}

/**
 * Per-instance accessor over the shared cache. `ensureDetails` triggers (or
 * reuses) a fetch and bumps a local version so the caller re-renders when the
 * cache fills; `getCached` reads the current entry synchronously.
 */
export function useMessageDetails(agentId: string | null | undefined) {
  const [version, setVersion] = useState(0)

  const ensureDetails = useCallback(async (messageId: string | null | undefined): Promise<MessageDetailsPayload | null> => {
    if (!messageId) return null
    const result = await fetchMessageDetails(agentId, messageId)
    setVersion((v) => v + 1)
    return result
    // version is read inside getCached via closure over the render-time value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, version])

  const getCached = useCallback((messageId: string | null | undefined): MessageDetailsPayload | null => {
    return getCachedDetails(agentId, messageId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, version])

  return { ensureDetails, getCached }
}
