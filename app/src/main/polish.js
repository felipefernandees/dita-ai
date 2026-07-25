const AUDIO_MARKERS = /\[(BLANK_AUDIO|MÚSICA|MUSIC|APPLAUSE|RUÍDO|NOISE|SILÊNCIO)\]/gi

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// "em tópicos:", "faz uma lista", "abre tópicos" ditos NO INÍCIO da fala.
// Ancorado no começo pra não pegar "queria falar em tópicos com você".
const CMD_TOPICOS = /^(?:em\s+t[óo]picos|abre\s+t[óo]picos|faz(?:er)?\s+(?:uma\s+)?lista|em\s+forma\s+de\s+lista)\s*[:.,]?\s*/i

const ORDINAIS = ['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono', 'décimo']
// ordinal abrindo uma oração (início do texto ou depois de . ! ? ;), com o
// complemento opcional que a gente fala sem pensar ("primeiro de tudo,")
const RE_ORDINAL = new RegExp(
  `(^|[.!?;]\\s+)(${ORDINAIS.join('|')})\\b(\\s+(?:de\\s+tudo|lugar|ponto|item|passo|de\\s+todos))?\\s*[,:]?\\s*`,
  'giu'
)

function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Quebra em frases, mantendo a pontuação final de cada uma
function frases(text) {
  return text.split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter(Boolean)
}

function comoBullets(text) {
  const itens = frases(text).map((f) => capitalizar(f.replace(/[.,;]+$/, '').trim())).filter(Boolean)
  if (itens.length < 2) return null
  return itens.map((i) => `- ${i}`).join('\n')
}

// "Primeiro X. Segundo Y. Terceiro Z." vira lista numerada. Exige 3+ ordinais
// em ordem crescente: menos que isso costuma ser fala normal, não enumeração.
function comoListaNumerada(text) {
  const achados = [...text.matchAll(RE_ORDINAL)]
  if (achados.length < 3) return null
  const posicoes = achados.map((m) => ORDINAIS.indexOf(m[2].toLowerCase()))
  const crescente = posicoes.every((p, i) => i === 0 ? p === 0 : p === posicoes[i - 1] + 1)
  if (!crescente) return null

  // [1] é a pontuação que fecha a frase anterior: ela pertence à introdução
  const intro = text.slice(0, achados[0].index + achados[0][1].length).trim()
  const itens = achados.map((m, i) => {
    const inicio = m.index + m[0].length
    const fim = i + 1 < achados.length ? achados[i + 1].index + achados[i + 1][1].length : text.length
    return capitalizar(text.slice(inicio, fim).trim())
  })
  const lista = itens.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return intro ? `${intro}\n\n${lista}` : lista
}

export function polish(rawText, { dictionary = [], snippets = [] } = {}) {
  let text = String(rawText || '').replace(AUDIO_MARKERS, ' ')
  // reticências que o whisper insere em silêncio: remove "...", "…" e afins
  text = text.replace(/[.…]{2,}/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  // se sobrou só pontuação/espaço (ex: "." ou "…" de silêncio), descarta
  if (/^[\s\p{P}\p{S}]*$/u.test(text)) return ''
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

  // comando de voz explícito ganha da detecção automática
  if (CMD_TOPICOS.test(text)) {
    const bullets = comoBullets(text.replace(CMD_TOPICOS, ''))
    if (bullets) return bullets
  }
  const lista = comoListaNumerada(text)
  if (lista) return lista

  return capitalizar(text)
}
