// Ajuste fino do texto ANTES de colar, olhando o que já está escrito em volta
// do cursor. É o detalhe que faz o ditado "encaixar" no texto em vez de chegar
// como um bloco solto: sem isto, ditar no meio de uma frase cola "Oi Max, Tudo
// certo." com maiúscula e ponto no lugar errado, e a pessoa corrige à mão.
//
// Comportamento observado no Wispr Flow e reescrito aqui (ver
// SPEC-DITADO.md, seção 6). Olha só a LINHA atual: o que está em outra linha
// não decide espaço nem maiúscula.

const LETRA = /^\p{L}$/u
const LETRA_OU_NUMERO = /^[\p{L}\p{N}]$/u
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
// Pontuação que não "fecha" a frase: atravessando ela, ainda estamos no meio.
const NEUTROS = '—–`,-/:;()[]{} '
const ASPAS_FECHANDO = `"'”’`
// Depois destes, o texto novo precisa de espaço antes ("fim.| Novo").
const PEDEM_ESPACO = '!%),.:;>?]}'
const OPERADORES = '\\/|-&*+=~'

function ultimo(s) { return s.length ? s[s.length - 1] : '' }

// A linha antes do cursor termina no meio de uma frase? ("Oi Max," → sim;
// "Tudo certo." → não; "" → não)
export function terminaNoMeioDaFrase(linhaAntes) {
  const s = Array.from(String(linhaAntes).replace(/[  ]+$/, ''))
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i]
    if (LETRA_OU_NUMERO.test(c)) return true
    if (NEUTROS.includes(c)) continue
    if (ASPAS_FECHANDO.includes(c) && i > 0 && !/\s/.test(s[i - 1])) continue
    return false
  }
  return false
}

// O texto depois do cursor continua a frase? (começa com minúscula ou com
// pontuação: então o ditado não pode trazer ponto final próprio)
export function depoisContinuaAFrase(linhaDepois) {
  const s = String(linhaDepois).replace(/^[  ]+/, '')
  for (const c of s) {
    if (LETRA.test(c)) return c.toLowerCase() === c && c.toUpperCase() !== c
    if ('!%,.:;>?'.includes(c)) return true
    if (!NEUTROS.includes(c)) return false
  }
  return false
}

export function precisaEspacoAntes(linhaAntes) {
  const s = String(linhaAntes)
  if (!s.length) return false
  const c = ultimo(s)
  if (CJK.test(c)) return false
  if (LETRA_OU_NUMERO.test(c)) return true
  if (PEDEM_ESPACO.includes(c)) return true
  if (ASPAS_FECHANDO.includes(c) && s.length > 1 && !/\s/.test(s[s.length - 2])) return true
  if (OPERADORES.includes(c)) return s.length === 1 || s[s.length - 2] === ' '
  return false
}

export function precisaEspacoDepois(texto, linhaDepois) {
  if (CJK.test(ultimo(texto))) return false
  const d = String(linhaDepois)
  if (!d.length) return true
  if (LETRA_OU_NUMERO.test(d[0])) return true
  return OPERADORES.includes(d[0]) && d.length > 1 && d[1] === ' '
}

function minusculaInicial(t) {
  return t.length > 1 ? t[0].toLowerCase() + t.slice(1) : t
}

// O ditado começa com nome próprio? Então a maiúscula fica mesmo no meio da
// frase ("falei com o | Max" não vira "max"). Sem servidor pra marcar isso,
// a régua é: a primeira palavra está entre os nomes conhecidos (quem dita,
// palavras da tela, dicionário) ou é sigla.
export function comecaComNomeProprio(texto, nomesProprios = []) {
  const primeira = (String(texto).match(/\p{L}[\p{L}\p{N}'-]*/u) || [''])[0]
  if (!primeira) return false
  if (primeira.length > 1 && primeira === primeira.toUpperCase() && primeira !== primeira.toLowerCase()) return true
  return nomesProprios.includes(primeira)
}

// Em mensagem curta de zap ninguém põe ponto final. Limite de frases por
// estilo: formal nunca tira, casual tira até 10, muito casual sempre, e o
// padrão só tira em app de mensagem e até 2 frases.
export function tirarPontoDeMensagem(texto, { linhaAntes = '', linhaDepois = '', selecionado = '', mensagem = false, estilo = 'default' } = {}) {
  let limite
  if (estilo === 'formal') return texto
  if (estilo === 'casual') limite = 10
  else if (estilo === 'veryCasual') limite = Infinity
  else if (mensagem) limite = 2
  else return texto
  if (selecionado.length > 0) return texto
  const frasesNoTexto = texto.split(/[.!?]+/).filter((f) => f.trim().length > 0).length
  if (/[.!?]/.test(linhaAntes + selecionado + linhaDepois) || frasesNoTexto > limite) return texto
  return texto.replace(/[.]+$/, '')
}

export function ajustarParaColar(texto, {
  antes = '',
  depois = '',
  selecionado = '',
  nomesProprios = [],
  mensagem = false,
  estilo = 'default'
} = {}) {
  let t = String(texto ?? '').trim()
  if (!t) return ''
  const linhaAntes = String(antes).split('\n').pop() || ''
  const linhaDepois = String(depois).split('\n')[0] || ''
  const nome = comecaComNomeProprio(t, nomesProprios)

  t = tirarPontoDeMensagem(t, { linhaAntes, linhaDepois, selecionado, mensagem, estilo })

  if (selecionado) {
    // Substituindo uma seleção: herda a caixa e os espaços dela.
    const sel = selecionado.trimStart()
    if (sel && LETRA.test(sel[0]) && sel[0].toLowerCase() === sel[0] && !nome) t = minusculaInicial(t)
    if (!PEDEM_ESPACO.includes(ultimo(sel))) t = t.replace(/[!.?]+$/, '')
    if (selecionado[0] === ' ') t = ' ' + t
    if (ultimo(selecionado) === ' ') t += ' '
    return t
  }

  if (terminaNoMeioDaFrase(linhaAntes) && !nome) t = minusculaInicial(t)
  if (depoisContinuaAFrase(linhaDepois)) t = t.replace(/[!.?]+$/, '')
  if (precisaEspacoAntes(linhaAntes)) t = ' ' + t
  if (precisaEspacoDepois(t, linhaDepois)) t += ' '
  return t
}
