import Cocoa
import ApplicationServices

// Dois modos de uso rápido do helper, chamados pelo Electron um processo por
// vez (`dita-hotkeys contexto` e `dita-hotkeys colar`).
//
// POR QUE PROCESSO SEPARADO E NÃO O HELPER DE ATALHOS QUE JÁ ESTÁ VIVO
// A leitura de Acessibilidade conversa com o app em foco, e um app travado pode
// segurar a chamada. Se isso acontecesse dentro do processo do CGEventTap, o
// tap seria desligado pelo sistema e TODOS os atalhos parariam. Isolado, o pior
// caso é um contexto vazio neste ditado; o Electron mata o processo no prazo.
// É o mesmo binário, então herda a permissão de Acessibilidade já concedida.

// Prazo de cada chamada AX. O padrão do sistema é 6 s, o que transformaria um
// app engasgado num ditado engasgado.
private let PRAZO_AX: Float = 0.25

// Orçamento da varredura das palavras da janela. O contexto é capturado no
// INÍCIO do ditado e só é usado no fim, mas a varredura não pode competir com o
// áudio por CPU durante a fala inteira.
private let PRAZO_VARREDURA: TimeInterval = 0.35
private let MAX_NOS = 1500
private let MAX_CHARS_TELA = 20000
private let MAX_CHARS_POR_TEXTO = 300

// Campo atual: o mesmo teto do Wispr (500 no total), com mais peso no que está
// ANTES do cursor, que é o que decide maiúscula, espaço e continuidade.
private let MAX_ANTES = 400
private let MAX_DEPOIS = 100

func emitirJSON(_ obj: [String: Any]) {
    if let dados = try? JSONSerialization.data(withJSONObject: obj, options: []),
       let linha = String(data: dados, encoding: .utf8) {
        print(linha)
        fflush(stdout)
    }
}

private func ax(_ el: AXUIElement, _ nome: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, nome as CFString, &v) == .success ? v : nil
}

private func axElemento(_ el: AXUIElement, _ nome: String) -> AXUIElement? {
    guard let v = ax(el, nome), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return (v as! AXUIElement)
}

private func axTexto(_ v: AnyObject?) -> String? {
    guard let v = v else { return nil }
    if let s = v as? String { return s }
    if CFGetTypeID(v) == CFURLGetTypeID() { return (v as! NSURL).absoluteString }
    return nil
}

private func axFaixa(_ el: AXUIElement) -> CFRange? {
    guard let v = ax(el, kAXSelectedTextRangeAttribute as String),
          CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    var r = CFRange()
    return AXValueGetValue(v as! AXValue, .cfRange, &r) ? r : nil
}

private func cortar(_ s: String, _ n: Int) -> String {
    s.count > n ? String(s.prefix(n)) : s
}

// Lê o campo em foco. Faixas da AX são em unidades UTF-16, por isso NSString.
private func lerCampo(_ el: AXUIElement) -> [String: Any] {
    let papel = axTexto(ax(el, kAXRoleAttribute as String)) ?? ""
    let subpapel = axTexto(ax(el, kAXSubroleAttribute as String)) ?? ""
    if subpapel == "AXSecureTextField" {
        // Campo de senha: não lê nada e avisa, o Electron não cola aqui.
        return ["papel": papel, "senha": true, "editavel": false]
    }

    var settable = DarwinBoolean(false)
    AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable)
    let papeisDeTexto: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
    let editavel = settable.boolValue || papeisDeTexto.contains(papel)

    var campo: [String: Any] = ["papel": papel, "editavel": editavel, "senha": false]
    guard let valor = axTexto(ax(el, kAXValueAttribute as String)) else {
        campo["leu"] = false
        return campo
    }
    let ns = valor as NSString
    var antes = "", depois = "", selecionado = ""
    if let f = axFaixa(el), f.location >= 0, f.location <= ns.length {
        let ini = f.location
        let fim = min(ns.length, f.location + max(0, f.length))
        antes = ns.substring(to: ini)
        selecionado = ns.substring(with: NSRange(location: ini, length: fim - ini))
        depois = ns.substring(from: fim)
    } else {
        // Sem faixa (alguns campos web): assume o cursor no fim, que é o caso
        // mais comum de quem acabou de clicar pra escrever.
        antes = valor
    }
    campo["leu"] = true
    campo["antes"] = antes.count > MAX_ANTES ? String(antes.suffix(MAX_ANTES)) : antes
    campo["depois"] = cortar(depois, MAX_DEPOIS)
    campo["selecionado"] = cortar(selecionado, 2000)
    return campo
}

// Varre a janela em largura juntando textos visíveis e, de passagem, a URL da
// área web (Safari e Chrome expõem AXURL no AXWebArea).
private func varrerJanela(_ janela: AXUIElement) -> (textos: [String], url: String?) {
    let limite = Date().addingTimeInterval(PRAZO_VARREDURA)
    var fila: [AXUIElement] = [janela]
    var i = 0
    var textos: [String] = []
    var chars = 0
    var url: String? = nil
    let nomes = [kAXRoleAttribute, kAXSubroleAttribute, kAXValueAttribute, kAXTitleAttribute,
                 kAXDescriptionAttribute, kAXChildrenAttribute, "AXURL"] as CFArray

    while i < fila.count && i < MAX_NOS && chars < MAX_CHARS_TELA && Date() < limite {
        let el = fila[i]; i += 1
        var valores: CFArray?
        guard AXUIElementCopyMultipleAttributeValues(el, nomes, AXCopyMultipleAttributeOptions(rawValue: 0), &valores) == .success,
              let v = valores as? [AnyObject], v.count == 7 else { continue }
        let papel = axTexto(v[0]) ?? ""
        let subpapel = axTexto(v[1]) ?? ""
        if subpapel == "AXSecureTextField" { continue }
        if papel == "AXWebArea", url == nil, let u = axTexto(v[6]), !u.isEmpty { url = u }
        for idx in [2, 3, 4] {
            if let s = axTexto(v[idx])?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
                let t = cortar(s, MAX_CHARS_POR_TEXTO)
                textos.append(t)
                chars += t.count
            }
        }
        if let filhos = v[5] as? [AXUIElement] { fila.append(contentsOf: filhos) }
    }
    return (textos, url)
}

func rodarContexto() -> Never {
    AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), PRAZO_AX)
    guard let app = NSWorkspace.shared.frontmostApplication else {
        emitirJSON(["event": "contexto", "ok": false, "motivo": "sem_app"])
        exit(0)
    }
    var saida: [String: Any] = [
        "event": "contexto",
        "ok": true,
        "app": app.localizedName ?? "",
        "bundleId": app.bundleIdentifier ?? "",
        "confiavel": AXIsProcessTrusted()
    ]
    guard AXIsProcessTrusted() else { emitirJSON(saida); exit(0) }

    let appEl = AXUIElementCreateApplication(app.processIdentifier)
    // Apps em Electron (Slack, Notion, WhatsApp desktop...) só montam a árvore
    // de Acessibilidade quando alguém pede. Em app nativo a chamada só falha.
    AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)

    if let foco = axElemento(appEl, kAXFocusedUIElementAttribute as String) {
        saida["campo"] = lerCampo(foco)
    }
    if let janela = axElemento(appEl, kAXFocusedWindowAttribute as String) {
        saida["janela"] = axTexto(ax(janela, kAXTitleAttribute as String)) ?? ""
        let (textos, url) = varrerJanela(janela)
        saida["textos"] = textos
        if let url = url { saida["url"] = url }
    }
    emitirJSON(saida)
    exit(0)
}

// Cola o texto que chega pelo stdin no campo em foco e devolve ao usuário o
// clipboard que ele tinha, com TODOS os tipos (imagem, arquivo, rich text), não
// só o texto puro. Sai depois da restauração; o Electron não espera por isso,
// só pela linha "colado".
func rodarColar(_ args: [String]) -> Never {
    var esperaRestaurar: TimeInterval = 0.6
    for a in args where a.hasPrefix("--restaurar-ms=") {
        if let ms = Double(a.dropFirst("--restaurar-ms=".count)) { esperaRestaurar = ms / 1000 }
    }
    let dados = FileHandle.standardInput.readDataToEndOfFile()
    guard let texto = String(data: dados, encoding: .utf8), !texto.isEmpty else {
        emitirJSON(["event": "erro", "motivo": "vazio"]); exit(1)
    }
    guard AXIsProcessTrusted() else {
        emitirJSON(["event": "erro", "motivo": "sem_permissao"]); exit(2)
    }

    let pb = NSPasteboard.general
    var salvos: [NSPasteboardItem] = []
    for item in pb.pasteboardItems ?? [] {
        let copia = NSPasteboardItem()
        for tipo in item.types {
            if let d = item.data(forType: tipo) { copia.setData(d, forType: tipo) }
        }
        salvos.append(copia)
    }

    pb.clearContents()
    let item = NSPasteboardItem()
    item.setString(texto, forType: .string)
    // Convenção nspasteboard.org: gerenciadores de clipboard (Raycast, Paste,
    // Maccy) não guardam o ditado no histórico deles como se fosse cópia.
    item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
    item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.AutoGeneratedType"))
    pb.writeObjects([item])
    let marca = pb.changeCount

    // Cmd+V com as flags EXATAS: se o usuário ainda estiver segurando algum
    // modificador do atalho, ele não pode virar Cmd+Opt+V (colar sem formatação
    // em alguns apps, nada em outros).
    let fonte = CGEventSource(stateID: .combinedSessionState)
    let teclaV: CGKeyCode = 9
    let desce = CGEvent(keyboardEventSource: fonte, virtualKey: teclaV, keyDown: true)
    let sobe = CGEvent(keyboardEventSource: fonte, virtualKey: teclaV, keyDown: false)
    desce?.flags = .maskCommand
    sobe?.flags = .maskCommand
    desce?.post(tap: .cghidEventTap)
    sobe?.post(tap: .cghidEventTap)
    emitirJSON(["event": "colado"])

    // Só restaura se ninguém mexeu no clipboard enquanto isso: se o usuário
    // copiou outra coisa nesse meio segundo, a cópia dele vale mais.
    Thread.sleep(forTimeInterval: esperaRestaurar)
    if pb.changeCount == marca && !salvos.isEmpty {
        pb.clearContents()
        pb.writeObjects(salvos)
    }
    exit(0)
}
