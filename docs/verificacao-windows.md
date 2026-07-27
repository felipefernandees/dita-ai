# Verificação manual do port Windows

O que os testes automatizados **não** alcançam. Leva ~5 minutos, mais uns 3 se
você for verificar o motor remoto (opcional).

Por que não dá para automatizar: teclas sintetizadas por software chegam ao hook
marcadas como injetadas, e o hook as ignora de propósito (é o que impede a
própria colagem do app de se autodisparar). Microfone exige dispositivo real e a
permissão global do Windows. E colagem depende de qual janela tem foco no
momento.

## Antes de começar

```powershell
cd app
npm run dev
```

Espere o ícone aparecer na bandeja do sistema. Abra o **Bloco de Notas** com um
arquivo novo e vazio — não um documento seu.

## Roteiro

| # | Ação | Esperado | Se falhar |
|---|---|---|---|
| 1 | `Ctrl+Shift+Espaço`, falar, `Ctrl+Shift+Espaço` | pílula aparece, some, texto colado no Bloco de Notas | ver diagnóstico abaixo |
| 2 | Nenhum espaço extra foi digitado no passo 1 | o atalho é suprimido, não vaza para o app | supressão do hook falhou |
| 3 | Segurar `Ctrl direito`, falar, soltar | mesmo resultado do passo 1 | push-to-talk |
| 4 | Segurar `Ctrl direito` e soltar em menos de 0,3s | **nada acontece** | guarda de PTT curto |
| 5 | Segurar `Ctrl direito` + `C`, soltar | nada é gravado, e o `Ctrl+C` funciona normal | detecção de combo |
| 6 | Gravar e apertar `Esc` | tarja "Transcrição cancelada / Anular" | |
| 7 | Clicar em "Anular" na tarja | o texto é colado mesmo assim | |
| 8 | `Esc` sem estar gravando | o `Esc` chega ao app normalmente | supressão condicional |
| 9 | **Clique esquerdo** no ícone da bandeja | abre as Preferências | |
| 10 | Clique direito no ícone | menu com o último ditado (só informativo), Abrir, Idiomas, Sair | |
| 11 | Preferências → botão do atalho | mostra `Ctrl + Shift + Espaço` e `Ctrl direito` marcado; **nenhum** `⌘`, `⌥` ou `Fn` | |
| 12 | Clicar no botão e apertar `F5`, testar | `F5` passa a gravar sem reiniciar o app | helper reinicia sozinho |
| 13 | Segurar o atalho principal por 3 segundos | grava **uma vez** só, sem piscar | anti auto-repeat |
| 14 | Clicar no botão e apertar só `J` | recusa e explica que a tecla sozinha pararia de funcionar em todos os programas; o atalho anterior continua valendo | validação da captura |
| 15 | Clicar no botão, segurar `Ctrl+Shift` e soltar sem apertar mais nada | continua em "Pressione a combinação…", nada é gravado | modificador não é atalho |
| 16 | Clicar no botão e apertar `Esc` | sai do modo de captura sem trocar nada | |
| 17 | Trocar para `Ctrl+Alt+Ç` (tecla à direita do L) e testar | grava normal; o rótulo mostra `Ctrl + Alt + Ç` | tecla OEM do ABNT2 |
| 18 | Preferências → push-to-talk → `Shift direito`, testar | o passo 3 passa a funcionar com `Shift direito` | |

## Motor Tempo Real (Gemini)

Opcional — pule se você só usa o motor local. Os passos 19 e 20 precisam ser
feitos **antes** de salvar qualquer chave, senão você não vê o fallback.

Tenha uma chave gratuita em mãos (`aistudio.google.com` → Get API key → Create
API key). A chave nunca é mostrada de volta pela interface depois de salva.

| # | Ação | Esperado | Se falhar |
|---|---|---|---|
| 19 | Preferências → Motor de transcrição → **Modo Tempo Real** (sem chave salva) | a opção fica marcada, o aviso de que o áudio vai para o Google aparece na descrição, e o formulário de chave se abre | |
| 20 | Ditar normalmente ainda sem chave | **notificação** dizendo que nenhuma chave foi salva, e o ditado é transcrito pelo motor local do mesmo jeito — o texto é colado | fallback do motor |
| 21 | Colar a chave e clicar em **Salvar e Ativar** | "Chave salva e cifrada pelo cofre do sistema"; o campo **não** volta preenchido | `safeStorage` indisponível: nesse caso o aviso de texto puro é o comportamento esperado, não um erro |
| 22 | Aparece a **barra "Uso diário estimado"** | mostra `n / 1500` e o percentual, com o texto dizendo que a contagem é local a esta máquina | |
| 23 | Ditar uma frase e cronometrar | o texto chega logo depois de você parar de falar (na medição de referência, ~440ms), não em 7 a 10s | ver `npm run diag:gemini` |
| 24 | Voltar às Preferências | o contador da barra subiu em 1 | contabilização de uso |
| 25 | Rodapé das Preferências | com o Modo Tempo Real ativo lê **"O ÁUDIO É ENVIADO AO GOOGLE"**; ao voltar para o Modo Padrão volta a ler "100% LOCAL" | |
| 26 | Remover a chave e ditar | notificação de chave ausente e transcrição local, como no passo 20 | |

Se o passo 23 falhar com a sessão fechando logo depois de conectar, o id do
modelo provavelmente foi aposentado. Rode `npm run diag:gemini` e veja
"Quando parar de funcionar" em [windows.md](windows.md#motor-tempo-real-gemini).

## Se você compilou o build Vulkan

Só para quem rodou `npm run whisper:vulkan` — o build é opcional.

| # | Ação | Esperado |
|---|---|---|
| 27 | Ditar com o motor local e olhar o log do app na subida | o candidato `vulkan` é sondado; numa máquina com GPU compatível ele é escolhido, numa sem ele é descartado em favor do `blas` |
| 28 | Comparar o tempo com o do `blas` | mais rápido na máquina com GPU; **igual ou pior** sem GPU — é exatamente por isso que existe a sonda |

## Sobre as combinações reservadas

Não tente gravar `Alt+F4`, `Alt+Tab`, `Ctrl+Alt+Del` ou `Win+L` para ver a
recusa: o Windows age nessas teclas antes da janela recebê-las — a janela fecha,
o alternador aparece, a sessão bloqueia. É justamente por isso que elas são
recusadas, e é por isso que a recusa é verificada nos testes automatizados
(`tests/atalhos.test.js` e o cenário `parse` de `tests/helper-win.emit.test.js`)
e não aqui.

## Diagnóstico

**A pílula não aparece e nada acontece**
O hook não instalou. Feche outros apps de captura de teclado (AutoHotkey,
gerenciadores de macro, software de teclado gamer) e reabra.

**Grava e transcreve, mas não cola — o texto fica no card grande**
A janela em foco roda como administrador. Um hook e um `SendInput` de processo
comum não alcançam janelas elevadas (UIPI do Windows). Rode o Dita Aí como
administrador também, ou use o app alvo sem elevação. O botão "Copiar Ditado"
está ali justamente para esse caso.

**O atalho funciona em alguns apps e em outros não**
Mesma causa acima.

**Nada é gravado / erro de microfone**
Configurações → Privacidade e segurança → Microfone → ligue "Permitir que
aplicativos da área de trabalho acessem seu microfone".

**A transcrição local demora muito**
Esperado em máquina modesta: por padrão o whisper roda em CPU no Windows. As
saídas são compilar o build Vulkan ou trocar por um modelo menor — ver
[Aceleração por GPU](windows.md#aceleração-por-gpu-vulkan-opcional).

**O Modo Tempo Real está ligado mas o ditado continua lento**
A sessão remota não subiu e o app caiu no motor local — deve ter aparecido uma
notificação explicando qual dos três motivos foi (sem chave, cota estimada
esgotada, ou falha de conexão). `npm run diag:gemini` separa os casos.

## Depois: o app empacotado

Os passos acima rodam em modo `dev`. Vale repetir os passos 1, 3 e 9 com o app
instalado, porque três coisas mudam de caminho:

| O quê | Em dev | Instalado |
|---|---|---|
| helper | `helper-win/dist/` | `resources/dita-helper.exe` |
| whisper | `app/resources/win/whisper/` | `resources/whisper/` |
| ícone da bandeja | `app/resources/win/tray.ico` | `resources/tray.ico` |

Também confirme "abrir ao iniciar" nas Preferências:

```powershell
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' | Select-Object -Property '*ita*'
```

Deve aparecer uma entrada apontando para o executável instalado, e sumir quando
você desliga a opção.
