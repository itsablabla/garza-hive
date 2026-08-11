import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from '@/server/db/schema'
import { fullMockConfig } from '../../test-helpers'

// Skip when another suite has globally mocked the schema to stubs (mock.module
// is process-global): real columns are required for the in-memory CRUD here.
const schemaIsReal = !!(schema as { chatFolders?: { id?: unknown } }).chatFolders?.id
const d = schemaIsReal ? describe : describe.skip

const sqlite = new Database(':memory:')
sqlite.run(`CREATE TABLE quick_sessions (
  id text PRIMARY KEY NOT NULL, agent_id text NOT NULL, created_by text NOT NULL,
  title text, status text NOT NULL DEFAULT 'active', kind text NOT NULL DEFAULT 'quick',
  folder_id text, pinned integer NOT NULL DEFAULT 0, updated_at integer,
  model text, provider_id text, thinking_enabled integer, thinking_effort text,
  created_at integer NOT NULL, closed_at integer, expires_at integer
)`)
sqlite.run(`CREATE TABLE chat_folders (
  id text PRIMARY KEY NOT NULL, user_id text NOT NULL, name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0, created_at integer NOT NULL, updated_at integer NOT NULL
)`)
sqlite.run(`CREATE TABLE messages (
  id text PRIMARY KEY NOT NULL, agent_id text NOT NULL, session_id text,
  role text NOT NULL, content text, source_type text NOT NULL, source_id text,
  tool_calls text, reasoning text, metadata text, is_redacted integer DEFAULT 0,
  created_at integer NOT NULL
)`)
sqlite.run(`CREATE TABLE agents (
  id text PRIMARY KEY NOT NULL, slug text, name text NOT NULL, role text,
  avatar_path text, model text, provider_id text, created_at integer, updated_at integer
)`)
const testDb = drizzle(sqlite, { schema })

const sseSent: Array<{ type: string; userId?: string; data: Record<string, unknown> }> = []

mock.module('@/server/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, debug() {}, error() {} }) }))
mock.module('@/server/db/index', () => ({ db: testDb, sqlite, initVirtualTables() {} }))
mock.module('@/server/config', () => ({
  config: {
    ...fullMockConfig,
    chatSessions: { maxPerUser: 3, maxFoldersPerUser: 2, autoTitle: false },
  },
}))
mock.module('@/server/sse/index', () => ({
  sseManager: {
    sendToUser: (userId: string, event: { type: string; data: Record<string, unknown> }) => {
      sseSent.push({ type: event.type, userId, data: event.data })
    },
    sendToAgent: (_agentId: string, event: { type: string; data: Record<string, unknown> }) => {
      sseSent.push({ type: event.type, data: event.data })
    },
    broadcast: (event: { type: string; data: Record<string, unknown> }) => {
      sseSent.push({ type: event.type, data: event.data })
    },
  },
}))
mock.module('@/server/services/agent-resolver', () => ({
  resolveAgentId: (idOrSlug: string) => {
    const row = sqlite.query('SELECT id FROM agents WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug) as { id: string } | null
    return row?.id ?? null
  },
}))

const routesMod = schemaIsReal
  ? await import('@/server/routes/chat-sessions')
  : ({} as typeof import('@/server/routes/chat-sessions'))
const cleanupMod = schemaIsReal
  ? await import('@/server/services/quick-session-cleanup')
  : ({} as typeof import('@/server/services/quick-session-cleanup'))

function makeApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('user' as never, { id: 'user-1', name: 'Test' } as never)
    await next()
  })
  app.route('/api/chat-sessions', routesMod.chatSessionRoutes)
  app.route('/api/chat-folders', routesMod.chatFolderRoutes)
  return app
}

function reset() {
  sqlite.run('DELETE FROM quick_sessions')
  sqlite.run('DELETE FROM chat_folders')
  sqlite.run('DELETE FROM messages')
  sqlite.run('DELETE FROM agents')
  sqlite.run(`INSERT INTO agents (id, slug, name, avatar_path) VALUES ('agent-1', 'aria', 'Aria', NULL)`)
  sseSent.length = 0
}

d('chat session routes', () => {
  beforeEach(reset)

  it('creates a chat session with kind=chat, no expiry, updatedAt set', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat-sessions', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'agent-1' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { session: { id: string; agentId: string; pinned: boolean; folderId: string | null } }
    expect(body.session.agentId).toBe('agent-1')
    expect(body.session.pinned).toBe(false)
    expect(body.session.folderId).toBeNull()

    const row = sqlite.query('SELECT kind, expires_at, updated_at FROM quick_sessions WHERE id = ?').get(body.session.id) as { kind: string; expires_at: number | null; updated_at: number | null }
    expect(row.kind).toBe('chat')
    expect(row.expires_at).toBeNull()
    expect(row.updated_at).not.toBeNull()

    expect(sseSent.some((e) => e.type === 'chat-session:created' && e.userId === 'user-1')).toBe(true)
  })

  it('has no per-Agent active limit but enforces the global cap', async () => {
    const app = makeApp()
    // maxPerUser mocked to 3 — three creates on the SAME agent succeed
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/api/chat-sessions', {
        method: 'POST',
        body: JSON.stringify({ agentId: 'agent-1' }),
      })
      expect(res.status).toBe(201)
    }
    const res = await app.request('/api/chat-sessions', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'agent-1' }),
    })
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('MAX_CHAT_SESSIONS')
  })

  it('lists cross-agent, pinned first then by activity, with search + folder filters', async () => {
    const app = makeApp()
    sqlite.run(`INSERT INTO agents (id, slug, name) VALUES ('agent-2', 'bob', 'Bob')`)
    sqlite.run(`INSERT INTO chat_folders (id, user_id, name, sort_order, created_at, updated_at) VALUES ('f1', 'user-1', 'Work', 0, 0, 0)`)
    const mk = (id: string, agentId: string, title: string, updatedAt: number, pinned = 0, folderId: string | null = null) =>
      sqlite.run(
        `INSERT INTO quick_sessions (id, agent_id, created_by, title, kind, pinned, folder_id, created_at, updated_at)
         VALUES (?, ?, 'user-1', ?, 'chat', ?, ?, 1000, ?)`,
        [id, agentId, title, pinned, folderId, updatedAt],
      )
    mk('s1', 'agent-1', 'Groceries plan', 2000)
    mk('s2', 'agent-2', 'Trip to Rome', 3000)
    mk('s3', 'agent-1', 'Rome photos', 1500, 1, 'f1')
    // A plain quick session and an api session must NOT appear
    sqlite.run(`INSERT INTO quick_sessions (id, agent_id, created_by, kind, created_at) VALUES ('q1', 'agent-1', 'user-1', 'quick', 5000)`)
    sqlite.run(`INSERT INTO quick_sessions (id, agent_id, created_by, kind, created_at) VALUES ('a1', 'agent-1', 'user-1', 'api', 5000)`)

    const res = await app.request('/api/chat-sessions')
    const body = await res.json() as { sessions: Array<{ id: string; agentName: string }> }
    expect(body.sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']) // pinned first, then updatedAt desc
    expect(body.sessions.find((s) => s.id === 's2')!.agentName).toBe('Bob')

    const search = await app.request('/api/chat-sessions?search=rome')
    const searchBody = await search.json() as { sessions: Array<{ id: string }> }
    expect(searchBody.sessions.map((s) => s.id).sort()).toEqual(['s2', 's3'])

    const folder = await app.request('/api/chat-sessions?folderId=f1')
    const folderBody = await folder.json() as { sessions: Array<{ id: string }> }
    expect(folderBody.sessions.map((s) => s.id)).toEqual(['s3'])

    const unfiled = await app.request('/api/chat-sessions?folderId=none')
    const unfiledBody = await unfiled.json() as { sessions: Array<{ id: string }> }
    expect(unfiledBody.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })

  it('rejects creation for unknown agents', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat-sessions', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'nope' }),
    })
    expect(res.status).toBe(404)
  })
})

d('chat folder routes', () => {
  beforeEach(reset)

  it('creates, renames and deletes folders (unfiling sessions on delete)', async () => {
    const app = makeApp()
    const create = await app.request('/api/chat-folders', {
      method: 'POST',
      body: JSON.stringify({ name: 'Work' }),
    })
    expect(create.status).toBe(201)
    const { folder } = await create.json() as { folder: { id: string; name: string } }
    expect(folder.name).toBe('Work')
    expect(sseSent.some((e) => e.type === 'chat-folder:created')).toBe(true)

    const rename = await app.request(`/api/chat-folders/${folder.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Personal' }),
    })
    expect(rename.status).toBe(200)
    const renamed = await rename.json() as { folder: { name: string } }
    expect(renamed.folder.name).toBe('Personal')

    sqlite.run(
      `INSERT INTO quick_sessions (id, agent_id, created_by, kind, folder_id, created_at) VALUES ('s1', 'agent-1', 'user-1', 'chat', ?, 0)`,
      [folder.id],
    )
    const del = await app.request(`/api/chat-folders/${folder.id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const session = sqlite.query('SELECT folder_id FROM quick_sessions WHERE id = ?').get('s1') as { folder_id: string | null }
    expect(session.folder_id).toBeNull()
    expect(sqlite.query('SELECT count(*) as c FROM chat_folders').get()).toEqual({ c: 0 })
    expect(sseSent.some((e) => e.type === 'chat-folder:deleted')).toBe(true)
  })

  it('enforces the folder cap and ownership', async () => {
    const app = makeApp()
    // maxFoldersPerUser mocked to 2
    for (const name of ['A', 'B']) {
      const res = await app.request('/api/chat-folders', { method: 'POST', body: JSON.stringify({ name }) })
      expect(res.status).toBe(201)
    }
    const over = await app.request('/api/chat-folders', { method: 'POST', body: JSON.stringify({ name: 'C' }) })
    expect(over.status).toBe(409)

    sqlite.run(`INSERT INTO chat_folders (id, user_id, name, sort_order, created_at, updated_at) VALUES ('other', 'user-2', 'X', 0, 0, 0)`)
    const forbidden = await app.request('/api/chat-folders/other', { method: 'DELETE' })
    expect(forbidden.status).toBe(403)
  })
})

d('quick session cleanup — chat exemption', () => {
  beforeEach(reset)

  it('never closes or deletes kind=chat sessions', async () => {
    const past = Date.now() - 100 * 24 * 60 * 60 * 1000
    // Expired-looking chat session (defensive: expires_at should always be null, but even if set it must survive)
    sqlite.run(
      `INSERT INTO quick_sessions (id, agent_id, created_by, kind, status, created_at, expires_at) VALUES ('chat-1', 'agent-1', 'user-1', 'chat', 'active', ?, ?)`,
      [past, past],
    )
    // Old closed chat session — must not be retention-deleted
    sqlite.run(
      `INSERT INTO quick_sessions (id, agent_id, created_by, kind, status, created_at, closed_at) VALUES ('chat-2', 'agent-1', 'user-1', 'chat', 'closed', ?, ?)`,
      [past, past],
    )
    // Expired plain quick session — must be closed
    sqlite.run(
      `INSERT INTO quick_sessions (id, agent_id, created_by, kind, status, created_at, expires_at) VALUES ('quick-1', 'agent-1', 'user-1', 'quick', 'active', ?, ?)`,
      [past, past],
    )
    // Old closed plain quick session — must be deleted
    sqlite.run(
      `INSERT INTO quick_sessions (id, agent_id, created_by, kind, status, created_at, closed_at) VALUES ('quick-2', 'agent-1', 'user-1', 'quick', 'closed', ?, ?)`,
      [past, past],
    )

    await cleanupMod.runQuickSessionCleanupSweep()

    const chat1 = sqlite.query('SELECT status FROM quick_sessions WHERE id = ?').get('chat-1') as { status: string }
    expect(chat1.status).toBe('active')
    expect(sqlite.query('SELECT id FROM quick_sessions WHERE id = ?').get('chat-2')).not.toBeNull()
    const quick1 = sqlite.query('SELECT status FROM quick_sessions WHERE id = ?').get('quick-1') as { status: string }
    expect(quick1.status).toBe('closed')
    expect(sqlite.query('SELECT id FROM quick_sessions WHERE id = ?').get('quick-2')).toBeNull()
  })
})
