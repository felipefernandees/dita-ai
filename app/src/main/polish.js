const AUDIO_MARKERS = /\[(BLANK_AUDIO|MÚSICA|MUSIC|APPLAUSE|RUÍDO|NOISE|SILÊNCIO)\]/gi

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function polish(rawText, { dictionary = [], snippets = [] } = {}) {
  let text = String(rawText || '').replace(AUDIO_MARKERS, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return ''

  const normalized = text.toLowerCase().replace(/[.!?,;]+$/, '').trim()
  for (const s of snippets) {
    if (normalized === s.trigger.toLowerCase().trim()) return s.content
  }

  for (const d of dictionary) {
    if (!d.replacement) continue
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(d.term)}(?=$|[^\\p{L}\\p{N}])`, 'giu')
    text = text.replace(re, (m, pre) => pre + d.replacement)
  }

  text = text.replace(/\s+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}
