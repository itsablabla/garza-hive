/**
 * LLM provider types — re-exports from the SDK. Single source of truth in
 * `packages/sdk/src/index.ts`.
 */
export { THINKING_EFFORT_ORDER, downgradeEffort } from '@garzahive/sdk'
export type {
  ThinkingEffort,
  LLMModel,
  GarzaHiveTool,
  GarzaHiveRole,
  TextBlock,
  ImageBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  GarzaHiveMessageBlock,
  GarzaHiveMessage,
  SystemPrompt,
  ChatRequest,
  ChatChunk,
  LLMProvider,
} from '@garzahive/sdk'
