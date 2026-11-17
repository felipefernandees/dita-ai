import { spawn } from 'child_process'

// Contexto do ditado: onde a pessoa está escrevendo e o que está na tela.
//
// É o que separa transcrição de ditado bom. Com o app, o texto ao redor do
// cursor e as palavras da janela, a limpeza por IA acerta grafia de nome que
// está visível ("Seviva", "Max Carrau"), sabe se é e-mail ou zap e continua a
// frase no tom do que já estava escrito.
//
// Capturado no INÍCIO do ditado (é ali que o cursor está onde a pessoa quer
// o texto) e só usado no fim, então a captura tem a fala inteira pra terminar.
// Nada aqui pode atrasar o popup ou o microfone: tudo é promessa com prazo, e
// prazo estourado vira contexto vazio, nunca ditado travado.

const PRAZO_MS = 1500

// ── Categoria do app ─────────────────────────────────────────────────────────
// Decide o ESTILO da limpeza. Casa por bundle id (apps nativos) e por domínio
// (a mesma coisa aberta no navegador). Listas curtas e focadas no que se usa
// no Brasil; o que não casar é 'outro', que é o estilo neutro.
const EMAIL = [
  'com.apple.mail', 'com.microsoft.outlook', 'com.google.gmail', 'com.superhuman.electron',
  'com.readdle.sparkdesktop', 'com.readdle.smartemail-mac', 'com.mimestream.mimestream', 'com.hey.app.desktop',
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.superhuman.com', 'app.hey.com', 'mail.proton.me'
]
const TRABALHO = [
  'com.tinyspeck.slackmacgap', 'com.slack.slack', 'com.microsoft.teams', 'com.microsoft.teams2', 'us.zoom.xos',
  'app.slack.com', 'teams.microsoft.com', 'chat.google.com', 'linkedin.com', 'app.zoom.us', 'meet.google.com'
]
const PESSOAL = [
  'net.whatsapp.whatsapp', 'desktop.whatsapp', 'com.apple.mobilesms', 'ru.keepcoder.telegram', 'com.tdesktop.telegram',
  'org.whispersystems.signal-desktop', 'com.hnc.discord', 'com.discordapp.discord', 'com.facebook.archon',
  'web.whatsapp.com', 'web.telegram.org', 'discord.com', 'messenger.com', 'instagram.com', 'x.com', 'twitter.com'
]

function hostDe(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

function casa(lista, bundle, host) {
  return lista.some((x) => bundle === x || (host && (host === x || host.endsWith('.' + x))))
}

export function categoriaDoApp({ bundleId = '', url = '' } = {}) {
  const bundle = String(bundleId).toLowerCase()
  const host = hostDe(url)
  if (casa(EMAIL, bundle, host)) return 'email'
  if (casa(TRABALHO, bundle, host)) return 'trabalho'
  if (casa(PESSOAL, bundle, host)) return 'pessoal'
  return 'outro'
}

// ── Palavras da tela ─────────────────────────────────────────────────────────
// A IA não precisa da janela inteira, precisa das palavras que ela poderia
// grafar errado: nomes próprios, marcas, siglas, termos técnicos. Palavra comum
// em minúscula ("reunião", "amanhã") a IA já sabe escrever; mandá-la só gasta
// token e dilui o que importa.
const RUIDO = /^(https?|www|com|br|png|jpg|svg|pdf|true|false|null|undefined|arrow|pointer|ipad|chevron|xmark)$/i

export function palavrasDaTela(textos = [], { limite = 150 } = {}) {
  const contagem = new Map()
  for (const t of textos) {
    for (const bruta of String(t).split(/[^\p{L}\p{N}@._'-]+/u)) {
      const p = bruta.replace(/^[._'-]+|[._'-]+$/g, '')
      if (p.length < 3 || p.length > 40) continue
      if (/^\d+$/.test(p) || RUIDO.test(p)) continue
      const interessante =
        /^\p{Lu}/u.test(p) ||                 // Nome, Empresa, Sigla
        /\p{Ll}\p{Lu}/u.test(p) ||            // camelCase, iPhone
        /\d/.test(p) ||                       // n8n, gpt4o
        /[@.]/.test(p)                        // handle, domínio
      if (!interessante) continue
      contagem.set(p, (contagem.get(p) || 0) + 1)
    }
  }
  // Mais frequente primeiro: o nome do contato aparece em várias mensagens, o
  // rótulo de um botão aparece uma vez.
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, limite).map(([p]) => p)
}

// Formato único que o resto do app consome, venha de onde vier.
export function normalizarContexto(bruto) {
  if (!bruto || bruto.ok === false) return null
  const campo = bruto.campo || {}
  const url = bruto.url || ''
  return {
    app: bruto.app || '',
    bundleId: bruto.bundleId || '',
    janela: bruto.janela || '',
    url,
    categoria: categoriaDoApp({ bundleId: bruto.bundleId, url }),
    leuCampo: Boolean(campo.leu),
    editavel: campo.editavel !== false,
    senha: Boolean(campo.senha),
    antes: campo.antes || '',
    depois: campo.depois || '',
    selecionado: campo.selecionado || '',
    palavras: palavrasDaTela(bruto.textos || [])
  }
}

// Roda `dita-hotkeys contexto` e devolve o contexto normalizado, ou null.
// Só existe no macOS; no Windows o helper ainda não tem esse modo.
export function capturarContexto({ helperPath, prazoMs = PRAZO_MS, spawnFn = spawn, plataforma = process.platform } = {}) {
  if (plataforma !== 'darwin' || !helperPath) return Promise.resolve(null)
  return new Promise((resolve) => {
    let saida = ''
    let feito = false
    const fim = (valor) => {
      if (feito) return
      feito = true
      clearTimeout(timer)
      resolve(valor)
    }
    let filho
    try {
      filho = spawnFn(helperPath, ['contexto'], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch { resolve(null); return }
    const timer = setTimeout(() => {
      try { filho.kill('SIGKILL') } catch {}
      fim(null)
    }, prazoMs)
    filho.stdout?.on('data', (c) => {
      saida += c.toString()
      const idx = saida.indexOf('\n')
      if (idx < 0) return
      try { fim(normalizarContexto(JSON.parse(saida.slice(0, idx)))) } catch { fim(null) }
    })
    filho.on('error', () => fim(null))
    // 'close' e não 'exit': o 'exit' pode chegar antes do último pedaço do
    // stdout, e o contexto inteiro estaria nele.
    filho.on('close', () => fim(null))
  })
}
