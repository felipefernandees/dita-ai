using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using DitaHelper;

// Prova, contra o código real do helper, que o HookCallback não bloqueia
// quando ninguém está drenando o stdout.
//
// Por que isso importa: o Windows aplica LowLevelHooksTimeout (~300ms) a cada
// chamada de um hook WH_KEYBOARD_LL. Estourou, o sistema desregistra o hook
// sem avisar e os atalhos morrem. A versão anterior do Emit() escrevia direto
// no pipe do stdout de dentro do callback, então bastava o Electron parar de
// ler para os atalhos morrerem de vez.
//
// O relatório sai no stderr — o stdout é exatamente o que este teste entope.
internal static class Harness
{
    private const int Events = 2000;

    private static MethodInfo Priv(string name) =>
        typeof(HotkeysCommand).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)!;

    private static int Main(string[] args) => (args.Length > 0 ? args[0] : "") switch
    {
        "drain" => Drain(),
        "altgr" => AltGr(),
        "parse" => ParseSpecs(args.Skip(1).ToArray()),
        _ => NonBlocking()
    };

    // Cenário 4: o vocabulário de atalhos. O formato dos specs é contrato de
    // fio entre o renderer (atalhos.js monta a string) e o helper (ShortcutSpec
    // faz o parse), e nada além deste cenário percebe se os dois divergirem —
    // uma string que a UI grava e o helper recusa vira um atalho que
    // silenciosamente volta ao default, sem erro em lugar nenhum.
    //
    // Recebe os specs como argumentos ("toggle:ctrl+space", "ptt:rshift") para
    // que a LISTA viva no teste em JS, ao lado das expectativas, em vez de
    // ficar duplicada aqui. Imprime uma linha JSON por spec, na ordem recebida.
    private static int ParseSpecs(string[] specs)
    {
        foreach (var entrada in specs)
        {
            // Despeja o vocabulário inteiro do helper. É o outro lado da
            // comparação: sem isto o teste só provaria que o C# aceita o que o
            // JS conhece, e uma tecla que só o C# conhece passaria batida.
            if (entrada == "@tokens")
            {
                Console.Out.WriteLine(
                    "{\"kind\":\"tokens\",\"base\":[" +
                    string.Join(",", Teclas.Base.Keys.Select(Str)) +
                    "],\"ptt\":[" +
                    string.Join(",", PttSpec.Tabela.Keys.Select(Str)) +
                    "],\"reservadas\":[" +
                    string.Join(",", Teclas.Reservadas.Select(Str)) +
                    "],\"modificadores\":[" +
                    string.Join(",", Teclas.Modificadores.Select(Str)) +
                    "]}");
                continue;
            }

            int sep = entrada.IndexOf(':');
            string tipo = sep < 0 ? "toggle" : entrada[..sep];
            string spec = sep < 0 ? entrada : entrada[(sep + 1)..];

            if (tipo == "ptt")
            {
                // ok=false + o vk do fallback: o teste precisa distinguir
                // "parseou como rctrl" de "caiu no rctrl porque era inválido".
                bool ok = PttSpec.TryParse(spec, out int vk);
                Console.Out.WriteLine(
                    "{\"kind\":\"ptt\",\"spec\":" + Str(spec) +
                    ",\"ok\":" + Bool(ok) +
                    ",\"vk\":" + PttSpec.Parse(spec) + "}");
                continue;
            }

            bool okT = ToggleSpec.TryParse(spec, out var parsed, out var motivo);
            var efetivo = okT ? parsed! : ToggleSpec.Parse(spec);
            Console.Out.WriteLine(
                "{\"kind\":\"toggle\",\"spec\":" + Str(spec) +
                ",\"ok\":" + Bool(okT) +
                ",\"motivo\":" + Str(motivo.ToString()) +
                ",\"vk\":" + efetivo.Vk +
                ",\"ctrl\":" + Bool(efetivo.Ctrl) +
                ",\"alt\":" + Bool(efetivo.Alt) +
                ",\"shift\":" + Bool(efetivo.Shift) +
                ",\"win\":" + Bool(efetivo.Win) +
                ",\"canon\":" + Str(efetivo.Serializar()) + "}");
        }
        Console.Out.Flush();
        return 0;
    }

    private static string Bool(bool b) => b ? "true" : "false";

    private static string Str(string s) =>
        "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    private static FieldInfo Campo(string name) =>
        typeof(HotkeysCommand).GetField(name, BindingFlags.NonPublic | BindingFlags.Static)!;

    // Cenário 3: push-to-talk no Right Alt, que em teclado ABNT2 É o AltGr.
    // O Windows injeta um LeftCtrl junto do AltGr, e ele auto-repete enquanto a
    // tecla está segurada. Com a regra antiga ("qualquer tecla aborta"), esse
    // LeftCtrl abortava o próprio ditado e o PTT nunca funcionava nesse layout.
    //
    // Imprime os eventos no stdout, um por linha, para o teste conferir a
    // sequência. Modificador não pode virar combo; tecla de ação tem que virar.
    private static int AltGr()
    {
        Priv("StartWriter").Invoke(null, null);
        Campo("_pttVk").SetValue(null, Native.VK_RMENU);

        var cb = (Native.HookProc)Delegate.CreateDelegate(
            typeof(Native.HookProc), Priv("HookCallback"));

        void Tecla(int vk, int msg)
        {
            var kb = new Native.KBDLLHOOKSTRUCT { vkCode = (uint)vk };
            IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf<Native.KBDLLHOOKSTRUCT>());
            Marshal.StructureToPtr(kb, p, false);
            cb(0, (IntPtr)msg, p);
            Marshal.FreeHGlobal(p);
        }

        // --- segurar AltGr e falar: o LeftCtrl injetado não pode abortar ---
        Tecla(Native.VK_RMENU, Native.WM_KEYDOWN);      // espera ptt_down
        Tecla(Native.VK_LCONTROL, Native.WM_KEYDOWN);   // AltGr injeta isto
        Tecla(Native.VK_LCONTROL, Native.WM_KEYDOWN);   // e auto-repete
        Tecla(Native.VK_LSHIFT, Native.WM_KEYDOWN);     // Shift também não aborta
        Tecla(Native.VK_RMENU, Native.WM_KEYUP);        // espera ptt_up, NÃO abort

        // --- AltGr + tecla de ação: aí sim é combo de verdade ---
        Tecla(Native.VK_RMENU, Native.WM_KEYDOWN);      // ptt_down
        Tecla(Native.VK_V, Native.WM_KEYDOWN);          // combo
        Tecla(Native.VK_RMENU, Native.WM_KEYUP);        // ptt_abort

        Priv("Drain").Invoke(null, null);
        return 0;
    }

    // Cenário 2: saída ordenada. O que já está na fila precisa chegar ao stdout
    // antes de o processo sair — é o caminho do "no_permission", que enfileira
    // uma linha e retorna 1 na sequência. Aqui o stdout é real e drenado pelo
    // teste; a única saída esperada é a linha do evento.
    private static int Drain()
    {
        Priv("StartWriter").Invoke(null, null);
        Priv("Emit").Invoke(null, new object[] { "no_permission" });
        Priv("Drain").Invoke(null, null);
        return 0;
    }

    // Cenário 1: com o stdout entupido, o callback ainda devolve na hora.
    private static int NonBlocking()
    {
        // Console.SetOut embrulha em TextWriter.Synchronized, então a primeira
        // escrita que travar também segura o lock: é o pipe cheio, fielmente.
        Console.SetOut(new NeverWriter());

        // CONTROLE — sem isto o teste não prova nada. Uma escrita direta no
        // Console.Out (literalmente o que o Emit antigo fazia dentro do
        // callback) NÃO pode completar. Se completar, o fixture não trava e
        // qualquer medição abaixo é ruído.
        var control = new Thread(() => { Console.Out.Write("x"); Console.Out.Flush(); })
        { IsBackground = true };
        control.Start();
        bool controlBlocked = !control.Join(1000);

        // Sobe a thread escritora do helper. Ela vai travar na primeira linha
        // que tirar da fila — que é o cenário sob teste.
        Priv("StartWriter").Invoke(null, null);

        // Delegate em vez de MethodInfo.Invoke: a sobrecarga da reflexão não
        // pode entrar na medição.
        var cb = (Native.HookProc)Delegate.CreateDelegate(
            typeof(Native.HookProc), Priv("HookCallback"));

        // Evento de teclado não-injetado na tecla de PTT padrão (Right Ctrl):
        // down/up alternados geram um ptt_down ou ptt_up por chamada.
        var kb = new Native.KBDLLHOOKSTRUCT { vkCode = (uint)Native.VK_RCONTROL };
        IntPtr lParam = Marshal.AllocHGlobal(Marshal.SizeOf<Native.KBDLLHOOKSTRUCT>());
        Marshal.StructureToPtr(kb, lParam, false);

        cb(0, (IntPtr)Native.WM_KEYDOWN, lParam); // aquece o JIT
        cb(0, (IntPtr)Native.WM_KEYUP, lParam);

        long worst = 0;
        long t0 = Stopwatch.GetTimestamp();
        for (int i = 0; i < Events; i++)
        {
            int msg = (i % 2 == 0) ? Native.WM_KEYDOWN : Native.WM_KEYUP;
            long a = Stopwatch.GetTimestamp();
            cb(0, (IntPtr)msg, lParam);
            long d = Stopwatch.GetTimestamp() - a;
            if (d > worst) worst = d;
        }
        long totalTicks = Stopwatch.GetTimestamp() - t0;

        Marshal.FreeHGlobal(lParam);

        static double Ms(long ticks) => ticks * 1000.0 / Stopwatch.Frequency;

        Console.Error.WriteLine(
            "HARNESS {\"controlBlocked\":" + (controlBlocked ? "true" : "false") +
            ",\"events\":" + Events +
            ",\"totalMs\":" + Ms(totalTicks).ToString("F3", System.Globalization.CultureInfo.InvariantCulture) +
            ",\"worstMs\":" + Ms(worst).ToString("F3", System.Globalization.CultureInfo.InvariantCulture) + "}");
        Console.Error.Flush();

        // Voltar do Main em vez de chamar Environment.Exit é parte do teste: a
        // thread escritora está presa numa escrita que nunca termina, então o
        // processo só consegue sair porque ela é IsBackground. Se alguém trocar
        // isso, este harness pendura e o teste estoura no timeout.
        return 0;
    }
}

// TextWriter que nunca completa uma escrita: o pipe do stdout depois que o
// Electron parou de drenar.
internal sealed class NeverWriter : TextWriter
{
    private readonly ManualResetEventSlim _never = new(false);

    public override Encoding Encoding => Encoding.UTF8;
    public override void Write(char value) => _never.Wait();
    public override void Write(char[] buffer, int index, int count) => _never.Wait();
    public override void Write(string? value) => _never.Wait();
    public override void WriteLine(string? value) => _never.Wait();
    public override void Flush() => _never.Wait();
}
