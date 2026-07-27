# Dita Aí no Windows

Ditado por voz global, 100% local, no Windows 10/11 x64.

## O que você precisa

| Item | Por quê |
|---|---|
| **Windows 10 21H2 ou 11**, x64 | o helper usa `SetWindowsHookEx` e `SendInput` |
| **16GB de RAM** (recomendado) | o modelo carregado ocupa cerca de 1,6GB |
| **Node.js 20+** | rodar e compilar o app |
| **.NET 8 SDK** | compilar o helper de atalho global |
| **~4GB de disco livre** | modelo (1,6GB) + binários do whisper.cpp + build |

Placa de vídeo dedicada **não** é necessária. Explicação em [Sobre a transcrição ser em CPU](#sobre-a-transcrição-ser-em-cpu).

## Instalação

```powershell
winget install Microsoft.DotNet.SDK.8
```

Abra um terminal **novo** depois disso (o PATH só atualiza em processo novo), então:

```powershell
git clone https://github.com/felipefernandees/dita-ai.git
cd dita-ai\app
npm install
npm run helper:win
npm run deps:win
npm run icons:win
npm run dev
```

O que cada script faz:

| Script | O que faz |
|---|---|
| `helper:win` | compila `dita-helper.exe` (atalho global + colagem) |
| `deps:win` | baixa os binários do whisper.cpp dos releases oficiais |
| `icons:win` | gera os ícones `.ico` da bandeja e do app |

Na primeira execução o app baixa o modelo `ggml-large-v3-turbo` (1,6GB) para
`%APPDATA%\dita-ai\models\`. Isso demora alguns minutos e acontece **uma vez só**.

Para gerar o instalador: `npm run build:win` → `app\dist\Dita AI Setup 0.1.0.exe`.

## A permissão que o Windows pede

Só uma, e ela é global do sistema (não por aplicativo):

**Configurações → Privacidade e segurança → Microfone** → ligue
**"Permitir que aplicativos da área de trabalho acessem seu microfone"**.

Não existe equivalente à permissão de Acessibilidade do macOS: o hook de teclado
funciona sem pedir nada.

## Atalhos

| Ação | Atalho |
|---|---|
| Gravar (liga/desliga) | `Ctrl+Shift+Espaço` |
| Gravar (segurar pra falar) | `Ctrl direito` |
| Cancelar no meio | `Esc` |
| Colar o último ditado | `Ctrl+Alt+V` |

Dá para trocar nas Preferências (ícone na bandeja do sistema).

### Por que os atalhos são diferentes do Mac

**`Fn+Espaço` não existe aqui.** A tecla `Fn` é resolvida dentro do firmware do
teclado e nunca chega ao sistema operacional — nenhum programa no Windows
consegue capturá-la. Por isso o padrão é `Ctrl+Shift+Espaço`, que não colide com
o alternador de idioma (`Ctrl+Espaço`) nem com o menu de janela (`Alt+Espaço`).

**O push-to-talk não é o `Alt direito`.** Em teclado ABNT2 o `Alt direito` é o
`AltGr`, usado para `ç`, `º` e `₢`. As teclas de push-to-talk nunca são
suprimidas (você ainda precisa delas nos atalhos normais), então usar o AltGr
quebraria sua digitação. Ele está na lista de opções, mas nunca como padrão.

**O `Windows direito` não é oferecido.** Um toque solto nele abre o menu Iniciar
toda vez, e como as teclas de PTT não são suprimidas, não há como evitar isso.

## Sobre a transcrição ser em CPU

O whisper.cpp **não publica build Vulkan para Windows** — nunca publicou. Os
únicos binários acelerados por GPU nos releases oficiais são cuBLAS, que só
funcionam em placas NVIDIA.

O app baixa duas variantes e usa a primeira que subir:

1. **BLAS** (OpenBLAS) — acelera a multiplicação de matrizes no CPU
2. **CPU puro** — rede de segurança

Isso significa que a transcrição roda no processador. Em máquina modesta o
`large-v3-turbo` pode demorar mais que o tempo do áudio. Se ficar lento demais
para o seu gosto, a saída é trocar por um modelo menor em
`app/src/main/whisper.js` (constante `MODEL_FILE`).

Quem tem placa NVIDIA pode baixar o `whisper-cublas-*-bin-x64.zip` manualmente e
apontar a variável `DITA_WHISPER_SERVER` para o executável dele.

## Personalize o vocabulário

Vale tanto quanto no Mac: abra `app/src/main/whisper.js`, ache a constante
`VOCABULARIO` e coloque ali seus nomes próprios — empresa, sócios, ferramentas do
seu stack, sua cidade. É o ajuste com melhor retorno do projeto inteiro.

## Onde ficam seus dados

| O quê | Onde |
|---|---|
| Histórico de ditados (SQLite) | `%APPDATA%\dita-ai\dita.db` |
| Modelo de transcrição | `%APPDATA%\dita-ai\models\` |

## Problemas conhecidos

| Sintoma | Causa | O que fazer |
|---|---|---|
| SmartScreen bloqueia o instalador | executável não assinado | "Mais informações" → "Executar assim mesmo" |
| o atalho não funciona em um app específico | esse app roda como administrador; um hook instalado por processo comum não recebe os eventos dele (UIPI) | rodar o Dita Aí como administrador também, ou o app alvo sem elevação |
| transcreve mas não cola | mesma causa acima, agora no `SendInput` | o texto fica no card grande com o botão "Copiar Ditado" |
| `VCRUNTIME140.dll não encontrada` | falta o redistribuível do Visual C++ | `winget install Microsoft.VCRedist.2015+.x64` |
| a preferência "tamanho do popup" não faz nada | bug que já existe no projeto original, nas duas plataformas: o valor é lido mas nunca aplicado à janela | nenhuma ação; o popup usa tamanho fixo |

## Como funciona por dentro

```
Ctrl+Shift+Espaço  (dita-helper.exe, hook WH_KEYBOARD_LL)
        │  evento JSON no stdout
        ▼
Electron grava o áudio  →  ffmpeg converte  →  whisper-server (local, BLAS/CPU)
        │
        ▼
Texto volta, passa pelo polimento (pontuação e capitalização)
        │
        ▼
dita-helper.exe paste  →  Ctrl+V via SendInput na janela em foco
```

O único acesso à internet do projeto é o download do modelo, uma vez.

## Rodando os testes

```powershell
cd app
npm test
```

O teste de integração do whisper fica de fora por padrão (ele baixa 1,6GB).
Para incluí-lo:

```powershell
cd app
npx cross-env RUN_WHISPER=1 npm test
```
