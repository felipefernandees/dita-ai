using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace DitaHelper;

internal static class HotkeysCommand
{
    // O delegate precisa de uma referência gerenciada viva: o Windows guarda
    // só o ponteiro nativo, e o GC coletaria o thunk no meio da sessão.
    private static Native.HookProc? _proc;
    private static IntPtr _hook = IntPtr.Zero;

    // O HookCallback NUNCA pode escrever no pipe do stdout. O Windows impõe
    // LowLevelHooksTimeout (HKCU\Control Panel\Desktop, ~300ms por padrão) a
    // cada chamada de um hook low-level: se o callback estourar esse prazo, o
    // sistema desregistra o hook SILENCIOSAMENTE — sem exceção, sem erro, sem
    // evento — e os atalhos do usuário morrem pelo resto da sessão (o
    // hotkeys.js do Electron não tem lógica de restart). Uma escrita no pipe
    // bloqueia sempre que o Electron para de drenar nosso stdout, mesmo que
    // brevemente (pausa de GC, transcrição pesada, renderer travado). Por isso
    // o callback só enfileira, e uma thread dedicada escreve.
    //
    // A fila é DELIBERADAMENTE sem capacidade máxima. Não troque por uma
    // BlockingCollection limitada nem por uma fila que descarta eventos: com
    // limite, o Add volta a bloquear o produtor — que é o callback — e o
    // problema retorna inteiro; descartando, um ptt_up perdido deixaria o app
    // preso em estado de gravação para sempre. A fila só cresce se o Electron
    // parou de ler de vez, e nesse caso o app já morreu — a memória gasta não
    // importa mais.
    private static readonly BlockingCollection<string> _queue = new();
    private static Thread? _writer;

    private static ToggleSpec _toggle = ToggleSpec.Parse("ctrl+shift+space");
    private static int _pttVk = Native.VK_RCONTROL;

    private static volatile bool _recording; // escrito pela thread do stdin
    private static bool _toggleHeld;         // anti auto-repeat
    private static bool _pttDown;
    private static bool _pttCombo;

    public static int Run(string[] args)
    {
        foreach (var arg in args)
        {
            if (arg.StartsWith("--toggle=", StringComparison.Ordinal))
                _toggle = ToggleSpec.Parse(arg["--toggle=".Length..]);
            if (arg.StartsWith("--ptt=", StringComparison.Ordinal))
                _pttVk = PttSpec.Parse(arg["--ptt=".Length..]);
        }

        new Thread(ReadStdinLoop) { IsBackground = true }.Start();
        StartWriter();

        _proc = HookCallback;
        _hook = Native.SetWindowsHookExW(
            Native.WH_KEYBOARD_LL, _proc, Native.GetModuleHandleW(null), 0);

        if (_hook == IntPtr.Zero)
        {
            Emit("no_permission");
            Drain();
            return 1;
        }

        Emit("ready");

        // Um hook low-level só é chamado se a thread que o instalou bombeia
        // mensagens. Sem este laço o callback nunca dispara.
        while (Native.GetMessageW(out _, IntPtr.Zero, 0, 0) > 0) { }

        Native.UnhookWindowsHookEx(_hook);
        Drain();
        return 0;
    }

    private static void StartWriter()
    {
        // IsBackground = true: quando o laço de mensagens termina, o processo
        // está saindo e a thread escritora não pode segurá-lo vivo — ela pode
        // estar parada para sempre numa escrita no pipe, que é exatamente o
        // cenário que a fila existe para tolerar. O flush ordenado da saída
        // normal fica por conta do Drain() abaixo, não do runtime.
        _writer = new Thread(WriterLoop) { IsBackground = true, Name = "stdout-writer" };
        _writer.Start();
    }

    private static void WriterLoop()
    {
        // GetConsumingEnumerable() bloqueia enquanto a fila está vazia e só
        // termina depois de CompleteAdding() + fila drenada.
        foreach (var line in _queue.GetConsumingEnumerable())
        {
            try
            {
                Console.Out.Write(line);
                Console.Out.Flush();
            }
            catch (IOException) { /* o Electron fechou o pipe: nada a fazer */ }
            catch (ObjectDisposedException) { }
        }
    }

    // Saída normal: fecha a fila para o writer terminar o foreach e dá a ele um
    // prazo para escrever o que sobrou. O Join é limitado porque o writer pode
    // estar preso numa escrita que nunca completa; nesse caso IsBackground
    // garante que o processo sai mesmo assim, em vez de virar zumbi.
    private static void Drain()
    {
        _queue.CompleteAdding();
        _writer?.Join(TimeSpan.FromSeconds(2));
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return Native.CallNextHookEx(_hook, nCode, wParam, lParam);

        var data = Marshal.PtrToStructure<Native.KBDLLHOOKSTRUCT>(lParam);

        // Ignora o Ctrl+V que nós mesmos injetamos ao colar: sem isto o helper
        // veria o próprio paste como "combo" e abortaria o PTT seguinte.
        if ((data.flags & Native.LLKHF_INJECTED) != 0)
            return Native.CallNextHookEx(_hook, nCode, wParam, lParam);

        int msg = (int)wParam;
        int vk = (int)data.vkCode;
        bool isDown = msg == Native.WM_KEYDOWN || msg == Native.WM_SYSKEYDOWN;
        bool isUp = msg == Native.WM_KEYUP || msg == Native.WM_SYSKEYUP;

        // Push-to-talk: o modificador sozinho. Nunca suprimido — o usuário
        // ainda precisa dele para os atalhos normais do sistema.
        if (vk == _pttVk)
        {
            if (isDown && !_pttDown)
            {
                _pttDown = true;
                _pttCombo = false;
                Emit("ptt_down");
            }
            else if (isUp && _pttDown)
            {
                _pttDown = false;
                Emit(_pttCombo ? "ptt_abort" : "ptt_up");
            }
            return Native.CallNextHookEx(_hook, nCode, wParam, lParam);
        }

        if (isDown)
        {
            if (_toggle.Matches(vk))
            {
                // segurar a tecla não deve disparar vários toggles
                if (!_toggleHeld) { _toggleHeld = true; Emit("toggle"); }
                return (IntPtr)1; // suprime: o app em foco não digita o caractere
            }
            if (vk == Native.VK_ESCAPE && _recording)
            {
                Emit("esc");
                return (IntPtr)1;
            }
            // Tecla de ação com o PTT segurado = combo normal (Ctrl+C etc),
            // aborta o ditado. Modificador NÃO conta:
            //
            //   1. Em teclado ABNT2 o AltGr É o Right Alt, e o Windows injeta
            //      um LeftCtrl junto — que auto-repete enquanto a tecla está
            //      segurada. Com a regra antiga o AltGr abortava a si mesmo, e
            //      o push-to-talk simplesmente não funcionava nesse layout.
            //   2. Mesmo fora do ABNT2, segurar Shift no meio da fala não é
            //      intenção de cancelar ditado nenhum.
            if (_pttDown && !EhModificador(vk))
            {
                _pttCombo = true;
                Emit("combo");
            }
        }
        else if (isUp && vk == _toggle.Vk && _toggleHeld)
        {
            // o keydown foi suprimido; suprimir o keyup solto evita que o app
            // em foco veja metade da combinação. Os modificadores já podem ter
            // sido soltos, então comparamos só a tecla base.
            _toggleHeld = false;
            return (IntPtr)1;
        }

        return Native.CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    // Teclas que só modificam outras. Segurar uma delas nunca é "o usuário
    // quis fazer outra coisa", então não aborta um push-to-talk em andamento.
    private static bool EhModificador(int vk) =>
        vk == Native.VK_SHIFT || vk == Native.VK_LSHIFT || vk == Native.VK_RSHIFT ||
        vk == Native.VK_CONTROL || vk == Native.VK_LCONTROL || vk == Native.VK_RCONTROL ||
        vk == Native.VK_MENU || vk == Native.VK_LMENU || vk == Native.VK_RMENU ||
        vk == Native.VK_LWIN || vk == Native.VK_RWIN ||
        vk == Native.VK_CAPITAL;

    // Chamado de dentro do HookCallback: só enfileira. Add() numa
    // BlockingCollection sem capacidade nunca bloqueia o produtor.
    private static void Emit(string ev)
    {
        try { _queue.Add("{\"event\":\"" + ev + "\"}\n"); }
        catch (InvalidOperationException) { /* Drain() já fechou a fila */ }
    }

    private static void ReadStdinLoop()
    {
        string? line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (line == "state on") _recording = true;
            else if (line == "state off") _recording = false;
        }
    }
}
