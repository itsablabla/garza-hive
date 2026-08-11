/**
 * Chat-workspace conversation services.
 *
 * A Chat-workspace conversation is a `kind='chat'` quick_sessions row: same
 * isolated session lane as quick chats, but full capability profile and a
 * user-managed lifecycle (no auto-expiry, no retention GC, rename/folder/
 * pin/delete). This module owns serialization, the post-turn upkeep hook
 * (activity bump + auto-title) and the user-scoped SSE lifecycle events.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/server/db/index'
import { quickSessions, agents } from '@/server/db/schema'
import { config } from '@/server/config'
import { createLogger } from '@/server/logger'
import { sseManager } from '@/server/sse/index'
import type { ChatSessionSummary } from '@/shared/types'

const log = createLogger('chat-sessions')

type QuickSessionRow = typeof quickSessions.$inferSelect
type AgentInfo = { name: string | null; avatarPath: string | null }

export function agentAvatarUrl(agentId: string, avatarPath: string | null): string | null {
  if (!avatarPath) return null
  return `/api/uploads/agents/${agentId}/avatar.${avatarPath.split('.').pop() ?? 'png'}`
}

/** Serialize a chat session row (+ its agent's display info) for the API/SSE. */
export function serializeChatSession(row: QuickSessionRow, agent: AgentInfo | undefined, messageCount?: number): ChatSessionSummary {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: agent?.name ?? '',
    agentAvatarUrl: agentAvatarUrl(row.agentId, agent?.avatarPath ?? null),
    title: row.title,
    folderId: row.folderId ?? null,
    pinned: row.pinned ?? false,
    createdAt: (row.createdAt as Date).getTime(),
    updatedAt: row.updatedAt ? (row.updatedAt as Date).getTime() : (row.createdAt as Date).getTime(),
    ...(messageCount !== undefined ? { messageCount } : {}),
    model: row.model ?? null,
    providerId: row.providerId ?? null,
    thinkingEnabled: row.thinkingEnabled ?? null,
    thinkingEffort: (row.thinkingEffort as ChatSessionSummary['thinkingEffort']) ?? null,
  }
}

/** Load a chat session + agent info and emit `chat-session:updated` to its owner. */
export async function emitChatSessionUpdated(sessionId: string): Promise<void> {
  const row = await db.select().from(quickSessions).where(eq(quickSessions.id, sessionId)).get()
  if (!row || row.kind !== 'chat') return
  const agent = await db
    .select({ name: agents.name, avatarPath: agents.avatarPath })
    .from(agents)
    .where(eq(agents.id, row.agentId))
    .get()
  sseManager.sendToUser(row.createdBy, {
    type: 'chat-session:updated',
    data: { session: serializeChatSession(row, agent) },
  })
}

/** Bump a chat session's activity timestamp (drives sidebar date-grouping). */
export async function touchChatSession(sessionId: string): Promise<void> {
  await db.update(quickSessions).set({ updatedAt: new Date() }).where(eq(quickSessions.id, sessionId))
}

/**
 * Post-turn upkeep for a chat-workspace conversation: bump the activity
 * timestamp, auto-title the conversation from the first exchange when it has
 * no title yet, then notify the owner's clients. Failures are non-fatal —
 * the turn itself already completed.
 */
export async function onChatSessionTurnComplete(params: {
  sessionId: string
  agentId: string
  userText: string
  assistantText: string
}): Promise<void> {
  const { sessionId, agentId, userText, assistantText } = params
  try {
    await touchChatSession(sessionId)

    const row = await db.select().from(quickSessions).where(eq(quickSessions.id, sessionId)).get()
    if (!row || row.kind !== 'chat') return

    if (!row.title && config.chatSessions.autoTitle && (userText.trim() || assistantText.trim())) {
      const title = await generateChatTitle({ sessionRow: row, agentId, userText, assistantText })
      if (title) {
        await db.update(quickSessions).set({ title }).where(eq(quickSessions.id, sessionId))
      }
    }

    await emitChatSessionUpdated(sessionId)
  } catch (err) {
    log.warn({ sessionId, err }, 'Chat session post-turn upkeep failed')
  }
}

/** One-shot LLM call: name the conversation from its first exchange. */
async function generateChatTitle(params: {
  sessionRow: QuickSessionRow
  agentId: string
  userText: string
  assistantText: string
}): Promise<string | null> {
  const { sessionRow, agentId, userText, assistantText } = params
  try {
    const agent = await db
      .select({ model: agents.model, providerId: agents.providerId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get()
    if (!agent) return null

    const modelId = sessionRow.model ?? agent.model
    const providerId = sessionRow.model ? sessionRow.providerId : agent.providerId

    const { resolveLLM } = await import('@/server/llm/core/resolve')
    const { runOneShot } = await import('@/server/llm/core/run-oneshot')
    const resolved = await resolveLLM({ modelId, providerId })

    const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s)
    const { text, usage } = await runOneShot(resolved, {
      system: [{
        type: 'text',
        text:
          'You generate short conversation titles. Reply with ONLY the title: '
          + 'at most 6 words, no quotes, no trailing punctuation, in the language of the conversation.',
      }],
      messages: [
        {
          role: 'user',
          content: [{
            type: 'text',
            text: `User: ${clip(userText, 2000)}\n\nAssistant: ${clip(assistantText, 2000)}\n\nTitle:`,
          }],
        },
      ],
      maxOutputTokens: 64,
    })

    const { recordUsage } = await import('@/server/services/token-usage')
    recordUsage({
      callSite: 'chat-session-title',
      callType: 'generate-text',
      providerType: resolved.providerRow.type,
      providerId: resolved.providerRow.id,
      modelId: resolved.model.id,
      agentId,
      sessionId: sessionRow.id,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        inputTokenDetails: { cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens },
        outputTokenDetails: { reasoningTokens: usage.reasoningTokens },
      },
    })

    const title = text.trim().replace(/^["'«]+|["'»]+$/g, '').replace(/[.!?]+$/, '').trim()
    if (!title) return null
    return title.length > 200 ? title.slice(0, 200) : title
  } catch (err) {
    log.debug({ sessionId: sessionRow.id, err }, 'Chat session auto-title failed')
    return null
  }
}
