# Dita Aí — Port para Windows (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rodar o Dita Aí no Windows 10/11 x64 com a mesma UX do Mac (segurar tecla, falar, soltar, texto colado no app em foco), mantendo o build macOS funcionando.

**Architecture:** Camada de plataforma no processo main do Electron. Todo caminho absoluto e toda chamada de SO saem dos módulos de domínio e vão para 4 módulos novos (`paths.js`, `binaries.js`, `helper-path.js`, `defaults.js`) + implementações `paster.darwin.js` / `paster.win32.js` atrás de um dispatcher. O helper Swift (CGEventTap) ganha um irmão em C# (`dita-helper.exe`) que fala **exatamente o mesmo protocolo** — uma linha JSON por evento no stdout, `state on|off` no stdin — então `hotkeys.js` não muda de lógica. whisper.cpp e ffmpeg deixam de vir do Homebrew: ffmpeg via npm `ffmpeg-static` (cross-platform), whisper-server via binários oficiais baixados por script para `app/resources/win/whisper/{vulkan,cpu}`, com fallback Vulkan → CPU em runtime.

**Tech Stack:** Electron 34 + electron-vite, React 18, better-sqlite3, vitest, C# / .NET 8 (helper Win32: `SetWindowsHookEx(WH_KEYBOARD_LL)`, `SendInput`, `GetForegroundWindow`), whisper.cpp (Vulkan/CPU), ffmpeg-static, electron-builder (nsis).

**Restrições descobertas no ambiente alvo:**
- `Fn` **não é uma tecla programável no Windows** (resolvida no firmware do teclado, não chega ao hook). O atalho padrão do Mac (`Fn+Espaço`) não tem equivalente — o default no Windows muda.
- Teclado **ABNT2**: `AltGr` **é** o `Right Alt`. Usar `ralt` como push-to-talk quebraria `ç`, `º`, `₢`, `/` em algumas layouts. Default de PTT no Windows = **`Right Ctrl`**.
- `WH_KEYBOARD_LL` de processo não-elevado **não recebe eventos** enquanto uma janela elevada (Admin) está em foco. Comportamento documentado, não contornável sem rodar como Admin.
- Máquina de dev: .NET **runtime** 8 instalado, **SDK ausente** (Task 0 resolve). Sem Visual Studio Build Tools. GPU = AMD Radeon integrada → Vulkan funciona mas o ganho é modesto; o caminho CPU precisa ser de primeira classe, não decorativo.

---

## Estrutura de arquivos

**Novos — camada de plataforma (`app/src/main/`)**

| Arquivo | Responsabilidade |
|---|---|
| `paths.js` | `dataDir()`, `modelDir()`, `dbPath()`. Única fonte de caminho de dados. |
| `binaries.js` | `ffmpegPath()`, `whisperServerCandidates()`. Única fonte de caminho de binário externo. |
| `helper-path.js` | Caminho do helper (Swift ou .exe) em dev e empacotado. |
| `defaults.js` | Defaults de atalho por plataforma. |
| `paster.darwin.js` | Implementação atual (osascript), movida sem alteração de lógica. |
| `paster.win32.js` | Implementação via `dita-helper.exe paste` / `frontapp`. |
| `paster.js` | Dispatcher — reescrito, sem lógica de SO. |

**Novos — helper Windows (`helper-win/`)**

| Arquivo | Responsabilidade |
|---|---|
| `DitaHelper/DitaHelper.csproj` | Projeto console .NET 8, win-x64, single-file self-contained. |
| `DitaHelper/Program.cs` | Dispatch de subcomando: `hotkeys` \| `paste` \| `frontapp`. |
| `DitaHelper/Native.cs` | P/Invoke: hook, SendInput, foreground window. |
| `DitaHelper/ShortcutSpec.cs` | Parse de `--toggle=` / `--ptt=` → VK + modificadores. |
| `DitaHelper/HotkeysCommand.cs` | Hook LL + máquina de supressão + stdin `state on/off` + emit JSON. |
| `DitaHelper/PasteCommand.cs` | `SendInput` Ctrl+V. |
| `DitaHelper/FrontAppCommand.cs` | Nome do processo em foco. |
| `build.ps1` | `dotnet publish` → `helper-win/dist/dita-helper.exe`. |

**Novos — scripts e recursos (`app/`)**

| Arquivo | Responsabilidade |
|---|---|
| `scripts/fetch-whisper-win.mjs` | Baixa/extrai whisper.cpp Vulkan + CPU em `resources/win/whisper/`. |
| `scripts/make-win-icons.ps1` | Gera `resources/win/tray.ico` (32px) e `build/icon.ico` (256px). |
| `resources/win/` | Saída dos dois scripts acima. Ignorado pelo git. |

**Modificados**

| Arquivo | O que muda |
|---|---|
| `app/src/main/whisper.js` | Caminhos via `binaries.js`/`paths.js`; download sem `curl`/`mv`; fallback Vulkan→CPU. |
| `app/src/main/index.js` | `dataDir()`, `askForMediaAccess` só no darwin, args do helper, smoke test por plataforma. |
| `app/src/main/tray.js` | Ícone `.ico` no Windows, aceleradores por plataforma. |
| `app/src/main/recorder-window.js` | Chamadas mac-only sob guarda. |
| `app/src/renderer/src/Settings.jsx` | Lista de atalhos por plataforma. |
| `app/package.json` | Dep `ffmpeg-static`, scripts `build:win`, `helper:win`, `deps:win`, `icons:win`. |
| `app/electron-builder.yml` | Bloco `win` + `nsis`, `extraResources` movido para dentro de `mac:`/`win:`. |
| `README.md` + novo `docs/windows.md` | Instruções das duas plataformas. |

`app/src/main/db.js` **não** muda: ele já recebe o caminho do banco como argumento, sem literal embutido.

**Testes novos:** `app/tests/paths.test.js`, `shortcut-defaults.test.js`, `helper-path.test.js`, `paster-dispatch.test.js`, `binaries.test.js`, `helper-win.integration.test.js`, mais o stub `app/tests/stubs/electron.js` e o novo `app/vitest.config.js`.

**Ordem das tasks:** 0 (toolchain) → 1-2 (paths/defaults) → 3-4 (helper C#) → 5-6 (helper-path/paster) → 7-8 (binaries/whisper) → 9 (binários e ícones) → 10 (ligar no main) → 11 (UI) → 12 (empacotar) → 13 (docs) → 14 (verificação).

---

## Task 0: Preparar toolchain

**Files:** nenhum (setup de máquina).

- [ ] **Step 1: Instalar o .NET 8 SDK**

A máquina tem só o runtime. Sem SDK não existe `dotnet publish`.

```bash
winget install --id Microsoft.DotNet.SDK.8 --accept-source-agreements --accept-package-agreements
```

- [ ] **Step 2: Verificar o SDK**

Abrir um **novo** terminal (o PATH só atualiza em processo novo) e rodar:

```bash
dotnet --list-sdks
```

Esperado: uma linha começando com `8.` — por exemplo `8.0.404 [C:\Program Files\dotnet\sdk]`. Se sair vazio, o PATH não recarregou: fechar e reabrir o terminal.

- [ ] **Step 3: Instalar as dependências npm do app**

```bash
cd app && npm install
```

Esperado: termina sem erro. O `postinstall` roda `electron-builder install-app-deps`, que baixa o prebuild do `better-sqlite3` para Electron 34 / win32-x64.

- [ ] **Step 4: Verificar que o better-sqlite3 carregou de verdade**

O prebuild pode faltar e o npm ainda assim sair com código 0. Testar o carregamento real.

`ELECTRON_RUN_AS_NODE=1` não é opcional aqui: sem ele o `electron` abre uma janela GUI e o comando nunca retorna.

```bash
cd app && ELECTRON_RUN_AS_NODE=1 npx electron -e "require('better-sqlite3'); console.log('better-sqlite3 OK')"
```

Esperado: imprime `better-sqlite3 OK`, sem `NODE_MODULE_VERSION` mismatch nem `was compiled against a different Node.js version`.

Se falhar: instalar as VS Build Tools (`winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools"`) e rodar `npx electron-rebuild -f -w better-sqlite3`.

- [ ] **Step 5: Consertar o runner de teste no Windows**

O script `test` do `package.json` usa a sintaxe POSIX de variável inline (`VAR=x comando`). O `npm` no Windows roda scripts pelo `cmd.exe`, que não entende isso e falha com:

```
'ELECTRON_RUN_AS_NODE' não é reconhecido como um comando interno ou externo
```

```bash
cd app && npm install --save-dev cross-env@^7.0.3
```

Em `app/package.json`, trocar o script `test`:

```json
    "test": "cross-env ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run",
```

`cross-env` funciona igual nas duas plataformas — o Mac não regride.

- [ ] **Step 6: Rodar a suíte existente como baseline**

```bash
cd app && npm test
```

Baseline medido em 25/07/2026 nesta máquina: **25 passed, 1 skipped** (`whisper.integration.test.js`, atrás de `RUN_WHISPER=1` — a Task 8 o torna cross-platform). Nenhuma task pode fazer esse número regredir.

- [ ] **Step 7: Commit do estado inicial**

```bash
git add -A && git commit -m "chore: fix test runner on Windows, baseline for the port"
```

---

## Task 1: `paths.js` — caminho de dados cross-platform

Hoje `~/Library/Application Support/dita-ai` está hardcoded em dois arquivos (`index.js:14`, `whisper.js:9`).

Duas armadilhas:

1. `app.getPath('userData')` **não** serve — no Mac ele resolve para `Application Support/Dita Aí` (o `productName`), o que abandonaria o banco de dados dos usuários Mac existentes. O caminho tem que continuar sendo o literal `dita-ai`.
2. Este módulo **não pode importar `electron`**. A suíte roda com `ELECTRON_RUN_AS_NODE=1`, onde o módulo `electron` resolve para uma *string* com o caminho do binário; um `import { app } from 'electron'` falha no link ESM antes de qualquer try/catch rodar. Por isso `paths.js` usa só `process.env` e `os.homedir()` — que dão exatamente o mesmo resultado que `app.getPath('appData')` nas duas plataformas.

**Files:**
- Create: `app/src/main/paths.js`
- Test: `app/tests/paths.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/paths.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest'
import { dataDir, modelDir, dbPath } from '../src/main/paths.js'

const ORIGINAL = process.env.DITA_DATA_DIR

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DITA_DATA_DIR
  else process.env.DITA_DATA_DIR = ORIGINAL
})

describe('paths', () => {
  it('respeita DITA_DATA_DIR quando definido', () => {
    process.env.DITA_DATA_DIR = '/tmp/dita-teste'
    expect(dataDir()).toBe('/tmp/dita-teste')
  })

  it('deriva modelDir e dbPath de dataDir', () => {
    process.env.DITA_DATA_DIR = '/tmp/dita-teste'
    expect(modelDir()).toContain('models')
    expect(modelDir().startsWith('/tmp/dita-teste')).toBe(true)
    expect(dbPath()).toContain('dita.db')
    expect(dbPath().startsWith('/tmp/dita-teste')).toBe(true)
  })

  it('sem override, aponta para uma pasta chamada dita-ai', () => {
    delete process.env.DITA_DATA_DIR
    expect(dataDir().replace(/\\/g, '/')).toContain('/dita-ai')
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd app && npm test -- paths
```

Esperado: FAIL — `Failed to resolve import "../src/main/paths.js"`.

- [ ] **Step 3: Implementar `paths.js`**

Criar `app/src/main/paths.js`:

```js
import { homedir } from 'os'
import { join } from 'path'

// Fonte única do diretório de dados.
//
// Sem importar 'electron' de propósito: sob ELECTRON_RUN_AS_NODE (como a
// suíte roda) o módulo 'electron' é uma string de caminho, e o import
// nomeado quebraria. O resultado abaixo é idêntico ao de
// app.getPath('appData') nas duas plataformas.
//
// E é 'appData' + o literal 'dita-ai', não 'userData': userData resolve para
// o productName ("Dita Aí") no macOS, o que mudaria o caminho dos usuários
// Mac existentes e abandonaria o banco deles.
export function dataDir() {
  if (process.env.DITA_DATA_DIR) return process.env.DITA_DATA_DIR
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'dita-ai')
  }
  return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'dita-ai')
}

export function modelDir() { return join(dataDir(), 'models') }
export function dbPath() { return join(dataDir(), 'dita.db') }
```

- [ ] **Step 4: Rodar para ver passar**

```bash
cd app && npm test -- paths
```

Esperado: 3 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/paths.js app/tests/paths.test.js
git commit -m "feat: add cross-platform data path resolution"
```

---

## Task 2: `defaults.js` — atalhos padrão por plataforma

`Fn` não existe no Windows e `Right Alt` é `AltGr` no ABNT2. Os defaults precisam divergir por plataforma, e `index.js` chama `getSetting('toggleShortcut', 'fn+space')` em dois lugares com o literal repetido.

**Files:**
- Create: `app/src/main/defaults.js`
- Test: `app/tests/shortcut-defaults.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/shortcut-defaults.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { DEFAULT_TOGGLE, DEFAULT_PTT, TOGGLE_OPTIONS, PTT_OPTIONS } from '../src/main/defaults.js'

describe('defaults de atalho', () => {
  it('nunca oferece fn no Windows: Fn não chega ao hook de teclado', () => {
    if (process.platform !== 'win32') return
    expect(DEFAULT_TOGGLE).not.toContain('fn')
    expect(TOGGLE_OPTIONS).not.toContain('fn+space')
  })

  it('nunca usa right alt como PTT no Windows: AltGr no teclado ABNT2', () => {
    if (process.platform !== 'win32') return
    expect(DEFAULT_PTT).not.toBe('ralt')
  })

  it('o default sempre está entre as opções oferecidas', () => {
    expect(TOGGLE_OPTIONS).toContain(DEFAULT_TOGGLE)
    expect(PTT_OPTIONS).toContain(DEFAULT_PTT)
  })

  it('mantém fn+space e rcmd como default no macOS', () => {
    if (process.platform !== 'darwin') return
    expect(DEFAULT_TOGGLE).toBe('fn+space')
    expect(DEFAULT_PTT).toBe('rcmd')
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd app && npm test -- shortcut-defaults
```

Esperado: FAIL — `Failed to resolve import "../src/main/defaults.js"`.

- [ ] **Step 3: Implementar `defaults.js`**

Criar `app/src/main/defaults.js`:

```js
const isWin = process.platform === 'win32'

// Windows não entrega a tecla Fn ao WH_KEYBOARD_LL (o firmware do teclado a
// consome), então fn+space não é portável. ctrl+shift+space é o default por
// não colidir com o alternador de IME (ctrl+space) nem com o menu de janela
// (alt+space).
export const DEFAULT_TOGGLE = isWin ? 'ctrl+shift+space' : 'fn+space'

// Right Alt é AltGr em teclado ABNT2 — usá-lo como push-to-talk quebraria
// ç, º e ₢. Right Ctrl é o análogo seguro do Right Command do macOS.
export const DEFAULT_PTT = isWin ? 'rctrl' : 'rcmd'

export const TOGGLE_OPTIONS = isWin
  ? ['ctrl+shift+space', 'ctrl+space', 'alt+space', 'f5']
  : ['fn+space', 'opt+space', 'ctrl+space', 'f5']

export const PTT_OPTIONS = isWin
  ? ['rctrl', 'rshift', 'rwin']
  : ['rcmd', 'ropt']
```

- [ ] **Step 4: Rodar para ver passar**

```bash
cd app && npm test -- shortcut-defaults
```

Esperado: 4 testes PASS (dois deles saem cedo fora da plataforma correspondente).

- [ ] **Step 5: Commit**

```bash
git add app/src/main/defaults.js app/tests/shortcut-defaults.test.js
git commit -m "feat: add per-platform shortcut defaults"
```

---

## Task 3: Helper C# â€” esqueleto, `frontapp` e `paste`

O helper Windows Ã© um Ãºnico executÃ¡vel com trÃªs subcomandos. Dois sÃ£o processos curtos (`paste`, `frontapp`) e um Ã© longo (`hotkeys`, Task 4). ComeÃ§amos pelos curtos porque dÃ£o para verificar Ã  mÃ£o em segundos.

**Files:**
- Create: `helper-win/DitaHelper/DitaHelper.csproj`
- Create: `helper-win/DitaHelper/Native.cs`
- Create: `helper-win/DitaHelper/FrontAppCommand.cs`
- Create: `helper-win/DitaHelper/PasteCommand.cs`
- Create: `helper-win/DitaHelper/HotkeysCommand.cs` (stub; Task 4 substitui)
- Create: `helper-win/DitaHelper/Program.cs`
- Create: `helper-win/build.ps1`
- Create: `helper-win/.gitignore`

- [ ] **Step 1: Criar o projeto**

Criar `helper-win/DitaHelper/DitaHelper.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>dita-helper</AssemblyName>
    <RootNamespace>DitaHelper</RootNamespace>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>true</SelfContained>
    <PublishSingleFile>true</PublishSingleFile>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>

</Project>
```

Self-contained: o usuÃ¡rio final nÃ£o precisa instalar runtime .NET nenhum. Custa ~15MB no instalador, irrelevante ao lado do modelo de 1,6GB.

- [ ] **Step 2: Criar as P/Invoke**

Criar `helper-win/DitaHelper/Native.cs`:

```csharp
using System.Runtime.InteropServices;

namespace DitaHelper;

internal static class Native
{
    public const int WH_KEYBOARD_LL = 13;

    public const int WM_KEYDOWN = 0x0100;
    public const int WM_KEYUP = 0x0101;
    public const int WM_SYSKEYDOWN = 0x0104;
    public const int WM_SYSKEYUP = 0x0105;

    public const int VK_SHIFT = 0x10;
    public const int VK_CONTROL = 0x11;
    public const int VK_MENU = 0x12;
    public const int VK_ESCAPE = 0x1B;
    public const int VK_SPACE = 0x20;
    public const int VK_RWIN = 0x5C;
    public const int VK_F5 = 0x74;
    public const int VK_V = 0x56;
    public const int VK_RSHIFT = 0xA1;
    public const int VK_RCONTROL = 0xA3;
    public const int VK_RMENU = 0xA5;

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // Eventos que nÃ³s mesmos sintetizamos (o paste) chegam marcados como
    // injetados. O hook precisa ignorÃ¡-los para nÃ£o se auto-disparar.
    public const uint LLKHF_INJECTED = 0x10;

    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookExW(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [DllImport("user32.dll")]
    public static extern int GetMessageW(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // MOUSEINPUT Ã© o maior membro da uniÃ£o; declarÃ¡-lo garante que
    // sizeof(INPUT) bata com o que o SendInput espera (40 bytes em x64).
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION
    {
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public MOUSEINPUT mi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public INPUTUNION u;
    }

    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
```

- [ ] **Step 3: Implementar `frontapp`**

Equivalente ao `osascript "get name of first process whose frontmost is true"`. Imprime o nome do processo em foco e sai.

Criar `helper-win/DitaHelper/FrontAppCommand.cs`:

```csharp
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
```

- [ ] **Step 4: Implementar `paste`**

Equivalente ao `osascript 'keystroke "v" using command down'`.

Criar `helper-win/DitaHelper/PasteCommand.cs`:

```csharp
using System.Runtime.InteropServices;

namespace DitaHelper;

internal static class PasteCommand
{
    // Marca nossos prÃ³prios eventos para que o hook de hotkeys saiba ignorÃ¡-los.
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
```

- [ ] **Step 5: Stub do `hotkeys`**

Criar `helper-win/DitaHelper/HotkeysCommand.cs` (a Task 4 substitui este arquivo inteiro):

```csharp
namespace DitaHelper;

internal static class HotkeysCommand
{
    public static int Run(string[] args)
    {
        Console.Error.WriteLine("hotkeys ainda nÃ£o implementado");
        return 3;
    }
}
```

- [ ] **Step 6: Implementar o dispatch de subcomando**

Criar `helper-win/DitaHelper/Program.cs`:

```csharp
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
```

- [ ] **Step 7: Script de build**

Criar `helper-win/build.ps1`:

```powershell
# Compila o helper para helper-win/dist/dita-helper.exe
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root 'dist'

dotnet publish (Join-Path $root 'DitaHelper\DitaHelper.csproj') -c Release -o $out

Write-Host "helper em: $(Join-Path $out 'dita-helper.exe')"
```

Criar `helper-win/.gitignore`:

```
dist/
DitaHelper/bin/
DitaHelper/obj/
```

- [ ] **Step 8: Compilar**

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File helper-win/build.ps1
```

Esperado: termina com `helper em: ...\helper-win\dist\dita-helper.exe`. Se der `MSB4236` ou "SDK nÃ£o encontrado", voltar Ã  Task 0.

- [ ] **Step 9: Verificar `frontapp` Ã  mÃ£o**

```bash
./helper-win/dist/dita-helper.exe frontapp
```

Esperado: imprime o nome do processo da janela em foco, sem quebra de linha â€” provavelmente `WindowsTerminal`, `Code` ou `powershell`. **Se sair vazio, nÃ£o seguir**: significa que o `appName` gravado no banco ficaria vazio.

- [ ] **Step 10: Verificar `paste` Ã  mÃ£o**

Abrir o Bloco de Notas, deixar o cursor no campo de texto, e rodar o comando abaixo â€” ele copia um texto, espera 4 segundos (tempo de vocÃª clicar no Bloco de Notas) e entÃ£o cola:

```bash
powershell -NoProfile -Command "Set-Clipboard 'teste dita'; Start-Sleep 4; & './helper-win/dist/dita-helper.exe' paste; Write-Host \"exit=$LASTEXITCODE\""
```

Esperado: `teste dita` aparece no Bloco de Notas e sai `exit=0`.

- [ ] **Step 11: Commit**

```bash
git add helper-win/
git commit -m "feat(helper-win): add C# helper skeleton with paste and frontapp"
```


---

## Task 4: Helper C# â€” comando `hotkeys`

Porta do `helper/DitaHotkeys.swift`. O protocolo com o Electron Ã© **idÃªntico** ao do Mac â€” uma linha `{"event":"..."}` por evento no stdout, `state on` / `state off` no stdin â€” para que `app/src/main/hotkeys.js` nÃ£o precise de nenhuma mudanÃ§a de lÃ³gica.

Eventos emitidos, na mesma grafia do Swift: `ready`, `toggle`, `ptt_down`, `ptt_up`, `ptt_abort`, `combo`, `esc`, `no_permission`.

**Files:**
- Modify: `helper-win/DitaHelper/Native.cs` (adicionar `GetModuleHandleW`)
- Create: `helper-win/DitaHelper/ShortcutSpec.cs`
- Modify: `helper-win/DitaHelper/HotkeysCommand.cs` (substitui o stub da Task 3 inteiro)
- Test: `app/tests/helper-win.integration.test.js`

- [ ] **Step 1: Adicionar `GetModuleHandleW` ao `Native.cs`**

`SetWindowsHookEx` aceita `NULL` como `hMod` para hooks low-level, mas em executÃ¡vel single-file isso Ã© historicamente instÃ¡vel. Passar o handle do mÃ³dulo Ã© o caminho documentado.

Em `helper-win/DitaHelper/Native.cs`, logo antes do fechamento da classe (a Ãºltima chave `}` do arquivo), inserir:

```csharp
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr GetModuleHandleW(string? lpModuleName);
```

- [ ] **Step 2: Criar o parser de atalho**

Criar `helper-win/DitaHelper/ShortcutSpec.cs`:

```csharp
namespace DitaHelper;

// Atalho de toggle: uma tecla base + um conjunto EXATO de modificadores.
// Exato importa: com "ctrl+space" configurado, Ctrl+Shift+EspaÃ§o nÃ£o deve
// disparar o toggle â€” senÃ£o o usuÃ¡rio perde combinaÃ§Ãµes do app em foco.
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
        // default = ctrl+shift+space (nÃ£o colide com o alternador de IME
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
    // "ralt" existe como opÃ§Ã£o mas nunca Ã© o default no Windows: em teclado
    // ABNT2 o Right Alt Ã© o AltGr, usado para Ã§, Âº, â‚¢.
    public static int Parse(string spec) => spec switch
    {
        "rshift" => Native.VK_RSHIFT,
        "rwin" => Native.VK_RWIN,
        "ralt" => Native.VK_RMENU,
        _ => Native.VK_RCONTROL
    };
}
```

- [ ] **Step 3: Implementar o comando `hotkeys`**

Substituir **todo** o conteÃºdo de `helper-win/DitaHelper/HotkeysCommand.cs`:

```csharp
using System.Runtime.InteropServices;

namespace DitaHelper;

internal static class HotkeysCommand
{
    // O delegate precisa de uma referÃªncia gerenciada viva: o Windows guarda
    // sÃ³ o ponteiro nativo, e o GC coletaria o thunk no meio da sessÃ£o.
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

        // Um hook low-level sÃ³ Ã© chamado se a thread que o instalou bombeia
        // mensagens. Sem este laÃ§o o callback nunca dispara.
        while (Native.GetMessageW(out _, IntPtr.Zero, 0, 0) > 0) { }

        Native.UnhookWindowsHookEx(_hook);
        return 0;
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return Native.CallNextHookEx(_hook, nCode, wParam, lParam);

        var data = Marshal.PtrToStructure<Native.KBDLLHOOKSTRUCT>(lParam);

        // Ignora o Ctrl+V que nÃ³s mesmos injetamos ao colar: sem isto o helper
        // veria o prÃ³prio paste como "combo" e abortaria o PTT seguinte.
        if ((data.flags & Native.LLKHF_INJECTED) != 0)
            return Native.CallNextHookEx(_hook, nCode, wParam, lParam);

        int msg = (int)wParam;
        int vk = (int)data.vkCode;
        bool isDown = msg == Native.WM_KEYDOWN || msg == Native.WM_SYSKEYDOWN;
        bool isUp = msg == Native.WM_KEYUP || msg == Native.WM_SYSKEYUP;

        // Push-to-talk: o modificador sozinho. Nunca suprimido â€” o usuÃ¡rio
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
                // segurar a tecla nÃ£o deve disparar vÃ¡rios toggles
                if (!_toggleHeld) { _toggleHeld = true; Emit("toggle"); }
                return (IntPtr)1; // suprime: o app em foco nÃ£o digita o caractere
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
            // em foco veja metade da combinaÃ§Ã£o. Os modificadores jÃ¡ podem ter
            // sido soltos, entÃ£o comparamos sÃ³ a tecla base.
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
```

- [ ] **Step 4: Recompilar**

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File helper-win/build.ps1
```

Esperado: build sem erro. Warnings de `Marshal.PtrToStructure` nÃ£o aparecem; se aparecer `CA1416`, ignorar (Ã© o analisador de plataforma, e o TFM jÃ¡ Ã© `net8.0-windows`).

- [ ] **Step 5: Escrever o teste de integraÃ§Ã£o**

Criar `app/tests/helper-win.integration.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const HELPER = join(__dirname, '../../helper-win/dist/dita-helper.exe')
const run = process.platform === 'win32' && existsSync(HELPER)

describe.skipIf(!run)('dita-helper.exe hotkeys', () => {
  it('emite {"event":"ready"} em menos de 5s e sobrevive ao stdin', async () => {
    const proc = spawn(HELPER, ['hotkeys', '--toggle=f5', '--ptt=rctrl'],
      { stdio: ['pipe', 'pipe', 'pipe'] })

    const ready = await new Promise((resolve) => {
      let buffer = ''
      const timer = setTimeout(() => resolve(null), 5000)
      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString()
        if (buffer.includes('"ready"')) { clearTimeout(timer); resolve(buffer.trim()) }
      })
    })

    expect(ready).toBe('{"event":"ready"}')

    // o stdin nÃ£o pode derrubar o processo
    proc.stdin.write('state on\nstate off\n')
    await new Promise((r) => setTimeout(r, 300))
    expect(proc.exitCode).toBe(null)

    proc.kill()
  }, 10000)
})
```

- [ ] **Step 6: Rodar o teste**

```bash
cd app && npm test -- helper-win
```

Esperado: 1 teste PASS. Se sair `skipped`, o `.exe` nÃ£o existe â€” voltar ao Step 4.

- [ ] **Step 7: Verificar a supressÃ£o Ã  mÃ£o (o teste automatizado nÃ£o cobre isto)**

Rodar o helper em foreground:

```bash
./helper-win/dist/dita-helper.exe hotkeys --toggle=ctrl+shift+space --ptt=rctrl
```

Com o terminal em foco, verificar cada item:

| AÃ§Ã£o | Esperado no stdout | Esperado na tela |
|---|---|---|
| `Ctrl+Shift+EspaÃ§o` | uma linha `{"event":"toggle"}` | **nenhum espaÃ§o digitado** |
| segurar `Ctrl+Shift+EspaÃ§o` 3s | **uma Ãºnica** linha `toggle` | nada digitado |
| pressionar e soltar `Ctrl direito` | `ptt_down` e depois `ptt_up` | nada |
| `Ctrl direito` + `C`, soltar | `ptt_down`, `combo`, `ptt_abort` | o Ctrl+C normal funciona |
| `Esc` sozinho | **nada** | o Esc chega ao app normalmente |
| digitar `state on` + Enter, depois `Esc` | `{"event":"esc"}` | o Esc **nÃ£o** chega ao app |
| `Ctrl+EspaÃ§o` (sÃ³ ctrl) | **nada** | espaÃ§o digitado normalmente |

Se a linha "segurar 3s" produzir vÃ¡rias `toggle`, o anti auto-repeat estÃ¡ quebrado â€” conferir `_toggleHeld`. Encerrar com `Ctrl+C`.

- [ ] **Step 8: Commit**

```bash
git add helper-win/ app/tests/helper-win.integration.test.js
git commit -m "feat(helper-win): implement global hotkey hook with mac-compatible protocol"
```


---

## Task 5: `helper-path.js` â€” localizar o helper nas duas plataformas

Hoje o caminho do helper estÃ¡ embutido em `index.js:15-17`. Passa a ser um mÃ³dulo, porque agora o `paster.win32.js` tambÃ©m precisa dele.

**Files:**
- Create: `app/src/main/helper-path.js`
- Test: `app/tests/helper-path.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/helper-path.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest'
import { helperPath } from '../src/main/helper-path.js'

afterEach(() => { delete process.env.DITA_HELPER })

describe('helperPath', () => {
  it('respeita DITA_HELPER', () => {
    process.env.DITA_HELPER = 'C:/tmp/fake-helper.exe'
    expect(helperPath()).toBe('C:/tmp/fake-helper.exe')
  })

  it('usa o nome de executÃ¡vel certo por plataforma', () => {
    const p = helperPath().replace(/\\/g, '/')
    if (process.platform === 'win32') expect(p.endsWith('/dita-helper.exe')).toBe(true)
    else expect(p.endsWith('/dita-hotkeys')).toBe(true)
  })

  it('em dev aponta para a pasta do helper da plataforma', () => {
    const p = helperPath().replace(/\\/g, '/')
    if (process.platform === 'win32') expect(p).toContain('helper-win/dist')
    else expect(p).toContain('/helper/')
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd app && npm test -- helper-path
```

Esperado: FAIL â€” `Failed to resolve import "../src/main/helper-path.js"`.

- [ ] **Step 3: Implementar**

Criar `app/src/main/helper-path.js`:

```js
import { join } from 'path'

const EXE = process.platform === 'win32' ? 'dita-helper.exe' : 'dita-hotkeys'
const DEV_SUBDIR = process.platform === 'win32' ? 'helper-win/dist' : 'helper'

// Equivalente a app.isPackaged sem importar 'electron' (que sob
// ELECTRON_RUN_AS_NODE resolve para uma string).
//
// A checagem de ELECTRON_RUN_AS_NODE não é opcional: a suíte roda assim, e
// nela process.resourcesPath TAMBÉM está definido — sem ela todo teste cairia
// no ramo "empacotado" e o teste de caminho de dev falharia.
function isPackaged() {
  if (process.defaultApp) return false            // rodando via `electron .`
  if (process.env.ELECTRON_RUN_AS_NODE) return false // rodando a suíte
  return !!process.resourcesPath
}

// __dirname existe no bundle CJS que o electron-vite gera (app/out/main),
// mas nÃ£o sob vitest em ESM.
function baseDir() {
  return typeof __dirname !== 'undefined' ? __dirname : join(process.cwd(), 'out/main')
}

export function helperPath() {
  if (process.env.DITA_HELPER) return process.env.DITA_HELPER
  if (isPackaged()) return join(process.resourcesPath, EXE)
  // out/main -> app/ -> raiz do repo
  return join(baseDir(), '../../..', DEV_SUBDIR, EXE)
}
```

- [ ] **Step 4: Rodar para ver passar**

```bash
cd app && npm test -- helper-path
```

Esperado: 3 testes PASS.

- [ ] **Step 5: Trocar o cÃ¡lculo inline em `index.js`**

Em `app/src/main/index.js`, remover as linhas 15-17:

```js
const HELPER = app.isPackaged
  ? join(process.resourcesPath, 'dita-hotkeys')
  : join(__dirname, '../../../helper/dita-hotkeys')
```

e adicionar o import junto dos outros, no topo:

```js
import { helperPath } from './helper-path.js'
```

Depois, nas duas chamadas de `startHotkeys` (linhas ~141 e ~193), trocar `helperPath: HELPER` por `helperPath: helperPath()`.

- [ ] **Step 6: Verificar que o app ainda sobe no Mac (ou que nada quebrou no build)**

```bash
cd app && npm run build
```

Esperado: build sem erro e sem warning de `HELPER is not defined`.

- [ ] **Step 7: Commit**

```bash
git add app/src/main/helper-path.js app/src/main/index.js app/tests/helper-path.test.js
git commit -m "refactor: extract helper path resolution into its own module"
```

---

## Task 6: `paster` â€” dispatcher + implementaÃ§Ã£o Windows

`paster.js` hoje Ã© 100% macOS (osascript). Vira um dispatcher fino com uma implementaÃ§Ã£o por plataforma, mantendo a assinatura pÃºblica `getFrontmostApp()` / `pasteText(text)` intacta para o `index.js`.

**Files:**
- Create: `app/src/main/paster.darwin.js` (conteÃºdo atual de `paster.js`, sem mudanÃ§a de lÃ³gica)
- Create: `app/src/main/paster.win32.js`
- Modify: `app/src/main/paster.js` (vira dispatcher)
- Test: `app/tests/paster-dispatch.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/paster-dispatch.test.js`:

```js
import { describe, it, expect } from 'vitest'
import * as paster from '../src/main/paster.js'

describe('paster (dispatcher)', () => {
  it('exporta a mesma superfÃ­cie pÃºblica nas duas plataformas', () => {
    expect(typeof paster.getFrontmostApp).toBe('function')
    expect(typeof paster.pasteText).toBe('function')
  })

  it('getFrontmostApp devolve string e nunca lanÃ§a', async () => {
    const name = await paster.getFrontmostApp()
    expect(typeof name).toBe('string')
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd app && npm test -- paster-dispatch
```

Esperado: FAIL. Sob `ELECTRON_RUN_AS_NODE` o `import { clipboard } from 'electron'` do `paster.js` atual nÃ£o resolve â€” Ã© exatamente esse acoplamento que a task remove do caminho de import.

- [ ] **Step 3: Mover a implementaÃ§Ã£o macOS**

Criar `app/src/main/paster.darwin.js` com o conteÃºdo **exato** do `paster.js` atual:

```js
import { clipboard } from 'electron'
import { execFile } from 'child_process'

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
  })
}

export async function getFrontmostApp() {
  try {
    return await osascript('tell application "System Events" to get name of first process whose frontmost is true')
  } catch { return '' }
}

export async function pasteText(text) {
  const previous = clipboard.readText()
  clipboard.writeText(text)
  try {
    await osascript('tell application "System Events" to keystroke "v" using command down')
  } catch {
    return false // sem permissÃ£o de acessibilidade ou keystroke falhou
  }
  // restaura o clipboard do usuÃ¡rio depois que o paste assentou
  setTimeout(() => {
    if (clipboard.readText() === text && previous) clipboard.writeText(previous)
  }, 400)
  return true
}
```

- [ ] **Step 4: Escrever a implementaÃ§Ã£o Windows**

Criar `app/src/main/paster.win32.js`:

```js
import { clipboard } from 'electron'
import { execFile } from 'child_process'
import { helperPath } from './helper-path.js'

function helper(args) {
  return new Promise((resolve, reject) => {
    execFile(helperPath(), args, { windowsHide: true }, (err, stdout) =>
      (err ? reject(err) : resolve(stdout.trim())))
  })
}

export async function getFrontmostApp() {
  try { return await helper(['frontapp']) } catch { return '' }
}

export async function pasteText(text) {
  const previous = clipboard.readText()
  clipboard.writeText(text)
  try {
    // exit != 0 = SendInput bloqueado (janela em foco rodando como admin)
    await helper(['paste'])
  } catch {
    return false
  }
  // restaura o clipboard do usuÃ¡rio depois que o paste assentou
  setTimeout(() => {
    if (clipboard.readText() === text && previous) clipboard.writeText(previous)
  }, 400)
  return true
}
```

- [ ] **Step 5: Transformar `paster.js` em dispatcher**

Substituir **todo** o conteÃºdo de `app/src/main/paster.js`:

```js
// Dispatcher de plataforma. Os imports sÃ£o estÃ¡ticos de propÃ³sito: o
// electron-vite faz bundle do processo main com rollup, que nÃ£o resolve
// especificador dinÃ¢mico. Importar o mÃ³dulo da outra plataforma Ã© inofensivo
// â€” cada um sÃ³ define funÃ§Ãµes, nada roda no import.
import * as darwin from './paster.darwin.js'
import * as win32 from './paster.win32.js'

const impl = process.platform === 'win32' ? win32 : darwin

export const getFrontmostApp = (...args) => impl.getFrontmostApp(...args)
export const pasteText = (...args) => impl.pasteText(...args)
```

- [ ] **Step 6: Isolar o `electron` do caminho de teste**

O teste do Step 1 ainda quebra: os dois mÃ³dulos de implementaÃ§Ã£o importam `clipboard` de `electron`. Adicionar um alias de teste em `app/vitest.config.js` (criar o arquivo se nÃ£o existir):

```js
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'

export default defineConfig({
  test: {
    alias: {
      // Sob ELECTRON_RUN_AS_NODE o mÃ³dulo 'electron' Ã© uma string de caminho.
      // Os testes nÃ£o exercitam a Ã¡rea de transferÃªncia de verdade.
      electron: fileURLToPath(new URL('./tests/stubs/electron.js', import.meta.url))
    }
  }
})
```

Criar `app/tests/stubs/electron.js`:

```js
let texto = ''
export const clipboard = {
  readText: () => texto,
  writeText: (t) => { texto = String(t) }
}
export const app = { isPackaged: false, getPath: () => '' }
export default { clipboard, app }
```

- [ ] **Step 7: Rodar para ver passar**

```bash
cd app && npm test -- paster-dispatch
```

Esperado: 2 testes PASS. No Windows, `getFrontmostApp()` chama o `.exe` real â€” se ele nÃ£o estiver compilado, o `execFile` rejeita, o `catch` devolve `''` e o teste passa mesmo assim (Ã© o comportamento correto: paster nunca lanÃ§a).

- [ ] **Step 8: Rodar a suÃ­te inteira para conferir que o alias nÃ£o quebrou nada**

```bash
cd app && npm test
```

Esperado: o mesmo conjunto de passes do baseline da Task 0, mais os testes novos das Tasks 1, 2, 5 e 6.

- [ ] **Step 9: Commit**

```bash
git add app/src/main/paster.js app/src/main/paster.darwin.js app/src/main/paster.win32.js app/vitest.config.js app/tests/paster-dispatch.test.js app/tests/stubs/electron.js
git commit -m "feat: add Windows paster implementation behind a platform dispatcher"
```


---

## Task 7: `binaries.js` â€” ffmpeg e whisper-server sem Homebrew

`whisper.js:7-8` aponta para `/opt/homebrew`. No Windows nÃ£o existe Homebrew, e mesmo no Mac o caminho fixo Ã© frÃ¡gil. Duas estratÃ©gias diferentes, porque os dois binÃ¡rios tÃªm naturezas diferentes:

- **ffmpeg**: existe pacote npm oficial (`ffmpeg-static`) com binÃ¡rio por plataforma. Vira dependÃªncia e resolve Mac e Windows de uma vez.
- **whisper-server**: nÃ£o tem pacote npm confiÃ¡vel. No Mac continua vindo do Homebrew (nÃ£o regride nada para o usuÃ¡rio atual); no Windows vem dos binÃ¡rios oficiais do whisper.cpp, baixados pela Task 8 para `app/resources/win/whisper/{vulkan,cpu}`.

**Files:**
- Create: `app/src/main/binaries.js`
- Modify: `app/package.json` (dependÃªncia `ffmpeg-static`)
- Test: `app/tests/binaries.test.js`

- [ ] **Step 1: Instalar o ffmpeg-static**

```bash
cd app && npm install ffmpeg-static@^5.2.0
```

Precisa ficar em `dependencies` (nÃ£o `devDependencies`): o electron-vite trata deps como externas e o electron-builder empacota `node_modules`.

- [ ] **Step 2: Escrever o teste que falha**

Criar `app/tests/binaries.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { ffmpegPath, whisperServerCandidates } from '../src/main/binaries.js'

afterEach(() => {
  delete process.env.DITA_FFMPEG
  delete process.env.DITA_WHISPER_SERVER
})

describe('binaries', () => {
  it('respeita os overrides de ambiente', () => {
    process.env.DITA_FFMPEG = '/tmp/ffmpeg'
    process.env.DITA_WHISPER_SERVER = '/tmp/whisper-server'
    expect(ffmpegPath()).toBe('/tmp/ffmpeg')
    expect(whisperServerCandidates()).toEqual(['/tmp/whisper-server'])
  })

  it('o ffmpeg resolvido existe em disco', () => {
    expect(existsSync(ffmpegPath())).toBe(true)
  })

  it('devolve os candidatos de whisper-server na ordem certa', () => {
    const c = whisperServerCandidates()
    expect(Array.isArray(c)).toBe(true)
    if (process.platform === 'win32') {
      // vulkan primeiro, cpu como rede de seguranÃ§a
      const idxVulkan = c.findIndex((p) => p.includes('vulkan'))
      const idxCpu = c.findIndex((p) => p.includes('cpu'))
      if (idxVulkan >= 0 && idxCpu >= 0) expect(idxVulkan).toBeLessThan(idxCpu)
    } else {
      expect(c[0]).toContain('whisper-server')
    }
  })
})
```

- [ ] **Step 3: Rodar para ver falhar**

```bash
cd app && npm test -- binaries
```

Esperado: FAIL â€” `Failed to resolve import "../src/main/binaries.js"`.

- [ ] **Step 4: Implementar**

Criar `app/src/main/binaries.js`:

```js
import { join } from 'path'
import { existsSync } from 'fs'
import ffmpegStatic from 'ffmpeg-static'

const isWin = process.platform === 'win32'

function isPackaged() {
  if (process.defaultApp) return false            // rodando via `electron .`
  if (process.env.ELECTRON_RUN_AS_NODE) return false // rodando a suíte
  return !!process.resourcesPath
}

function baseDir() {
  return typeof __dirname !== 'undefined' ? __dirname : join(process.cwd(), 'out/main')
}

export function ffmpegPath() {
  if (process.env.DITA_FFMPEG) return process.env.DITA_FFMPEG
  // com asar:false o caminho jÃ¡ Ã© real, mas manter o replace deixa o mÃ³dulo
  // correto caso o asar volte a ser ligado
  return String(ffmpegStatic).replace('app.asar', 'app.asar.unpacked')
}

// Ordem de preferÃªncia. O chamador tenta um a um: se o build Vulkan nÃ£o subir
// (driver sem suporte, GPU sem Vulkan), o build CPU assume.
export function whisperServerCandidates() {
  if (process.env.DITA_WHISPER_SERVER) return [process.env.DITA_WHISPER_SERVER]
  if (!isWin) return ['/opt/homebrew/opt/whisper-cpp/bin/whisper-server']

  const root = isPackaged()
    ? join(process.resourcesPath, 'whisper')
    : join(baseDir(), '../../resources/win/whisper')

  return ['vulkan', 'cpu']
    .map((flavor) => join(root, flavor, 'whisper-server.exe'))
    .filter((p) => existsSync(p))
}
```

- [ ] **Step 5: Rodar para ver passar**

```bash
cd app && npm test -- binaries
```

Esperado: 3 testes PASS. O terceiro passa com lista vazia enquanto a Task 8 nÃ£o rodou â€” Ã© intencional, o teste sÃ³ verifica a *ordem* quando os dois existem.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/binaries.js app/tests/binaries.test.js app/package.json app/package-lock.json
git commit -m "feat: resolve ffmpeg and whisper-server without Homebrew"
```

---

## Task 8: `whisper.js` â€” caminhos, download sem `curl`, fallback Vulkanâ†’CPU

**Files:**
- Modify: `app/src/main/whisper.js`
- Modify: `app/src/main/index.js` (a chamada de `ensureModel` vira `await`)
- Test: `app/tests/whisper.unit.test.js` (continua passando sem mudanÃ§a)

- [ ] **Step 1: Trocar o topo do arquivo**

Em `app/src/main/whisper.js`, substituir as linhas 1 a 13 (do primeiro `import` atÃ© a linha do `MODEL_URL`) por:

```js
import { spawn, execFile } from 'child_process'
import { writeFile, unlink, readFile, rename } from 'fs/promises'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { modelDir } from './paths.js'
import { ffmpegPath, whisperServerCandidates } from './binaries.js'

// large-v3-turbo sem quantizaÃ§Ã£o: mesma velocidade do q5_0 no Apple Silicon,
// com menos erro de palavra parecida. Pesa 1,6GB de RAM.
const MODEL_FILE = 'ggml-large-v3-turbo.bin'
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'
const PORT = 8971

// funÃ§Ã£o, nÃ£o constante: modelDir() depende de env que sÃ³ existe em runtime
export function modelPath() { return join(modelDir(), MODEL_FILE) }
```

`execFileSync` sai dos imports â€” nÃ£o Ã© mais usado. `homedir` tambÃ©m sai: quem sabe de caminho agora Ã© o `paths.js`.

- [ ] **Step 2: Reescrever `ensureModel`**

Substituir a funÃ§Ã£o `ensureModel` inteira (linhas ~31-38 do arquivo original):

```js
// Download em stream com arquivo .part: uma queda de rede no meio nÃ£o deixa
// um modelo truncado de 1,6GB parecendo vÃ¡lido no disco.
export async function ensureModel() {
  const target = modelPath()
  if (existsSync(target)) return target

  mkdirSync(modelDir(), { recursive: true })
  const partial = target + '.part'

  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`download do modelo falhou: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial))
  await rename(partial, target)

  return target
}
```

Isso remove as duas Ãºltimas dependÃªncias de binÃ¡rio Unix do projeto (`curl` e `mv`).

- [ ] **Step 3: Parametrizar o binÃ¡rio do servidor**

Substituir a assinatura e a primeira linha de `startWhisperServer`:

```js
export async function startWhisperServer({
  binPath,
  modelPath: model = modelPath(),
  language = 'pt',
  port = PORT
} = {}) {
  const bin = binPath || whisperServerCandidates()[0]
  if (!bin) throw new Error('nenhum whisper-server encontrado: rode `npm run deps:win`')

  const proc = spawn(bin, [
    '--model', model, '--host', '127.0.0.1', '--port', String(port),
```

O restante da lista de argumentos e todo o laÃ§o de espera de 60s ficam **exatamente como estÃ£o**. SÃ³ trocar, na mensagem de erro do final, `whisper-server nÃ£o subiu em 60s` por `` `whisper-server (${bin}) nÃ£o subiu em 60s` `` para o log dizer qual variante falhou.

- [ ] **Step 4: Adicionar o fallback**

Adicionar, logo depois de `startWhisperServer`:

```js
// Tenta cada variante na ordem de whisperServerCandidates() (Vulkan, depois
// CPU). Uma GPU sem driver Vulkan faz o processo morrer no boot; nesse caso
// nÃ£o hÃ¡ erro de rede a distinguir, entÃ£o simplesmente tentamos a prÃ³xima.
export async function startWhisperServerWithFallback(opts = {}) {
  const candidates = whisperServerCandidates()
  if (!candidates.length) throw new Error('nenhum whisper-server encontrado: rode `npm run deps:win`')

  let lastError
  for (const binPath of candidates) {
    try {
      return await startWhisperServer({ ...opts, binPath })
    } catch (err) {
      lastError = err
      console.error(`whisper-server falhou em ${binPath}:`, err.message)
    }
  }
  throw lastError
}
```

- [ ] **Step 5: Trocar o `FFMPEG` fixo em `webmToWav`**

Na funÃ§Ã£o `webmToWav`, trocar a linha do `execFile`:

```js
    execFile(ffmpegPath(), ['-y', '-i', webm, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
```

E apagar a constante `const FFMPEG = '/opt/homebrew/bin/ffmpeg'`, que jÃ¡ saiu no Step 1.

- [ ] **Step 6: Atualizar o `index.js`**

Em `app/src/main/index.js`:

- linha 7, trocar o import:

```js
import { ensureModel, startWhisperServerWithFallback, transcribe } from './whisper.js'
```

- linha ~98, `ensureModel()` vira `await ensureModel()`
- linha ~100 e a de dentro de `restartWhisper`, `startWhisperServer(...)` vira `startWhisperServerWithFallback(...)`

- [ ] **Step 7: Rodar os testes de unidade do whisper**

```bash
cd app && npm test -- whisper.unit
```

Esperado: 3 testes PASS. `juntarSegmentos` nÃ£o foi tocado â€” se falhar, alguma ediÃ§Ã£o vazou para a funÃ§Ã£o errada.

- [ ] **Step 8: Tornar o teste de integraÃ§Ã£o cross-platform**

Substituir **todo** o conteÃºdo de `app/tests/whisper.integration.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureModel, startWhisperServerWithFallback, transcribe } from '../src/main/whisper.js'
import { ffmpegPath } from '../src/main/binaries.js'

const run = process.env.RUN_WHISPER === '1' ? describe : describe.skip
const FRASE = 'O rato roeu a roupa do rei de Roma'

// gera um wav de fala sintÃ©tica com a voz do prÃ³prio sistema
function falar(destino) {
  if (process.platform === 'darwin') {
    const aiff = join(tmpdir(), 'dita-test.aiff')
    execFileSync('say', ['-v', 'Luciana', '-o', aiff, FRASE])
    execFileSync(ffmpegPath(), ['-y', '-i', aiff, destino])
    return
  }
  // Windows: SAPI via PowerShell escreve wav direto
  const wav = join(tmpdir(), 'dita-test-sapi.wav')
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.Speech; ` +
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$s.SetOutputToWaveFile('${wav}'); $s.Speak('${FRASE}'); $s.Dispose()`])
  execFileSync(ffmpegPath(), ['-y', '-i', wav, destino])
}

run('whisper integraÃ§Ã£o', () => {
  it('transcreve fala sintÃ©tica em portuguÃªs', { timeout: 180000 }, async () => {
    const webm = join(tmpdir(), 'dita-test.webm')
    falar(webm)
    await ensureModel()
    const server = await startWhisperServerWithFallback({})
    try {
      const text = await transcribe(readFileSync(webm), { port: server.port })
      expect(text.toLowerCase()).toContain('rato roeu')
    } finally {
      server.kill()
    }
  })
})
```

No Windows a voz padrÃ£o do SAPI pode ser em inglÃªs (Microsoft Zira/David). Se o teste falhar por pronÃºncia, instalar a voz `Microsoft Maria` em ConfiguraÃ§Ãµes â†’ Hora e Idioma â†’ Fala. Isso Ã© diagnÃ³stico do teste, nÃ£o do app.

- [ ] **Step 9: Rodar o teste de integraÃ§Ã£o**

SÃ³ depois da Task 9 (que baixa os binÃ¡rios). Marcar este step e voltar:

```bash
cd app && RUN_WHISPER=1 npm test -- whisper.integration
```

Esperado: 1 teste PASS. Primeira execuÃ§Ã£o baixa 1,6GB â€” pode levar minutos.

- [ ] **Step 10: Commit**

```bash
git add app/src/main/whisper.js app/src/main/index.js app/tests/whisper.integration.test.js
git commit -m "feat: platform-agnostic whisper paths, streamed model download, GPU fallback"
```


---

## Task 9: Baixar os binÃ¡rios Windows (whisper.cpp) e gerar os Ã­cones

O `whisper-server.exe` nÃ£o vem de gerenciador de pacote. Vem dos releases oficiais do whisper.cpp, e os nomes dos assets mudam entre versÃµes â€” por isso o script **consulta a API do GitHub e reporta o que encontrou** em vez de assumir um nome fixo.

**Files:**
- Create: `app/scripts/fetch-whisper-win.mjs`
- Create: `app/scripts/make-win-icons.ps1`
- Modify: `app/package.json` (scripts `deps:win`, `icons:win`)
- Modify: `.gitignore` (ignorar `app/resources/win/`)

- [ ] **Step 1: Escrever o script de download**

Criar `app/scripts/fetch-whisper-win.mjs`:

```js
// Baixa os binÃ¡rios oficiais do whisper.cpp e os deixa em
// app/resources/win/whisper/{vulkan,cpu}/whisper-server.exe (+ DLLs).
// Os nomes dos assets mudam entre releases, entÃ£o casamos por regex e
// imprimimos o que foi escolhido.
import { execFileSync } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync, readdirSync, renameSync, cpSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../resources/win/whisper')
const TMP = join(HERE, '../.tmp-whisper')
const API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest'

// vulkan Ã© opcional: nem todo release publica. cpu Ã© obrigatÃ³rio.
const FLAVORS = [
  { name: 'vulkan', match: /vulkan/i, required: false },
  { name: 'cpu', match: /^whisper-bin-x64\.zip$/i, required: true }
]

async function baixar(url, destino) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dita-ai-build' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destino))
}

function extrair(zip, destino) {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destino}' -Force`],
    { stdio: 'inherit' })
}

// o exe do servidor mudou de nome entre versÃµes (server.exe -> whisper-server.exe)
function acharServidor(raiz) {
  for (const entry of readdirSync(raiz, { withFileTypes: true })) {
    const full = join(raiz, entry.name)
    if (entry.isDirectory()) {
      const found = acharServidor(full)
      if (found) return found
    } else if (/^(whisper-)?server\.exe$/i.test(entry.name)) {
      return full
    }
  }
  return null
}

const res = await fetch(API, { headers: { 'User-Agent': 'dita-ai-build' } })
if (!res.ok) throw new Error(`API do GitHub respondeu HTTP ${res.status}`)
const release = await res.json()
console.log(`release: ${release.tag_name}`)
console.log('assets disponÃ­veis:')
for (const a of release.assets) console.log('  -', a.name)

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
mkdirSync(OUT, { recursive: true })

for (const flavor of FLAVORS) {
  const asset = release.assets.find((a) => a.name.endsWith('.zip')
    && /x64/i.test(a.name)
    && flavor.match.test(a.name))

  if (!asset) {
    const msg = `nenhum asset ${flavor.name} neste release`
    if (flavor.required) throw new Error(msg + ' â€” conferir a lista acima e ajustar o regex')
    console.log(`  (pulando ${flavor.name}: ${msg})`)
    continue
  }

  console.log(`\n${flavor.name}: ${asset.name} (${(asset.size / 1e6).toFixed(1)}MB)`)
  const zip = join(TMP, asset.name)
  const desempacotado = join(TMP, flavor.name)

  await baixar(asset.browser_download_url, zip)
  extrair(zip, desempacotado)

  const servidor = acharServidor(desempacotado)
  if (!servidor) throw new Error(`${asset.name} nÃ£o contÃ©m server.exe nem whisper-server.exe`)

  // copia a pasta inteira: o exe depende das DLLs vizinhas (ggml, whisper, vulkan)
  const pastaDoExe = dirname(servidor)
  const destino = join(OUT, flavor.name)
  rmSync(destino, { recursive: true, force: true })
  cpSync(pastaDoExe, destino, { recursive: true })

  const alvo = join(destino, 'whisper-server.exe')
  const copiado = join(destino, servidor.split(/[\\/]/).pop())
  if (copiado !== alvo) renameSync(copiado, alvo)

  console.log(`  -> ${alvo}`)
}

rmSync(TMP, { recursive: true, force: true })
console.log('\npronto.')
```

- [ ] **Step 2: Escrever o script de Ã­cones**

O `.icns` do Mac nÃ£o serve no Windows, e o `trayTemplate.png` Ã© monocromÃ¡tico preto â€” invisÃ­vel na barra de tarefas escura. O Ã­cone da bandeja no Windows usa o Ã­cone colorido do app.

Criar `app/scripts/make-win-icons.ps1`:

```powershell
# Gera resources/win/tray.ico (32px) e build/icon.ico (256px) a partir do
# app-icon colorido do branding. System.Drawing evita dependÃªncia npm nova.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here '..\..\branding\app-icon-1024.png'
if (-not (Test-Path $src)) { throw "nÃ£o achei $src" }

function New-Ico($source, $size, $destination) {
    $dir = Split-Path -Parent $destination
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

    $original = [System.Drawing.Image]::FromFile($source)
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = 'HighQualityBicubic'
    $graphics.DrawImage($original, 0, 0, $size, $size)

    $handle = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($handle)
    $stream = [System.IO.File]::Create($destination)
    $icon.Save($stream)

    $stream.Close(); $icon.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $original.Dispose()
    Write-Host "gerado: $destination ($size px)"
}

New-Ico $src 32 (Join-Path $here '..\resources\win\tray.ico')
New-Ico $src 256 (Join-Path $here '..\build\icon.ico')
```

- [ ] **Step 3: Registrar os scripts no `package.json`**

Em `app/package.json`, dentro de `"scripts"`, adicionar:

```json
    "deps:win": "node scripts/fetch-whisper-win.mjs",
    "icons:win": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-win-icons.ps1",
    "helper:win": "powershell -NoProfile -ExecutionPolicy Bypass -File ../helper-win/build.ps1",
```

- [ ] **Step 4: Ignorar os artefatos**

Adicionar ao `.gitignore` da raiz:

```
app/resources/win/
app/build/icon.ico
app/.tmp-whisper/
```

BinÃ¡rio de terceiro nÃ£o entra no repo: quem clonar roda `npm run deps:win`.

- [ ] **Step 5: Rodar o download**

```bash
cd app && npm run deps:win
```

Esperado: lista os assets do release, baixa 1 ou 2 zips e imprime dois (ou um) caminho `-> ...whisper-server.exe`. Se der `nenhum asset cpu neste release`, ler a lista impressa e corrigir o regex de `FLAVORS` â€” o nome do asset mudou upstream.

- [ ] **Step 6: Verificar que o binÃ¡rio roda**

```bash
./app/resources/win/whisper/cpu/whisper-server.exe --help
```

Esperado: imprime as opÃ§Ãµes de uso. Se der erro de DLL faltando (`VCRUNTIME140.dll`), instalar o redistribuÃ­vel: `winget install Microsoft.VCRedist.2015+.x64`.

- [ ] **Step 7: Gerar os Ã­cones**

```bash
cd app && npm run icons:win
```

Esperado: duas linhas `gerado: ...`. Abrir `app/resources/win/tray.ico` no Explorer e confirmar que Ã© o Ã­cone colorido, nÃ£o um quadrado preto.

- [ ] **Step 8: Rodar o teste de binaries de novo**

Agora os candidatos existem de verdade:

```bash
cd app && npm test -- binaries
```

Esperado: 3 PASS, e agora o teste de ordem exercita o caminho real (vulkan antes de cpu).

- [ ] **Step 9: Commit**

```bash
git add app/scripts/fetch-whisper-win.mjs app/scripts/make-win-icons.ps1 app/package.json .gitignore
git commit -m "build: add scripts to fetch whisper.cpp binaries and generate Windows icons"
```

---

## Task 10: Ligar tudo no processo main

Ãšltimos pontos macOS no cÃ³digo de aplicaÃ§Ã£o: caminho de dados, prompt de microfone, argumentos do helper, Ã­cone/aceleradores da bandeja, chamadas de janela mac-only e o smoke test.

**Files:**
- Modify: `app/src/main/index.js`
- Modify: `app/src/main/tray.js`
- Modify: `app/src/main/recorder-window.js`

- [ ] **Step 1: `index.js` â€” caminho de dados**

Trocar a linha 14:

```js
const DATA_DIR = join(homedir(), 'Library/Application Support/dita-ai')
```

por um import (junto dos outros, no topo):

```js
import { dataDir, dbPath } from './paths.js'
```

Dentro de `app.whenReady()`, trocar as duas linhas:

```js
  mkdirSync(DATA_DIR, { recursive: true })
  initDb(join(DATA_DIR, 'dita.db'))
```

por:

```js
  mkdirSync(dataDir(), { recursive: true })
  initDb(dbPath())
```

`homedir` sai dos imports se nÃ£o sobrar outro uso.

- [ ] **Step 2: `index.js` â€” prompt de microfone**

`systemPreferences.askForMediaAccess` sÃ³ existe no macOS; no Windows ele nem Ã© chamado, e a permissÃ£o Ã© global do sistema. Trocar a linha 93:

```js
  systemPreferences.askForMediaAccess('microphone').catch(() => {})
```

por:

```js
  // macOS pede permissÃ£o por app; Windows Ã© um toggle global do sistema
  // (ConfiguraÃ§Ãµes > Privacidade > Microfone > "Permitir que aplicativos de
  // Ã¡rea de trabalho acessem seu microfone"), sem API de prompt.
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {})
  }
```

- [ ] **Step 3: `index.js` â€” defaults e argumentos do helper**

Adicionar ao topo:

```js
import { DEFAULT_TOGGLE, DEFAULT_PTT } from './defaults.js'
```

Trocar o `helperArgs` (linhas ~136-139):

```js
  const helperArgs = () => {
    const flags = [
      `--toggle=${getSetting('toggleShortcut', DEFAULT_TOGGLE)}`,
      `--ptt=${getSetting('pttShortcut', DEFAULT_PTT)}`
    ]
    // o helper Windows Ã© multi-comando; o Swift sÃ³ faz hotkeys
    return process.platform === 'win32' ? ['hotkeys', ...flags] : flags
  }
```

E no handler `settings:get-all`, trocar os dois defaults literais:

```js
    toggleShortcut: getSetting('toggleShortcut', DEFAULT_TOGGLE),
    pttShortcut: getSetting('pttShortcut', DEFAULT_PTT)
```

- [ ] **Step 4: `index.js` â€” texto da notificaÃ§Ã£o de permissÃ£o**

O texto atual fala de "Ajustes > Privacidade e SeguranÃ§a > Acessibilidade", que nÃ£o existe no Windows. Trocar o corpo do `onNoPermission` (linhas ~144-149):

```js
    onNoPermission: () => {
      new Notification({
        title: 'Dita AÃ­ nÃ£o conseguiu registrar o atalho',
        body: process.platform === 'darwin'
          ? 'Ajustes > Privacidade e SeguranÃ§a > Acessibilidade: ative o Dita AÃ­. Os atalhos ligam sozinhos em seguida.'
          : 'O atalho global falhou ao instalar. Feche outros apps de captura de teclado e reabra o Dita AÃ­.'
      }).show()
    }
```

- [ ] **Step 5: `index.js` â€” smoke test**

O bloco `DITA_TEST_DICTATION` usa `say` e o ffmpeg do Homebrew. Substituir o corpo inteiro do `if (process.env.DITA_TEST_DICTATION) { ... }`:

```js
  if (process.env.DITA_TEST_DICTATION) {
    const { execFileSync } = await import('child_process')
    const { readFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { ffmpegPath } = await import('./binaries.js')
    const webm = join(tmpdir(), 'dita-smoke.webm')
    const frase = 'Teste do pipeline completo do Dita AÃ­'

    if (process.platform === 'darwin') {
      const aiff = join(tmpdir(), 'dita-smoke.aiff')
      execFileSync('say', ['-v', 'Luciana', '-o', aiff, frase])
      execFileSync(ffmpegPath(), ['-y', '-i', aiff, webm], { stdio: 'ignore' })
    } else {
      const wav = join(tmpdir(), 'dita-smoke.wav')
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Add-Type -AssemblyName System.Speech; ` +
        `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
        `$s.SetOutputToWaveFile('${wav}'); $s.Speak('${frase}'); $s.Dispose()`])
      execFileSync(ffmpegPath(), ['-y', '-i', wav, webm], { stdio: 'ignore' })
    }

    targetApp = 'SmokeTest'
    recStartedAt = Date.now() - 3000
    rec.show()
    await processDictation(readFileSync(webm))
    console.log('SMOKE_RESULT:', JSON.stringify(getLastDictation()))
  }
```

- [ ] **Step 6: `tray.js` â€” Ã­cone e aceleradores**

Substituir `loadIcon` e a linha do `globalShortcut`:

```js
const isMac = process.platform === 'darwin'

function loadIcon() {
  const file = isMac ? 'trayTemplate.png' : 'win/tray.ico'
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, isMac ? 'trayTemplate.png' : 'tray.ico')
    : join(__dirname, '../../resources', file)

  const img = nativeImage.createFromPath(iconPath)
  if (!isMac) return img            // .ico jÃ¡ traz o tamanho certo
  const resized = img.resize({ width: 18, height: 18 })
  resized.setTemplateImage(true)    // sÃ³ o macOS entende template image
  return resized
}
```

No `buildMenu`, trocar os dois aceleradores:

```js
      { label: 'Paste last transcript', accelerator: isMac ? 'Ctrl+Cmd+V' : 'Ctrl+Alt+V', click: onPasteLast },
```

```js
      { label: 'Sair do Dita AÃ­', accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q', click: () => app.quit() }
```

E o atalho global (`Control+Command+V` nÃ£o existe no Windows â€” o `register` falha silenciosamente):

```js
  globalShortcut.register(isMac ? 'Control+Command+V' : 'Control+Alt+V', onPasteLast)
```

- [ ] **Step 7: `recorder-window.js` â€” chamadas mac-only sob guarda**

`setVisibleOnAllWorkspaces` com `skipTransformProcessType` Ã© especÃ­fico do macOS. Adicionar perto do topo do arquivo:

```js
const isMac = process.platform === 'darwin'

// no macOS mantÃ©m o popup acima de apps em tela cheia e fora da troca de
// espaÃ§os; no Windows o alwaysOnTop 'screen-saver' jÃ¡ basta
function keepOnAllWorkspaces(win) {
  if (!isMac) return
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
}
```

Trocar as duas chamadas existentes (linha 27 e linha 64) por `keepOnAllWorkspaces(win)`.

- [ ] **Step 8: Subir o app em dev**

```bash
cd app && npm run dev
```

Esperado: o Ã­cone aparece na bandeja do sistema, sem erro no console. A primeira execuÃ§Ã£o baixa o modelo de 1,6GB â€” deixar terminar.

- [ ] **Step 9: Verificar o ciclo completo Ã  mÃ£o**

Com o app rodando, abrir o Bloco de Notas e:

| AÃ§Ã£o | Esperado |
|---|---|
| `Ctrl+Shift+EspaÃ§o`, falar, `Ctrl+Shift+EspaÃ§o` | pÃ­lula aparece, some, texto colado no Bloco de Notas |
| segurar `Ctrl direito`, falar, soltar | mesmo resultado |
| segurar `Ctrl direito` e soltar em menos de 300ms | nada acontece (guarda de PTT curto) |
| gravar e apertar `Esc` | tarja "TranscriÃ§Ã£o cancelada / Anular" |
| clicar em "Anular" | o texto Ã© colado mesmo assim |
| menu da bandeja â†’ "Paste last transcript" | cola o Ãºltimo ditado |

Se o texto nÃ£o colar mas a transcriÃ§Ã£o aparecer no card grande, o `paste` foi bloqueado: a janela em foco roda como administrador.

- [ ] **Step 10: Commit**

```bash
git add app/src/main/index.js app/src/main/tray.js app/src/main/recorder-window.js
git commit -m "feat: wire Windows platform layer into the main process"
```


---

## Task 11: Tela de PreferÃªncias â€” atalhos por plataforma

`Settings.jsx:88-103` oferece "Fn + EspaÃ§o" e "âŒ˜ Command direito", que nÃ£o existem no Windows. Selecionar qualquer um deles hoje gravaria uma configuraÃ§Ã£o que o helper Windows ignora â€” o usuÃ¡rio mexe e nada muda.

O renderer nÃ£o deve inferir a plataforma sozinho (com `contextIsolation` ligado `process` nÃ£o estÃ¡ disponÃ­vel): a plataforma vem junto do payload de configuraÃ§Ãµes que ele jÃ¡ busca.

**Files:**
- Modify: `app/src/main/index.js` (handler `settings:get-all`)
- Modify: `app/src/renderer/src/Settings.jsx`

- [ ] **Step 1: Mandar a plataforma no payload**

Em `app/src/main/index.js`, no handler `settings:get-all`, adicionar a primeira propriedade:

```js
  ipcMain.handle('settings:get-all', () => ({
    platform: process.platform,
    language: getSetting('language', 'pt'),
```

- [ ] **Step 2: Definir as opÃ§Ãµes no renderer**

Em `app/src/renderer/src/Settings.jsx`, adicionar acima do componente (logo depois dos imports):

```jsx
// Fn nÃ£o chega a nenhum hook no Windows, e o Right Alt Ã© o AltGr do teclado
// ABNT2 â€” por isso as listas divergem em vez de serem traduzidas.
const ATALHOS = {
  darwin: {
    toggle: [
      ['fn+space', 'Fn + EspaÃ§o'],
      ['opt+space', 'âŒ¥ Option + EspaÃ§o'],
      ['ctrl+space', 'âŒƒ Control + EspaÃ§o'],
      ['f5', 'F5']
    ],
    ptt: [
      ['rcmd', 'âŒ˜ Command direito'],
      ['ropt', 'âŒ¥ Option direito']
    ],
    padraoToggle: 'fn+space',
    padraoPtt: 'rcmd',
    colarUltimo: 'âŒƒâŒ˜V'
  },
  win32: {
    toggle: [
      ['ctrl+shift+space', 'Ctrl + Shift + EspaÃ§o'],
      ['ctrl+space', 'Ctrl + EspaÃ§o'],
      ['alt+space', 'Alt + EspaÃ§o'],
      ['f5', 'F5']
    ],
    ptt: [
      ['rctrl', 'Ctrl direito'],
      ['rshift', 'Shift direito'],
      ['rwin', 'Windows direito']
    ],
    padraoToggle: 'ctrl+shift+space',
    padraoPtt: 'rctrl',
    colarUltimo: 'Ctrl+Alt+V'
  }
}
```

- [ ] **Step 3: Usar as opÃ§Ãµes nos dois `select`**

Dentro do componente, antes do `return`, adicionar:

```jsx
  const atalhos = ATALHOS[settings.platform] || ATALHOS.darwin
```

Substituir o `select` de toggle (linhas 88-93):

```jsx
          <select
            style={S.select}
            value={settings.toggleShortcut || atalhos.padraoToggle}
            onChange={(e) => update('toggleShortcut', e.target.value)}
          >
            {atalhos.toggle.map(([valor, rotulo]) => (
              <option key={valor} value={valor}>{rotulo}</option>
            ))}
          </select>
```

Substituir o `select` de push-to-talk (linhas 100-103):

```jsx
          <select
            style={S.select}
            value={settings.pttShortcut || atalhos.padraoPtt}
            onChange={(e) => update('pttShortcut', e.target.value)}
          >
            {atalhos.ptt.map(([valor, rotulo]) => (
              <option key={valor} value={valor}>{rotulo}</option>
            ))}
          </select>
```

- [ ] **Step 4: Corrigir a legenda do rodapÃ©**

Substituir a linha 107:

```jsx
            <span style={S.kbd}>Esc</span> cancela a gravaÃ§Ã£o Â· <span style={S.kbd}>{atalhos.colarUltimo}</span> cola o Ãºltimo ditado
```

- [ ] **Step 5: Verificar na tela**

```bash
cd app && npm run dev
```

Abrir PreferÃªncias pelo menu da bandeja. Esperado: o seletor principal mostra "Ctrl + Shift + EspaÃ§o" e o de push-to-talk mostra "Ctrl direito"; nenhuma opÃ§Ã£o com `âŒ˜` ou `Fn`. Trocar o atalho principal para `F5` e confirmar que `F5` passa a gravar sem reiniciar o app (o `settings:set` reinicia o helper).

- [ ] **Step 6: Commit**

```bash
git add app/src/main/index.js app/src/renderer/src/Settings.jsx
git commit -m "feat: show platform-appropriate shortcut options in preferences"
```

---

## Task 12: Empacotar (electron-builder + NSIS)

**Files:**
- Modify: `app/electron-builder.yml`
- Modify: `app/package.json` (script `build:win`)
- Modify: `app/scripts/after-pack.cjs` (nenhuma mudanÃ§a de lÃ³gica â€” confirmar o early return)

- [ ] **Step 1: Conferir o `after-pack.cjs`**

Ele jÃ¡ tem `if (context.electronPlatformName !== 'darwin') return` na linha 9. Nada a fazer, mas **confirmar** â€” se essa guarda sumir, o build Windows quebra tentando rodar `plutil`.

- [ ] **Step 2: Reescrever o `electron-builder.yml`**

Substituir **todo** o conteÃºdo de `app/electron-builder.yml`:

```yaml
appId: com.felipetambara.dita-ai
productName: Dita AI
asar: false
afterPack: scripts/after-pack.cjs
directories:
  output: dist
files:
  - out/**

mac:
  icon: build/icon.icns
  category: public.app-category.productivity
  target:
    - dir
  extendInfo:
    CFBundleDisplayName: Dita AÃ­
    NSMicrophoneUsageDescription: O Dita AÃ­ usa o microfone para transcrever sua fala.
    LSUIElement: false
  hardenedRuntime: false
  extraResources:
    - from: ../helper/dita-hotkeys
      to: dita-hotkeys
    - from: resources/trayTemplate.png
      to: trayTemplate.png
    - from: resources/trayTemplate@2x.png
      to: trayTemplate@2x.png

win:
  icon: build/icon.ico
  target:
    - nsis
  # sem certificado de assinatura de cÃ³digo: o SmartScreen vai avisar na
  # primeira execuÃ§Ã£o, igual ao Gatekeeper no Mac
  extraResources:
    - from: ../helper-win/dist/dita-helper.exe
      to: dita-helper.exe
    - from: resources/win/tray.ico
      to: tray.ico
    - from: resources/win/whisper
      to: whisper

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  shortcutName: Dita AÃ­
```

`extraResources` sai do nÃ­vel raiz e passa a ser declarado dentro de `mac:` e `win:` â€” no raiz, o builder tentaria copiar `helper/dita-hotkeys` (que nÃ£o existe no Windows) e falharia.

- [ ] **Step 3: Adicionar o script de build**

Em `app/package.json`, dentro de `"scripts"`:

```json
    "build:win": "npm run helper:win && npm run icons:win && electron-vite build && electron-builder --win",
```

O helper e os Ã­cones precisam existir antes do `electron-builder` copiar os `extraResources`.

- [ ] **Step 4: Empacotar**

```bash
cd app && npm run build:win
```

Esperado: termina com `building        target=nsis` e produz `app/dist/Dita AI Setup 0.1.0.exe`. Se falhar com `cannot find ../helper-win/dist/dita-helper.exe`, a Task 4 nÃ£o foi concluÃ­da.

- [ ] **Step 5: Conferir o conteÃºdo do pacote antes de instalar**

```bash
ls app/dist/win-unpacked/resources/
```

Esperado: contÃ©m `dita-helper.exe`, `tray.ico`, `whisper/` e `app/`. Se `whisper/` faltar, o app instalado nÃ£o transcreve â€” voltar Ã  Task 9.

- [ ] **Step 6: Instalar e testar o app empacotado**

Rodar `app/dist/Dita AI Setup 0.1.0.exe`. O SmartScreen vai avisar ("Windows protegeu o computador") â€” clicar em "Mais informaÃ§Ãµes" â†’ "Executar assim mesmo". Isso Ã© esperado: o executÃ¡vel nÃ£o Ã© assinado, exatamente como o `.app` nÃ£o Ã© notarizado no Mac.

Depois de instalar, repetir a tabela de verificaÃ§Ã£o do Step 9 da Task 10, agora com o app instalado (nÃ£o em `npm run dev`). O que muda em relaÃ§Ã£o ao dev:

| Ponto | Por quÃª importa |
|---|---|
| o helper vem de `resources/dita-helper.exe` | valida o `helperPath()` no ramo `isPackaged` |
| o whisper vem de `resources/whisper/` | valida o `whisperServerCandidates()` empacotado |
| "abrir ao iniciar" | valida `app.setLoginItemSettings` no Windows |

- [ ] **Step 7: Verificar o autostart**

Nas PreferÃªncias, ligar "abrir ao iniciar". Depois:

```bash
powershell -NoProfile -Command "Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' | Select-Object -Property '*ita*'"
```

Esperado: uma entrada apontando para o executÃ¡vel instalado. Desligar a opÃ§Ã£o e confirmar que a entrada some.

- [ ] **Step 8: Commit**

```bash
git add app/electron-builder.yml app/package.json
git commit -m "build: add Windows NSIS packaging"
```

---

## Task 13: DocumentaÃ§Ã£o

O README atual afirma "macOS com Apple Silicon" como requisito e manda rodar `brew install`. Precisa cobrir as duas plataformas sem virar um labirinto.

**Files:**
- Modify: `README.md`
- Create: `docs/windows.md`

- [ ] **Step 1: Criar o guia do Windows**

Criar `docs/windows.md`:

````markdown
# Dita AÃ­ no Windows

## O que vocÃª precisa

| Item | Por quÃª |
|---|---|
| Windows 10 21H2 ou 11, x64 | o helper usa `SetWindowsHookEx` e `SendInput` |
| 16GB de RAM (recomendado) | o modelo carregado ocupa cerca de 1,6GB |
| Node.js 20+ | rodar e compilar o app |
| .NET 8 SDK | compilar o helper de atalho global |
| ~4GB de disco livre | modelo (1,6GB) + binÃ¡rios do whisper.cpp |

Placa de vÃ­deo Ã© opcional: se houver Vulkan, o app usa; se nÃ£o, cai para CPU sozinho.

## InstalaÃ§Ã£o

```powershell
winget install Microsoft.DotNet.SDK.8
git clone https://github.com/felipefernandees/dita-ai.git
cd dita-ai\app
npm install
npm run helper:win   # compila o dita-helper.exe
npm run deps:win     # baixa whisper.cpp
npm run icons:win    # gera os Ã­cones
npm run dev
```

Na primeira execuÃ§Ã£o ele baixa o modelo `ggml-large-v3-turbo` (1,6GB) para
`%APPDATA%\dita-ai\models\`. Acontece **uma vez sÃ³**.

Para gerar o instalador: `npm run build:win` â†’ `app\dist\Dita AI Setup 0.1.0.exe`.

## A permissÃ£o que o Windows pede

SÃ³ uma, e ela Ã© global (nÃ£o por app):

**ConfiguraÃ§Ãµes â†’ Privacidade e seguranÃ§a â†’ Microfone** â†’ ligar
**"Permitir que aplicativos da Ã¡rea de trabalho acessem seu microfone"**.

NÃ£o existe permissÃ£o de acessibilidade equivalente Ã  do macOS: o hook de
teclado funciona sem pedir nada.

## Atalhos

| AÃ§Ã£o | Atalho |
|---|---|
| Gravar (liga/desliga) | `Ctrl+Shift+EspaÃ§o` |
| Gravar (segurar) | `Ctrl direito` |
| Cancelar no meio | `Esc` |
| Colar Ãºltimo ditado | `Ctrl+Alt+V` |

DÃ¡ para trocar nas PreferÃªncias (Ã­cone na bandeja do sistema).

**Por que nÃ£o `Fn+EspaÃ§o` como no Mac?** No Windows a tecla `Fn` Ã© resolvida
dentro do teclado e nunca chega ao sistema operacional â€” nenhum programa
consegue capturÃ¡-la.

**Por que o push-to-talk nÃ£o Ã© o `Alt direito`?** Em teclado ABNT2 o `Alt
direito` Ã© o `AltGr`, usado para `Ã§`, `Âº` e `â‚¢`. Ele estÃ¡ disponÃ­vel na lista
de opÃ§Ãµes, mas nÃ£o como padrÃ£o.

## Problemas conhecidos

| Sintoma | Causa | O que fazer |
|---|---|---|
| SmartScreen bloqueia o instalador | executÃ¡vel nÃ£o assinado | "Mais informaÃ§Ãµes" â†’ "Executar assim mesmo" |
| o atalho nÃ£o funciona em um app especÃ­fico | esse app roda como administrador; o hook de um processo comum nÃ£o recebe os eventos dele | rodar o Dita AÃ­ como administrador tambÃ©m, ou o app alvo sem elevaÃ§Ã£o |
| transcreve mas nÃ£o cola | mesmo motivo acima, no `SendInput` | o texto fica no card grande com o botÃ£o "Copiar Ditado" |
| `VCRUNTIME140.dll nÃ£o encontrada` | falta o redistribuÃ­vel do Visual C++ | `winget install Microsoft.VCRedist.2015+.x64` |
| transcriÃ§Ã£o muito lenta | rodando no build CPU | conferir no console qual binÃ¡rio subiu; instalar/atualizar o driver de vÃ­deo habilita o Vulkan |
````

- [ ] **Step 2: Ajustar o README**

Em `README.md`, trocar a linha 3 (o parÃ¡grafo de abertura), substituindo "no Mac inteiro" por "no computador inteiro".

Substituir a seÃ§Ã£o "## O que vocÃª precisa" e "## InstalaÃ§Ã£o" inteiras (linhas 11 a 41) por:

```markdown
## Escolha sua plataforma

| Sistema | Guia |
|---|---|
| **macOS** (Apple Silicon) | continue lendo abaixo |
| **Windows** 10/11 x64 | [docs/windows.md](docs/windows.md) |

## O que vocÃª precisa (macOS)
```

...e manter a tabela e o bloco de instalaÃ§Ã£o atuais logo em seguida, sem
alteraÃ§Ã£o.

- [ ] **Step 3: Ajustar a tabela de pastas**

Na tabela "| Pasta | O que tem |" no fim do README, adicionar uma linha depois da linha do `helper/`:

```markdown
| `helper-win/` | `dita-helper.exe`, o equivalente Windows (hook de teclado + colagem) |
```

- [ ] **Step 4: Ajustar a seÃ§Ã£o "Como funciona por dentro"**

No diagrama, trocar a primeira e a Ãºltima linha para nÃ£o citarem sÃ³ o Mac:

```
Atalho global (helper Swift no macOS, dita-helper.exe no Windows)
        â”‚
        â–¼
Electron grava o Ã¡udio  â†’  ffmpeg converte  â†’  whisper.cpp (servidor local)
        â”‚
        â–¼
Texto volta, passa pelo polimento (pontuaÃ§Ã£o e capitalizaÃ§Ã£o)
        â”‚
        â–¼
Colado no campo onde o cursor estÃ¡
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/windows.md
git commit -m "docs: add Windows setup guide and make the README cross-platform"
```

---

## Task 14: VerificaÃ§Ã£o final

- [ ] **Step 1: SuÃ­te completa**

```bash
cd app && npm test
```

Esperado: todos os testes passam. Comparar com o baseline anotado na Task 0 â€” nenhum teste que passava antes pode ter regredido.

- [ ] **Step 2: Teste de integraÃ§Ã£o do whisper**

```bash
cd app && RUN_WHISPER=1 npm test -- whisper.integration
```

Esperado: PASS.

- [ ] **Step 3: Smoke test do pipeline sem atalhos**

```bash
cd app && npm run dev
```

Com `DITA_TEST_DICTATION=1` no ambiente (`$env:DITA_TEST_DICTATION=1` no PowerShell antes de rodar).
Esperado: o console imprime `SMOKE_RESULT: {...}` com um `text` nÃ£o vazio.

- [ ] **Step 4: Conferir que o Mac nÃ£o regrediu**

Esta Ã© a parte que nÃ£o dÃ¡ para verificar na mÃ¡quina Windows. Antes de abrir PR
para o upstream, rodar em um Mac:

```bash
cd app && npm test && npm run build:mac
```

Esperado: mesma suÃ­te verde e o `.app` gerado. Se nÃ£o houver Mac disponÃ­vel,
declarar isso explicitamente no PR em vez de afirmar que funciona.

- [ ] **Step 5: Commit final e branch**

```bash
git add -A && git commit -m "chore: Windows port complete"
```

