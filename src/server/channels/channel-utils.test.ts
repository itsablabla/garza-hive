import { describe, it, expect } from 'bun:test'
import {
  splitMessage,
  escapeTelegramV2,
  formatForTelegram,
  formatForSlack,
  formatForMatrix,
  formatForWhatsApp,
  stripMarkdown,
} from './channel-utils'

describe('splitMessage', () => {
  it('returns single chunk when text fits', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello'])
  })

  it('splits at paragraph boundary', () => {
    const text = 'A'.repeat(50) + '\n\n' + 'B'.repeat(50)
    const chunks = splitMessage(text, 60)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toBe('A'.repeat(50))
  })

  it('splits at line boundary', () => {
    const text = 'A'.repeat(50) + '\n' + 'B'.repeat(50)
    const chunks = splitMessage(text, 60)
    expect(chunks[0]).toBe('A'.repeat(50))
  })

  it('splits at sentence boundary', () => {
    const text = 'A'.repeat(50) + '. ' + 'B'.repeat(50)
    const chunks = splitMessage(text, 60)
    expect(chunks[0]).toBe('A'.repeat(50))
  })

  it('hard-splits when no boundary found', () => {
    const text = 'A'.repeat(200)
    const chunks = splitMessage(text, 100)
    expect(chunks[0]).toHaveLength(100)
  })
})

describe('escapeTelegramV2', () => {
  it('escapes all special chars', () => {
    expect(escapeTelegramV2('1+1=2')).toBe('1\\+1\\=2')
    expect(escapeTelegramV2('hello!')).toBe('hello\\!')
    expect(escapeTelegramV2('a.b')).toBe('a\\.b')
  })

  it('escapes backslash itself', () => {
    expect(escapeTelegramV2('a\\b')).toBe('a\\\\b')
  })
})

describe('formatForTelegram', () => {
  it('converts bold markdown', () => {
    const result = formatForTelegram('**hello**')
    expect(result).toContain('*')
    expect(result).toContain('hello')
  })

  it('preserves code blocks verbatim', () => {
    const code = '```python\nprint("hello")\n```'
    const result = formatForTelegram(code)
    expect(result).toContain('```python')
    expect(result).toContain('print("hello")')
  })
})

describe('formatForSlack', () => {
  it('converts **bold** to *bold*', () => {
    expect(formatForSlack('**hello**')).toContain('*hello*')
  })

  it('escapes & < >', () => {
    const result = formatForSlack('a & b < c > d')
    expect(result).toContain('&amp;')
    expect(result).toContain('&lt;')
    expect(result).toContain('&gt;')
  })
})

describe('formatForMatrix', () => {
  it('wraps bold in <strong>', () => {
    expect(formatForMatrix('**hi**')).toContain('<strong>')
  })

  it('wraps code fences in <pre><code>', () => {
    expect(formatForMatrix('```\ncode\n```')).toContain('<pre><code>')
  })

  it('wraps inline code in <code>', () => {
    expect(formatForMatrix('`foo`')).toContain('<code>foo</code>')
  })
})

describe('formatForWhatsApp', () => {
  it('converts **bold** to *bold*', () => {
    expect(formatForWhatsApp('**hello**')).toContain('*hello*')
  })

  it('strips headings', () => {
    expect(formatForWhatsApp('# Title')).toBe('Title')
  })
})

describe('stripMarkdown', () => {
  it('removes ** markers', () => {
    expect(stripMarkdown('**bold**')).toBe('bold')
  })

  it('removes code fences but keeps content', () => {
    expect(stripMarkdown('```\ncode\n```')).toContain('code')
  })

  it('removes heading markers', () => {
    expect(stripMarkdown('## heading')).toBe('heading')
  })
})
