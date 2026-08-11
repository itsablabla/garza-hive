---
title: Chat workspace
description: An OpenWebUI-style multi-conversation interface powered by your Agents, with folders, pinning and search.
---

The **Chat workspace** is a freeform, multi-conversation interface — think OpenWebUI or the ChatGPT web app — where the "model selector" is replaced by your Agents. Switch to it from the **workspace switcher** in the top-left corner of the app (next to the logo): **Hive** is everything you know (Agents, Projects, Tasks, Crons, Files, Mini-Apps…), **Chat** is the conversation workspace at `/chat`. The app remembers the workspace you were in and lands you back there on your next visit.

## What a conversation is

Each conversation runs on the same isolated session lane as [quick chat](/docs/agents/overview/), but with a different policy:

- **Full power.** Unlike quick chat's minimal profile, a Chat-workspace conversation runs the Agent's **full capability profile** — full system prompt, memories, contacts and the complete toolset. It genuinely is "talking to the real bot".
- **Isolated context.** The conversation has its own context window. Nothing you say here lands in the Agent's main timeline, and the Agent's ongoing work is not interrupted.
- **No expiry.** Quick sessions auto-close after 24 hours; Chat conversations never expire. You delete them when you're done (or keep them forever).
- **Unlimited.** There is no "one active session per Agent" limit — open as many concurrent conversations as you like, across any mix of Agents (up to a configurable cap, 500 by default).

A conversation is **bound to the Agent you picked when creating it**. The Agent selector on the new-chat screen chooses the bot for the *next* conversation; switching an existing conversation to another Agent is a planned follow-up.

## The interface

### Conversation sidebar

The left sidebar lists all your conversations across all Agents:

- **New chat** starts a fresh conversation (pick an Agent, type a message — the conversation is created on first send).
- **Search** filters by title or Agent name.
- **Pinned** conversations stay at the top.
- **Folders** group conversations. Create one from the button at the bottom of the sidebar, then move conversations in via each item's "⋯" menu. Deleting a folder keeps its conversations — they return to the main list.
- Everything else is grouped by date: Today, Yesterday, Previous 7 days, Previous 30 days, Older.

Each conversation row has a hover "⋯" menu: rename, pin/unpin, move to folder, delete. Deleting permanently removes the conversation and its messages.

### Conversation pane

The main pane is the familiar GarzaHive message stack — streaming tokens, reasoning blocks, tool-call cards, file attachments, a stop button — in a centered reading column. The composer includes the same per-session **model and thinking overrides** as quick chat: try another model in one conversation without touching the Agent's configuration.

### Auto-titles

New conversations are named automatically from the first exchange (a single cheap LLM call on the session's model), just like OpenWebUI. Rename anytime from the "⋯" menu. Disable with `CHAT_SESSION_AUTO_TITLE=false`.

## Quick chat vs. Chat workspace

Both run on the same engine (an isolated session lane). Use whichever fits the moment:

| | Quick chat (Hive workspace) | Chat workspace |
|---|---|---|
| Capability profile | Minimal (reduced prompt, no tasks/crons/inter-agent tools) | **Full** (complete prompt + toolset) |
| Lifetime | Auto-expires after 24h | Never expires; you delete it |
| Concurrency | 1 active per Agent | Unlimited conversations |
| Organization | — | Folders, pinning, search, rename |
| Where | Overlay next to an Agent's main chat | Its own workspace at `/chat` |

## Configuration

| Env var | Default | Description |
|---|---|---|
| `CHAT_SESSION_MAX_PER_USER` | `500` | Max conversations per user. |
| `CHAT_FOLDER_MAX_PER_USER` | `100` | Max folders per user. |
| `CHAT_SESSION_AUTO_TITLE` | `true` | Auto-name conversations from the first exchange. |
