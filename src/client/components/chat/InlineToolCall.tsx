import { memo } from 'react'
import { ToolCallCard } from '@/client/components/chat/ToolCallCard'
import type { ToolCallViewItem } from '@/client/hooks/useToolCalls'

// Re-exported so the existing unit test (`InlineToolCall.test.ts`) keeps importing
// from this path. The implementation now lives in the shared `ToolCallCard`.
export { normalizeToolCallArgs } from '@/client/components/chat/ToolCallCard'

interface InlineToolCallProps {
  toolCall: ToolCallViewItem
  /** Agent id for lazy-loading full tool I/O when the list DTO was slimmed. */
  agentId?: string | null
}

/** Compact tool-call card rendered inline within a message bubble. */
export const InlineToolCall = memo(function InlineToolCall({ toolCall, agentId }: InlineToolCallProps) {
  return <ToolCallCard toolCall={toolCall} agentId={agentId} variant="inline" />
})
