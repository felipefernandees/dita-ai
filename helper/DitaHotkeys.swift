import Cocoa
import CoreGraphics

// Estado compartilhado entre o tap e a thread de stdin
final class State {
    static let shared = State()
    var recording = false            // setado via stdin, controla supressão do Esc
    var rightCmdDown = false
    var rightCmdCombo = false
}

func emit(_ event: String) {
    print("{\"event\":\"\(event)\"}")
    fflush(stdout)
}

// Thread de stdin: "state on" / "state off"
DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        if line == "state on" { State.shared.recording = true }
        if line == "state off" { State.shared.recording = false }
    }
}

// Pede a permissão com o prompt oficial: isso registra o app na lista de
// Acessibilidade dos Ajustes. Depois fica aguardando a concessão (polling),
// sem morrer, pra não exigir reabrir o app.
if !AXIsProcessTrusted() {
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(opts)
    emit("no_permission")
    while !AXIsProcessTrusted() {
        Thread.sleep(forTimeInterval: 2)
    }
    emit("permission_granted")
}

let kVK_Space: Int64 = 49
let kVK_Escape: Int64 = 53
let kVK_RightCommand: Int64 = 54

let mask: CGEventMask =
    (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.flagsChanged.rawValue)

let callback: CGEventTapCallBack = { _, type, event, _ in
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags
    let st = State.shared

    if type == .flagsChanged && keyCode == kVK_RightCommand {
        if flags.contains(.maskCommand) {
            st.rightCmdDown = true
            st.rightCmdCombo = false
            emit("ptt_down")
        } else if st.rightCmdDown {
            st.rightCmdDown = false
            emit(st.rightCmdCombo ? "ptt_abort" : "ptt_up")
        }
        return Unmanaged.passRetained(event)
    }

    if type == .keyDown {
        // Fn+Espaço: toggle. Suprime o evento pro sistema não digitar espaço.
        if keyCode == kVK_Space && flags.contains(.maskSecondaryFn) {
            emit("toggle")
            return nil
        }
        // Esc: só reporta (e suprime) se estiver gravando
        if keyCode == kVK_Escape && st.recording {
            emit("esc")
            return nil
        }
        // Qualquer tecla com right-cmd segurado = combo normal (Cmd+V etc.), aborta PTT
        if st.rightCmdDown {
            st.rightCmdCombo = true
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
