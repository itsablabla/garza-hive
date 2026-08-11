import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { api } from '@/client/lib/api'
import { useSSE } from '@/client/hooks/useSSE'
import type { ChatSessionSummary, ChatFolder } from '@/shared/types'

/**
 * Chat-workspace state: the user's cross-Agent conversation list + folders,
 * kept in sync via the `chat-session:*` / `chat-folder:*` SSE lifecycle
 * events (user-scoped, so multi-tab updates work without refetching).
 *
 * Layered on the same session lane as `useQuickChat` — the conversation pane
 * itself reuses that hook; this one only owns the sidebar data.
 */
export function useChatWorkspace() {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [folders, setFolders] = useState<ChatFolder[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    try {
      const [sessionsData, foldersData] = await Promise.all([
        api.get<{ sessions: ChatSessionSummary[] }>('/chat-sessions?limit=500'),
        api.get<{ folders: ChatFolder[] }>('/chat-folders'),
      ])
      setSessions(sessionsData.sessions)
      setFolders(foldersData.folders)
    } catch {
      toast.error(t('chatWorkspace.errors.fetchFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // ── SSE lifecycle sync (user-scoped events) ────────────────────────────────
  useSSE({
    'chat-session:created': (data) => {
      const session = data.session as ChatSessionSummary
      setSessions((prev) => (prev.some((s) => s.id === session.id) ? prev : [session, ...prev]))
    },
    'chat-session:updated': (data) => {
      const session = data.session as ChatSessionSummary
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === session.id)
        return exists ? prev.map((s) => (s.id === session.id ? session : s)) : [session, ...prev]
      })
    },
    'chat-session:deleted': (data) => {
      const sessionId = data.sessionId as string
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    },
    'chat-folder:created': (data) => {
      const folder = data.folder as ChatFolder
      setFolders((prev) => (prev.some((f) => f.id === folder.id) ? prev : [...prev, folder]))
    },
    'chat-folder:updated': (data) => {
      const folder = data.folder as ChatFolder
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? folder : f)))
    },
    'chat-folder:deleted': (data) => {
      const folderId = data.folderId as string
      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      setSessions((prev) => prev.map((s) => (s.folderId === folderId ? { ...s, folderId: null } : s)))
    },
  })

  // ── Session CRUD ───────────────────────────────────────────────────────────

  const createSession = useCallback(async (agentId: string): Promise<ChatSessionSummary | null> => {
    try {
      const data = await api.post<{ session: ChatSessionSummary }>('/chat-sessions', { agentId })
      // SSE also delivers chat-session:created; the guard in the handler dedupes.
      setSessions((prev) => (prev.some((s) => s.id === data.session.id) ? prev : [data.session, ...prev]))
      return data.session
    } catch (err: unknown) {
      const apiErr = err as { code?: string } | undefined
      if (apiErr?.code === 'MAX_CHAT_SESSIONS') {
        toast.error(t('chatWorkspace.errors.maxSessions'))
      } else {
        toast.error(t('chatWorkspace.errors.createFailed'))
      }
      return null
    }
  }, [t])

  const updateSession = useCallback(async (
    sessionId: string,
    patch: { title?: string | null; folderId?: string | null; pinned?: boolean },
  ): Promise<boolean> => {
    // Optimistic update; SSE reconciles with the server state.
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...patch } as ChatSessionSummary : s)))
    try {
      await api.patch(`/quick-sessions/${sessionId}`, patch)
      return true
    } catch {
      toast.error(t('chatWorkspace.errors.updateFailed'))
      fetchAll()
      return false
    }
  }, [t, fetchAll])

  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      await api.delete(`/quick-sessions/${sessionId}`)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      return true
    } catch {
      toast.error(t('chatWorkspace.errors.deleteFailed'))
      return false
    }
  }, [t])

  // ── Folder CRUD ────────────────────────────────────────────────────────────

  const createFolder = useCallback(async (name: string): Promise<ChatFolder | null> => {
    try {
      const data = await api.post<{ folder: ChatFolder }>('/chat-folders', { name })
      setFolders((prev) => (prev.some((f) => f.id === data.folder.id) ? prev : [...prev, data.folder]))
      return data.folder
    } catch (err: unknown) {
      const apiErr = err as { code?: string } | undefined
      if (apiErr?.code === 'MAX_CHAT_FOLDERS') {
        toast.error(t('chatWorkspace.errors.maxFolders'))
      } else {
        toast.error(t('chatWorkspace.errors.folderCreateFailed'))
      }
      return null
    }
  }, [t])

  const renameFolder = useCallback(async (folderId: string, name: string): Promise<boolean> => {
    try {
      const data = await api.patch<{ folder: ChatFolder }>(`/chat-folders/${folderId}`, { name })
      setFolders((prev) => prev.map((f) => (f.id === folderId ? data.folder : f)))
      return true
    } catch {
      toast.error(t('chatWorkspace.errors.folderRenameFailed'))
      return false
    }
  }, [t])

  const deleteFolder = useCallback(async (folderId: string): Promise<boolean> => {
    try {
      await api.delete(`/chat-folders/${folderId}`)
      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      setSessions((prev) => prev.map((s) => (s.folderId === folderId ? { ...s, folderId: null } : s)))
      return true
    } catch {
      toast.error(t('chatWorkspace.errors.folderDeleteFailed'))
      return false
    }
  }, [t])

  const getSession = useCallback(
    (sessionId: string | null) => (sessionId ? sessions.find((s) => s.id === sessionId) ?? null : null),
    [sessions],
  )

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt),
    [folders],
  )

  return {
    sessions,
    folders: sortedFolders,
    isLoading,
    getSession,
    createSession,
    updateSession,
    deleteSession,
    createFolder,
    renameFolder,
    deleteFolder,
    refetch: fetchAll,
  }
}
