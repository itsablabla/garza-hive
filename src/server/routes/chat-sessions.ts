import { Hono } from 'hono'
import { eq, and, desc, sql } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import { db } from '@/server/db/index'
import { quickSessions, chatFolders, messages, agents } from '@/server/db/schema'
import { resolveAgentId } from '@/server/services/agent-resolver'
import { serializeChatSession } from '@/server/services/chat-sessions'
import { config } from '@/server/config'
import type { AppVariables } from '@/server/app'
import { createLogger } from '@/server/logger'
import { sseManager } from '@/server/sse/index'
import type { ChatFolder } from '@/shared/types'

const log = createLogger('routes:chat-sessions')

// ─── Chat-workspace conversations: /api/chat-sessions ───────────────────────
//
// A conversation is a `kind='chat'` quick_sessions row: same isolated session
// lane as quick chats (detail/messages/stop/PATCH are served by the existing
// /api/quick-sessions/:id routes), but cross-Agent listing, user-managed
// lifecycle and folder/pin organization live here.

const chatSessionRoutes = new Hono<{ Variables: AppVariables }>()

// POST / — create a new chat conversation on any Agent
chatSessionRoutes.post('/', async (c) => {
  const user = c.get('user') as { id: string; name: string }
  const body = await c.req.json().catch(() => ({}))
  const { agentId: agentIdParam, title: rawTitle } = body as { agentId?: string; title?: string }

  const agentId = agentIdParam ? resolveAgentId(agentIdParam) : null
  if (!agentId) {
    return c.json({ error: { code: 'KIN_NOT_FOUND', message: 'Agent not found' } }, 404)
  }

  const title = rawTitle?.trim() || null
  if (title && title.length > 200) {
    return c.json({ error: { code: 'TITLE_TOO_LONG', message: 'Title must be 200 characters or less' } }, 400)
  }

  // Soft cap on total conversations per user (no per-Agent active limit —
  // unlimited concurrent conversations is the point of the Chat workspace).
  const countRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(quickSessions)
    .where(and(eq(quickSessions.createdBy, user.id), eq(quickSessions.kind, 'chat')))
    .get()
  if ((countRow?.count ?? 0) >= config.chatSessions.maxPerUser) {
    return c.json({
      error: { code: 'MAX_CHAT_SESSIONS', message: 'Maximum chat conversations reached — delete some first' },
    }, 409)
  }

  const now = new Date()
  const sessionId = uuid()
  await db.insert(quickSessions).values({
    id: sessionId,
    agentId,
    createdBy: user.id,
    title,
    status: 'active',
    kind: 'chat',
    createdAt: now,
    updatedAt: now,
    expiresAt: null, // user-managed lifecycle — never auto-closed
  })

  const row = await db
    .select()
    .from(quickSessions)
    .where(eq(quickSessions.id, sessionId))
    .get()
  const agent = await db
    .select({ name: agents.name, avatarPath: agents.avatarPath })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get()

  const session = serializeChatSession(row!, agent, 0)

  sseManager.sendToUser(user.id, { type: 'chat-session:created', data: { session } })
  log.debug({ agentId, sessionId: session.id, userId: user.id }, 'Chat session created')

  return c.json({ session }, 201)
})

// GET / — cross-Agent list of the user's chat conversations
// Query params: ?search=<title substring> ?folderId=<id|none> ?limit ?offset
chatSessionRoutes.get('/', async (c) => {
  const user = c.get('user') as { id: string; name: string }
  const search = c.req.query('search')?.trim()
  const folderFilter = c.req.query('folderId')
  const limitParam = Math.min(Math.max(parseInt(c.req.query('limit') ?? '200', 10) || 200, 1), 500)
  const offsetParam = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0)

  const conditions = [
    eq(quickSessions.createdBy, user.id),
    eq(quickSessions.kind, 'chat'),
  ]
  if (search) {
    // Escape LIKE wildcards so a literal "%"/"_" in the query doesn't match everything
    const escaped = search.replace(/[\\%_]/g, (ch) => `\\${ch}`)
    conditions.push(sql`${quickSessions.title} LIKE ${`%${escaped}%`} ESCAPE '\\'`)
  }
  if (folderFilter === 'none') {
    conditions.push(sql`${quickSessions.folderId} IS NULL`)
  } else if (folderFilter) {
    conditions.push(eq(quickSessions.folderId, folderFilter))
  }

  const rows = await db
    .select({
      session: quickSessions,
      agentName: agents.name,
      agentAvatarPath: agents.avatarPath,
    })
    .from(quickSessions)
    .leftJoin(agents, eq(agents.id, quickSessions.agentId))
    .where(and(...conditions))
    .orderBy(desc(quickSessions.pinned), desc(sql`COALESCE(${quickSessions.updatedAt}, ${quickSessions.createdAt})`))
    .limit(limitParam + 1)
    .offset(offsetParam)
    .all()

  const hasMore = rows.length > limitParam
  if (hasMore) rows.pop()

  return c.json({
    sessions: rows.map((r) =>
      serializeChatSession(r.session, { name: r.agentName, avatarPath: r.agentAvatarPath }),
    ),
    hasMore,
  })
})

// ─── Chat-workspace folders: /api/chat-folders ───────────────────────────────

const chatFolderRoutes = new Hono<{ Variables: AppVariables }>()

function serializeFolder(row: typeof chatFolders.$inferSelect): ChatFolder {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: (row.createdAt as Date).getTime(),
    updatedAt: (row.updatedAt as Date).getTime(),
  }
}

// GET / — list the user's folders
chatFolderRoutes.get('/', async (c) => {
  const user = c.get('user') as { id: string; name: string }
  const rows = await db
    .select()
    .from(chatFolders)
    .where(eq(chatFolders.userId, user.id))
    .orderBy(chatFolders.sortOrder, chatFolders.createdAt)
    .all()
  return c.json({ folders: rows.map(serializeFolder) })
})

// POST / — create a folder
chatFolderRoutes.post('/', async (c) => {
  const user = c.get('user') as { id: string; name: string }
  const body = await c.req.json().catch(() => ({}))
  const name = (body as { name?: string }).name?.trim()

  if (!name) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Folder name is required' } }, 400)
  }
  if (name.length > 100) {
    return c.json({ error: { code: 'NAME_TOO_LONG', message: 'Folder name must be 100 characters or less' } }, 400)
  }

  const countRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatFolders)
    .where(eq(chatFolders.userId, user.id))
    .get()
  if ((countRow?.count ?? 0) >= config.chatSessions.maxFoldersPerUser) {
    return c.json({ error: { code: 'MAX_CHAT_FOLDERS', message: 'Maximum chat folders reached' } }, 409)
  }

  const maxSort = await db
    .select({ max: sql<number | null>`max(${chatFolders.sortOrder})` })
    .from(chatFolders)
    .where(eq(chatFolders.userId, user.id))
    .get()

  const now = new Date()
  const row = {
    id: uuid(),
    userId: user.id,
    name,
    sortOrder: (maxSort?.max ?? -1) + 1,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(chatFolders).values(row)

  const folder = serializeFolder(row)
  sseManager.sendToUser(user.id, { type: 'chat-folder:created', data: { folder } })
  log.debug({ folderId: folder.id, userId: user.id }, 'Chat folder created')

  return c.json({ folder }, 201)
})

// PATCH /:id — rename / reorder a folder
chatFolderRoutes.patch('/:id', async (c) => {
  const user = c.get('user') as { id: string; name: string }
  const row = await db.select().from(chatFolders).where(eq(chatFolders.id, c.req.param('id'))).get()
  if (!row) {
    return c.json({ error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } }, 404)
  }
  if (row.userId !== user.id) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not own this folder' } }, 403)
  }

  const body = await c.req.json().catch(() => ({})) as { name?: string; sortOrder?: number }
  const set: Record<string, unknown> = {}
  if ('name' in body) {
    const name = body.name?.trim()
    if (!name) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Folder name is required' } }, 400)
    }
    if (name.length > 100) {
      return c.json({ error: { code: 'NAME_TOO_LONG', message: 'Folder name must be 100 characters or less' } }, 400)
    }
    set.name = name
  }
  if ('sortOrder' in body) {
    if (typeof body.sortOrder !== 'number' || !Number.isFinite(body.sortOrder)) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'sortOrder must be a number' } }, 400)
    }
    set.sortOrder = Math.trunc(body.sortOrder)
  }
  if (Object.keys(set).length === 0) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Nothing to update' } }, 400)
  }
  set.updatedAt = new Date()

  await db.update(chatFolders).set(set).where(eq(chatFolders.id, row.id))
  const updated = await db.select().from(chatFolders).where(eq(chatFolders.id, row.id)).get()

  const folder = serializeFolder(updated!)
  sseManager.sendToUser(user.id, { type: 'chat-folder:updated', data: { folder } })

  return c.json({ folder })
})

// DELETE /:id — delete a folder (conversations inside are unfiled, not deleted)
chatFolderRoutes.delete('/:id', async (c) => {
  const user = c.get('user') as { id: string; name: string }
  const row = await db.select().from(chatFolders).where(eq(chatFolders.id, c.req.param('id'))).get()
  if (!row) {
    return c.json({ error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found' } }, 404)
  }
  if (row.userId !== user.id) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not own this folder' } }, 403)
  }

  // Unfile sessions explicitly (defensive — don't rely on FK ON DELETE)
  await db.update(quickSessions).set({ folderId: null }).where(eq(quickSessions.folderId, row.id))
  await db.delete(chatFolders).where(eq(chatFolders.id, row.id))

  sseManager.sendToUser(user.id, { type: 'chat-folder:deleted', data: { folderId: row.id } })
  log.debug({ folderId: row.id, userId: user.id }, 'Chat folder deleted')

  return c.json({ ok: true })
})

export { chatSessionRoutes, chatFolderRoutes }
