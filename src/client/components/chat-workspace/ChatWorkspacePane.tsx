import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { ChatAvatar } from '@/client/components/chat/ChatAvatar'
import { MessageBubble } from '@/client/components/chat/MessageBubble'
import { MessageInput } from '@/client/components/chat/MessageInput'
import { TypingIndicator } from '@/client/components/chat/TypingIndicator'
import { AgentSelector } from '@/client/components/common/AgentSelector'
import { FormDialog } from '@/client/components/common/FormDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/client/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/client/components/ui/dropdown-menu'
import { useQuickChat } from '@/client/hooks/useQuickChat'
import { WorkspacePathProvider } from '@/client/contexts/WorkspacePathContext'
import { useToolCalls } from '@/client/hooks/useToolCalls'
import { useDraftMessage } from '@/client/hooks/useDraftMessage'
import { useFileUpload } from '@/client/hooks/useFileUpload'
import { useAgentTools } from '@/client/hooks/useAgentTools'
import { useAutoScroll } from '@/client/hooks/useAutoScroll'
import { useAuth } from '@/client/hooks/useAuth'
import { AgentToolsModal } from '@/client/components/agent/AgentToolsModal'
import { cn } from '@/client/lib/utils'
import { MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import type { AgentThinkingEffort, ChatSessionSummary } from '@/shared/types'

interface LLMModel {
  id: string
  name: string
  providerId: string
  providerName: string
  providerType: string
  capability: string
}

interface AgentInfo {
  id: string
  name: string
  role: string
  avatarUrl: string | null
  model: string
  thinkingEnabled: boolean
  thinkingEffort: AgentThinkingEffort | null
}

interface ChatWorkspacePaneProps {
  /** The open conversation, or null for the "new chat" hero state. */
  session: ChatSessionSummary | null
  agents: AgentInfo[]
  llmModels?: LLMModel[]
  /** New-chat mode: create the session and send the first message. */
  onStartChat: (agentId: string, content: string, fileIds?: string[]) => Promise<void>
  onRenameSession: (sessionId: string, title: string) => void
  onPinSession: (sessionId: string, pinned: boolean) => void
  onDeleteSession: (sessionId: string) => void
}

const LAST_AGENT_KEY = 'garzahive:chat-workspace:last-agent'

/** Main conversation pane of the Chat workspace. Reuses the quick-session
 *  message stack (useQuickChat + MessageBubble + MessageInput) with an
 *  OpenWebUI-style centered column. `'chat'` sessions run the full capability
 *  profile server-side; the Agent selector picks the bot for NEW chats only
 *  (a conversation stays bound to its Agent — switching is a v2 follow-up). */
export function ChatWorkspacePane({
  session,
  agents,
  llmModels,
  onStartChat,
  onRenameSession,
  onPinSession,
  onDeleteSession,
}: ChatWorkspacePaneProps) {
  const { t } = useTranslation()
  const { user } = useAuth()

  const sessionId = session?.id ?? null
  const boundAgent = session ? agents.find((a) => a.id === session.agentId) ?? null : null

  // New-chat agent selection (persisted so the workspace remembers your bot)
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => {
    const stored = localStorage.getItem(LAST_AGENT_KEY)
    return stored && agents.some((a) => a.id === stored) ? stored : ''
  })
  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      const stored = localStorage.getItem(LAST_AGENT_KEY)
      setSelectedAgentId(stored && agents.some((a) => a.id === stored) ? stored : agents[0]!.id)
    }
  }, [agents, selectedAgentId])

  const activeAgentId = session ? session.agentId : selectedAgentId || null
  const activeAgent = session
    ? boundAgent
    : agents.find((a) => a.id === selectedAgentId) ?? null
  const agentName = session ? session.agentName : activeAgent?.name ?? ''
  const agentAvatarUrl = session ? session.agentAvatarUrl : activeAgent?.avatarUrl ?? null

  const {
    messages,
    session: sessionDetail,
    streamingMessage,
    isProcessing,
    isStreaming,
    sendMessage,
    stopStreaming,
    updateSessionOverrides,
  } = useQuickChat(sessionId, session?.agentId ?? null)

  // Full toolset — 'chat' sessions run the full capability profile.
  const { tools, count: toolCount, refetch: refetchTools } = useAgentTools(activeAgentId)
  const [toolsModalOpen, setToolsModalOpen] = useState(false)
  const { toolCallsByMessage } = useToolCalls(session?.agentId ?? null, messages)
  const { content: draftContent, setContent: setDraftContent, clearDraft } = useDraftMessage(
    sessionId ? `chatws-${sessionId}` : 'chatws-new',
  )
  const { pendingFiles, addFiles, removeFile, clearFiles, isUploading } = useFileUpload(activeAgentId ?? '')
  const [isStarting, setIsStarting] = useState(false)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { autoScroll, toggleAutoScroll, containerRef: scrollContainerRef, bottomRef } = useAutoScroll([
    messages.length,
    streamingMessage,
    isStreaming,
    isProcessing,
  ])

  const handleSend = useCallback(
    async (content: string, fileIds?: string[]) => {
      if (session) {
        const optimisticFiles = pendingFiles
          .filter((f) => f.status === 'done' && f.serverId && f.serverUrl)
          .map((f) => ({
            id: f.serverId!,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size,
            url: f.serverUrl!,
          }))
        sendMessage(content, fileIds, optimisticFiles.length > 0 ? optimisticFiles : undefined)
        clearDraft()
        clearFiles()
        return
      }
      // New-chat mode: create the session then deliver the first message.
      if (!selectedAgentId || isStarting) return
      setIsStarting(true)
      try {
        localStorage.setItem(LAST_AGENT_KEY, selectedAgentId)
        await onStartChat(selectedAgentId, content, fileIds)
        clearDraft()
        clearFiles()
      } finally {
        setIsStarting(false)
      }
    },
    [session, sendMessage, clearDraft, clearFiles, pendingFiles, selectedAgentId, isStarting, onStartChat],
  )

  const composer = (
    <MessageInput
      value={draftContent}
      onChange={setDraftContent}
      onSend={(content, fileIds) => void handleSend(content, fileIds)}
      onStop={stopStreaming}
      isStreaming={isStreaming}
      disabled={!session && (!selectedAgentId || isStarting)}
      pendingFiles={pendingFiles}
      isUploading={isUploading}
      onAddFiles={addFiles}
      onRemoveFile={removeFile}
      agentId={activeAgentId ?? undefined}
      llmModels={session ? llmModels : undefined}
      model={sessionDetail?.model ?? activeAgent?.model}
      providerId={sessionDetail?.providerId ?? null}
      onModelChange={
        session
          ? (modelId, providerId) => void updateSessionOverrides({ model: modelId, providerId })
          : undefined
      }
      thinkingEnabled={sessionDetail?.thinkingEnabled ?? activeAgent?.thinkingEnabled ?? false}
      thinkingEffort={sessionDetail?.thinkingEffort ?? activeAgent?.thinkingEffort ?? null}
      onChangeThinking={
        session
          ? (next) => void updateSessionOverrides({ thinkingEnabled: next.enabled, thinkingEffort: next.effort })
          : undefined
      }
      toolCount={toolCount}
      onShowTools={() => {
        void refetchTools()
        setToolsModalOpen(true)
      }}
    />
  )

  // ── New-chat hero state ─────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <div className="w-full max-w-lg animate-fade-in text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              {activeAgent ? (
                <ChatAvatar
                  avatarUrl={activeAgent.avatarUrl}
                  name={activeAgent.name}
                  className="size-14"
                  fallbackClassName="bg-primary/10 text-primary text-lg"
                />
              ) : (
                <MessageSquare className="size-6 text-primary" />
              )}
            </div>
            <h2 className="text-lg font-semibold">{t('chatWorkspace.hero.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('chatWorkspace.hero.subtitle')}</p>
            <div className="mx-auto mt-5 max-w-xs text-left">
              <AgentSelector
                value={selectedAgentId}
                onValueChange={setSelectedAgentId}
                agents={agents}
                placeholder={t('chatWorkspace.hero.selectAgent')}
              />
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">{composer}</div>
      </div>
    )
  }

  // ── Existing conversation ───────────────────────────────────────────────────
  return (
    <WorkspacePathProvider agentId={session.agentId}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Header: bound Agent identity + session menu */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <ChatAvatar
              avatarUrl={agentAvatarUrl}
              name={agentName}
              className="size-8"
              fallbackClassName="bg-primary/10 text-primary text-xs"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">
                {session.title ?? t('chatWorkspace.untitled')}
              </p>
              <p className="truncate text-xs text-muted-foreground">{agentName}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('chatWorkspace.itemMenu')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => {
                  setRenameValue(session.title ?? '')
                  setRenameOpen(true)
                }}
              >
                <Pencil className="size-4" />
                {t('chatWorkspace.actions.rename')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onPinSession(session.id, !session.pinned)}>
                {session.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                {session.pinned ? t('chatWorkspace.actions.unpin') : t('chatWorkspace.actions.pin')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Messages */}
        <div className="relative min-h-0 flex-1 overflow-y-auto" ref={scrollContainerRef}>
          <div className="mx-auto w-full max-w-3xl p-4">
            {messages.length === 0 && !streamingMessage ? (
              <div className="flex flex-col items-center justify-center py-12 animate-fade-in">
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <MessageSquare className="size-5 text-primary" />
                </div>
                <p className="max-w-[240px] text-center text-xs text-muted-foreground">
                  {t('chatWorkspace.emptyConversation', { name: agentName })}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {messages.map((msg) => {
                  const isFromUser = msg.role === 'user' && msg.sourceType === 'user'
                  return (
                    <MessageBubble
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      sourceType={msg.sourceType}
                      files={msg.files}
                      avatarUrl={isFromUser ? user?.avatarUrl : agentAvatarUrl}
                      senderName={isFromUser ? (user?.pseudonym ?? user?.firstName) : agentName}
                      timestamp={msg.createdAt}
                      toolCalls={toolCallsByMessage.get(msg.id)}
                      injectedMemories={msg.injectedMemories}
                      stepLimitReached={msg.stepLimitReached}
                      emptyTurn={msg.emptyTurn}
                      finishReason={msg.finishReason}
                      silentStop={msg.silentStop}
                      tokenUsage={msg.tokenUsage}
                      reasoning={msg.reasoning ?? undefined}
                      detailsTruncated={msg.detailsTruncated}
                      agentId={session.agentId}
                      messageId={msg.id}
                    />
                  )
                })}
                {streamingMessage && (
                  <MessageBubble
                    key={streamingMessage.id}
                    role={streamingMessage.role}
                    content={streamingMessage.content}
                    sourceType={streamingMessage.sourceType}
                    avatarUrl={agentAvatarUrl}
                    senderName={agentName}
                    timestamp={streamingMessage.createdAt}
                    toolCalls={toolCallsByMessage.get(streamingMessage.id)}
                    agentId={session.agentId}
                    messageId={streamingMessage.id}
                  />
                )}
                {(isProcessing || isStreaming) && !streamingMessage && (
                  <TypingIndicator agentName={agentName} agentAvatarUrl={agentAvatarUrl} />
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <button
            onClick={toggleAutoScroll}
            className={cn(
              'absolute bottom-2 right-2 z-10 flex size-7 items-center justify-center rounded-full shadow-lg transition-colors',
              autoScroll
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
            title={autoScroll ? t('chat.autoScroll.on') : t('chat.autoScroll.off')}
          >
            {autoScroll ? <Pin className="size-3" /> : <PinOff className="size-3" />}
          </button>
        </div>

        {/* Composer */}
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">{composer}</div>

        {toolsModalOpen && activeAgentId && (
          <AgentToolsModal
            open={toolsModalOpen}
            onOpenChange={setToolsModalOpen}
            agentId={activeAgentId}
            agentName={agentName}
            tools={tools}
          />
        )}

        {/* Rename dialog */}
        <FormDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title={t('chatWorkspace.renameDialog.title')}
          size="sm"
          onSubmit={() => {
            if (renameValue.trim()) onRenameSession(session.id, renameValue.trim())
            setRenameOpen(false)
          }}
          submitDisabled={!renameValue.trim()}
          submitLabel={t('common.save')}
        >
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={t('chatWorkspace.renameDialog.placeholder')}
            maxLength={200}
            autoFocus
          />
        </FormDialog>

        {/* Delete confirm */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('chatWorkspace.deleteDialog.title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('chatWorkspace.deleteDialog.description')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  setDeleteOpen(false)
                  onDeleteSession(session.id)
                }}
              >
                {t('common.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </WorkspacePathProvider>
  )
}
