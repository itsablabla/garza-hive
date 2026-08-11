/** The two top-level workspaces switchable from the AppTopBar brand corner:
 *  'hive' — everything that exists today (Agents, Projects, Tasks, …);
 *  'chat' — the OpenWebUI-style multi-conversation interface at /chat. */
export type Workspace = 'hive' | 'chat'

export const WORKSPACE_STORAGE_KEY = 'garzahive:workspace'

export function loadStoredWorkspace(): Workspace | null {
  const value = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  return value === 'hive' || value === 'chat' ? value : null
}

export function storeWorkspace(workspace: Workspace): void {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace)
}
