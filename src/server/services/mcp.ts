import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { tool as aiTool } from '@/server/tools/tool-helper'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/server/db/index'
import { createLogger } from '@/server/logger'
import { augmentedPath, killProcessTree } from '@/server/lib/process'
import { mcpServers, agentMcpServers } from '@/server/db/schema'
import type { Tool } from '@/server/tools/tool-helper'
import { eventBus } from '@/server/services/events'
import { getSecretForUse, markSecretUsed } from '@/server/services/vault'
import {
  extractPlaceholderKeys,
  hostMatchesAllowlist,
  noteHotSecret,
  substitutePlaceholders,
} from '@/server/services/secret-substitution'

const log = createLogger('mcp')

// PATH augmentation + process-tree kill now live in @/server/lib/process and are
// shared with the custom-tools executor.

// ─── Types ───────────────────────────────────────────────────────────────────

interface MCPConnection {
  client: Client
  transport: StdioClientTransport
  tools: MCPToolDef[]
  serverId: string
  serverName: string
}

interface MCPToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** Launch shape after JSON-parsing the stored MCP server row. */
export interface McpLaunchConfig {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * Synthetic tool id used for vault `allowedTools` checks when expanding secrets
 * into an MCP server's command/args/env at connect time. Restricted secrets must
 * list this name (or stay unrestricted) to be usable in MCP launch config.
 */
export const MCP_SERVER_CONNECT_TOOL = 'mcp_server_connect'

const URL_IN_LAUNCH_RE = /https?:\/\/[^\s"'\\]+/gi

/** Collect http(s) URLs embedded anywhere in the launch config (args + env values). */
export function extractLaunchUrls(launch: McpLaunchConfig): string[] {
  const urls = new Set<string>()
  const scan = (s: string) => {
    for (const m of s.matchAll(URL_IN_LAUNCH_RE)) urls.add(m[0]!)
  }
  scan(launch.command)
  for (const a of launch.args) scan(a)
  for (const v of Object.values(launch.env)) scan(v)
  return [...urls]
}

// ─── Connection pool (one connection per MCP server) ─────────────────────────

const connections = new Map<string, MCPConnection>()

const MCP_CONNECT_TIMEOUT_MS = 30_000
const MCP_CALL_TIMEOUT_MS = 120_000 // 2 minutes max for any single MCP tool call

/**
 * Expand `{{secret:KEY}}` placeholders in an MCP server's command/args/env
 * just before spawn. Tool-call expansion (tool-executor) does not cover this
 * path — MCP config is not a tool argument — so without this step agents that
 * store vault placeholders in MCP env/headers launch with the literal
 * `{{secret:…}}` string and remote auth fails closed.
 *
 * Fail-closed on unknown keys and on vault scope violations (`allowedTools` /
 * `allowedHosts`), matching tool-executor anti-exfiltration rules. Restricted
 * secrets must include `mcp_server_connect` in `allowedTools`. Host-scoped
 * secrets require every launch URL to match the allowlist (no decoy bypass). The stored
 * row stays placeholder-only; only the in-memory launch copy is expanded.
 */
export async function expandMcpLaunchSecrets(
  launch: McpLaunchConfig,
  meta: { serverId: string; serverName: string },
): Promise<McpLaunchConfig> {
  const keys = extractPlaceholderKeys(launch)
  if (keys.length === 0) return launch

  const resolved = new Map<string, string>()
  const missing: string[] = []
  const violations: Array<{ key: string; type: 'tool-scope' | 'host-scope'; message: string }> = []
  const launchUrls = extractLaunchUrls(launch)

  for (const key of keys) {
    const record = await getSecretForUse(key)
    if (record === null) {
      missing.push(key)
      continue
    }
    if (record.allowedTools && !record.allowedTools.includes(MCP_SERVER_CONNECT_TOOL)) {
      violations.push({
        key,
        type: 'tool-scope',
        message:
          `secret "${key}" is restricted to: ${record.allowedTools.join(', ')} ` +
          `(MCP connect requires "${MCP_SERVER_CONNECT_TOOL}")`,
      })
      continue
    }
    if (record.allowedHosts) {
      // Every http(s) URL in the launch config must match — a single allowlisted
      // decoy must not unlock expansion while the real MCP endpoint is off-list.
      const unmatched = launchUrls.filter((url) => !hostMatchesAllowlist(url, record.allowedHosts!))
      if (launchUrls.length === 0 || unmatched.length > 0) {
        violations.push({
          key,
          type: 'host-scope',
          message:
            `secret "${key}" is restricted to host${record.allowedHosts.length > 1 ? 's' : ''}: ` +
            `${record.allowedHosts.join(', ')} ` +
            `(launch URLs: ${launchUrls.length > 0 ? launchUrls.join(', ') : 'none'}` +
            `${unmatched.length > 0 ? `; unmatched: ${unmatched.join(', ')}` : ''})`,
        })
        continue
      }
    }
    resolved.set(key, record.value)
    noteHotSecret(key, record.value)
  }

  if (missing.length > 0 || violations.length > 0) {
    for (const key of missing) {
      eventBus.emit({
        type: 'vault:secret-used',
        data: {
          serverId: meta.serverId,
          serverName: meta.serverName,
          toolName: MCP_SERVER_CONNECT_TOOL,
          secretKey: key,
          violation: { type: 'unknown-key' },
        },
        timestamp: Date.now(),
      })
    }
    for (const v of violations) {
      eventBus.emit({
        type: 'vault:secret-used',
        data: {
          serverId: meta.serverId,
          serverName: meta.serverName,
          toolName: MCP_SERVER_CONNECT_TOOL,
          secretKey: v.key,
          violation: { type: v.type },
        },
        timestamp: Date.now(),
      })
    }
    if (violations.length > 0) {
      throw new Error(
        `Secret scope violation in MCP server "${meta.serverName}" config — connection aborted: ` +
          `${violations.map((v) => v.message).join('; ')}. ` +
          `Add "${MCP_SERVER_CONNECT_TOOL}" to the secret's allowed tools (and a matching host if restricted), or use an unrestricted secret.`,
      )
    }
    const list = missing.map((k) => `"${k}"`).join(', ')
    throw new Error(
      `Unknown secret${missing.length > 1 ? 's' : ''} ${list} in MCP server "${meta.serverName}" config — connection aborted. ` +
        `Use search_secrets / the Vault UI for the right key, or store the real value in env.`,
    )
  }

  for (const key of keys) {
    eventBus.emit({
      type: 'vault:secret-used',
      data: {
        serverId: meta.serverId,
        serverName: meta.serverName,
        toolName: MCP_SERVER_CONNECT_TOOL,
        secretKey: key,
      },
      timestamp: Date.now(),
    })
    markSecretUsed(key).catch((err) => log.warn({ key, err }, 'Failed to stamp secret last_used_at'))
  }

  const expanded = substitutePlaceholders(launch, resolved) as McpLaunchConfig
  log.debug(
    { serverId: meta.serverId, serverName: meta.serverName, secretKeys: keys },
    'Expanded secret placeholders in MCP launch config',
  )
  return expanded
}

async function connectToServer(serverId: string): Promise<MCPConnection | null> {
  const server = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get()
  if (!server) return null

  if (server.status !== 'active') {
    log.debug({ serverId, status: server.status }, 'Skipping non-active MCP server')
    return null
  }

  try {
    const rawArgs = server.args ? JSON.parse(server.args) as string[] : []
    const rawEnv = server.env ? JSON.parse(server.env) as Record<string, string> : {}
    const { command, args, env } = await expandMcpLaunchSecrets(
      { command: server.command, args: rawArgs, env: rawEnv },
      { serverId, serverName: server.name },
    )

    const transport = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, PATH: augmentedPath, ...env } as Record<string, string>,
    })

    const client = new Client({
      name: 'garzahive',
      version: '1.0.0',
    })

    // Connect with timeout to avoid hanging on unresponsive servers
    const connectPromise = client.connect(transport)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`MCP connection timeout after ${MCP_CONNECT_TIMEOUT_MS}ms`)), MCP_CONNECT_TIMEOUT_MS),
    )
    await Promise.race([connectPromise, timeoutPromise])

    // Discover tools
    const toolsResult = await client.listTools()
    const tools: MCPToolDef[] = (toolsResult.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    }))

    const conn: MCPConnection = {
      client,
      transport,
      tools,
      serverId,
      serverName: server.name,
    }

    connections.set(serverId, conn)
    log.info({ serverId, serverName: server.name, toolCount: tools.length }, 'MCP server connected')

    return conn
  } catch (err) {
    log.error({ serverId, serverName: server.name, err }, 'MCP connection failed')
    return null
  }
}

async function getConnection(serverId: string): Promise<MCPConnection | null> {
  // Return existing connection if alive
  if (connections.has(serverId)) {
    return connections.get(serverId)!
  }

  return connectToServer(serverId)
}

// Register graceful shutdown hooks
process.on('beforeExit', () => { disconnectAll() })
process.on('SIGINT', () => { disconnectAll().finally(() => process.exit(0)) })
process.on('SIGTERM', () => { disconnectAll().finally(() => process.exit(0)) })

// ─── Process tree cleanup ────────────────────────────────────────────────────

// ─── Disconnect ──────────────────────────────────────────────────────────────

export async function disconnectServer(serverId: string) {
  const conn = connections.get(serverId)
  if (conn) {
    // Grab the PID before close() clears it
    const pid = conn.transport.pid
    try {
      await conn.client.close()
    } catch { /* ignore */ }

    // Kill the entire process tree to clean up npm exec → sh → node chains.
    // client.close() only kills the direct child; grandchildren may survive.
    if (pid) {
      await killProcessTree(pid)
    }

    connections.delete(serverId)
  }
}

export async function disconnectAll() {
  for (const [id] of connections) {
    await disconnectServer(id)
  }
}

// ─── Connection status ───────────────────────────────────────────────────────

export interface MCPConnectionStatus {
  connected: boolean
  toolCount: number
  error?: string
}

/**
 * Check connection status for an MCP server. Uses cached connection if available.
 */
export async function getConnectionStatus(serverId: string): Promise<MCPConnectionStatus> {
  try {
    const conn = await getConnection(serverId)
    if (!conn) {
      return { connected: false, toolCount: 0, error: 'Failed to connect' }
    }
    return { connected: true, toolCount: conn.tools.length }
  } catch (err) {
    return { connected: false, toolCount: 0, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Force a fresh connection attempt (evicts cached connection first).
 */
export async function testConnection(serverId: string): Promise<MCPConnectionStatus> {
  // Evict existing connection
  await disconnectServer(serverId)
  return getConnectionStatus(serverId)
}

// ─── MCP tool summary for system prompt ──────────────────────────────────────

export interface MCPToolSummary {
  serverName: string
  tools: Array<{ name: string; description: string }>
}

/**
 * Get a lightweight summary of MCP tools available to an Agent.
 * Used for injection into the system prompt so the Agent knows what MCP tools are available.
 * This reuses existing connections (or creates them) but only extracts metadata.
 */
export async function getMCPToolsSummary(agentId: string): Promise<MCPToolSummary[]> {
  const links = await db
    .select({ mcpServerId: agentMcpServers.mcpServerId })
    .from(agentMcpServers)
    .where(eq(agentMcpServers.agentId, agentId))
    .all()

  if (links.length === 0) return []

  const summaries: MCPToolSummary[] = []

  for (const link of links) {
    const conn = await getConnection(link.mcpServerId)
    if (!conn) continue

    summaries.push({
      serverName: conn.serverName,
      tools: conn.tools.map((t) => ({
        name: `mcp_${sanitizeName(conn.serverName)}_${sanitizeName(t.name)}`,
        description: t.description,
      })),
    })
  }

  return summaries
}

// ─── MCP catalog (all global active servers, no per-Agent gate) ────────────────

/** A single MCP tool as it appears in the toolbox catalog. */
export interface MCPCatalogEntry {
  /** Stable grant name: `mcp_<sanitizeName(server)>_<sanitizeName(tool)>`. */
  name: string
  /** Human-facing display name of the originating server. */
  serverName: string
  serverId: string
  /** Raw (unsanitized) upstream tool name. */
  rawToolName: string
  description: string
}

/**
 * Enumerate every MCP tool from ALL global active servers, with no per-Agent
 * gate. This powers the toolbox catalog: a toolbox can list any of these stable
 * `mcp_*` names and the unified resolver will grant it to any Agent/task that
 * references that toolbox (the server's creds stay global).
 *
 * Servers that are not `active` are skipped. A server we cannot connect to (so
 * its tool list is unknown) contributes no entries — it simply won't appear in
 * the catalog until it connects.
 */
export async function listAllMCPCatalogTools(): Promise<MCPCatalogEntry[]> {
  const servers = await db.select().from(mcpServers).all()
  const entries: MCPCatalogEntry[] = []

  for (const server of servers) {
    if (server.status !== 'active') continue
    const conn = await getConnection(server.id)
    if (!conn) continue

    for (const t of conn.tools) {
      entries.push({
        name: `mcp_${sanitizeName(conn.serverName)}_${sanitizeName(t.name)}`,
        serverName: conn.serverName,
        serverId: server.id,
        rawToolName: t.name,
        description: t.description,
      })
    }
  }

  return entries
}

// ─── Resolve MCP tools (global, no per-Agent gate) ─────────────────────────────

/**
 * Resolve every MCP tool from ALL global ACTIVE servers, keyed by the canonical
 * `mcp_{sanitizeName(server)}_{sanitizeName(tool)}` name.
 *
 * The TOOLBOX is now the sole tool-grant primitive (see toolset-resolver.ts):
 * there is no per-Agent MCP access gate. MCP servers live globally in
 * `mcp_servers` with their own credentials; a toolbox references an MCP tool by
 * its stable name, and the unified resolver intersects that against this
 * universe. Server-level approval status (`status === 'active'`) still applies —
 * `pending_approval` servers contribute nothing.
 *
 * The `agentId` parameter is retained only for logging/diagnostic symmetry with
 * the other source resolvers; it no longer filters the result.
 */
export async function resolveMCPTools(
  _agentId?: string,
): Promise<Record<string, Tool<any, any>>> {
  const servers = await db.select().from(mcpServers).all()

  const resolved: Record<string, Tool<any, any>> = {}

  for (const server of servers) {
    if (server.status !== 'active') continue
    const conn = await getConnection(server.id)
    if (!conn) continue

    for (const mcpTool of conn.tools) {
      const toolKey = `mcp_${sanitizeName(conn.serverName)}_${sanitizeName(mcpTool.name)}`

      resolved[toolKey] = aiTool({
        description: `[MCP: ${conn.serverName}] ${mcpTool.description}`,
        inputSchema: jsonSchemaToZod(mcpTool.inputSchema),
        execute: async (args) => {
          return callMCPTool(conn, mcpTool.name, args as Record<string, unknown>)
        },
      })
    }
  }

  return resolved
}


// ─── Call an MCP tool ────────────────────────────────────────────────────────

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

/** Extract text content from an MCP call result */
function extractMCPResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  if (result.content && Array.isArray(result.content)) {
    const texts = result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
    return texts.length === 1 ? texts[0] : texts.join('\n')
  }
  return result
}

async function callMCPTool(
  conn: MCPConnection,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    const result = await withTimeout(
      conn.client.callTool({ name: toolName, arguments: args }),
      MCP_CALL_TIMEOUT_MS,
      `MCP tool ${toolName}`,
    )
    return extractMCPResult(result)
  } catch (err) {
    // Connection may be dead, try to reconnect once
    log.warn({ toolName, serverName: conn.serverName, err }, 'MCP tool call failed, attempting reconnection')
    await disconnectServer(conn.serverId)

    try {
      const newConn = await connectToServer(conn.serverId)
      if (newConn) {
        const retryResult = await withTimeout(
          newConn.client.callTool({ name: toolName, arguments: args }),
          MCP_CALL_TIMEOUT_MS,
          `MCP tool ${toolName} (retry)`,
        )
        return extractMCPResult(retryResult)
      }
    } catch (retryErr) {
      log.error({ toolName, serverName: conn.serverName, retryErr }, 'MCP tool call retry also failed')
    }

    return { error: err instanceof Error ? err.message : 'MCP tool call failed' }
  }
}

// ─── JSON Schema → Zod (simplified conversion) ──────────────────────────────

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  // If there are properties, build an object schema
  if (schema.type === 'object' && schema.properties) {
    const props = schema.properties as Record<string, Record<string, unknown>>
    const required = (schema.required as string[]) ?? []
    const shape: Record<string, z.ZodType> = {}

    for (const [key, prop] of Object.entries(props)) {
      let field = jsonSchemaPropertyToZod(prop)
      if (!required.includes(key)) {
        field = field.optional() as any
      }
      shape[key] = field
    }

    return z.object(shape)
  }

  // Fallback: accept anything
  return z.object({}).passthrough()
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): z.ZodType {
  const desc = (prop.description as string) ?? undefined

  switch (prop.type) {
    case 'string':
      if (prop.enum) {
        return z.enum(prop.enum as [string, ...string[]]).describe(desc ?? '')
      }
      return desc ? z.string().describe(desc) : z.string()
    case 'number':
    case 'integer':
      return desc ? z.number().describe(desc) : z.number()
    case 'boolean':
      return desc ? z.boolean().describe(desc) : z.boolean()
    case 'array':
      if (prop.items) {
        return z.array(jsonSchemaPropertyToZod(prop.items as Record<string, unknown>))
      }
      return z.array(z.unknown())
    case 'object':
      return jsonSchemaToZod(prop)
    default:
      return z.unknown()
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeName(name: string): string {
  // First try: transliterate common accented chars, then strip non-ascii
  const transliterated = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
  const result = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')

  // Fallback: if result is empty (all non-Latin chars), use a hash of the original name
  if (result === '') {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
    }
    return `u${Math.abs(hash).toString(36)}`
  }

  return result
}
