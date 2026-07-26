namespace DitaHelper;

internal static class Program
{
    public static int Main(string[] args)
    {
        var command = args.Length > 0 ? args[0] : "";
        return command switch
        {
            "hotkeys" => HotkeysCommand.Run(args),
            "paste" => PasteCommand.Run(),
            "frontapp" => FrontAppCommand.Run(),
            _ => Usage()
        };
    }

    private static int Usage()
    {
        Console.Error.WriteLine("uso: dita-helper <hotkeys|paste|frontapp> [--toggle=...] [--ptt=...]");
        return 2;
    }
}
