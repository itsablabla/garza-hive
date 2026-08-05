import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { toolRegistry } from '@/server/tools/index'
import { partitionToolCalls, executeSingleTool, describeUnavailableTool, type ToolCall } from '@/server/services/tool-executor'
import type { ToolRegistration } from '@/server/tools/types'
import type { Tool } from '@/server/tools/tool-helper'

const fakeTool = (overrides: Partial<ToolRegistration> = {}): ToolRegistration => ({
  availability: ['main', 'sub-agent'],
  create: () => ({ description: '', inputSchema: undefined as any, execute: async () => null } as unknown as Tool<any, any>),
  ...overrides,
})

const NAMES = {
  read1: '__partition_test_read_1__',
  read2: '__partition_test_read_2__',
  read3: '__partition_test_read_3__',
  write: '__partition_test_write__',
  ambiguous: '__partition_test_ambiguous__',
}

const call = (name: string, id: string): ToolCall => ({ id, name, args: {}, offset: 0 })

describe('partitionToolCalls', () => {
  beforeAll(() => {
    toolRegistry.register(NAMES.read1, fakeTool({ readOnly: true, concurrencySafe: true }), 'system')
    toolRegistry.register(NAMES.read2, fakeTool({ readOnly: true, concurrencySafe: true }), 'system')
    toolRegistry.register(NAMES.read3, fakeTool({ readOnly: true, concurrencySafe: true }), 'system')
    toolRegistry.register(NAMES.write, fakeTool({}), 'system') // conservative default: write/unsafe
    toolRegistry.register(NAMES.ambiguous, fakeTool({ readOnly: true }), 'system') // readOnly but not concurrencySafe
  })

  afterAll(() => {
    for (const n of Object.values(NAMES)) toolRegistry.unregister(n)
  })

  it('fuses three consecutive read-only tools into one parallel batch', () => {
    const batches = partitionToolCalls([
      call(NAMES.read1, 'a'),
      call(NAMES.read2, 'b'),
      call(NAMES.read3, 'c'),
    ])
    expect(batches).toHaveLength(1)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(batches[0]!.calls.map(c => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('isolates a single write into its own serial batch', () => {
    const batches = partitionToolCalls([call(NAMES.write, 'w')])
    expect(batches).toHaveLength(1)
    expect(batches[0]!.isConcurrencySafe).toBe(false)
    expect(batches[0]!.calls).toHaveLength(1)
  })

  it('splits [read, read, write, read, write] into four batches', () => {
    const batches = partitionToolCalls([
      call(NAMES.read1, '1'),
      call(NAMES.read2, '2'),
      call(NAMES.write, '3'),
      call(NAMES.read1, '4'),
      call(NAMES.write, '5'),
    ])
    expect(batches).toHaveLength(4)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(batches[0]!.calls.map(c => c.id)).toEqual(['1', '2'])
    expect(batches[1]!.isConcurrencySafe).toBe(false)
    expect(batches[1]!.calls.map(c => c.id)).toEqual(['3'])
    expect(batches[2]!.isConcurrencySafe).toBe(true)
    expect(batches[2]!.calls.map(c => c.id)).toEqual(['4'])
    expect(batches[3]!.isConcurrencySafe).toBe(false)
    expect(batches[3]!.calls.map(c => c.id)).toEqual(['5'])
  })

  it('treats unknown tools as conservative (serial, isolated)', () => {
    const batches = partitionToolCalls([
      call(NAMES.read1, 'a'),
      call('__unregistered_tool_name__', 'b'),
      call(NAMES.read2, 'c'),
    ])
    expect(batches).toHaveLength(3)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(batches[1]!.isConcurrencySafe).toBe(false)
    expect(batches[2]!.isConcurrencySafe).toBe(true)
  })

  it('treats readOnly-without-concurrencySafe as serial (conservative)', () => {
    const batches = partitionToolCalls([
      call(NAMES.read1, 'a'),
      call(NAMES.ambiguous, 'b'),
      call(NAMES.read2, 'c'),
    ])
    expect(batches).toHaveLength(3)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(batches[1]!.isConcurrencySafe).toBe(false)
    expect(batches[2]!.isConcurrencySafe).toBe(true)
  })

  it('returns an empty array for no calls', () => {
    expect(partitionToolCalls([])).toEqual([])
  })
})

// ── Path-overlap-aware batching (port of Hermes Agent's segment planner) ──────
// Uses the REAL path-scoped tools (read_file, write_file, edit_file, multi_edit,
// grep, list_directory) registered in the tool registry — not fakes — so the
// path-extraction + overlap logic exercises the production code paths.
describe('partitionToolCalls — path-overlap awareness', () => {
  const read = (id: string, path: string): ToolCall => ({ id, name: 'read_file', args: { path }, offset: 0 })
  const write = (id: string, path: string): ToolCall => ({ id, name: 'write_file', args: { path }, offset: 0 })
  const edit = (id: string, path: string): ToolCall => ({ id, name: 'edit_file', args: { path }, offset: 0 })
  const multiEdit = (id: string, path: string): ToolCall => ({ id, name: 'multi_edit', args: { path, edits: [] }, offset: 0 })
  const grep = (id: string, path: string): ToolCall => ({ id, name: 'grep', args: { pattern: 'x', path }, offset: 0 })

  const ids = (b: { calls: ToolCall[] }[]) => b.map(batch => batch.calls.map(c => c.id))
  const kinds = (b: { isConcurrencySafe: boolean }[]) => b.map(batch => batch.isConcurrencySafe)

  it('parallelizes two reads of the same path (reader↔reader commute)', () => {
    const batches = partitionToolCalls([read('a', 'src/x.ts'), read('b', 'src/x.ts')])
    expect(batches).toHaveLength(1)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(ids(batches)[0]).toEqual(['a', 'b'])
  })

  it('parallelizes independent-path writers (the boolean flag forced serial)', () => {
    const batches = partitionToolCalls([write('a', 'src/x.ts'), write('b', 'docs/y.md')])
    expect(batches).toHaveLength(1)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(ids(batches)[0]).toEqual(['a', 'b'])
  })

  it('parallelizes a read of A with a write to independent B', () => {
    const batches = partitionToolCalls([read('a', 'src/x.ts'), write('b', 'docs/y.md')])
    expect(batches).toHaveLength(1)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(ids(batches)[0]).toEqual(['a', 'b'])
  })

  it('splits a same-path write→read into ordered batches (prevents the write→read race)', () => {
    const batches = partitionToolCalls([write('w', 'src/x.ts'), read('r', 'src/x.ts')])
    expect(batches).toHaveLength(2)
    // Writer runs first (its own batch), reader after — never the reverse.
    expect(ids(batches)).toEqual([['w'], ['r']])
  })

  it('splits a read→write on the same path (reader cannot observe pre-mutation state)', () => {
    const batches = partitionToolCalls([read('r', 'src/x.ts'), write('w', 'src/x.ts')])
    expect(batches).toHaveLength(2)
    expect(ids(batches)).toEqual([['r'], ['w']])
  })

  it('orders a subtree search behind a write into that subtree', () => {
    // grep reserves its search root as a reader; a write into a file under that
    // root conflicts (subtree containment), so the write closes the run.
    const batches = partitionToolCalls([grep('g', 'src'), write('w', 'src/x.ts')])
    expect(batches).toHaveLength(2)
    expect(ids(batches)).toEqual([['g'], ['w']])
  })

  it('parallelizes a directory search with a write outside that subtree', () => {
    const batches = partitionToolCalls([grep('g', 'src'), write('w', 'docs/y.md')])
    expect(batches).toHaveLength(1)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(ids(batches)[0]).toEqual(['g', 'w'])
  })

  it('preserves emission order across a mixed batch with a conflict', () => {
    // read A, read B, write A (conflicts with read A → closes run), read A again.
    const batches = partitionToolCalls([
      read('1', 'a.ts'),
      read('2', 'b.ts'),
      write('3', 'a.ts'),
      read('4', 'a.ts'),
    ])
    // [1,2] parallel → [3] writer → [4] reader (after the write).
    expect(ids(batches)).toEqual([['1', '2'], ['3'], ['4']])
  })

  it('multi_edit is a writer and conflicts with a same-path read', () => {
    const batches = partitionToolCalls([multiEdit('m', 'a.ts'), read('r', 'a.ts')])
    expect(ids(batches)).toEqual([['m'], ['r']])
  })

  it('edit_file and write_file to the same path conflict (both writers)', () => {
    const batches = partitionToolCalls([edit('e', 'a.ts'), write('w', 'a.ts')])
    expect(ids(batches)).toEqual([['e'], ['w']])
  })

  it('a write with an unresolvable path falls back to serial (conservative)', () => {
    // write_file with no path arg → can't extract a scope path → not a parallel
    // candidate → isolated serial batch (matches the pre-path-overlap default).
    const noPathWrite: ToolCall = { id: 'w', name: 'write_file', args: {}, offset: 0 }
    const batches = partitionToolCalls([read('r', 'a.ts'), noPathWrite])
    expect(kinds(batches)).toEqual([true, false])
    expect(ids(batches)).toEqual([['r'], ['w']])
  })

  it('canonicalizes ., ./, and .. forms so equivalent paths overlap', () => {
    // grep "." or "./" is the workspace root — a write into src/x.ts must
    // conflict (subtree containment) and run after, not parallel.
    expect(ids(partitionToolCalls([grep('g', '.'), write('w', 'src/x.ts')]))).toEqual([['g'], ['w']])
    expect(ids(partitionToolCalls([grep('g', './'), write('w', 'src/x.ts')]))).toEqual([['g'], ['w']])
    // leading "./" is stripped, so "./src" and "src" overlap.
    expect(ids(partitionToolCalls([grep('g', './src'), write('w', 'src/x.ts')]))).toEqual([['g'], ['w']])
    // a/b/../c collapses to a/c, which overlaps a write to a/c/y.ts.
    expect(ids(partitionToolCalls([grep('g', 'a/b/../c'), write('w', 'a/c/y.ts')]))).toEqual([['g'], ['w']])
    // "./a/./b" canonicalizes to "a/b".
    expect(ids(partitionToolCalls([read('r', './a/./b.ts'), write('w', 'a/b.ts')]))).toEqual([['r'], ['w']])
  })
})

describe('describeUnavailableTool — blank-name anti-priming', () => {
  it('returns a terse data-not-a-call message for an empty name (no catalog)', () => {
    const msg = describeUnavailableTool('')
    expect(msg).toContain('Tool call rejected')
    expect(msg).toContain('data')
    // Must NOT dump the tool catalog — that feeds the priming loop.
    expect(msg).not.toContain('Available tools')
  })

  it('returns the terse message for a whitespace-only name', () => {
    const msg = describeUnavailableTool('   ')
    expect(msg).toContain('Tool call rejected')
    expect(msg).not.toContain('Available tools')
  })

  it('still gives a nonempty typo the catalog-style guidance', () => {
    const msg = describeUnavailableTool('read_fil')
    // A real (nonempty) typo keeps the "No tool named" guidance.
    expect(msg).toContain('No tool named')
  })
})

describe('executeSingleTool — unavailable tool classification', () => {
  // The `tools` map passed in is the already-resolved (granted-only) toolset.
  // A name absent from it must produce a clear, classified message — never the
  // old cryptic "has no execute function".
  const NATIVE_NAME = '__exec_test_native__'
  const emptyTools: Record<string, Tool<any, any>> = {}
  const run = (name: string) =>
    executeSingleTool({ id: 'x', name, args: {}, offset: 0 }, emptyTools, new AbortController())

  beforeAll(() => {
    // Register a native tool in the in-memory registry so getDomain() != null,
    // but deliberately keep it OUT of the empty `tools` map passed to
    // executeSingleTool (simulating a registered-but-not-granted tool).
    toolRegistry.register(NATIVE_NAME, fakeTool({ readOnly: true, concurrencySafe: true }), 'system')
  })

  afterAll(() => {
    toolRegistry.unregister(NATIVE_NAME)
  })

  it('reports an unknown made-up name as non-existent', async () => {
    const result = (await run('totally_made_up')) as { error: string }
    expect(result.error).toContain('No tool named')
    expect(result.error).not.toContain('has no execute function')
  })

  it('reports a custom_<slug> with no DB row as non-existent', async () => {
    // Random slug that will not exist in the DB → deterministic "No tool named".
    const slug = `nope_${Math.random().toString(36).slice(2)}`
    const result = (await run(`custom_${slug}`)) as { error: string }
    expect(result.error).toContain('No tool named')
    expect(result.error).not.toContain('has no execute function')
  })

  it('reports an MCP tool name as not in the current toolset', async () => {
    const result = (await run('mcp_someserver_dothing')) as { error: string }
    expect(result.error).toContain('MCP tool')
    expect(result.error).toContain('not in your current toolset')
  })

  it('reports a registered native tool absent from the toolset as exists-but-not-granted', async () => {
    // NATIVE_NAME is registered in the in-memory registry by this suite, but is
    // NOT present in the empty `tools` map passed to executeSingleTool.
    const result = (await run(NATIVE_NAME)) as { error: string }
    expect(result.error).toContain('exists but is not in your current toolset')
  })

  it('reports a granted tool with no execute as misconfigured (internal bug)', async () => {
    const broken = { description: '', inputSchema: undefined } as unknown as Tool<any, any>
    const result = (await executeSingleTool(
      { id: 'x', name: 'broken_tool', args: {}, offset: 0 },
      { broken_tool: broken },
      new AbortController(),
    )) as { error: string }
    expect(result.error).toContain('misconfigured')
    expect(result.error).toContain('internal bug')
  })
})

describe('executeSingleTool — abort race', () => {
  // A tool that NEVER settles and ignores its abortSignal — simulates a stuck
  // or genuinely long-running tool that doesn't honour cancellation.
  const hangingTool = (): Tool<any, any> =>
    ({ description: '', inputSchema: undefined as any, execute: () => new Promise(() => {}) } as unknown as Tool<any, any>)

  it('unwinds with an abort error when the signal fires mid-execution, even if the tool ignores it', async () => {
    const controller = new AbortController()
    const start = Date.now()
    const p = executeSingleTool({ id: 'x', name: 'hang', args: {}, offset: 0 }, { hang: hangingTool() }, controller)
    setTimeout(() => controller.abort(), 100)
    const result = (await p) as { error: string }
    expect(result.error).toContain('aborted')
    expect(Date.now() - start).toBeLessThan(3000)
  })

  it('returns an abort error immediately when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = (await executeSingleTool(
      { id: 'x', name: 'hang', args: {}, offset: 0 },
      { hang: hangingTool() },
      controller,
    )) as { error: string }
    expect(result.error).toContain('aborted')
  })
})
