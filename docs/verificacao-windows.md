# Verificação manual do port Windows

O que os testes automatizados **não** alcançam. Leva ~5 minutos.

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
| 9 | Menu da bandeja → "Paste last transcript" | cola o último ditado | |
| 10 | `Ctrl+Alt+V` | mesmo que o passo 9 | atalho global |
| 11 | Preferências → botão do atalho | mostra `Ctrl + Shift + Espaço` e `Ctrl direito` marcado; **nenhum** `⌘`, `⌥` ou `Fn` | |
| 12 | Clicar no botão e apertar `F5`, testar | `F5` passa a gravar sem reiniciar o app | helper reinicia sozinho |
| 13 | Segurar o atalho principal por 3 segundos | grava **uma vez** só, sem piscar | anti auto-repeat |
| 14 | Clicar no botão e apertar só `J` | recusa e explica que a tecla sozinha pararia de funcionar em todos os programas; o atalho anterior continua valendo | validação da captura |
| 15 | Clicar no botão, segurar `Ctrl+Shift` e soltar sem apertar mais nada | continua em "Pressione a combinação…", nada é gravado | modificador não é atalho |
| 16 | Clicar no botão e apertar `Esc` | sai do modo de captura sem trocar nada | |
| 17 | Trocar para `Ctrl+Alt+Ç` (tecla à direita do L) e testar | grava normal; o rótulo mostra `Ctrl + Alt + Ç` | tecla OEM do ABNT2 |
| 18 | Preferências → push-to-talk → `Shift direito`, testar | o passo 3 passa a funcionar com `Shift direito` | |

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

**A transcrição demora muito**
Esperado em máquina modesta: no Windows o whisper roda em CPU. Ver a seção
"Sobre a transcrição ser em CPU" em [windows.md](windows.md).

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
