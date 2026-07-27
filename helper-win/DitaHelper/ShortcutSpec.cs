namespace DitaHelper;

// Vocabulário de atalhos. Isto é o CONTRATO DE FIO com o renderer: o Electron
// nos passa --toggle=<spec> --ptt=<spec> e a UI monta essas strings a partir de
// um KeyboardEvent. O espelho em JS é app/src/renderer/src/atalhos.js, e o
// cenário "parse" do harness (app/tests/fixtures/emit-harness) existe para que
// os dois não divirjam em silêncio.
//
// Formato do toggle: tokens minúsculos unidos por '+', zero ou mais
// modificadores (ctrl, alt, shift, win — SEMPRE nessa ordem) seguidos de
// exatamente UMA tecla base. Ex.: "ctrl+shift+space", "alt+f9", "win+j".
internal static class Teclas
{
    // Nome -> virtual-key. Os números são os VK_* do WinUser.h; estão aqui como
    // literais em vez de constantes espalhadas no Native.cs porque isto é uma
    // TABELA — o valor só importa em conjunto com o nome ao lado.
    //
    // As teclas OEM são nomeadas pela POSIÇÃO FÍSICA (legenda de teclado US,
    // exatamente como o KeyboardEvent.code do Chromium), não pelo caractere
    // impresso. Isso não é anglicismo preguiçoso: o valor de VK_OEM_* é
    // posicional — VK_OEM_1 é sempre a tecla à direita do L, seja ela ';' num
    // teclado US ou 'Ç' num ABNT2. Nomear pelo caractere ("cedilha") faria o
    // mesmo spec apontar para teclas físicas diferentes conforme o layout ativo
    // no momento em que o usuário gravou o atalho. Os rótulos em português da
    // UI é que traduzem a posição para a legenda ABNT2 (semicolon -> "Ç").
    public static readonly Dictionary<string, int> Base = MontarBase();

    // Modificadores, na ordem canônica de serialização.
    public static readonly string[] Modificadores = { "ctrl", "alt", "shift", "win" };

    private static Dictionary<string, int> MontarBase()
    {
        var t = new Dictionary<string, int>(StringComparer.Ordinal);

        // 'a'..'z' -> VK_A..VK_Z (0x41..0x5A) e '0'..'9' -> 0x30..0x39.
        // Também posicionais: VK_A é a tecla na posição do A do layout US.
        for (char c = 'a'; c <= 'z'; c++) t[c.ToString()] = 0x41 + (c - 'a');
        for (char d = '0'; d <= '9'; d++) t[d.ToString()] = 0x30 + (d - '0');

        // F1..F24 = 0x70..0x87, contíguos.
        for (int i = 1; i <= 24; i++) t["f" + i] = 0x70 + (i - 1);

        t["space"] = 0x20;      // VK_SPACE
        t["enter"] = 0x0D;      // VK_RETURN
        t["tab"] = 0x09;        // VK_TAB
        t["esc"] = 0x1B;        // VK_ESCAPE
        t["backspace"] = 0x08;  // VK_BACK
        t["insert"] = 0x2D;     // VK_INSERT
        t["delete"] = 0x2E;     // VK_DELETE
        t["home"] = 0x24;       // VK_HOME
        t["end"] = 0x23;        // VK_END
        t["pageup"] = 0x21;     // VK_PRIOR
        t["pagedown"] = 0x22;   // VK_NEXT
        t["up"] = 0x26;         // VK_UP
        t["down"] = 0x28;       // VK_DOWN
        t["left"] = 0x25;       // VK_LEFT
        t["right"] = 0x27;      // VK_RIGHT

        // OEM. Comentário = a legenda ABNT2 daquela posição.
        t["semicolon"] = 0xBA;      // VK_OEM_1      — Ç no ABNT2
        t["slash"] = 0xBF;          // VK_OEM_2      — ; : no ABNT2
        t["backquote"] = 0xC0;      // VK_OEM_3      — ' " no ABNT2
        t["bracketleft"] = 0xDB;    // VK_OEM_4      — ´ ` (tecla morta)
        t["backslash"] = 0xDC;      // VK_OEM_5      — ] } no ABNT2
        t["bracketright"] = 0xDD;   // VK_OEM_6      — [ { no ABNT2
        t["quote"] = 0xDE;          // VK_OEM_7      — ~ ^ (tecla morta)
        t["minus"] = 0xBD;          // VK_OEM_MINUS  — - _
        t["equal"] = 0xBB;          // VK_OEM_PLUS   — = +
        t["comma"] = 0xBC;          // VK_OEM_COMMA  — , <
        t["period"] = 0xBE;         // VK_OEM_PERIOD — . >
        t["intlbackslash"] = 0xE2;  // VK_OEM_102    — \ | (tecla extra ISO)
        t["intlro"] = 0xC1;         // VK_ABNT_C1    — / ? (tecla extra ABNT2)

        return t;
    }

    // Só as teclas de função podem valer como atalho SEM modificador nenhum.
    // Qualquer outra base sozinha seria suprimida pelo hook em todo o sistema —
    // configurar "j" faria a letra J parar de funcionar no Windows inteiro, e o
    // usuário não teria como digitar nas Preferências para desfazer.
    public static bool PodeFicarSozinha(string nomeBase) =>
        nomeBase.Length >= 2 && nomeBase[0] == 'f' &&
        int.TryParse(nomeBase.AsSpan(1), out int n) && n >= 1 && n <= 24;

    // Combinações que o sistema operacional reserva. Não é preciosismo: o hook
    // low-level nem sequer VÊ ctrl+alt+delete (o SAS é tratado antes, em
    // kernel) nem win+l (bloqueio de sessão), então configurá-las daria um
    // atalho que simplesmente nunca dispara. alt+f4 e alt+tab o hook até vê,
    // mas suprimi-las quebraria fechar janela e alternar janela no sistema
    // inteiro — hostil demais para valer a escolha.
    public static readonly HashSet<string> Reservadas = new(StringComparer.Ordinal)
    {
        "alt+f4", "alt+tab", "ctrl+alt+delete", "win+l"
    };
}

// Por que um atalho foi recusado. O helper só usa isto para decidir se cai no
// default; quem transforma em frase é a UI (atalhos.js tem o mesmo enum).
internal enum MotivoRecusa
{
    Ok = 0,
    Vazio,          // string vazia / só '+'
    TokenDesconhecido,
    SemBase,        // só modificadores
    BaseDuplicada,  // duas teclas não-modificadoras
    ModificadorRepetido,
    PrecisaModificador, // tecla comum sozinha
    Reservada
}

// Atalho de toggle: uma tecla base + um conjunto EXATO de modificadores.
// Exato importa: com "ctrl+space" configurado, Ctrl+Shift+Espaço não deve
// disparar o toggle — senão o usuário perde combinações do app em foco.
internal sealed class ToggleSpec
{
    public int Vk;
    public bool Ctrl;
    public bool Shift;
    public bool Alt;
    public bool Win;
    // Guardado junto com o VK só para o Serializar() não precisar varrer a
    // tabela ao contrário (dois nomes nunca mapeiam para o mesmo VK hoje, mas
    // depender disso seria uma armadilha para quem adicionar uma tecla amanhã).
    public string NomeBase = "";

    // O default: não colide com o alternador de IME (ctrl+space) nem com o menu
    // de janela (alt+space).
    public const string Padrao = "ctrl+shift+space";

    // Qualquer entrada inválida cai no default em vez de derrubar o helper.
    // Isso inclui os specs do macOS ("fn+space", "opt+space"): eles nunca
    // deveriam chegar aqui — quem os interpreta é o helper em Swift — mas um
    // settings.json copiado de um Mac não pode matar os atalhos no Windows.
    public static ToggleSpec Parse(string spec) =>
        TryParse(spec, out var s, out _) ? s! : Fallback();

    private static ToggleSpec Fallback()
    {
        // Recursão impossível: o padrão é válido por construção, e os testes do
        // harness cobrem isso — se alguém quebrar a tabela, o cenário "parse"
        // acusa antes de virar stack overflow em produção.
        TryParse(Padrao, out var s, out _);
        return s!;
    }

    public static bool TryParse(string spec, out ToggleSpec? resultado, out MotivoRecusa motivo)
    {
        resultado = null;
        motivo = MotivoRecusa.Ok;

        if (string.IsNullOrWhiteSpace(spec)) { motivo = MotivoRecusa.Vazio; return false; }

        var s = new ToggleSpec();
        string? nomeBase = null;
        var partes = spec.Trim().ToLowerInvariant().Split('+');

        foreach (var parte in partes)
        {
            if (parte.Length == 0) { motivo = MotivoRecusa.Vazio; return false; }

            switch (parte)
            {
                case "ctrl":
                    if (s.Ctrl) { motivo = MotivoRecusa.ModificadorRepetido; return false; }
                    s.Ctrl = true; continue;
                case "alt":
                    if (s.Alt) { motivo = MotivoRecusa.ModificadorRepetido; return false; }
                    s.Alt = true; continue;
                case "shift":
                    if (s.Shift) { motivo = MotivoRecusa.ModificadorRepetido; return false; }
                    s.Shift = true; continue;
                case "win":
                    if (s.Win) { motivo = MotivoRecusa.ModificadorRepetido; return false; }
                    s.Win = true; continue;
            }

            if (!Teclas.Base.TryGetValue(parte, out int vk))
            {
                motivo = MotivoRecusa.TokenDesconhecido;
                return false;
            }
            // Duas teclas base ("ctrl+a+b") não descrevem nada que o hook possa
            // casar: ele recebe um VK por evento.
            if (nomeBase != null) { motivo = MotivoRecusa.BaseDuplicada; return false; }
            nomeBase = parte;
            s.NomeBase = parte;
            s.Vk = vk;
        }

        if (nomeBase == null) { motivo = MotivoRecusa.SemBase; return false; }

        if (!s.Ctrl && !s.Alt && !s.Shift && !s.Win && !Teclas.PodeFicarSozinha(nomeBase))
        {
            motivo = MotivoRecusa.PrecisaModificador;
            return false;
        }

        if (Teclas.Reservadas.Contains(s.Serializar()))
        {
            motivo = MotivoRecusa.Reservada;
            return false;
        }

        resultado = s;
        return true;
    }

    // Forma canônica: modificadores na ordem fixa, base por último. É o que a
    // comparação com Reservadas usa — sem isto, "f4+alt" escaparia do filtro.
    public string Serializar()
    {
        var partes = new List<string>(5);
        if (Ctrl) partes.Add("ctrl");
        if (Alt) partes.Add("alt");
        if (Shift) partes.Add("shift");
        if (Win) partes.Add("win");
        partes.Add(NomeBase);
        return string.Join("+", partes);
    }

    public bool Matches(int vk)
    {
        if (vk != Vk) return false;
        return Ctrl == Down(Native.VK_CONTROL)
            && Shift == Down(Native.VK_SHIFT)
            && Alt == Down(Native.VK_MENU)
            // Não existe VK genérico para a tecla Windows (o VK_LWIN/VK_RWIN
            // não têm um "VK_WIN" que agregue os dois), então o OR é manual.
            && Win == (Down(Native.VK_LWIN) || Down(Native.VK_RWIN));
    }

    private static bool Down(int vk) => (Native.GetAsyncKeyState(vk) & 0x8000) != 0;
}

// Push-to-talk é sempre UM modificador segurado — não uma combinação. Segurar
// "ctrl+shift" para falar exigiria duas mãos e travaria os dois modificadores
// pelo tempo todo do ditado.
internal static class PttSpec
{
    // 'rwin'/'lwin' ficaram DE FORA de propósito: um toque solto na tecla
    // Windows abre o menu Iniciar, e teclas de PTT nunca são suprimidas (o
    // usuário ainda precisa delas para os atalhos normais do sistema). Cair no
    // default é melhor do que honrar uma configuração antiga e deixar o
    // push-to-talk quebrado.
    //
    // 'ralt' existe como opção mas nunca é o default no Windows: em teclado
    // ABNT2 o Right Alt é o AltGr, usado para ç, º, ₢.
    public static readonly Dictionary<string, int> Tabela = new(StringComparer.Ordinal)
    {
        ["rctrl"] = Native.VK_RCONTROL,
        ["lctrl"] = Native.VK_LCONTROL,
        ["rshift"] = Native.VK_RSHIFT,
        ["lshift"] = Native.VK_LSHIFT,
        ["ralt"] = Native.VK_RMENU,
        ["lalt"] = Native.VK_LMENU
    };

    public const string Padrao = "rctrl";

    public static int Parse(string spec) => TryParse(spec, out int vk) ? vk : Tabela[Padrao];

    public static bool TryParse(string spec, out int vk)
    {
        vk = 0;
        if (string.IsNullOrWhiteSpace(spec)) return false;
        return Tabela.TryGetValue(spec.Trim().ToLowerInvariant(), out vk);
    }
}
