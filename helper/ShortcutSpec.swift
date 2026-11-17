import Foundation
import CoreGraphics

// Vocabulário de atalhos do macOS. Isto é o CONTRATO DE FIO com o renderer: o
// Electron nos passa --toggle=<spec> --ptt=<spec> e a UI monta essas strings a
// partir de um KeyboardEvent. O espelho em JS é app/src/renderer/src/atalhos.js,
// e app/tests/helper-mac.parse.test.js alimenta os MESMOS specs neste parser
// para os dois não divergirem em silêncio.
//
// Formato do toggle: tokens minúsculos unidos por '+', zero ou mais
// modificadores (fn, ctrl, opt, shift, cmd — SEMPRE nessa ordem, que é a
// convenção da Apple) seguidos de exatamente UMA tecla base.
// Ex.: "fn+space", "ctrl+opt+j", "cmd+shift+d", "f5".

enum MotivoRecusa: String {
    case ok = "Ok"
    case vazio = "Vazio"
    case tokenDesconhecido = "TokenDesconhecido"
    case semBase = "SemBase"
    case baseDuplicada = "BaseDuplicada"
    case modificadorRepetido = "ModificadorRepetido"
    case precisaModificador = "PrecisaModificador"
    case reservada = "Reservada"
}

enum Teclas {
    // Nome -> virtual keycode do macOS (os kVK_* do Carbon/HIToolbox). Estão
    // aqui como literais em vez de constantes espalhadas porque isto é uma
    // TABELA — o valor só importa em conjunto com o nome ao lado.
    //
    // Os keycodes do macOS são POSICIONAIS, exatamente como o
    // KeyboardEvent.code do Chromium: kVK_ANSI_Semicolon é sempre a tecla à
    // direita do L, seja ela ';' num teclado US ou 'Ç' num ABNT2. Nomear pelo
    // caractere impresso faria o mesmo spec apontar para teclas físicas
    // diferentes conforme o layout ativo quando o usuário gravou o atalho.
    static let base: [String: Int64] = montarBase()

    // Modificadores, na ordem canônica de serialização (a da Apple: fn ⌃ ⌥ ⇧ ⌘).
    static let modificadores = ["fn", "ctrl", "opt", "shift", "cmd"]

    // 'opt' é o canônico porque é o que está impresso na tecla e é o que os
    // specs antigos do app usam ("opt+space"). Os apelidos existem para um
    // settings.json vindo de um PC (ou escrito à mão) não virar erro.
    static let aliases = [
        "alt": "opt", "option": "opt",
        "command": "cmd", "meta": "cmd", "win": "cmd",
        "control": "ctrl"
    ]

    private static func montarBase() -> [String: Int64] {
        var t: [String: Int64] = [:]

        // Letras e dígitos: kVK_ANSI_*. Note que a numeração NÃO é contígua nem
        // alfabética — é a posição elétrica das teclas no teclado original da
        // Apple, e é por isso que cada uma está escrita à mão.
        let letras: [String: Int64] = [
            "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
            "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
            "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40,
            "n": 45, "m": 46
        ]
        let digitos: [String: Int64] = [
            "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
            "9": 25, "7": 26, "8": 28, "0": 29
        ]
        t.merge(letras) { a, _ in a }
        t.merge(digitos) { a, _ in a }

        // Teclas de função. Também fora de ordem, e só até F20: o macOS não tem
        // keycode para F21-F24, então elas nem entram no vocabulário (a UI
        // também não as oferece).
        let funcoes: [String: Int64] = [
            "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98,
            "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111, "f13": 105,
            "f14": 107, "f15": 113, "f16": 106, "f17": 64, "f18": 79, "f19": 80, "f20": 90
        ]
        t.merge(funcoes) { a, _ in a }

        t["space"] = 49
        t["enter"] = 36        // kVK_Return
        t["tab"] = 48
        t["esc"] = 53
        t["backspace"] = 51    // kVK_Delete (a tecla que apaga para trás)
        t["delete"] = 117      // kVK_ForwardDelete
        t["home"] = 115
        t["end"] = 119
        t["pageup"] = 116
        t["pagedown"] = 121
        t["up"] = 126
        t["down"] = 125
        t["left"] = 123
        t["right"] = 124

        // OEM. O comentário é a legenda ABNT2 daquela posição.
        t["semicolon"] = 41       // kVK_ANSI_Semicolon    — Ç no ABNT2
        t["slash"] = 44           // kVK_ANSI_Slash        — ; : no ABNT2
        t["backquote"] = 50       // kVK_ANSI_Grave        — ' " no ABNT2
        t["bracketleft"] = 33     // kVK_ANSI_LeftBracket  — ´ ` (tecla morta)
        t["backslash"] = 42       // kVK_ANSI_Backslash    — ] } no ABNT2
        t["bracketright"] = 30    // kVK_ANSI_RightBracket — [ { no ABNT2
        t["quote"] = 39           // kVK_ANSI_Quote        — ~ ^ (tecla morta)
        t["minus"] = 27           // kVK_ANSI_Minus        — - _
        t["equal"] = 24           // kVK_ANSI_Equal        — = +
        t["comma"] = 43           // kVK_ANSI_Comma        — , <
        t["period"] = 47          // kVK_ANSI_Period       — . >
        t["intlbackslash"] = 10   // kVK_ISO_Section       — tecla extra dos teclados ISO
        t["intlro"] = 94          // kVK_JIS_Underscore    — tecla extra dos JIS/ABNT

        return t
    }

    // Só as teclas de função podem valer como atalho SEM modificador nenhum.
    // Qualquer outra base sozinha seria suprimida pelo event tap em todo o
    // sistema — configurar "j" faria a letra J parar de funcionar no Mac
    // inteiro, e o usuário não teria como digitar nas Preferências para
    // desfazer.
    static func podeFicarSozinha(_ nomeBase: String) -> Bool {
        guard nomeBase.hasPrefix("f"), let n = Int(nomeBase.dropFirst()) else { return false }
        return n >= 1 && n <= 20
    }

    // O event tap fica ANTES do sistema, então tecnicamente daria para roubar
    // qualquer combinação. É justamente por isso que a lista existe: roubar
    // ⌘Tab, ⌘Q ou ⌘W deixaria o Mac sem alternar app, sair e fechar janela em
    // TODOS os programas, e ⌃⌘Q é o bloqueio de tela.
    static let reservadas: Set<String> = ["cmd+tab", "cmd+q", "cmd+w", "ctrl+cmd+q"]
}

struct ToggleSpec {
    var keyCode: Int64 = 0
    var fn = false
    var ctrl = false
    var opt = false
    var shift = false
    var cmd = false
    // Guardado junto com o keycode só para o serializar() não precisar varrer a
    // tabela ao contrário.
    var nomeBase = ""

    // O default histórico do app. Continua sendo o padrão porque é o atalho que
    // quem já usa o Dita Aí tem na memória muscular.
    static let padrao = "fn+space"

    // Qualquer entrada inválida cai no default em vez de derrubar o helper.
    // Isso inclui os specs do Windows ("ctrl+shift+space" é válido aqui, mas
    // "win+j" não): um settings.json copiado de um PC não pode matar os atalhos
    // no Mac.
    static func parse(_ spec: String) -> ToggleSpec {
        if let s = try? tryParse(spec) { return s }
        // Recursão impossível: o padrão é válido por construção, e o teste de
        // paridade cobre isso — se alguém quebrar a tabela, o vermelho aparece
        // lá antes de virar laço infinito em produção.
        return (try? tryParse(padrao)) ?? ToggleSpec(keyCode: 49, fn: true, nomeBase: "space")
    }

    struct Recusa: Error { let motivo: MotivoRecusa }

    static func tryParse(_ spec: String) throws -> ToggleSpec {
        let limpo = spec.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if limpo.isEmpty { throw Recusa(motivo: .vazio) }

        var s = ToggleSpec()
        var nomeBase: String? = nil

        for cru in limpo.split(separator: "+", omittingEmptySubsequences: false) {
            let parte = String(cru)
            if parte.isEmpty { throw Recusa(motivo: .vazio) }
            let token = Teclas.aliases[parte] ?? parte

            switch token {
            case "fn":
                if s.fn { throw Recusa(motivo: .modificadorRepetido) }
                s.fn = true; continue
            case "ctrl":
                if s.ctrl { throw Recusa(motivo: .modificadorRepetido) }
                s.ctrl = true; continue
            case "opt":
                if s.opt { throw Recusa(motivo: .modificadorRepetido) }
                s.opt = true; continue
            case "shift":
                if s.shift { throw Recusa(motivo: .modificadorRepetido) }
                s.shift = true; continue
            case "cmd":
                if s.cmd { throw Recusa(motivo: .modificadorRepetido) }
                s.cmd = true; continue
            default: break
            }

            guard let code = Teclas.base[token] else { throw Recusa(motivo: .tokenDesconhecido) }
            // Duas teclas base ("ctrl+a+b") não descrevem nada que o tap possa
            // casar: ele recebe um keycode por evento.
            if nomeBase != nil { throw Recusa(motivo: .baseDuplicada) }
            nomeBase = token
            s.nomeBase = token
            s.keyCode = code
        }

        guard let base = nomeBase else { throw Recusa(motivo: .semBase) }

        if !s.fn && !s.ctrl && !s.opt && !s.shift && !s.cmd && !Teclas.podeFicarSozinha(base) {
            throw Recusa(motivo: .precisaModificador)
        }

        if Teclas.reservadas.contains(s.serializar()) { throw Recusa(motivo: .reservada) }

        return s
    }

    // Forma canônica: modificadores na ordem fixa, base por último. É o que a
    // comparação com as reservadas usa — sem isto, "tab+cmd" escaparia do filtro.
    func serializar() -> String {
        var partes: [String] = []
        if fn { partes.append("fn") }
        if ctrl { partes.append("ctrl") }
        if opt { partes.append("opt") }
        if shift { partes.append("shift") }
        if cmd { partes.append("cmd") }
        partes.append(nomeBase)
        return partes.joined(separator: "+")
    }

    // Casa o evento com o spec. Os modificadores são comparados de forma EXATA:
    // com "ctrl+space" configurado, ⌃⇧Espaço NÃO deve disparar o toggle, senão o
    // usuário perde combinações do app em foco.
    //
    // A tecla Fn é o caso especial do macOS. Ela não é um modificador comum:
    //
    //  • O sistema LIGA a flag de função sozinho em teclas que não têm nada a
    //    ver com a Fn — setas, Home/End/PageUp/PageDown, ⌦ e as F1-F20. Exigir
    //    `fn == false` nessas teclas recusaria atalhos perfeitamente válidos
    //    (um "ctrl+left" nunca dispararia).
    //  • Nos teclados da Apple, com "Usar F1, F2 etc. como teclas de função"
    //    DESLIGADO (o padrão), o usuário precisa segurar Fn para produzir um F5
    //    de verdade; com a opção ligada, não precisa. O mesmo spec 'f5' tem que
    //    funcionar nos dois casos.
    //
    // Por isso a flag de função só é comparada quando a tecla base é uma tecla
    // "normal" — aí sim ela significa que o usuário apertou a Fn de propósito.
    func casaCom(keyCode code: Int64, flags: CGEventFlags) -> Bool {
        guard code == keyCode else { return false }
        guard ctrl == flags.contains(.maskControl),
              opt == flags.contains(.maskAlternate),
              shift == flags.contains(.maskShift),
              cmd == flags.contains(.maskCommand) else { return false }

        if ToggleSpec.flagFnEhImplicita(nomeBase) { return true }
        return fn == flags.contains(.maskSecondaryFn)
    }

    static func flagFnEhImplicita(_ nomeBase: String) -> Bool {
        if nomeBase.hasPrefix("f"), Int(nomeBase.dropFirst()) != nil { return true }
        return ["up", "down", "left", "right", "home", "end", "pageup", "pagedown", "delete"]
            .contains(nomeBase)
    }
}

// Push-to-talk é sempre UM modificador segurado — não uma combinação. Segurar
// "ctrl+shift" para falar exigiria duas mãos e travaria os dois modificadores
// pelo tempo todo do ditado.
enum PttSpec {
    // keycode da tecla + a flag que ela liga. Os dois são necessários: o
    // keycode diz QUAL tecla física mudou de estado, a flag diz se ela foi
    // pressionada ou solta (o evento de flagsChanged não tem essa informação
    // por si).
    struct Tecla {
        let code: Int64
        let flag: CGEventFlags
    }

    static let tabela: [String: Tecla] = [
        "rcmd":   Tecla(code: 54, flag: .maskCommand),
        "lcmd":   Tecla(code: 55, flag: .maskCommand),
        "lshift": Tecla(code: 56, flag: .maskShift),
        "lopt":   Tecla(code: 58, flag: .maskAlternate),
        "lctrl":  Tecla(code: 59, flag: .maskControl),
        "rshift": Tecla(code: 60, flag: .maskShift),
        "ropt":   Tecla(code: 61, flag: .maskAlternate),
        "rctrl":  Tecla(code: 62, flag: .maskControl),
        // A tecla globo/Fn. Funciona como PTT, mas o sistema pode ter uma ação
        // ligada a ela (emojis, ditado da Apple) — a UI avisa sobre isso.
        "fn":     Tecla(code: 63, flag: .maskSecondaryFn)
    ]

    // Apelidos para specs vindos de um PC ou escritos à mão.
    static let aliases = ["ralt": "ropt", "lalt": "lopt"]

    static let padrao = "fn"

    static func parse(_ spec: String) -> Tecla {
        let limpo = spec.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let token = aliases[limpo] ?? limpo
        return tabela[token] ?? tabela[padrao]!
    }

    static func valido(_ spec: String) -> Bool {
        let limpo = spec.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return tabela[aliases[limpo] ?? limpo] != nil
    }
}
