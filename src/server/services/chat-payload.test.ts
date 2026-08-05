import { describe, it, expect } from 'bun:test'
import {
  buildChatMessagePayload,
  previewJsonValue,
  slimReasoning,
  slimToolCalls,
  CHAT_REASONING_PREVIEW_CHARS,
  CHAT_TOOL_FIELD_PREVIEW_CHARS,
} from '@/server/services/chat-payload'

describe('previewJsonValue', () => {
  it('passes through short values', () => {
    expect(previewJsonValue('hi', 10)).toEqual({ value: 'hi', truncated: false })
    expect(previewJsonValue({ a: 1 }, 50)).toEqual({ value: { a: 1 }, truncated: false })
  })

  it('truncates long strings', () => {
    const long = 'x'.repeat(100)
    const out = previewJsonValue(long, 20)
    expect(out.truncated).toBe(true)
    expect(String(out.value)).toContain('[+80]')
  })
})

describe('slimToolCalls', () => {
  it('returns null for empty input', () => {
    expect(slimToolCalls(null).toolCalls).toBeNull()
    expect(slimToolCalls([]).toolCalls).toBeNull()
  })

  it('keeps small tool calls intact', () => {
    const raw = [{ id: '1', name: 'run_shell', args: { command: 'ls' }, result: { success: true, exitCode: 0 } }]
    const { toolCalls, truncated } = slimToolCalls(raw)
    expect(truncated).toBe(false)
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls![0]!.name).toBe('run_shell')
    expect(toolCalls![0]!.status).toBe('success')
    expect(toolCalls![0]!.truncated).toBeUndefined()
  })

  it('truncates huge results and marks entry', () => {
    const raw = [{
      id: 't1',
      name: 'run_shell',
      args: { command: 'cat big' },
      result: 'Z'.repeat(CHAT_TOOL_FIELD_PREVIEW_CHARS + 500),
    }]
    const { toolCalls, truncated } = slimToolCalls(raw)
    expect(truncated).toBe(true)
    expect(toolCalls![0]!.truncated).toBe(true)
    expect(String(toolCalls![0]!.result).length).toBeLessThan(CHAT_TOOL_FIELD_PREVIEW_CHARS + 40)
    expect(toolCalls![0]!.status).toBe('success')
  })

  it('marks error status from result.error', () => {
    const { toolCalls } = slimToolCalls([{ id: 'e', name: 'x', args: {}, result: { error: 'nope' } }])
    expect(toolCalls![0]!.status).toBe('error')
  })
})

describe('slimReasoning', () => {
  it('caps long plain strings', () => {
    const text = 'r'.repeat(CHAT_REASONING_PREVIEW_CHARS + 200)
    const { reasoning, truncated } = slimReasoning(text)
    expect(truncated).toBe(true)
    expect(String(reasoning).length).toBeLessThan(CHAT_REASONING_PREVIEW_CHARS + 40)
  })

  it('caps segment arrays by total budget', () => {
    const segs = [
      { offset: 0, text: 'a'.repeat(500) },
      { offset: 10, text: 'b'.repeat(500) },
      { offset: 20, text: 'c'.repeat(500) },
    ]
    const { reasoning, truncated } = slimReasoning(segs)
    expect(truncated).toBe(true)
    expect(Array.isArray(reasoning)).toBe(true)
    const total = (reasoning as Array<{ text: string }>).reduce((n, s) => n + s.text.replace(/…\[\+\d+\]$/, '').length, 0)
    // Budget is exhausted across segments
    expect(total).toBeLessThanOrEqual(CHAT_REASONING_PREVIEW_CHARS + 20)
  })
})

describe('buildChatMessagePayload', () => {
  it('slims by default and returns full when requested', () => {
    const tools = JSON.stringify([{
      id: '1',
      name: 'run_shell',
      args: { command: 'x' },
      result: 'Y'.repeat(2000),
    }])
    const reasoning = JSON.stringify([{ offset: 0, text: 'think '.repeat(500) }])

    const slim = buildChatMessagePayload(tools, reasoning)
    expect(slim.detailsTruncated).toBe(true)
    expect(slim.toolCalls![0]!.truncated).toBe(true)

    const full = buildChatMessagePayload(tools, reasoning, { full: true })
    expect(full.detailsTruncated).toBe(false)
    expect(String(full.toolCalls![0]!.result).length).toBe(2000)
  })
})
