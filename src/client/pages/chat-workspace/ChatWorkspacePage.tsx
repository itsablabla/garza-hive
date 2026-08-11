import { useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/client/components/ui/sidebar'
import { ChatWorkspaceSidebar } from '@/client/components/chat-workspace/ChatWorkspaceSidebar'
import { ChatWorkspacePane } from '@/client/components/chat-workspace/ChatWorkspacePane'
import { ConnectionBanner } from '@/client/components/common/ConnectionBanner'
import { useChatWorkspace } from '@/client/hooks/useChatWorkspace'
import { useAgents } from '@/client/hooks/useAgents'
import { useModels } from '@/client/hooks/useModels'
import { api } from '@/client/lib/api'

/** The Chat workspace ("/chat", "/chat/:sessionId") — an OpenWebUI-style
 *  multi-conversation interface powered by the user's Agents. Conversations
 *  run on the quick-session lane ('chat' kind: full capability profile,
 *  isolated context, no expiry) so the Agent's main timeline stays untouched. */
export function ChatWorkspacePage() {
  const navigate = useNavigate()
  const { sessionId } = useParams<{ sessionId: string }>()
  const {
    sessions,
    folders,
    isLoading,
    getSession,
    createSession,
    updateSession,
    deleteSession,
    createFolder,
    renameFolder,
    deleteFolder,
  } = useChatWorkspace()
  const { agents } = useAgents()
  const { llmModels } = useModels()

  const selectedSession = getSession(sessionId ?? null)

  // Deep link to a session that doesn't exist (deleted, wrong id) → new chat.
  useEffect(() => {
    if (sessionId && !isLoading && !selectedSession) {
      navigate('/chat', { replace: true })
    }
  }, [sessionId, isLoading, selectedSession, navigate])

  const handleStartChat = useCallback(
    async (agentId: string, content: string, fileIds?: string[]) => {
      const session = await createSession(agentId)
      if (!session) return
      try {
        await api.post(`/quick-sessions/${session.id}/messages`, { content, fileIds })
      } catch {
        // The pane surfaces send failures once mounted; still navigate so the
        // user lands in the (empty) conversation rather than losing it.
      }
      navigate(`/chat/${session.id}`)
    },
    [createSession, navigate],
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const ok = await deleteSession(id)
      if (ok && sessionId === id) navigate('/chat')
    },
    [deleteSession, sessionId, navigate],
  )

  return (
    <div className="h-full overflow-hidden" style={{ transform: 'translateZ(0)' }}>
      <SidebarProvider className="!min-h-0 !h-full">
        <ChatWorkspaceSidebar
          sessions={sessions}
          folders={folders}
          isLoading={isLoading}
          selectedSessionId={sessionId ?? null}
          onSelectSession={(id) => navigate(`/chat/${id}`)}
          onNewChat={() => navigate('/chat')}
          onRenameSession={(id, title) => void updateSession(id, { title })}
          onMoveSession={(id, folderId) => void updateSession(id, { folderId })}
          onPinSession={(id, pinned) => void updateSession(id, { pinned })}
          onDeleteSession={(id) => void handleDeleteSession(id)}
          onCreateFolder={(name) => void createFolder(name)}
          onRenameFolder={(id, name) => void renameFolder(id, name)}
          onDeleteFolder={(id) => void deleteFolder(id)}
        />

        <SidebarInset className="min-h-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-10 shrink-0 items-center border-b px-2">
              <SidebarTrigger />
            </div>
            <ConnectionBanner />
            <div className="min-h-0 flex-1">
              <ChatWorkspacePane
                key={sessionId ?? 'new'}
                session={selectedSession}
                agents={agents}
                llmModels={llmModels}
                onStartChat={handleStartChat}
                onRenameSession={(id, title) => void updateSession(id, { title })}
                onPinSession={(id, pinned) => void updateSession(id, { pinned })}
                onDeleteSession={(id) => void handleDeleteSession(id)}
              />
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
