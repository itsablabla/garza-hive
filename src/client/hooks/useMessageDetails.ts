import { useCallback, useRef, useState } from 'react'
import { api } from '@/client/lib/api'
import type { ToolCallEntry } from '@/shared/types'
import type { ChatMessage } from '@/client/hooks/useChat'

export interface MessageDetailsPayload {
  messageId: string
  toolCalls: ToolCallEntry[] | null
  reasoning: ChatMessage['reasoning']
}

/**
 * Lazy-load full toolCalls + reasoning for a message whose list DTO was slimmed
 * (`detailsTruncated`). Cached per messageId for the lifetime of the hook.
 */
export function useMessageDetails(agentId: string | null | undefined) {
  const cacheRef = useRef(new Map<string, MessageDetailsPayload>())
  const inflightRef = useRef(new Map<string, Promise<MessageDetailsPayload | null>>())
  const [version, setVersion] = useState(0)

  const getCached = useCallback((messageId: string) => {
    return cacheRef.current.get(messageId) ?? null
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps -- version bumps re-read

  const ensureDetails = useCallback(async (messageId: string): Promise<MessageDetailsPayload | null> => {
    if (!agentId || !messageId) return null
    const cached = cacheRef.current.get(messageId)
    if (cached) return cached

    const inflight = inflightRef.current.get(messageId)
    if (inflight) return inflight

    const req = api
      .get<MessageDetailsPayload>(`/agents/${agentId}/messages/${messageId}/details`)
      .then((data) => {
        cacheRef.current.set(messageId, data)
        inflightRef.current.delete(messageId)
        setVersion((v) => v + 1)
        return data
      })
      .catch((err) => {
        inflightRef.current.delete(messageId)
        console.error('[useMessageDetails] failed to load details', err)
        return null
      })

    inflightRef.current.set(messageId, req)
    return req
  }, [agentId])

  return { ensureDetails, getCached }
}
