---
title: External API
description: Talk to an Agent from your own code over HTTP, using an API key. Send a message, wait for the reply or poll for it, and hold isolated conversations.
---

The External API lets a program or script hold a conversation with an Agent over HTTP, without a browser session. You declare an external client, give it an API key, and call `/api/v1/*` with that key as a bearer token.

This is different from webhooks (which are fire-and-forget events) and channels (which are human chat on Telegram, Slack, and the like). The External API is a request and reply API: you send a message and get the Agent's answer back, correlated by a request id.

## 1. Declare a client and create a key

In the app, open **Settings → External API** (admin only).

1. **Add client**: give it a name (shown to the Agent as the sender), optionally lock it to a single Agent, and choose the allowed modes (main timeline, isolated threads, or both). You can set a per-client rate limit.
2. **Create key**: give the key a label. The full key (`hk_…`) is shown **once**. Copy it now; it is never displayed again. If you lose it, revoke it and create a new one.

Tool calls the Agent makes on this client's behalf run as the admin who owns the client.

## 2. Send a message

```bash
curl -X POST https://your-host/api/v1/agents/<agent-id-or-slug>/messages \
  -H "Authorization: Bearer hk_<keyId>.<secret>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "What is on my calendar today?", "mode": "wait" }'
```

With `mode: "wait"` the call blocks until the Agent answers and returns the reply:

```json
{ "requestId": "…", "status": "done", "reply": "You have 2 meetings…", "conversationId": null }
```

If the Agent takes longer than the wait timeout, you get `202` with `status: "pending"` instead, and you poll for the result (see below).

### Fire-and-forget plus polling

Omit `mode` (or set `"async"`) to return immediately:

```bash
curl -X POST https://your-host/api/v1/agents/<agent>/messages \
  -H "Authorization: Bearer hk_<keyId>.<secret>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Summarize the latest deploy logs." }'
# -> 202 { "requestId": "abc", "status": "pending" }
```

Then poll until it is done:

```bash
curl https://your-host/api/v1/requests/abc \
  -H "Authorization: Bearer hk_<keyId>.<secret>"
# -> { "requestId": "abc", "status": "done", "reply": "…", "error": null }
```

## 3. Main timeline vs isolated threads

There are two places a message can land, chosen per request:

- **Main timeline** (no `conversationId`): the message goes into the Agent's single ongoing conversation, the same one you see in the app. Best for your own scripts driving your own Agent.
- **Isolated thread** (`conversationId` or `newConversation`): a private context for this caller, separate from the human timeline and from other callers. Best when several integrations each hold their own conversation. Isolated threads run the Agent at full power; they just keep their context to themselves.

Open a thread, then keep talking in it:

```bash
# Open a thread
curl -X POST https://your-host/api/v1/agents/<agent>/conversations \
  -H "Authorization: Bearer hk_<keyId>.<secret>" \
  -H "Content-Type: application/json" \
  -d '{ "title": "Support session #42" }'
# -> 201 { "conversationId": "conv_…" }

# Send into it (the Agent keeps the context across turns)
curl -X POST https://your-host/api/v1/agents/<agent>/messages \
  -H "Authorization: Bearer hk_<keyId>.<secret>" \
  -H "Content-Type: application/json" \
  -d '{ "conversationId": "conv_…", "content": "And what about tomorrow?", "mode": "wait" }'
```

Read a thread's transcript with `GET /api/v1/conversations/<conversationId>/messages`, and close it with `POST /api/v1/conversations/<conversationId>/close`.

## 4. Errors and limits

All responses are JSON. Errors follow `{ "error": { "code": "…", "message": "…" } }`.

- `401 UNAUTHORIZED` / `401 API_KEY_REVOKED` / `403 CLIENT_DISABLED`: key or client problem.
- `403 AGENT_SCOPE_VIOLATION`: the key is locked to another Agent.
- `403 MODE_NOT_ALLOWED`: the client may not use that target (main or isolated).
- `429 RATE_LIMITED`: too many requests for this client this minute. Honor `Retry-After`.

A `wait` timeout is **not** an error: it returns `202 { status: "pending" }` and you switch to polling. The in-process wait does not survive a server restart, so always be ready to fall back to polling.

## Notes

- The whole API can be turned off with `GARZAHIVE_EXTERNAL_API_ENABLED=false`.
- Timeouts, rate-limit defaults, conversation TTL, and reply retention are configurable (see the configuration reference).
- Keep your keys secret. They grant the same access as the owning admin's tools. Revoke a leaked key immediately from Settings.
