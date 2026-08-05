import { memo } from 'react'
import { ToolCallCard } from '@/client/components/chat/ToolCallCard'
import type { ToolCallViewItem } from '@/client/hooks/useToolCalls'

interface ToolCallItemProps {
  toolCall: ToolCallViewItem
  agentId?: string | null
}

/** Larger tool-call card (with timestamp) rendered in the tool-calls side panel. */
export const ToolCallItem = memo(function ToolCallItem({ toolCall, agentId }: ToolCallItemProps) {
  return <ToolCallCard toolCall={toolCall} agentId={agentId} variant="panel" />
})
