/**
 * Shared utilities for channel adapters.
 *
 * Centralises logic that was previously copy-pasted across every adapter
 * (message splitting, per-platform markdown conversion) so changes are made
 * in one place.
 */

// ─── Message splitting ────────────────────────────────────────────────────────

/**
 * Split a long message into chunks at natural break-points.
 * Tries paragraph → line → sentence boundaries before hard-splitting.
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    let splitAt = remaining.lastIndexOf('\n\n', maxLength)
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', maxLength)
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('. ', maxLength)
    if (splitAt <= 0) splitAt = maxLength

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}

// ─── Per-platform markdown formatters ────────────────────────────────────────

/**
 * Escape all Telegram MarkdownV2 special characters in a plain string
 * so it can be embedded in a formatted message safely.
 *
 * Per Telegram Bot API docs the characters that MUST be escaped outside of
 * entities are: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeTelegramV2(text: string): string {
  // Escape every special character with a backslash.
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`)
}

/**
 * Convert LLM markdown to Telegram MarkdownV2.
 *
 * Handles the most common patterns produced by LLMs:
 *   **bold** / __bold__  →  *bold*
 *   *italic* / _italic_  →  _italic_
 *   `code`               →  `code`
 *   ```...```            →  ```...```
 *   # Heading            →  *Heading*  (bold)
 *
 * Text outside these patterns is escaped so special characters don't break
 * Telegram's parser.  This is intentionally a best-effort converter — corner
 * cases in mixed nesting are left as escaped plain text rather than failing.
 */
export function formatForTelegram(text: string): string {
  // Split into code-fence blocks vs. plain segments so we don't process
  // code content.
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        // Code block — pass through with escaped backticks in the content.
        // Telegram requires the language specifier (if present) to be on the
        // opening line immediately after ```.
        return part
      }
      // Inline code — extract first so we don't escape the backtick chars
      const inlineParts = part.split(/(`[^`\n]+`)/g)
      return inlineParts
        .map((p, j) => {
          if (j % 2 === 1) return p // already wrapped in backticks
          // Heading lines: "# Foo" → "*Foo*"
          let s = p.replace(/^(#{1,6})\s+(.+)$/gm, (_, __, content) => `*${escapeTelegramV2(content.trim())}*`)
          // Bold: **text** or __text__ → *text*
          s = s.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `*${escapeTelegramV2(inner)}*`)
          s = s.replace(/__([^_]+)__/g, (_, inner) => `*${escapeTelegramV2(inner)}*`)
          // Italic: *text* or _text_ → _text_
          s = s.replace(/\*([^*\n]+)\*/g, (_, inner) => `_${escapeTelegramV2(inner)}_`)
          s = s.replace(/_([^_\n]+)_/g, (_, inner) => `_${escapeTelegramV2(inner)}_`)
          // Escape remaining plain text characters (everything not yet part of
          // a recognised entity).
          // Walk char by char to avoid double-escaping the \ we inserted above.
          let result = ''
          for (let k = 0; k < s.length; k++) {
            const c = s[k]!
            // Skip characters that are already escaped (our own escaping above)
            if (c === '\\' && k + 1 < s.length) {
              result += c + s[++k]
              continue
            }
            // Skip characters that are already part of an entity marker
            if (c === '*' || c === '_' || c === '`') {
              result += c
              continue
            }
            if (/[[\]()~>#+\-=|{}.!]/.test(c)) {
              result += `\\${c}`
            } else {
              result += c
            }
          }
          return result
        })
        .join('')
    })
    .join('')
}

/**
 * Convert LLM markdown to Slack mrkdwn syntax.
 *
 *   **bold** / __bold__  →  *bold*
 *   *italic* / _italic_  →  _italic_   (Slack uses _ for italic)
 *   `code`               →  `code`
 *   ```...```            →  ```...```
 *   # Heading            →  *Heading*
 *
 * Angle brackets and & must be HTML-entity-escaped in Slack.
 */
export function formatForSlack(text: string): string {
  // Escape Slack-special characters in plain text segments
  const escapeSlack = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // code block verbatim
      const inlineParts = part.split(/(`[^`\n]+`)/g)
      return inlineParts
        .map((p, j) => {
          if (j % 2 === 1) return p
          // Headings → bold
          let s = p.replace(/^(#{1,6})\s+(.+)$/gm, (_, __, content) => `*${escapeSlack(content.trim())}*`)
          // Bold
          s = s.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `*${escapeSlack(inner)}*`)
          s = s.replace(/__([^_]+)__/g, (_, inner) => `*${escapeSlack(inner)}*`)
          // Italic
          s = s.replace(/\*([^*\n]+)\*/g, (_, inner) => `_${escapeSlack(inner)}_`)
          s = s.replace(/_([^_\n]+)_/g, (_, inner) => `_${escapeSlack(inner)}_`)
          // Escape remaining plain text
          return escapeSlack(s)
        })
        .join('')
    })
    .join('')
}

/**
 * Convert LLM markdown to a subset of HTML that Matrix clients render.
 *
 * Matrix `formatted_body` accepts a small set of HTML tags:
 *   <strong>, <em>, <code>, <pre>, <h1>–<h6>, <p>, <br>, <ul>, <li>, <a>
 *
 * This converter handles the common LLM output patterns.
 */
export function formatForMatrix(text: string): string {
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  // Code fences first
  let result = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
    return `<pre><code${cls}>${escapeHtml(code.trim())}</code></pre>`
  })
  // Inline code
  result = result.replace(/`([^`\n]+)`/g, (_, inner) => `<code>${escapeHtml(inner)}</code>`)
  // Headings
  result = result.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, content) => {
    const level = hashes.length
    return `<h${level}>${escapeHtml(content.trim())}</h${level}>`
  })
  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `<strong>${escapeHtml(inner)}</strong>`)
  result = result.replace(/__([^_]+)__/g, (_, inner) => `<strong>${escapeHtml(inner)}</strong>`)
  // Italic
  result = result.replace(/\*([^*\n]+)\*/g, (_, inner) => `<em>${escapeHtml(inner)}</em>`)
  result = result.replace(/_([^_\n]+)_/g, (_, inner) => `<em>${escapeHtml(inner)}</em>`)
  // Paragraphs: double newline → </p><p>
  result = result.replace(/\n\n+/g, '</p><p>')
  result = result.replace(/\n/g, '<br/>')
  return `<p>${result}</p>`
}

/**
 * Convert LLM markdown to the WhatsApp Cloud API formatting subset:
 *
 *   **bold** → *bold*   (WhatsApp uses single * for bold)
 *   _italic_ stays (WhatsApp also uses _)
 *   `code` stays
 *   ```...``` → triple-backtick (WhatsApp supports monospace blocks)
 *   Headings are stripped to plain text
 */
export function formatForWhatsApp(text: string): string {
  let s = text
  // Headings → plain
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '$1')
  // Bold: **text** → *text* (WA bold)
  s = s.replace(/\*\*([^*]+)\*\*/g, '*$1*')
  // __text__ → *text* (WA bold)
  s = s.replace(/__([^_]+)__/g, '*$1*')
  // *text* is already WA bold — leave it
  // _italic_ is already WA italic — leave it
  return s
}

/**
 * Strip all markdown formatting for platforms that render plain text only
 * (Signal, raw WhatsApp Web messages).
 */
export function stripMarkdown(text: string): string {
  let s = text
  // Code fences → preserve content
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')
  // Inline code → preserve content
  s = s.replace(/`([^`\n]+)`/g, '$1')
  // Headings
  s = s.replace(/^#{1,6}\s+/gm, '')
  // Bold / italic markers
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/\*([^*\n]+)\*/g, '$1')
  s = s.replace(/_([^_\n]+)_/g, '$1')
  return s
}

// ---------------------------------------------------------------------------
// Phase 1 — Channel live-update infrastructure types
// ---------------------------------------------------------------------------

/**
 * A single progress event emitted during an LLM turn.
 * Adapters with live-update support consume these to send status messages.
 */
export type ChannelProgressEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_end'; summary?: string; tokenCount?: number }
  | { type: 'tool_start'; name: string; stepIndex: number }
  | { type: 'tool_end'; name: string; stepIndex: number; durationMs: number }
  | { type: 'typing_refresh' }
  | { type: 'partial_text'; text: string }

/**
 * Callback that channel adapters (or the engine infrastructure) use to deliver
 * live progress events to the platform chat.
 */
export type ChannelProgressReporter = (event: ChannelProgressEvent) => Promise<void>
