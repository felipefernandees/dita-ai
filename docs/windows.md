# Dita Aí no Windows

Ditado por voz global no Windows 10/11 x64.

Por padrão tudo roda na sua máquina — o áudio não sai daqui. Existe um motor
opcional que troca velocidade por privacidade enviando o áudio ao Google; ele é
**desligado por padrão** e está descrito em
[Motor Tempo Real (Gemini)](#motor-tempo-real-gemini).

## O que você precisa

| Item | Por quê |
|---|---|
| **Windows 10 21H2 ou 11**, x64 | o helper usa `SetWindowsHookEx` e `SendInput` |
| **16GB de RAM** (recomendado) | o modelo carregado ocupa cerca de 1,6GB |
| **Node.js 20+** | rodar e compilar o app |
| **.NET 8 SDK** | compilar o helper de atalho global |
| **~4GB de disco livre** | modelo (1,6GB) + binários do whisper.cpp + build |

Placa de vídeo dedicada **não** é necessária. Existe um build acelerado por
Vulkan, mas ele é opcional e o app funciona sem ele — ver
[Aceleração por GPU](#aceleração-por-gpu-vulkan-opcional).

## Instalação

```powershell
winget install Microsoft.DotNet.SDK.8
```

Abra um terminal **novo** depois disso (o PATH só atualiza em processo novo),
então:

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
| `deps:win` | baixa os binários do whisper.cpp dos releases oficiais (`blas` e `cpu`) |
| `icons:win` | gera os ícones `.ico` da bandeja e do app |
| `whisper:vulkan` | **opcional**: compila do zero um whisper.cpp com backend Vulkan |
| `check:win-deps` | confere se os binários do whisper estão no lugar (roda dentro do `build:win`) |

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

| Ação | Padrão |
|---|---|
| Gravar (liga/desliga) | `Ctrl+Shift+Espaço` |
| Gravar (segurar pra falar) | `Ctrl direito` |
| Cancelar no meio | `Esc` |

O atalho principal **não é mais uma lista fixa**. Nas Preferências você clica no
botão do atalho, aperta a combinação que quiser, e ela é gravada — o helper
reinicia sozinho e o atalho novo já vale, sem reabrir o app.

### O que a captura recusa, e por quê

As mesmas regras valem nos dois lados (na UI, em
`app/src/renderer/src/atalhos.js`, e no helper C#, em
`helper-win/DitaHelper/ShortcutSpec.cs` — há testes que comparam os dois
veredictos justamente para não divergirem em silêncio):

| Combinação | Veredicto | Motivo |
|---|---|---|
| `J` sozinho (qualquer letra, número ou tecla OEM) | recusada | o hook suprime a tecla no sistema inteiro: o `J` pararia de funcionar em **todos** os programas, inclusive no campo onde você tentaria desfazer |
| `F1`–`F24` sozinhas | aceitas | são as únicas que podem ficar sem modificador |
| `Ctrl`/`Alt`/`Shift`/`Win` sem tecla base | não grava nada | a combinação ainda não terminou; a captura continua esperando |
| `Alt+F4`, `Alt+Tab`, `Ctrl+Alt+Del`, `Win+L` | recusadas | o Windows age nelas antes da janela receber o evento — o atalho nunca chegaria ao Dita Aí |
| qualquer coisa com `Win` | aceita, **com aviso** | o hook engole a tecla base, o shell vê a tecla Windows sozinha e abre o menu Iniciar ao soltar |

`Esc` durante a captura sai sem trocar nada.

**Teclado ABNT2:** o `Alt direito` é o `AltGr`, e o Chromium reporta o AltGr
como `ctrl` **e** `alt` ao mesmo tempo — é literalmente o que o Windows
entrega, não dá para distinguir de um Ctrl+Alt de verdade. Então gravar
"AltGr+J" registra `ctrl+alt+j`. O rótulo mostra `Ctrl + Alt + J`, que é o que o
helper vai de fato escutar: a UI não está mentindo, só está sendo literal.

As teclas OEM são gravadas pela **posição física**, não pelo caractere — por isso
a tecla à direita do `L` é rotulada `Ç`, mesmo que o layout ativo no momento
produzisse outra coisa.

### Push-to-talk

Push-to-talk continua sendo uma lista de seis botões, não uma captura, e é
sempre **um modificador segurado**: `Ctrl direito`, `Ctrl esquerdo`,
`Shift direito`, `Shift esquerdo`, `Alt direito` e `Alt esquerdo`. Segurar uma
combinação de dois modificadores durante um ditado inteiro exigiria duas mãos e
travaria os dois no sistema — oferecer captura aqui seria promessa falsa.

`Alt direito` e `Alt esquerdo` aparecem com aviso: o primeiro é o AltGr do
ABNT2 (usado em `ç`, `º` e `₢`), e soltar o `Alt esquerdo` sozinho ativa a barra
de menus do programa em foco. As teclas de PTT **nunca** são suprimidas — você
ainda precisa delas nos atalhos normais do sistema.

**As teclas Windows não são oferecidas como PTT.** Um toque solto abre o menu
Iniciar toda vez, e como as teclas de PTT não são suprimidas, não há como evitar.

### Por que o padrão é diferente do Mac

**`Fn+Espaço` não existe aqui.** A tecla `Fn` é resolvida dentro do firmware do
teclado e nunca chega ao sistema operacional — nenhum programa no Windows
consegue capturá-la. Por isso o padrão é `Ctrl+Shift+Espaço`, que não colide com
o alternador de idioma (`Ctrl+Espaço`) nem com o menu de janela (`Alt+Espaço`).

## Aceleração por GPU (Vulkan, opcional)

O whisper.cpp **não publica build Vulkan para Windows** — nunca publicou
(conferido nos 30 releases anteriores ao `v1.9.1`). Os únicos binários
acelerados por GPU nos releases oficiais são cuBLAS, que só funcionam em placas
NVIDIA. Por isso o `npm run whisper:vulkan` compila um do código-fonte.

O app procura três variantes, nesta ordem:

| Ordem | Variante | O que é | De onde vem |
|---|---|---|---|
| 1 | `vulkan` | inferência na GPU, qualquer fabricante | `npm run whisper:vulkan` (compila) |
| 2 | `blas` | mesma CPU, álgebra de matriz via OpenBLAS | `npm run deps:win` (baixa) |
| 3 | `cpu` | build ingênuo, sem dependência nenhuma | `npm run deps:win` (baixa) |

**Se a pasta `vulkan` não existir, nada quebra**: o app usa o `blas`. Quem clona
o repositório não precisa do toolchain de compilação para usar o projeto.

### O número medido, e o tamanho dele

Numa **Radeon integrada**, com **um** áudio de 11,4s:

| Variante | Tempo | Transcrição |
|---|---|---|
| BLAS (oficial) | 16,9s | idêntica |
| Vulkan (compilado) | 8,3s | idêntica |

Cerca de 2x mais rápido. Sendo honesto sobre o que isso vale: é **uma máquina e
uma amostra de áudio**, e a comparação de qualidade foi feita nessa mesma
amostra única. Não é uma validação ampla — é o resultado que temos, e ele pode
não se repetir no seu hardware nem no seu tipo de fala.

### Por que o candidato Vulkan é sondado antes de ser usado

Os outros candidatos são escolhidos por tentativa e erro: se o processo morre, o
próximo assume. Com o Vulkan isso não funcionaria.

Numa máquina **sem GPU compatível o binário Vulkan não falha**. Ele imprime
`Found 0 Vulkan devices` e sobe normalmente, caindo num backend de CPU embutido
— o ggml genérico, **sem** OpenBLAS. Ou seja: funcionaria, e funcionaria **pior**
que o `blas` que viria depois. Um laço de fallback que só reage a processo morto
jamais perceberia isso, e o usuário sem GPU ficaria em silêncio com a pior das
três opções.

Por isso o app roda o próprio binário com `--help` na subida e lê quantos
dispositivos o ggml enxergou (`app/src/main/binaries.js`, `vulkanUtilizavel`).
Custa ~160ms, uma vez. Zero dispositivos → o candidato é descartado.

### Requisitos do build Vulkan

Só para quem quer compilar. Nada disso é necessário para usar o app:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools `
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools `
              --add Microsoft.VisualStudio.Component.VC.CMake.Project `
              --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
winget install KhronosGroup.VulkanSDK
```

O Windows SDK **não** é opcional: sem ele falta o `rc.exe` e o link falha com
uma mensagem que parece "compilador não encontrado".

```powershell
cd app
npm run whisper:vulkan
```

O script clona o whisper.cpp em `C:\wsrc` (caminho curto de propósito: o gerador
de shaders do Vulkan é um sub-projeto CMake aninhado e, num diretório fundo, o
`TryCompile` estoura os 260 caracteres do MAX_PATH), compila e instala em
`app/resources/win/whisper/vulkan/`. No fim ele avisa quantos dispositivos
Vulkan o binário enxergou — se for zero, o app vai descartá-lo e usar o `blas`.

Quem tem placa **NVIDIA** pode, como alternativa, baixar o
`whisper-cublas-*-bin-x64.zip` manualmente e apontar `DITA_WHISPER_SERVER` para
o executável dele.

## Threads de inferência

Já foram 4 fixos, herdados do tuning de Apple Silicon (onde o trabalho pesado é
do Metal e sobram os núcleos de eficiência). No Windows a inferência local é
inteira em CPU, e 4 threads deixavam metade do processador parado.

Hoje o número segue os núcleos **físicos** (metade dos lógicos, teto de 8).
Medido num Ryzen 7 5700G (8C/16T), com o mesmo áudio de 11,4s:

| Threads | Tempo |
|---|---|
| 4 | 22,0s |
| 8 (físicos) | 17,8s |
| 16 (lógicos) | 27,3s |

Passar dos físicos **piora**: os threads de SMT brigam pelas mesmas unidades de
execução. Dá para forçar outro valor com a variável `DITA_THREADS`.

## Motor Tempo Real (Gemini)

Opcional, desligado por padrão, e você traz sua própria chave.

> **O que você precisa saber antes de ligar:** neste modo o seu áudio é
> **enviado para os servidores do Google** enquanto você fala. Ele não fica só
> na sua máquina. O motor local continua sendo o padrão, e você pode voltar para
> ele a qualquer momento.

### O que muda na prática

| | Motor local (padrão) | Motor Tempo Real |
|---|---|---|
| Onde o áudio vai | não sai da máquina | streaming para o Google |
| Espera depois que você para de falar | 7 a 10s neste hardware | ~440ms (medido) |
| Configuração | nenhuma | chave da API do Google |
| Custo | zero | free tier do Google (ver abaixo) |

### Como ligar

1. Pegue uma chave gratuita em `aistudio.google.com` → **Get API key** →
   **Create API key** → copie o código.
2. Preferências → **Motor de transcrição** → **Modo Tempo Real** → cole a chave
   → **Salvar e Ativar**.

A chave é cifrada em repouso pelo `safeStorage` do Electron (DPAPI no Windows) e
gravada em `%APPDATA%\dita-ai\config.json` — num arquivo separado do banco de
propósito, para ficar óbvio o que apagar se você quiser revogar tudo.

Se esta máquina não oferecer cofre de credenciais, o app **avisa na tela** e
grava em texto puro em vez de falhar calado. E se você copiar o `AppData` para
outro usuário ou outra máquina, os bytes cifrados não abrem lá: a UI diz isso e
pede a chave de novo, em vez de fingir que a chave sumiu.

### A barra de uso é uma estimativa

O free tier é de 1500 sessões por dia. A barra nas Preferências mostra
`usado / 1500`, mas **a contagem é local a esta máquina**: a mesma chave usada
em outro computador, ou em qualquer outra ferramenta, não aparece ali. Quem
decide o limite de verdade é o Google. A barra serve para você não se
surpreender, não como um contador oficial — não dá para saber o número real
daqui, e por isso o app não promete.

A contagem zera pela **data local**, não UTC: quem dita às 21h no Brasil já está
em 00h UTC do dia seguinte, e zerar a cota no meio da noite de trabalho pareceria
bug.

### O fallback: você nunca perde um ditado

Em qualquer um destes casos o app **notifica** e transcreve no motor local:

| Situação | O que aparece |
|---|---|
| Modo Tempo Real ligado, nenhuma chave salva | notificação pedindo para colar a chave nas configurações |
| Cota diária estimada esgotada | notificação avisando que ele volta ao local até amanhã |
| Falha ao conectar ou sessão derrubada no meio | notificação de que a fala continua sendo transcrita normalmente |

A fala gravada é reaproveitada; nada do que você falou é descartado.

### Quando parar de funcionar: troque o id do modelo

O modelo padrão é `models/gemini-3.1-flash-live-preview`.

**Os ids `preview`/`latest` da Live API são aposentados sem aviso.** Quando a
sessão começar a fechar logo depois do setup com erro de modelo inválido, é este
o botão a girar — sem recompilar:

```powershell
$env:DITA_GEMINI_MODEL = 'models/gemini-2.5-flash-native-audio-latest'
npm run dev
```

Os ids que a Live API aceitava em `bidiGenerateContent` na última medição
(2026-07-27) estão listados no bloco `PROTOCOLO` de
`app/src/main/gemini-live.js`, junto com os três outros detalhes do protocolo que
a versão anterior errava e que faziam o app cair calado no motor local a cada
ditado. **Leia esse bloco antes de mexer no cliente.**

### Diagnósticos

Para descobrir se o problema é chave, cota, modelo ou protocolo:

| Comando | O que responde |
|---|---|
| `npm run diag:gemini` | a chave salva existe e a conexão sobe? |
| `npm run diag:gemini:audio` | manda PCM16 real e mostra **cada** frame que volta — é o script que prova o protocolo |
| `npm run diag:gemini:cliente` | passa áudio real pelo cliente que vai embarcado, não por um reimplemento |
| `scripts/diag-gemini-tempo.js` | mede o intervalo entre "parei de falar" e "o texto está pronto" (ainda sem atalho no `package.json`; rode `npx electron scripts/diag-gemini-tempo.js`) |

Todos precisam de `DITA_APP_NAME="Dita Aí"` no ambiente — os scripts `npm` já
definem. **Não é opcional:** o Electron deriva o `userData` do `productName`, e
o `safeStorage` amarra a chave de cifragem a esse `userData`. Sem a variável o
`userData` vira `Electron`, a decifragem falha e o diagnóstico **mente** dizendo
que não há chave salva — você vai caçar um bug de credencial que não existe.

## Vocabulário e jargão de dev

Duas coisas diferentes, que agem em momentos diferentes:

**1. O prompt inicial do whisper.** Abra `app/src/main/whisper.js`, ache a
constante `VOCABULARIO` e coloque ali seus nomes próprios — empresa, sócios,
ferramentas do seu stack, sua cidade. Limite de ~224 tokens. Vale só para o
motor local, porque é um parâmetro do whisper.

**2. O dicionário de correção**, aplicado **depois** da transcrição, em
`polish()`. Ele vale para os **dois motores**, porque está no caminho
compartilhado do pipeline. É onde moram as correções de jargão: `git hub` →
`GitHub`, `deploi` → `deploy`, `web hook` → `webhook`, `docker compus` →
`docker compose`. O dicionário fica no SQLite e é semeado por versão, então
quem já usava o app recebe os termos novos sem perder o que editou.

### Por que o glossário não vai pelo `systemInstruction` do Gemini

Porque foi medido e **não muda nada**. A mesma frase densa de jargão, rodada com
e sem glossário na `systemInstruction`, saiu **exatamente igual** — o script está
em `app/scripts/diag-vocabulario.js`.

O motivo: no Gemini Live, quem transcreve não é o modelo. O texto que o app usa
vem de `serverContent.inputTranscription`, produzido por um caminho de ASR do
servidor que ignora a instrução dada ao modelo. A `systemInstruction` que o app
manda serve para **calar** o modelo (sem ela ele responde em áudio, e você paga
por cada token dessa resposta que vai direto para o lixo), não para ensinar
vocabulário. Corrigir depois, no dicionário, é o único ponto que funciona.

**Limitação conhecida:** o dicionário ainda não tem interface. Para editá-lo hoje
é preciso mexer no SQLite ou na semeadura em `app/src/main/db.js`. É uma lacuna
real, não uma decisão de design.

## A bandeja do sistema

| Ação | O que acontece |
|---|---|
| **Clique esquerdo** no ícone | abre as Preferências |
| Clique direito | menu: último ditado (só informativo), Abrir Dita Aí, Idiomas, Sair |

No macOS um clique no ícone já abre o menu sozinho, e é o que o usuário de Mac
espera. No Windows o clique esquerdo não faz nada por padrão, e quem instala o
app clica nele esperando que abra — ter que descobrir o botão direito é atrito à
toa.

**"Colar último ditado" foi removido**, e o atalho global `Ctrl+Alt+V` que fazia
a mesma coisa saiu junto. Uma tecla que cola texto antigo sem nada na interface
explicando de onde ele veio é surpresa, não recurso. A linha com o último ditado
continua no menu — ela informa, não age.

## Onde ficam seus dados

| O quê | Onde |
|---|---|
| Histórico de ditados (SQLite) | `%APPDATA%\dita-ai\dita.db` |
| Modelo de transcrição | `%APPDATA%\dita-ai\models\` |
| Chave do Gemini + contagem de uso | `%APPDATA%\dita-ai\config.json` |

## Problemas conhecidos

| Sintoma | Causa | O que fazer |
|---|---|---|
| SmartScreen bloqueia o instalador | executável não assinado | "Mais informações" → "Executar assim mesmo" |
| o atalho não funciona em um app específico | esse app roda como administrador; um hook instalado por processo comum não recebe os eventos dele (UIPI) | rodar o Dita Aí como administrador também, ou o app alvo sem elevação |
| transcreve mas não cola | mesma causa acima, agora no `SendInput` | o texto fica no card grande com o botão "Copiar Ditado" |
| `VCRUNTIME140.dll não encontrada` | falta o redistribuível do Visual C++ | `winget install Microsoft.VCRedist.2015+.x64` |
| a preferência "tamanho do popup" não faz nada | bug que já existe no projeto original, nas duas plataformas: o valor é lido mas nunca aplicado à janela | nenhuma ação; o popup usa tamanho fixo |
| Modo Tempo Real ligado, mas o ditado demora como antes | a sessão remota não subiu e o app caiu no motor local | conferir a notificação que apareceu e rodar `npm run diag:gemini` |
| a transcrição local está lenta | é CPU, a não ser que você tenha compilado o build Vulkan | ver [Aceleração por GPU](#aceleração-por-gpu-vulkan-opcional), ou trocar por um modelo menor em `app/src/main/whisper.js` (constante `MODEL_FILE`) |

## Como funciona por dentro

```
Ctrl+Shift+Espaço  (dita-helper.exe, hook WH_KEYBOARD_LL)
        │  evento JSON no stdout
        ▼
Electron grava o áudio
        │
        ├── motor local (padrão)  → ffmpeg → whisper-server (vulkan/blas/cpu)
        │                                    tudo dentro da sua máquina
        │
        └── motor Tempo Real      → PCM16 16kHz → WebSocket → Gemini Live
            (opcional, opt-in)                    o áudio sai da sua máquina
        │
        ▼
polish(): pontuação, capitalização e o dicionário de jargão  (nos DOIS motores)
        │
        ▼
dita-helper.exe paste  →  Ctrl+V via SendInput na janela em foco
```

No modo padrão, o único acesso à internet do projeto é o download do modelo, uma
vez. No Modo Tempo Real, o áudio é transmitido ao Google durante a fala.

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

Depois dos testes automatizados, o roteiro manual está em
[verificacao-windows.md](verificacao-windows.md) — ele cobre o que hook de
teclado, microfone e colagem não deixam automatizar.
