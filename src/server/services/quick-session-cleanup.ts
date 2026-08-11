import { eq, and, lt, ne, inArray } from 'drizzle-orm'
import { db } from '@/server/db/index'
import { quickSessions, messages } from '@/server/db/schema'
import { config } from '@/server/config'
import { createLogger } from '@/server/logger'
import { sseManager } from '@/server/sse/index'

const log = createLogger('quick-session-cleanup')

let cleanupInterval: ReturnType<typeof setInterval> | null = null

/**
 * One cleanup sweep. Exported for tests.
 * - Closes sessions that have expired (expiresAt < now)
 * - Deletes closed sessions older than retentionDays
 *   (messages cascade-deleted via FK)
 * Chat-workspace conversations (kind='chat') are exempt from both: their
 * lifecycle is user-managed (rename/delete), never GC'd.
 */
export async function runQuickSessionCleanupSweep(): Promise<void> {
  const now = new Date()

  // 1. Close expired sessions. Chat-workspace conversations (kind='chat')
  // never expire — they are user-managed (like 'api' rows they carry a
  // null expiresAt, but the explicit filter guards against future edits).
  const expired = await db
    .select({ id: quickSessions.id, agentId: quickSessions.agentId })
    .from(quickSessions)
    .where(and(
      eq(quickSessions.status, 'active'),
      lt(quickSessions.expiresAt, now),
      ne(quickSessions.kind, 'chat'),
    ))
    .all()

  if (expired.length > 0) {
    for (const s of expired) {
      await db.update(quickSessions).set({
        status: 'closed',
        closedAt: now,
      }).where(eq(quickSessions.id, s.id))

      // Notify connected clients so the UI updates
      sseManager.sendToAgent(s.agentId, {
        type: 'quick-session:closed',
        agentId: s.agentId,
        data: { sessionId: s.id },
      })
    }
    log.info({ count: expired.length }, 'Closed expired quick sessions')
  }

  // 2. Delete closed sessions older than retentionDays. Chat-workspace
  // conversations are exempt: their lifecycle is explicit user deletes.
  const cutoff = new Date(now.getTime() - config.quickSessions.retentionDays * 24 * 60 * 60 * 1000)
  const stale = await db
    .select({ id: quickSessions.id })
    .from(quickSessions)
    .where(and(
      eq(quickSessions.status, 'closed'),
      lt(quickSessions.closedAt, cutoff),
      ne(quickSessions.kind, 'chat'),
    ))
    .all()

  if (stale.length > 0) {
    const staleIds = stale.map((s) => s.id)
    // Delete messages first — the DB DDL may lack ON DELETE CASCADE
    await db.delete(messages).where(inArray(messages.sessionId, staleIds))
    for (const s of stale) {
      await db.delete(quickSessions).where(eq(quickSessions.id, s.id))
    }
    log.info({ count: stale.length }, 'Deleted stale quick sessions')
  }
}

/**
 * Start the periodic cleanup job for quick sessions.
 */
export function startQuickSessionCleanup() {
  if (cleanupInterval) return

  const intervalMs = config.quickSessions.cleanupIntervalMinutes * 60 * 1000

  cleanupInterval = setInterval(async () => {
    try {
      await runQuickSessionCleanupSweep()
    } catch (err) {
      log.error({ err }, 'Quick session cleanup error')
    }
  }, intervalMs)

  log.info({ intervalMinutes: config.quickSessions.cleanupIntervalMinutes }, 'Quick session cleanup started')
}

export function stopQuickSessionCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}
