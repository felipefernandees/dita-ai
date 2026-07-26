namespace DitaHelper;

// Atalho de toggle: uma tecla base + um conjunto EXATO de modificadores.
// Exato importa: com "ctrl+space" configurado, Ctrl+Shift+Espaço não deve
// disparar o toggle — senão o usuário perde combinações do app em foco.
internal sealed class ToggleSpec
{
    public int Vk;
    public bool Ctrl;
    public bool Shift;
    public bool Alt;

    public static ToggleSpec Parse(string spec) => spec switch
    {
        "ctrl+space" => new ToggleSpec { Vk = Native.VK_SPACE, Ctrl = true },
        "alt+space" => new ToggleSpec { Vk = Native.VK_SPACE, Alt = true },
        "f5" => new ToggleSpec { Vk = Native.VK_F5 },
        // default = ctrl+shift+space (não colide com o alternador de IME
        // nem com o menu de janela)
        _ => new ToggleSpec { Vk = Native.VK_SPACE, Ctrl = true, Shift = true }
    };

    public bool Matches(int vk)
    {
        if (vk != Vk) return false;
        return Ctrl == Down(Native.VK_CONTROL)
            && Shift == Down(Native.VK_SHIFT)
            && Alt == Down(Native.VK_MENU);
    }

    private static bool Down(int vk) => (Native.GetAsyncKeyState(vk) & 0x8000) != 0;
}

internal static class PttSpec
{
    // Espelha PTT_OPTIONS de defaults.js — os valores são contrato entre as
    // duas camadas, então o que a UI não oferece o parser não reconhece.
    //
    // "ralt" existe como opção mas nunca é o default no Windows: em teclado
    // ABNT2 o Right Alt é o AltGr, usado para ç, º, ₢.
    //
    // "rwin" saiu de propósito: um toque solto abre o menu Iniciar e teclas de
    // PTT nunca são suprimidas. Cair no default (rctrl) é melhor do que honrar
    // uma configuração antiga e deixar o push-to-talk quebrado.
    public static int Parse(string spec) => spec switch
    {
        "rshift" => Native.VK_RSHIFT,
        "ralt" => Native.VK_RMENU,
        _ => Native.VK_RCONTROL
    };
}
