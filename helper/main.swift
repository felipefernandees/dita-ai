import Cocoa
import CoreGraphics

// Estado compartilhado entre o tap e a thread de stdin
final class State {
    static let shared = State()
    var recording = false            // setado via stdin, controla supressão do Esc
    var pttDown = false
    var pttCombo = false
}

func emit(_ event: String) {
    print("{\"event\":\"\(event)\"}")
    fflush(stdout)
}

// Modo `parse`: não sobe tap nenhum, só responde o que o parser acha de um spec
// e sai. É por aqui que app/tests/helper-mac.parse.test.js compara, veredicto a
// veredicto, este parser com o espelho em JS (src/renderer/src/atalhos.js) —
// sem isso os dois divergem em silêncio e o usuário só descobre que "o atalho
// não pegou".
func rodarParse(_ args: [String]) -> Never {
    let specs = Array(args.dropFirst(2))
    var saidas: [String] = []
    for spec in specs {
        let escapado = spec.replacingOccurrences(of: "\\", with: "\\\\")
                           .replacingOccurrences(of: "\"", with: "\\\"")
        do {
            let s = try ToggleSpec.tryParse(spec)
            saidas.append("{\"spec\":\"\(escapado)\",\"ok\":true,\"canonico\":\"\(s.serializar())\",\"keyCode\":\(s.keyCode)}")
        } catch let r as ToggleSpec.Recusa {
            saidas.append("{\"spec\":\"\(escapado)\",\"ok\":false,\"motivo\":\"\(r.motivo.rawValue)\"}")
        } catch {
            saidas.append("{\"spec\":\"\(escapado)\",\"ok\":false,\"motivo\":\"TokenDesconhecido\"}")
        }
    }
    print("[" + saidas.joined(separator: ",") + "]")
    exit(0)
}

// Modo `ptt`: mesma ideia do parse, para a lista de push-to-talk.
func rodarPtt(_ args: [String]) -> Never {
    let specs = Array(args.dropFirst(2))
    let saidas = specs.map { spec -> String in
        "{\"spec\":\"\(spec)\",\"ok\":\(PttSpec.valido(spec) ? "true" : "false"),\"keyCode\":\(PttSpec.parse(spec).code)}"
    }
    print("[" + saidas.joined(separator: ",") + "]")
    exit(0)
}

let argumentos = CommandLine.arguments
if argumentos.count > 1 {
    if argumentos[1] == "parse" { rodarParse(argumentos) }
    if argumentos[1] == "ptt" { rodarPtt(argumentos) }
}

// Configuração de atalhos via argv: --toggle=<spec> --ptt=<spec>.
// O vocabulário completo está em ShortcutSpec.swift; spec inválido cai no
// default em vez de derrubar o helper e deixar o app sem atalho nenhum.
var toggleArg = ToggleSpec.padrao
var pttArg = PttSpec.padrao
for arg in argumentos {
    if arg.hasPrefix("--toggle=") { toggleArg = String(arg.dropFirst("--toggle=".count)) }
    if arg.hasPrefix("--ptt=") { pttArg = String(arg.dropFirst("--ptt=".count)) }
}
let toggleSpec = ToggleSpec.parse(toggleArg)
let ptt = PttSpec.parse(pttArg)

// Thread de stdin: "state on" / "state off"
DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        if line == "state on" { State.shared.recording = true }
        if line == "state off" { State.shared.recording = false }
    }
}

// Pede a permissão com o prompt oficial (registra o app na lista) e aguarda
// a concessão sem morrer.
if !AXIsProcessTrusted() {
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(opts)
    emit("no_permission")
    while !AXIsProcessTrusted() {
        Thread.sleep(forTimeInterval: 2)
    }
    emit("permission_granted")
}

let kVK_Escape: Int64 = 53

let mask: CGEventMask =
    (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.flagsChanged.rawValue)

let callback: CGEventTapCallBack = { _, type, event, _ in
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags
    let st = State.shared

    if type == .flagsChanged && keyCode == ptt.code {
        if flags.contains(ptt.flag) {
            st.pttDown = true
            st.pttCombo = false
            emit("ptt_down")
        } else if st.pttDown {
            st.pttDown = false
            emit(st.pttCombo ? "ptt_abort" : "ptt_up")
        }
        return Unmanaged.passRetained(event)
    }

    if type == .keyDown {
        // Ignora auto-repeat: segurar a tecla NÃO deve disparar vários toggles
        // (era isso que fazia o popup piscar/sumir no meio da fala)
        let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0

        // Toggle: suprime o evento pro sistema não digitar o caractere
        if toggleSpec.casaCom(keyCode: keyCode, flags: flags) {
            if !isRepeat { emit("toggle") }
            return nil
        }
        // Esc: só reporta (e suprime) se estiver gravando
        if keyCode == kVK_Escape && st.recording {
            emit("esc")
            return nil
        }
        // Qualquer tecla com o modificador de PTT segurado = combo normal, aborta
        if st.pttDown {
            st.pttCombo = true
            emit("combo")
        }
    }

    return Unmanaged.passRetained(event)
}

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: mask,
    callback: callback,
    userInfo: nil
) else {
    emit("no_permission")
    exit(1)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit("ready")
CFRunLoopRun()
