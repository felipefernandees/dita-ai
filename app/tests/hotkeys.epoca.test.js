import { describe, it, expect, vi } from 'vitest'
import { createHotkeyMachine } from '../src/main/hotkeys.js'

// O BUG QUE ESTES TESTES TRANCAM
//
// Encostar no Cmd direito (push-to-talk de menos de 300ms) cancelava a máquina,
// mas o `onStart` do index.js ainda estava pendurado num `await
// getFrontmostApp()`. Quando o osascript respondia — 100 a 180ms depois, medido
// nesta máquina — ele seguia em frente e chamava `rec.show()` e
// `rec.send('rec:start')` numa máquina que já estava em `idle`.
//
// O resultado era o pior estado possível: popup na tela, microfone aberto, e
// NENHUM botão funcionando. O X (`rec:cancel-hard`) e o check (`rec:finish`)
// testam `state() === 'recording'` antes de agir; com a máquina em `idle` os
// dois viravam no-op e o ditado só morria no watchdog de 30 minutos.
//
// A época é a defesa estrutural: cada gravação recebe um número, e quem
// terminar um trabalho assíncrono compara o número que recebeu com o atual
// antes de aplicar qualquer efeito. Um `await` reintroduzido no onStart amanhã
// não traz o bug de volta — o efeito atrasado simplesmente não se aplica.
describe('época da gravação', () => {
  function makeMachine(nowValues = []) {
    let i = 0
    const now = () => nowValues[Math.min(i++, nowValues.length - 1)] ?? 0
    const cbs = { onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn() }
    return { m: createHotkeyMachine({ ...cbs, now }), cbs }
  }

  it('onStart recebe a época da gravação que o disparou', () => {
    const { m, cbs } = makeMachine([0, 2000])
    m.handle('toggle')
    expect(cbs.onStart).toHaveBeenCalledWith(m.epocaAtual(), 'travado')
  })

  it('a época muda a cada gravação nova', () => {
    const { m } = makeMachine([0, 2000, 3000, 5000])
    m.handle('toggle')
    const primeira = m.epocaAtual()
    m.handle('toggle')
    m.handle('toggle')
    expect(m.epocaAtual()).not.toBe(primeira)
  })

  it('cancelar avança a época, invalidando o onStart em voo', () => {
    const { m } = makeMachine([0, 150])
    m.handle('ptt_down')
    const epocaDoDitado = m.epocaAtual()
    m.handle('esc') // cancelado antes de o onStart terminar
    expect(m.state()).toBe('idle')
    expect(m.epocaAtual()).not.toBe(epocaDoDitado)
  })

  it('finalizar também avança a época', () => {
    const { m } = makeMachine([0, 2000])
    m.handle('toggle')
    const epocaDoDitado = m.epocaAtual()
    m.handle('toggle')
    expect(m.epocaAtual()).not.toBe(epocaDoDitado)
  })

  // O caso do relato, ponta a ponta: o efeito atrasado do onStart consulta a
  // época antes de ligar o popup e desiste sozinho.
  it('efeito atrasado do onStart não liga a gravação depois do cancelamento', async () => {
    const efeitos = []
    let soltarOsascript
    const osascript = new Promise((r) => { soltarOsascript = r })
    let agora = 0

    const m = createHotkeyMachine({
      now: () => agora,
      onStart: async (epoca) => {
        await osascript
        if (epoca !== m.epocaAtual()) return // a guarda que este teste protege
        efeitos.push('show+rec:start')
      },
      onStop: () => efeitos.push('stop'),
      onCancel: (r) => efeitos.push('cancel:' + r)
    })

    m.handle('ptt_down')
    agora = 150
    m.handle('esc')

    soltarOsascript('Chrome')
    await new Promise((r) => setTimeout(r, 0))

    expect(efeitos).toEqual(['cancel:esc'])
    expect(m.state()).toBe('idle')
  })
})
