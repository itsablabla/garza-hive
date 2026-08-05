---
title: MCP, Model Context Protocol
description: "Connect external MCP servers to GarzaHive so their tools become callable by your Agents, with global scope, toolbox-based granting, and approval controls."
---

The Model Context Protocol (MCP) is an open standard for exposing tools to an LLM through a small server process. GarzaHive can act as an MCP **client**: you register external MCP servers, GarzaHive launches them, discovers the tools they expose, and makes those tools callable by your Agents alongside GarzaHive's own native tools.

This lets you bolt on capabilities GarzaHive does not ship with, a filesystem server, a database server, a third-party API wrapper, without writing a plugin, as long as the capability already exists as an MCP server.

## How the connection works

GarzaHive connects to MCP servers over **stdio**: it runs a local command, and talks to it over standard input and output. A registered server is defined by:

- **name**: a display name (also used to derive the tool prefix).
- **command**: the executable to run, for example `npx`, `node`, or `python`.
- **args**: an optional list of arguments passed to the command.
- **env**: optional environment variables for the process (merged on top of GarzaHive's own environment). This is where you put the server's API keys or paths. Env values are stored and never sent back to the frontend; the UI only shows which keys exist.

On first use GarzaHive spawns the process, performs the MCP handshake (with a 30-second connection timeout), and calls the server's `listTools` to learn what it offers. Connections are pooled and reused; one live connection per server. Individual tool calls have a 2-minute timeout, and if a call fails because the connection died, GarzaHive reconnects once and retries.

### Vault placeholders in MCP config

Command, args, and env may contain `{{secret:KEY}}` placeholders (same grammar as tool args). GarzaHive expands them **at connect time** from the Vault, fail-closed if a key is missing **or** if the secret's scope forbids MCP use. The stored row keeps the placeholder; only the spawned process sees the real value. Prefer placeholders over pasting raw tokens into env.

Vault scoping (same anti-exfiltration rules as tool calls):

- If a secret has **allowed tools**, it must include the synthetic id `mcp_server_connect` or MCP connect aborts.
- If a secret has **allowed hosts**, **every** `http(s)://…` URL in the server's command/args/env must match that allowlist (a decoy allowlisted URL cannot unlock an off-list MCP endpoint).
- Unrestricted secrets (no allow-lists) expand as usual.

### Remote (HTTP / SSE) MCP servers

There is no first-class remote transport in GarzaHive. Bridge remote endpoints with a local stdio proxy such as [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

- **command**: `bun` (or `npx`)
- **args**: `["x", "--bun", "mcp-remote", "https://example.com/mcp", "--header", "Authorization:${AUTH_HEADER}", "--transport", "http-only"]`
- **env**: `{ "AUTH_HEADER": "Bearer {{secret:MY_MCP_TOKEN}}" }`

`mcp-remote` expands `${AUTH_HEADER}` itself. Do **not** invent env keys like `MCP_HEADERS` / `MCP_REMOTE_HEADERS` / `MCP_REMOTE_HEADER_AUTHORIZATION` — they are ignored. Put spaces in the env value (`Bearer …`), not inside the `--header` arg, so clients that split args on spaces do not mangle the header.

:::note
GarzaHive always launches MCP servers as local child processes via stdio, so the server's command must be runnable on the same host (the binary or package must be present, for example via `bun x` / `npx`). When GarzaHive shuts down it terminates the whole process tree of each server.
:::

## Registering a server

You manage MCP servers from the app (Settings). Provide the command, args, and any environment variables, then save. A typical example, registering the official filesystem server:

- **name**: `Filesystem`
- **command**: `npx`
- **args**: `["-y", "@modelcontextprotocol/server-filesystem", "/data/shared"]`

After registering you can check the connection status or run a fresh connection test from the UI; the test evicts any cached connection and reconnects so you see the live result and the number of tools discovered.

Servers have a status. An `active` server contributes its tools; a `pending_approval` server contributes nothing until approved (see below). Editing a server's command, args, or env disconnects it so the next call reconnects with the new configuration.

## How the tools surface to Agents

Once a server is active, each of its tools is exposed under a stable, sanitised name:

```
mcp_<server-name>_<tool-name>
```

For example a `read_file` tool on a server named `Filesystem` becomes `mcp_filesystem_read_file`. Names are lowercased and non-alphanumeric characters are collapsed to underscores, so the prefix stays stable even if the server name has spaces or punctuation.

MCP servers are **global**: their tools live in the shared tool universe with no per-Agent access gate, and their credentials stay global. Granting works through **toolboxes**, GarzaHive's single tool-grant mechanism. To let a specific Agent call an MCP tool, add that tool's `mcp_*` name to a toolbox attached to the Agent.

:::caution
The catch-all `all` toolbox expands to every **native** tool (plus enabled custom tools), but it does **not** automatically include MCP tools. MCP (and plugin) tools must be listed by their stable name in a toolbox to be granted. So even with the `all` toolbox, an Agent will not call `mcp_filesystem_read_file` unless that name is explicitly in one of its toolboxes.
:::

When an Agent has MCP tools available, its system prompt includes a short summary listing each external server and how many tools it provides, so the Agent knows the tools exist and can call them like any other tool. The Agent calls them by name; GarzaHive forwards the call to the server and returns the result (text content is extracted and passed back to the Agent).

## Agents that manage MCP themselves

Agents can also create and manage MCP servers through tools, not just admins through the UI:

| Tool | What it does |
|---|---|
| `add_mcp_server` | Register a new server (name, command, args, env). It is auto-linked to the calling Agent. |
| `update_mcp_server` | Change a server's name, command, args, or env (env is merged with existing values). |
| `remove_mcp_server` | Delete a server, disconnect it, and remove it from all Agents. |
| `list_mcp_servers` | List every server on the platform with its command and status. |

## Approval

Because an MCP server runs an arbitrary local command, letting an Agent add one is sensitive. The `MCP_REQUIRE_APPROVAL` setting (default **true**) controls this: when on, a server created by an Agent via `add_mcp_server` starts in `pending_approval` and contributes no tools until an admin approves it from the UI. GarzaHive also raises a persistent notification so you know a server is waiting. Set `MCP_REQUIRE_APPROVAL=false` to let Agent-created servers become active immediately (only do this if you trust what your Agents will register).

## Limits and behaviour to expect

- **stdio launch only.** Remote HTTP/SSE endpoints need a local bridge (`mcp-remote` or similar); see above.
- **Vault placeholders.** `{{secret:KEY}}` in command/args/env is expanded at connect time; unknown keys abort the connection.
- **Tools only.** GarzaHive consumes the MCP `listTools` and `callTool` surface. Tool inputs are converted from the server's JSON Schema into the internal schema Agents call against; unusual or deeply nested schemas may be simplified, and unknown shapes fall back to accepting any object.
- **Timeouts.** 30 seconds to connect, 2 minutes per tool call. A failed call triggers one reconnect-and-retry before returning an error to the Agent.
- **Granting is explicit.** Servers are global, but a tool is only callable by an Agent whose toolbox lists that tool's `mcp_*` name.

## Related

- [Native tools](/docs/agents/tools/) for the built-in tools MCP tools sit alongside.
- [Plugins overview](/docs/plugins/overview/) for the in-process alternative when you want to ship a tool, provider, or channel as code rather than connect an external server.
- [Configuration](/docs/getting-started/configuration/) for `MCP_REQUIRE_APPROVAL` and related settings.
