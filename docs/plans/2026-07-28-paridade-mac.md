# Paridade macOS: trazer de volta o que o port de Windows ensinou

> 2026-07-28. O port para Windows (PRs #1, #2 e #3, de @ArtudGabriel) rodou inteiro
> numa máquina Windows. Boa parte do que ele fez é neutra de plataforma e o macOS
> herdou de graça no merge. Este plano cuida do resto: o que ficou só do lado de lá,
> e o que o port mudou com uma premissa de x86 que fica errada no Apple Silicon.

## O que o macOS JÁ ganhou no merge (nada a fazer)

- **Supervisor do helper** (`hotkeys.js`): o helper de teclado agora é reiniciado com
  backoff e o usuário é avisado quando ele desiste. Antes, se o `dita-hotkeys` morresse,
  os atalhos paravam em silêncio e o app continuava com cara de saudável.
- **Modelo baixado em stream** com arquivo `.part` (`whisper.js`): era `execFileSync`
  com `curl` bloqueando o boot. Fechou um dos três bloqueadores de distribuição.
- **ffmpeg do npm** (`ffmpeg-static`, em `binaries.js`): saiu o caminho fixo para o
  Homebrew. Metade do bloqueador nº 1 resolvida.
- **Fallback de whisper-server** com erro que distingue "modelo ilegível" e "porta
  ocupada" de "este backend não serve nesta máquina".
- **Motor Gemini Live** como alternativa remota ao Whisper local, com config cifrada.

## O que este plano faz

### A. Atalho livre no macOS (o helper Swift ganha gramática)

Hoje `DitaHotkeys.swift` aceita 4 toggles (`fn+space`, `opt+space`, `ctrl+space`, `f5`)
e 2 push-to-talk, tudo em `switch` literal. No Windows o aluno trocou isso por uma
gramática (`helper-win/DitaHelper/ShortcutSpec.cs`), espelhada em JS
(`app/src/renderer/src/atalhos.js`), com a UI capturando a combinação apertada.

- `helper/ShortcutSpec.swift`: parser da mesma gramática, com o vocabulário do macOS
  (`ctrl`, `alt`, `shift`, `cmd`, `fn`) e tabela token → virtual keycode do Carbon.
- Aceita os specs antigos (`opt+space` continua valendo, `opt` é alias de `alt`):
  ninguém perde o atalho que já usa ao atualizar.
- `atalhos.js` passa a ter gramática POR plataforma; `specDeEvento` mapeia `metaKey`
  para `cmd` no macOS e para `win` no Windows.
- A tecla **Fn não existe no `KeyboardEvent`** do Chromium no macOS: não dá para
  capturá-la apertando. Por isso o macOS ganha captura **mais** botões de preset para
  o que a captura não alcança (`Fn + Espaço`).
- Comando `parse` no helper Swift + teste que alimenta os MESMOS specs no parser Swift
  de verdade e compara veredicto a veredicto com o JS, igual ao `emit-harness` do C#.

### B. whisper-server dentro do app (fim do Homebrew)

`binaries.js` ainda devolve `/opt/homebrew/opt/whisper-cpp/bin/whisper-server` no macOS:
o app só roda no Mac de quem tem aquela fórmula instalada. O upstream não publica
binário de macOS, então o caminho é compilar.

- `app/scripts/build-whisper-mac.mjs`: compila o whisper.cpp numa tag fixa com
  `GGML_METAL_EMBED_LIBRARY=ON` (o shader entra no binário, sem `.metallib` solto) e
  deixa o resultado em `app/resources/mac/whisper/metal/`.
- `binaries.js` no macOS: primeiro o empacotado, depois o Homebrew (conveniência de dev).
- `electron-builder.yml`: `resources/mac/whisper` vira `extraResources` do mac.
- `cmake` passa a ser dependência de BUILD do macOS, como o .NET SDK é do Windows.

### C. Threads de inferência no Apple Silicon

O port trocou o `4` fixo por `min(8, núcleos_lógicos / 2)`, medido num Ryzen com SMT.
No Apple Silicon não existe SMT e os núcleos não são iguais: num M4 de 10 núcleos
(4 performance + 6 eficiência) a conta dá 5 threads, o que joga trabalho num E-core e
atrasa o lote inteiro. No macOS o número certo é o de núcleos de performance,
lido de `hw.perflevel0.logicalcpu`.

### D. `getFrontmostApp` não pode pendurar o ditado

`paster.darwin.js` chama `osascript` sem timeout, e o `onStart` do ditado espera por ele
ANTES de mostrar o popup. Um `osascript` travado (permissão de Automação pendente, System
Events ocupado) trava o começo do ditado sem nenhum sinal. Timeout curto, e falhou volta
string vazia, que é o contrato que o `catch` já tinha.

## Verificação

- `npm test` verde no macOS (era 214/1 falha antes).
- Trocar o atalho pela UI, apertando uma combinação nova, e ditar com ela.
- `npm run deps:mac && npm run build:mac`, e o app empacotado transcrevendo numa sessão
  sem `whisper-cpp` no PATH.
- Checklist manual: `docs/verificacao-mac.md`.
