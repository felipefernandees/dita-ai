using System.Runtime.InteropServices;

namespace DitaHelper;

internal static class PasteCommand
{
    // Marca nossos proprios eventos para que o hook de hotkeys saiba ignora-los.
    public static readonly IntPtr SIGNATURE = new(0xD17A);

    public static int Run()
    {
        var inputs = new[]
        {
            Key(Native.VK_CONTROL, false),
            Key(Native.VK_V, false),
            Key(Native.VK_V, true),
            Key(Native.VK_CONTROL, true)
        };

        uint sent = Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Native.INPUT>());

        // SendInput retorna quantos eventos entraram na fila. Menos que o
        // pedido significa bloqueio por UIPI (janela elevada em foco).
        if (sent != inputs.Length)
        {
            Console.Error.Write("SendInput bloqueado: a janela em foco roda como administrador");
            return 1;
        }
        return 0;
    }

    private static Native.INPUT Key(int vk, bool up) => new()
    {
        type = Native.INPUT_KEYBOARD,
        u = new Native.INPUTUNION
        {
            ki = new Native.KEYBDINPUT
            {
                wVk = (ushort)vk,
                wScan = 0,
                dwFlags = up ? Native.KEYEVENTF_KEYUP : 0,
                time = 0,
                dwExtraInfo = SIGNATURE
            }
        }
    };
}
