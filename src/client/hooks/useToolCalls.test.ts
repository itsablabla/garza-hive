import { describe, it, expect } from 'bun:test'
import { extractToolCallsFromMessages } from './useToolCalls'
import type { ChatMessage } from './useChat'

describe('extractToolCallsFromMessages', () => {
  it('ignores non-array toolCalls without throwing (regression: "{} is not iterable")', () => {
    // A corrupted/compacted row stored as a non-array object must not crash the
    // chat render. This is the exact shape that triggered the prod UI crash.
    const messages = [
      {
        id: 'm-bad',
        role: 'assistant',
        toolCalls: { _compacted: true, toolNames: ['run_shell'] },
      },
      {
        id: 'm-good',
        role: 'assistant',
        toolCalls: [
          { id: 't1', name: 'run_shell', args: {}, result: { success: true } },
        ],
      },
    ] as unknown as ChatMessage[]

    const out = extractToolCallsFromMessages(messages)
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('t1')
    expect(out[0]!.messageId).toBe('m-good')
  })

  it('skips non-assistant messages and messages without toolCalls', () => {
    const messages = [
      { id: 'u1', role: 'user', toolCalls: [{ id: 'x', name: 'run_shell', args: {}, result: {} }] },
      { id: 'a1', role: 'assistant', toolCalls: undefined },
    ] as unknown as ChatMessage[]

    expect(extractToolCallsFromMessages(messages)).toEqual([])
  })

  it('maps fields through from valid tool-call entries', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 42,
        toolCalls: [
          { id: 't1', name: 'run_shell', args: { cmd: 'ls' }, result: { success: true }, offset: 3 },
          { id: 't2', name: 'read_file', args: { path: '/x' }, result: { error: 'missing' }, offset: 5, truncated: true },
        ],
      },
    ] as unknown as ChatMessage[]

    const out = extractToolCallsFromMessages(messages)
    expect(out).toHaveLength(2)
    expect(out[0]!.status).toBe('success')
    expect(out[0]!.offset).toBe(3)
    expect(out[1]!.status).toBe('error')
    expect(out[1]!.truncated).toBe(true)
  })
})
