using System.Diagnostics;

namespace DitaHelper;

internal static class FrontAppCommand
{
    public static int Run()
    {
        var hwnd = Native.GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return 0; // nada em foco: string vazia, como no Mac

        _ = Native.GetWindowThreadProcessId(hwnd, out uint pid);
        if (pid == 0) return 0;

        try
        {
            Console.Out.Write(Process.GetProcessById((int)pid).ProcessName);
        }
        catch (ArgumentException)
        {
            // processo morreu entre o GetForegroundWindow e o GetProcessById
        }
        return 0;
    }
}
