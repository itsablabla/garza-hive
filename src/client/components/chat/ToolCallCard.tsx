import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/client/components/ui/collapsible'
import { ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/client/lib/utils'
import { getToolDomainMeta } from '@/client/lib/tool-domain-lookup'
import { useCustomToolMeta } from '@/client/lib/custom-tool-names'
import { ToolDomainIcon } from '@/client/components/common/ToolDomainIcon'
import { JsonViewer } from '@/client/components/common/JsonViewer'
import { CustomToolRenderer } from '@/client/components/chat/CustomToolRenderer'
import { getRenderer, getPreviewRenderer } from '@/client/lib/tool-renderers'
import { getToolCallsDefaultOpen } from '@/client/lib/tool-call-prefs'
import { useMessageDetails } from '@/client/hooks/useMessageDetails'
import type { ToolCallEntry } from '@/shared/types'
import type { ToolCallViewItem, ToolCallStatus } from '@/client/hooks/useToolCalls'

/**
 * `pending`  — args still streaming / queued (muted spinner).
 * `running`  — execution started (primary spinner, visibly active).
 * `success`  — done, no error.
 * `error`    — done, errored.
 */
const STATUS_ICONS: Record<ToolCallStatus, typeof CheckCircle2> = {
  pending: Loader2,
  running: Loader2,
  success: CheckCircle2,
  error: XCircle,
}

const STATUS_CLASSES: Record<ToolCallStatus, string> = {
  pending: 'text-muted-foreground animate-spin',
  running: 'text-primary animate-spin',
  success: 'text-success',
  error: 'text-destructive',
}

export function normalizeToolCallArgs(args: unknown): Record<string, unknown> {
  return (args ?? {}) as Record<string, unknown>
}

type ToolCardVariant = 'inline' | 'panel'

interface ToolCallCardProps {
  toolCall: ToolCallViewItem
  /** Agent id for lazy-loading full tool I/O when the list DTO was slimmed. */
  agentId?: string | null
  variant: ToolCardVariant
}

const VARIANT = {
  inline: {
    chevron: 'size-3',
    iconWrap: 'flex size-5 items-center justify-center rounded',
    icon: 'size-3',
    name: 'text-xs',
    trigger: 'px-2.5 py-1.5',
    status: 'size-3',
    content: 'px-2.5 pb-2 space-y-1.5 pt-1.5',
    loader: 'size-3',
    showTime: false,
  },
  panel: {
    chevron: 'size-3.5',
    iconWrap: 'flex size-6 items-center justify-center rounded-md shrink-0',
    icon: 'size-3.5',
    name: 'text-sm',
    trigger: 'px-3 py-2',
    status: 'size-3.5',
    content: 'px-3 pb-2 space-y-2 pt-2',
    loader: 'size-3.5',
    showTime: true,
  },
} as const

/**
 * Unified tool-call card. Renders inline within a message bubble (`variant="inline"`,
 * compact, no timestamp) or in the tool-calls side panel (`variant="panel"`, larger,
 * with a timestamp). Previously two near-duplicate components (`InlineToolCall` and
 * `ToolCallItem`) — see git history for the retry-loop bug that had to be fixed twice
 * because of that duplication.
 *
 * Full args/result lazy-load from the shared message-details cache
 * (`useMessageDetails`), so expanding several cards in one message costs a single
 * `GET .../messages/:id/details` round-trip shared with that message's reasoning block.
 */
export const ToolCallCard = memo(function ToolCallCard({ toolCall, agentId, variant }: ToolCallCardProps) {
  const { t } = useTranslation()
  const v = VARIANT[variant]
  const [open, setOpen] = useState(getToolCallsDefaultOpen)
  const [fullArgs, setFullArgs] = useState<unknown>(toolCall.args)
  const [fullResult, setFullResult] = useState<unknown>(toolCall.result)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [resolved, setResolved] = useState(!toolCall.truncated)
  const resolvedIdRef = useRef<string | null>(toolCall.truncated ? null : toolCall.id)
  // Refs guard in-flight + already-attempted loads so a failed fetch can't
  // retry in a tight loop (state in the callback deps would churn identity and
  // re-fire the mount effect). attemptedRef resets on identity change / reopen.
  const loadingRef = useRef(false)
  const attemptedRef = useRef(false)

  const { ensureDetails, getCached } = useMessageDetails(agentId)

  // Only reset local full blobs when the tool call identity changes — not when
  // the parent re-supplies slim list props after a history refetch.
  useEffect(() => {
    if (resolvedIdRef.current === toolCall.id) return
    setFullArgs(toolCall.args)
    setFullResult(toolCall.result)
    setResolved(!toolCall.truncated)
    resolvedIdRef.current = toolCall.truncated ? null : toolCall.id
    attemptedRef.current = false
  }, [toolCall.id, toolCall.args, toolCall.result, toolCall.truncated])

  const loadDetails = useCallback(async () => {
    if (resolved || !toolCall.truncated || !agentId) return
    if (loadingRef.current || attemptedRef.current) return
    loadingRef.current = true
    attemptedRef.current = true
    setLoadingDetails(true)
    // Shared cache: if a sibling card or this message's reasoning block already
    // fetched /details, this resolves from cache with no network.
    const details = await ensureDetails(toolCall.messageId)
    const full = details?.toolCalls?.find((tc) => tc.id === toolCall.id) ?? null
    if (full) {
      setFullArgs(full.args)
      setFullResult(full.result)
      setResolved(true)
      resolvedIdRef.current = toolCall.id
    }
    setLoadingDetails(false)
    loadingRef.current = false
  }, [agentId, resolved, toolCall.truncated, toolCall.id, toolCall.messageId, ensureDetails])

  // Default-open (settings) never fires onOpenChange — load on mount when needed.
  useEffect(() => {
    if (open && toolCall.truncated && !resolved && !attemptedRef.current) {
      void loadDetails()
    }
  }, [open, toolCall.truncated, resolved, loadDetails])

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (next) {
      // Allow a manual retry after a previously failed auto-attempt.
      attemptedRef.current = false
      void loadDetails()
    }
  }, [loadDetails])

  const meta = getToolDomainMeta(toolCall.domain)
  const StatusIcon = STATUS_ICONS[toolCall.status]
  const statusClass = STATUS_CLASSES[toolCall.status]
  const isError = toolCall.status === 'error'

  const CustomRenderer = getRenderer(toolCall.name)
  const isCustomTool = toolCall.name.startsWith('custom_')
  const { name: customName } = useCustomToolMeta(toolCall.name)
  const customSlug = isCustomTool ? toolCall.name.slice('custom_'.length) : null
  const humanName = customName ?? t(`tools.names.${toolCall.name}`, { defaultValue: toolCall.name })
  const previewFn = getPreviewRenderer(toolCall.name)
  const args = normalizeToolCallArgs(fullArgs)
  // Renderers/preview fns predate the `running` status — map it to `pending`
  // (a spinner) so they keep type-checking and render sensibly for an in-flight call.
  const rendererStatus = toolCall.status === 'running' ? 'pending' : toolCall.status
  const preview = previewFn?.({ toolName: toolCall.name, args, status: rendererStatus })

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-lg border border-border bg-muted/50">
        <CollapsibleTrigger className={cn('flex w-full items-center gap-2 cursor-pointer text-left hover:bg-muted/80 transition-colors rounded-lg', v.trigger)}>
          <ChevronRight
            className={cn(
              'shrink-0 text-muted-foreground transition-transform duration-200',
              v.chevron,
              open && 'rotate-90',
            )}
          />
          <div className={cn(v.iconWrap, meta.bg)}>
            <ToolDomainIcon domain={toolCall.domain} className={cn('text-foreground', v.icon)} />
          </div>
          <span className={cn('flex-1 truncate font-medium text-muted-foreground', v.name)}>
            {humanName}
            {preview && (
              <span className="ml-1.5 text-xs text-muted-foreground/60 font-normal">· {preview}</span>
            )}
          </span>
          <StatusIcon className={cn('shrink-0', v.status, statusClass)} />
          {v.showTime && (
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              {new Date(toolCall.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className={cn('border-t border-border/30', v.content)}>
            {loadingDetails ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className={cn('animate-spin', v.loader)} />
                {t('common.loading', 'Loading…')}
              </div>
            ) : CustomRenderer ? (
              <CustomRenderer
                toolName={toolCall.name}
                args={args}
                result={fullResult}
                status={rendererStatus}
              />
            ) : customSlug ? (
              <CustomToolRenderer
                slug={customSlug}
                result={fullResult}
                args={args}
              />
            ) : (
              <>
                <JsonViewer
                  data={args}
                  label={t('tools.viewer.input')}
                  maxHeight="max-h-40"
                />

                {fullResult !== undefined && (
                  <JsonViewer
                    data={fullResult}
                    label={t('tools.viewer.output')}
                    labelClassName={isError ? 'text-destructive' : undefined}
                    maxHeight="max-h-60"
                    className={isError ? 'bg-destructive/5 border border-destructive/20' : undefined}
                  />
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
})
