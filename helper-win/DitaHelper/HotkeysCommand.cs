using System.Runtime.InteropServices;

namespace DitaHelper;

internal static class HotkeysCommand
{
    // O delegate precisa de uma referência gerenciada viva: o Windows guarda
    // só o ponteiro nativo, e o GC coletaria o thunk no meio da sessão.
    private static Native.HookProc? _proc;
    private static IntPtr _hook = IntPtr.Zero;

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

        _proc = HookCallback;
        _hook = Native.SetWindowsHookExW(
            Native.WH_KEYBOARD_LL, _proc, Native.GetModuleHandleW(null), 0);

        if (_hook == IntPtr.Zero)
        {
            Emit("no_permission");
            return 1;
        }

        Emit("ready");

        // Um hook low-level só é chamado se a thread que o instalou bombeia
        // mensagens. Sem este laço o callback nunca dispara.
        while (Native.GetMessageW(out _, IntPtr.Zero, 0, 0) > 0) { }

        Native.UnhookWindowsHookEx(_hook);
        return 0;
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
            // qualquer outra tecla com o PTT segurado = combo normal, aborta
            if (_pttDown)
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

    private static void Emit(string ev)
    {
        Console.Out.Write("{\"event\":\"" + ev + "\"}\n");
        Console.Out.Flush();
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
