---
title: SDK Reference
description: Complete GarzaHive mini-app SDK API reference.
---

The GarzaHive SDK (`garzahive-sdk.js`) is the low-level API that powers the React hooks. You can use it directly for non-React apps or advanced use cases.

## GarzaHive Global Object

After the SDK loads, the `GarzaHive` global is available.

### Lifecycle

```javascript
GarzaHive.ready()  // Signal that the app has finished loading
```

:::note
`ready()` is a method you call once your app is initialized, not a boolean property. The parent waits for this signal before showing the app.
:::

### App Info

```javascript
GarzaHive.app
// { id, name, slug, agentId, agentName, agentAvatarUrl, isFullPage, locale, user }

GarzaHive.agent       // { id, name, avatarUrl }
GarzaHive.user      // { id, name, pseudonym, locale, timezone, avatarUrl }
GarzaHive.locale    // string — current UI language code (e.g. 'en', 'fr')
GarzaHive.version   // string — SDK version
GarzaHive.isFullPage // boolean — whether the app is in full-page mode
```

### Theme

```javascript
GarzaHive.theme       // { mode: "light"|"dark", palette: string }
GarzaHive.on("theme-changed", ({ mode, palette }) => { ... })
```

### Events

Listen for parent events or emit your own:

```javascript
GarzaHive.on(eventName, callback)   // Listen for events from the parent
GarzaHive.emit(eventName, data?)    // Send events to the parent
```

**Built-in event names:**

| Event | Description |
|---|---|
| `theme-changed` | Theme mode or palette changed |
| `app-meta` | App metadata updated |
| `locale-changed` | UI language changed |
| `fullpage-changed` | Full-page mode toggled |
| `shared-data` | Data received from another mini-app |

## Storage

Persistent key-value storage (server-side, max 64KB per value, 500 keys per app).

```javascript
await GarzaHive.storage.get(key)      // → value | null
await GarzaHive.storage.set(key, value)  // JSON-serializable
await GarzaHive.storage.delete(key)   // → boolean (true if deleted)
await GarzaHive.storage.list()        // → [{ key, size }]
await GarzaHive.storage.clear()       // → number (keys cleared)
```

:::note
`list()` takes no arguments and returns objects with `key` and `size` (bytes), not just key strings.
:::

## Navigation & Display

```javascript
GarzaHive.navigate(path)          // Navigate the parent GarzaHive UI to a path
GarzaHive.fullpage(bool)          // Toggle full-page or side-panel mode
GarzaHive.setTitle(title)         // Dynamically update the panel header title
GarzaHive.setBadge(value)         // Set sidebar badge (number, string, or null to clear)
GarzaHive.resize(width?, height?) // Request panel resize (320-1200px width, 200-2000px height)
GarzaHive.openApp(slug)           // Open another mini-app from the same Agent by slug
```

## Messaging

```javascript
await GarzaHive.sendMessage(text, options?)
// Send a message to the Agent's conversation
// options: { silent?: boolean }
// Rate limited: 5 per 30s

await GarzaHive.conversation.history(limit?)
// Get recent messages (default 20, max 100)
// Returns: [{ id, role, content, createdAt, sourceType }]

await GarzaHive.conversation.send(text, options?)
// Alias of sendMessage
```

## Memory

```javascript
await GarzaHive.memory.search(query, limit?)
// Semantic search Agent memories (default 20, max 50)
// Returns: [{ id, content, category, subject, score, updatedAt }]

await GarzaHive.memory.store(content, { category?, subject? })
// Store a new memory
// category: "fact" | "preference" | "decision" | "knowledge" (default)
// Max 2000 chars
// Returns: { id, content, category, subject }
```

## Clipboard

```javascript
await GarzaHive.clipboard.write(text)  // Copy text to system clipboard (bypasses iframe restrictions)
await GarzaHive.clipboard.read()       // Read text from system clipboard (may require permission)
```

## Notifications

```javascript
await GarzaHive.notification(title, body?)  // → boolean
// Shows a browser notification via the parent window
```

## Toast & Dialogs

These are methods on the `GarzaHive` object directly:

```javascript
GarzaHive.toast("Saved!", "success")
// type: "info" (default) | "success" | "warning" | "error"

const ok = await GarzaHive.confirm("Delete this item?", {
  title: "Confirm",
  confirmText: "Delete",
  cancelText: "Cancel",
})
// Returns: boolean

const name = await GarzaHive.prompt("Enter your name", {
  title: "Input",
  placeholder: "John Doe",
  defaultValue: "",
  confirmText: "OK",
  cancelText: "Cancel",
})
// Returns: string | null
```

:::note
In the React layer (`@garzahive/react`), `toast`, `confirm`, and `prompt` are re-exported as standalone functions for convenience. Under the hood they call these same SDK methods.
:::

## Keyboard Shortcuts

```javascript
const unregister = GarzaHive.shortcut("ctrl+k", callback)
// Returns unregister function. Pass null callback to remove.
// Examples: "ctrl+k", "meta+shift+p", "escape"
```

## File Downloads

```javascript
await GarzaHive.download(filename, content, mimeType?)
// content: string, object (auto-JSON), Blob, or ArrayBuffer
// mimeType is auto-detected if omitted
```

## Inter-App Communication

```javascript
GarzaHive.share(targetSlug, data)
// Share JSON data with another mini-app and open it
// Note: this is synchronous (fire-and-forget)

GarzaHive.on("shared-data", ({ from, fromName, data, ts }) => { ... })
// Receive shared data from another app

await GarzaHive.apps.list()     // List all mini-apps from the same Agent
await GarzaHive.apps.get(appId) // Get details of a specific app
// Returns: { id, name, slug, description, icon, version }
```

## HTTP Proxy

Make external HTTP requests via GarzaHive's server (bypasses CORS). Rate limited: 60 req/min, 5MB max, 15s timeout.

```javascript
const res = await GarzaHive.http(url, options?)
const data = await GarzaHive.http.json(url)
const data = await GarzaHive.http.post(url, body)
```

## Backend API Client

Call routes defined in `_server.js`:

```javascript
const data = await GarzaHive.api.get("/path")         // GET → JSON
const data = await GarzaHive.api.post("/path", body)   // POST → JSON
const data = await GarzaHive.api.put("/path", body)     // PUT → JSON
const data = await GarzaHive.api.patch("/path", body)   // PATCH → JSON
const data = await GarzaHive.api.delete("/path")        // DELETE → JSON
const data = await GarzaHive.api.json("/path", headers?) // GET + JSON parse
const res = await GarzaHive.api("/path", opts?)          // Raw Response
```

## Platform API Client

Call GarzaHive's **own** REST API (the same endpoints the settings pages use) to build a mini-app that manages a platform resource (a contacts manager, a crons board, a projects dashboard) instead of sending the user into settings.

```javascript
const { contacts } = await GarzaHive.platform.get("/contacts")
await GarzaHive.platform.post("/contacts", { firstName: "Ada", lastName: "Lovelace" })
await GarzaHive.platform.patch("/contacts/" + id, { lastName: "King" })
await GarzaHive.platform.delete("/contacts/" + id)
const res = await GarzaHive.platform("/contacts", opts?)  // Raw Response
```

Same shorthands as `GarzaHive.api` (`get/post/put/patch/delete/json`), but proxied to `/api/<resource>` instead of your backend.

**Permissions.** Each call is gated by a `platform:<resource>:<read|write>` permission you declare in `app.json`; the user approves them in the app's permission banner. The resource is the first path segment, and a `write` grant implies `read`:

```json
{ "permissions": ["platform:contacts:read", "platform:contacts:write"] }
```

| Call | Needs |
|------|-------|
| `platform.get("/contacts")` | `platform:contacts:read` |
| `platform.post("/contacts", …)` | `platform:contacts:write` |
| `platform.delete("/crons/123")` | `platform:crons:write` |

Discover each resource's routes and payload shapes in [the API reference](https://github.com/itsablabla/garza-hive/blob/main/api.md). A few resources are never reachable through the gateway: `auth`, `vault` (secret values), `database`, `users`, and `mini-apps` (so an app can't grant itself permissions).

:::caution
The platform API runs with **your** privileges. Only install mini-apps you trust with the resources they request, and review the permission banner before approving. (Mini-app iframes run at an opaque origin with a scoped token, so they can only reach their own namespace and the resources you grant, but a self-hosted instance still runs the app code you install.)
:::

## Server-Sent Events

Subscribe to real-time events from the backend (`_server.js` using `ctx.events.emit()`).

```javascript
GarzaHive.events.on("eventName", (data) => { ... })
GarzaHive.events.subscribe((event) => { ... })  // all events — { event, data }
GarzaHive.events.send("eventName", data)        // → backend onClientEvent(); resolves { handled, result }
GarzaHive.events.close()
GarzaHive.events.connected  // boolean
```

## CSS Design System

A design system CSS is auto-injected into every mini-app.

### CSS Variables

```css
/* Core */
var(--color-primary)
var(--color-background)
var(--color-foreground)
var(--color-muted)
var(--color-card)
var(--color-border)

/* Semantic */
var(--color-secondary)
var(--color-accent)
var(--color-destructive)
var(--color-success)
var(--color-warning)
var(--color-info)

/* Charts */
var(--color-chart-1) through var(--color-chart-5)

/* Gradients & effects */
var(--color-gradient-start)
var(--color-gradient-mid)
var(--color-gradient-end)
var(--color-glow-1) through var(--color-glow-3)
var(--color-glass-bg)
var(--color-glass-strong-bg)

/* Typography */
var(--font-sans)
var(--font-mono)

/* Radius */
var(--radius-sm) through var(--radius-full)

/* Shadows */
var(--shadow-xs) through var(--shadow-xl)
```

### Utility Classes

**Layout (Tailwind-like):** `.flex`, `.flex-col`, `.grid`, `.grid-cols-2`, `.items-center`, `.justify-between`, `.gap-4`, `.p-4`, `.m-4`, `.w-full`, `.max-w-md`, `.space-y-4`, `.overflow-auto`.

**Typography:** `.text-sm`, `.text-xl`, `.font-bold`, `.text-center`.

**Appearance:** `.bg-card`, `.bg-muted`, `.border`, `.rounded-lg`, `.shadow-md`.

**Components:** `.btn`, `.btn-primary`, `.card`, `.input`, `.badge`, `.table`, `.spinner`.

**Glass/Effects:** `.glass-strong`, `.surface-card`, `.gradient-primary`, `.btn-shine`, `.card-hover`.

### Responsive Utilities

Breakpoints: `sm` (≥640px), `md` (≥768px), `lg` (≥1024px), `xl` (≥1280px).

Prefix any utility: `md:grid-cols-2`, `lg:hidden`, `sm:flex-row`.

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

### Animations

`.animate-fade-in`, `.animate-fade-in-up`, `.animate-slide-in-left`, `.animate-scale-in`, `.animate-bounce-in`, `.animate-shake`, `.animate-spin`, `.animate-wiggle`, `.animate-levitate`.

Modifiers: `.delay-1` to `.delay-10`, `.duration-75` / `.duration-1000`.

Transitions: `.transition-all`, `.transition-colors`, `.ease-bounce`, `.ease-spring`.

All animations respect `prefers-reduced-motion`.

## TypeScript Definitions

Full type definitions are available at:

- `/api/mini-apps/sdk/garzahive-sdk.d.ts`
- `/api/mini-apps/sdk/garzahive-react.d.ts`
- `/api/mini-apps/sdk/garzahive-components.d.ts`
