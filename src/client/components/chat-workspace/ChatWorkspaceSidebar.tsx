import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/client/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/client/components/ui/dropdown-menu'
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
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { FormDialog } from '@/client/components/common/FormDialog'
import { EmptyState } from '@/client/components/common/EmptyState'
import { ChatAvatar } from '@/client/components/chat/ChatAvatar'
import {
  MessageSquarePlus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Folder,
  FolderPlus,
  FolderInput,
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react'
import type { ChatSessionSummary, ChatFolder } from '@/shared/types'

interface ChatWorkspaceSidebarProps {
  sessions: ChatSessionSummary[]
  folders: ChatFolder[]
  isLoading: boolean
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewChat: () => void
  onRenameSession: (sessionId: string, title: string) => void
  onMoveSession: (sessionId: string, folderId: string | null) => void
  onPinSession: (sessionId: string, pinned: boolean) => void
  onDeleteSession: (sessionId: string) => void
  onCreateFolder: (name: string) => void
  onRenameFolder: (folderId: string, name: string) => void
  onDeleteFolder: (folderId: string) => void
}

interface DateGroup {
  key: string
  label: string
  items: ChatSessionSummary[]
}

/** OpenWebUI-style conversation sidebar: new chat, search, pinned, folders,
 *  then date-grouped conversations. Every action is reachable from a visible
 *  hover menu (never context-menu-only). */
export function ChatWorkspaceSidebar({
  sessions,
  folders,
  isLoading,
  selectedSessionId,
  onSelectSession,
  onNewChat,
  onRenameSession,
  onMoveSession,
  onPinSession,
  onDeleteSession,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: ChatWorkspaceSidebarProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  const [renameTarget, setRenameTarget] = useState<ChatSessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ChatSessionSummary | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderDialogTarget, setFolderDialogTarget] = useState<ChatFolder | null>(null)
  const [folderNameValue, setFolderNameValue] = useState('')
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<ChatFolder | null>(null)

  const query = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!query) return sessions
    return sessions.filter(
      (s) =>
        (s.title ?? '').toLowerCase().includes(query) ||
        s.agentName.toLowerCase().includes(query),
    )
  }, [sessions, query])

  // Grouping: pinned → per-folder → date buckets for the unfiled rest.
  const { pinned, byFolder, dateGroups } = useMemo(() => {
    const pinnedList: ChatSessionSummary[] = []
    const folderMap = new Map<string, ChatSessionSummary[]>()
    const unfiled: ChatSessionSummary[] = []

    for (const s of filtered) {
      if (s.pinned) {
        pinnedList.push(s)
      } else if (s.folderId && folders.some((f) => f.id === s.folderId)) {
        const list = folderMap.get(s.folderId) ?? []
        list.push(s)
        folderMap.set(s.folderId, list)
      } else {
        unfiled.push(s)
      }
    }

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const dayMs = 24 * 60 * 60 * 1000
    const startOfYesterday = startOfToday - dayMs
    const startOf7Days = startOfToday - 7 * dayMs
    const startOf30Days = startOfToday - 30 * dayMs

    const groups: DateGroup[] = [
      { key: 'today', label: t('chatWorkspace.groups.today'), items: [] },
      { key: 'yesterday', label: t('chatWorkspace.groups.yesterday'), items: [] },
      { key: 'week', label: t('chatWorkspace.groups.previous7Days'), items: [] },
      { key: 'month', label: t('chatWorkspace.groups.previous30Days'), items: [] },
      { key: 'older', label: t('chatWorkspace.groups.older'), items: [] },
    ]
    for (const s of unfiled) {
      const ts = s.updatedAt
      if (ts >= startOfToday) groups[0]!.items.push(s)
      else if (ts >= startOfYesterday) groups[1]!.items.push(s)
      else if (ts >= startOf7Days) groups[2]!.items.push(s)
      else if (ts >= startOf30Days) groups[3]!.items.push(s)
      else groups[4]!.items.push(s)
    }

    return {
      pinned: pinnedList,
      byFolder: folderMap,
      dateGroups: groups.filter((g) => g.items.length > 0),
    }
  }, [filtered, folders, t])

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const openRenameSession = (session: ChatSessionSummary) => {
    setRenameTarget(session)
    setRenameValue(session.title ?? '')
  }

  const openCreateFolder = () => {
    setFolderDialogTarget(null)
    setFolderNameValue('')
    setFolderDialogOpen(true)
  }

  const openRenameFolder = (folder: ChatFolder) => {
    setFolderDialogTarget(folder)
    setFolderNameValue(folder.name)
    setFolderDialogOpen(true)
  }

  const submitFolderDialog = () => {
    const name = folderNameValue.trim()
    if (!name) return
    if (folderDialogTarget) onRenameFolder(folderDialogTarget.id, name)
    else onCreateFolder(name)
    setFolderDialogOpen(false)
  }

  const renderSessionItem = (session: ChatSessionSummary) => (
    <SidebarMenuItem key={session.id}>
      <SidebarMenuButton
        onClick={() => onSelectSession(session.id)}
        isActive={session.id === selectedSessionId}
        title={session.title ?? undefined}
      >
        <ChatAvatar
          avatarUrl={session.agentAvatarUrl}
          name={session.agentName}
          className="size-5 shrink-0"
          fallbackClassName="bg-primary/10 text-primary text-[8px]"
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {session.title ?? t('chatWorkspace.untitled')}
        </span>
        {session.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={t('chatWorkspace.itemMenu')}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-48">
          <DropdownMenuItem onClick={() => openRenameSession(session)}>
            <Pencil className="size-4" />
            {t('chatWorkspace.actions.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPinSession(session.id, !session.pinned)}>
            {session.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {session.pinned ? t('chatWorkspace.actions.unpin') : t('chatWorkspace.actions.pin')}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="mr-2 size-4" />
              {t('chatWorkspace.actions.moveToFolder')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {session.folderId && (
                <DropdownMenuItem onClick={() => onMoveSession(session.id, null)}>
                  {t('chatWorkspace.actions.removeFromFolder')}
                </DropdownMenuItem>
              )}
              {folders
                .filter((f) => f.id !== session.folderId)
                .map((f) => (
                  <DropdownMenuItem key={f.id} onClick={() => onMoveSession(session.id, f.id)}>
                    <Folder className="size-4" />
                    <span className="truncate">{f.name}</span>
                  </DropdownMenuItem>
                ))}
              {folders.length === 0 && (
                <DropdownMenuItem onClick={openCreateFolder}>
                  <FolderPlus className="size-4" />
                  {t('chatWorkspace.actions.newFolder')}
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteTarget(session)}
          >
            <Trash2 className="size-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )

  return (
    <Sidebar className="surface-sidebar">
      <SidebarHeader className="gap-2">
        <Button onClick={onNewChat} className="w-full justify-start gap-2" variant="outline">
          <MessageSquarePlus className="size-4" />
          {t('chatWorkspace.newChat')}
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('chatWorkspace.searchPlaceholder')}
            className="pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {!isLoading && sessions.length === 0 ? (
          <div className="px-2 py-6">
            <EmptyState
              compact
              icon={MessageSquare}
              title={t('chatWorkspace.empty.title')}
              description={t('chatWorkspace.empty.description')}
              actionLabel={t('chatWorkspace.newChat')}
              onAction={onNewChat}
            />
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>{t('chatWorkspace.groups.pinned')}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>{pinned.map(renderSessionItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {folders.map((folder) => {
              const items = byFolder.get(folder.id) ?? []
              if (query && items.length === 0) return null
              const collapsed = collapsedFolders.has(folder.id)
              return (
                <SidebarGroup key={folder.id}>
                  <SidebarGroupLabel asChild>
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-1.5 pr-7 text-left"
                      onClick={() => toggleFolder(folder.id)}
                    >
                      {collapsed ? (
                        <ChevronRight className="size-3 shrink-0" />
                      ) : (
                        <ChevronDown className="size-3 shrink-0" />
                      )}
                      <Folder className="size-3 shrink-0" />
                      <span className="truncate">{folder.name}</span>
                      <span className="text-muted-foreground/60">{items.length}</span>
                    </button>
                  </SidebarGroupLabel>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarGroupAction aria-label={t('chatWorkspace.folderMenu')}>
                        <MoreHorizontal />
                      </SidebarGroupAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="right" className="w-44">
                      <DropdownMenuItem onClick={() => openRenameFolder(folder)}>
                        <Pencil className="size-4" />
                        {t('chatWorkspace.actions.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteFolderTarget(folder)}
                      >
                        <Trash2 className="size-4" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {!collapsed && (
                    <SidebarGroupContent>
                      {items.length > 0 ? (
                        <SidebarMenu>{items.map(renderSessionItem)}</SidebarMenu>
                      ) : (
                        <p className="px-2 py-1 text-xs text-muted-foreground/60">
                          {t('chatWorkspace.folderEmpty')}
                        </p>
                      )}
                    </SidebarGroupContent>
                  )}
                </SidebarGroup>
              )
            })}

            {dateGroups.map((group) => (
              <SidebarGroup key={group.key}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>{group.items.map(renderSessionItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}

            {query && filtered.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                {t('chatWorkspace.noResults')}
              </p>
            )}
          </>
        )}
      </SidebarContent>

      {/* Visible new-folder entry point */}
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={openCreateFolder}
        >
          <FolderPlus className="size-4" />
          {t('chatWorkspace.actions.newFolder')}
        </Button>
      </div>

      {/* Rename conversation */}
      <FormDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        title={t('chatWorkspace.renameDialog.title')}
        size="sm"
        onSubmit={() => {
          if (renameTarget && renameValue.trim()) {
            onRenameSession(renameTarget.id, renameValue.trim())
          }
          setRenameTarget(null)
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

      {/* Create / rename folder */}
      <FormDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        title={
          folderDialogTarget
            ? t('chatWorkspace.folderDialog.renameTitle')
            : t('chatWorkspace.folderDialog.createTitle')
        }
        size="sm"
        onSubmit={submitFolderDialog}
        submitDisabled={!folderNameValue.trim()}
        submitLabel={folderDialogTarget ? t('common.save') : t('common.create')}
      >
        <Input
          value={folderNameValue}
          onChange={(e) => setFolderNameValue(e.target.value)}
          placeholder={t('chatWorkspace.folderDialog.placeholder')}
          maxLength={100}
          autoFocus
        />
      </FormDialog>

      {/* Delete conversation confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
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
                if (deleteTarget) onDeleteSession(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete folder confirm */}
      <AlertDialog
        open={deleteFolderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteFolderTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chatWorkspace.deleteFolderDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('chatWorkspace.deleteFolderDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteFolderTarget) onDeleteFolder(deleteFolderTarget.id)
                setDeleteFolderTarget(null)
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  )
}
