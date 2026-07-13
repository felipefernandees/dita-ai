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

// Configuração de atalhos via argv: --toggle=fn+space|opt+space|ctrl+space|f5
// e --ptt=rcmd|ropt
var toggleMode = "fn+space"
var pttMode = "rcmd"
for arg in CommandLine.arguments {
    if arg.hasPrefix("--toggle=") { toggleMode = String(arg.dropFirst("--toggle=".count)) }
    if arg.hasPrefix("--ptt=") { pttMode = String(arg.dropFirst("--ptt=".count)) }
}

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

let kVK_Space: Int64 = 49
let kVK_Escape: Int64 = 53
let kVK_RightCommand: Int64 = 54
let kVK_RightOption: Int64 = 61
let kVK_F5: Int64 = 96

let pttKeyCode: Int64 = pttMode == "ropt" ? kVK_RightOption : kVK_RightCommand
let pttFlag: CGEventFlags = pttMode == "ropt" ? .maskAlternate : .maskCommand

func isToggle(_ keyCode: Int64, _ flags: CGEventFlags) -> Bool {
    switch toggleMode {
    case "opt+space": return keyCode == kVK_Space && flags.contains(.maskAlternate)
    case "ctrl+space": return keyCode == kVK_Space && flags.contains(.maskControl)
    case "f5": return keyCode == kVK_F5
    default: return keyCode == kVK_Space && flags.contains(.maskSecondaryFn)
    }
}

let mask: CGEventMask =
    (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.flagsChanged.rawValue)

let callback: CGEventTapCallBack = { _, type, event, _ in
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags
    let st = State.shared

    if type == .flagsChanged && keyCode == pttKeyCode {
        if flags.contains(pttFlag) {
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
        // Toggle: suprime o evento pro sistema não digitar o caractere
        if isToggle(keyCode, flags) {
            emit("toggle")
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
