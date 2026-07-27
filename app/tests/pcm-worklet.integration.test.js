import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// pcm.test.js prova que a ARITMÉTICA da conversão está certa. Ele não prova a
// outra metade, que é onde estava o risco real: se o AudioWorklet CARREGA no
// app empacotado.
//
// O worklet não pode entrar no bundle do React (o AudioWorkletGlobalScope não
// tem window nem document), então ele é importado com `?url` e o Vite decide
// sozinho — pelo tamanho do arquivo, contra o assetsInlineLimit de 4 KB — se
// vira um `data:` embutido ou um .js separado em assets/. Um comentário a mais
// neste worklet muda a decisão. Além disso o app empacotado carrega o renderer
// por loadFile, ou seja file://, onde a resolução de módulo tem regras próprias.
//
// Nada disso aparece em `npm run build`: o build passa igual, e a falha só
// existiria na máquina do usuário, em runtime, como "o modo tempo real não
// escreve nada". Por isso este teste abre uma janela Electron de verdade,
// carrega o build de verdade e roda áudio de verdade pelo worklet.
//
// Sem microfone e sem chave de API: OfflineAudioContext também tem
// `audioWorklet` e renderiza por software.
const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(HERE, '../out/renderer')
const PROBE = join(HERE, 'fixtures/worklet-probe.cjs')
const ELECTRON = join(HERE, '../node_modules/electron/dist/electron.exe')

// Depende do `npm run build` ter rodado. Pula em vez de falhar: numa árvore
// recém-clonada não existe out/, e um vermelho aqui apontaria para o lugar
// errado.
const temBuild = existsSync(join(RENDERER, 'index.html')) && existsSync(join(RENDERER, 'assets'))
const temElectron = existsSync(ELECTRON)

describe.skipIf(!temBuild || !temElectron)('AudioWorklet no build empacotado', () => {
  it('carrega em file:// e fatia o áudio em blocos de 250 ms mono', () => {
    // ELECTRON_RUN_AS_NODE está ligado para a suíte inteira (é assim que o
    // vitest roda). Aqui ele precisa SUMIR do ambiente: sem o Chromium não há
    // BrowserWindow, que é justamente o que este teste existe para exercitar.
    // Zerar não basta — o Electron olha se a variável está DEFINIDA, então
    // string vazia continua valendo como ligada. Tem que deletar.
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE

    const saida = execFileSync(ELECTRON, [PROBE, RENDERER], { encoding: 'utf8', timeout: 90000, env })

    const r = JSON.parse(saida.slice(saida.indexOf('{'), saida.lastIndexOf('}') + 1))
    expect(r.erro).toBeUndefined()

    // O build produziu um worklet alcançável, em qualquer uma das duas formas
    // que o Vite pode escolher.
    expect(['data-uri', 'asset']).toContain(r.forma)
    // ...e a página é mesmo a file:// do empacotado, não um dev server.
    expect(r.pagina).toBe('file:')

    // channelCountMode 'explicit' com channelCount 1: a fonte da sonda é
    // ESTÉREO, e o nó ainda assim é mono. É daqui que vem a garantia de mono —
    // não de o worklet ler inputs[0][0].
    expect(r.canaisDoNo).toBe(1)

    // 2 s a 16 kHz = 32000 amostras = 8 blocos de 4000. Um bloco pode ficar
    // pela metade no fim da renderização e nunca ser postado.
    expect(r.blocos).toBeGreaterThanOrEqual(7)
    // TODO bloco tem exatamente 4000 amostras: nenhum tamanho diferente na
    // lista. 4000 / 16000 Hz = 250 ms, que é o contrato com o Gemini.
    expect(r.tamanhos).toEqual([4000])
  }, 120000)
})
