# Verificação manual do macOS

O que os testes automatizados **não** alcançam. Leva ~5 minutos, mais uns 3 se
você for verificar o motor remoto (opcional).

Por que não dá para automatizar: teclas sintetizadas por software chegam ao
event tap marcadas como injetadas, e o helper as ignora de propósito (é o que
impede a própria colagem do app de se autodisparar). Microfone exige dispositivo
real e a permissão do sistema. E colagem depende de qual janela tem foco no
momento.

Este roteiro é o irmão de [verificacao-windows.md](verificacao-windows.md), e
existe pelo mesmo motivo que aquele: o port para Windows foi feito inteiramente
no Windows, e a paridade que ele trouxe de volta para o Mac (atalho livre,
whisper embutido) precisa ser exercitada por uma pessoa numa máquina de verdade.

## Antes de começar

```bash
cd app
npm run deps:mac    # uma vez: compila o whisper.cpp (precisa de cmake)
npm run helper:mac  # uma vez: compila o helper Swift
npm run dev
```

Espere o ícone aparecer na barra de menus. Abra o **TextEdit** com um documento
novo e vazio — não um arquivo seu.

> Em modo `dev`, quem pede a permissão de Acessibilidade é o **Electron**, não o
> "Dita Aí". Depois de `npm run build:mac`, é o app.

## Roteiro

| # | Ação | Esperado | Se falhar |
|---|---|---|---|
| 1 | `Fn+Espaço`, falar, `Fn+Espaço` | pílula aparece, some, texto colado no TextEdit | ver diagnóstico abaixo |
| 2 | Nenhum espaço extra foi digitado no passo 1 | o atalho é suprimido, não vaza para o app | supressão do event tap falhou |
| 3 | Segurar `⌘ direito`, falar, soltar | mesmo resultado do passo 1 | push-to-talk |
| 4 | Segurar `⌘ direito` e soltar em menos de 0,3s | **nada acontece** | guarda de PTT curto |
| 5 | Segurar `⌘ direito` + `V`, soltar | nada é gravado, e o `⌘V` cola normal | detecção de combo |
| 6 | Gravar e apertar `Esc` | tarja "Transcrição cancelada / Anular" | |
| 7 | Clicar em "Anular" na tarja | o texto é colado mesmo assim | |
| 8 | `Esc` sem estar gravando | o `Esc` chega ao app normalmente | supressão condicional |
| 9 | Clicar no ícone da barra de menus | menu com o último ditado, Abrir, Idiomas, Sair | |
| 10 | Preferências → botão do atalho | mostra `fn + Espaço`, com `⌘ direito` marcado no push-to-talk; **nenhum** `Ctrl`, `Alt` ou `Win` escrito por extenso | |
| 11 | Clicar no botão e apertar `⌃⌥J`, testar | passa a gravar com `⌃⌥J` **sem reiniciar o app** | o helper reinicia sozinho ao trocar |
| 12 | Segurar o atalho principal por 3 segundos | grava **uma vez** só, sem piscar | anti auto-repeat |
| 13 | Clicar no botão e apertar só `J` | recusa e explica que a tecla sozinha pararia de funcionar em todos os programas; o atalho anterior continua valendo | validação da captura |
| 14 | Clicar no botão, segurar `⌃⇧` e soltar sem apertar mais nada | continua em "Pressione a combinação…", nada é gravado | modificador não é atalho |
| 15 | Clicar no botão e apertar `Esc` | sai do modo de captura sem trocar nada | |
| 16 | Clicar no botão e apertar `⌘Tab` | recusa dizendo que o macOS reserva a combinação | lista de reservadas |
| 17 | Clicar no botão e apertar `⌘Espaço` | **aceita**, mas avisa que o Spotlight deixa de abrir com ela | aviso não-bloqueante |
| 18 | Voltar pelo botão **fn + Espaço**, testar | grava de novo com `Fn+Espaço` | preset (a captura não alcança a tecla Fn) |
| 19 | Trocar para `⌃⌥Ç` (tecla à direita do L) e testar | grava normal; o rótulo mostra `⌃ + ⌥ + Ç` | tecla OEM do ABNT2 |
| 20 | Preferências → push-to-talk → `⇧ direito`, testar | o passo 3 passa a funcionar com `⇧ direito` | |

## O app sem Homebrew (o teste que importa para distribuir)

Este é o motivo de o `deps:mac` existir. Ele prova que o `.app` roda numa máquina
que **não** é a sua.

| # | Ação | Esperado |
|---|---|---|
| 21 | `npm run build:mac` e abrir `dist/mac-arm64/Dita AI.app` | abre, transcreve, cola |
| 22 | `otool -L "dist/mac-arm64/Dita AI.app/Contents/Resources/whisper/metal/whisper-server"` | só frameworks do sistema (`/System/...`, `/usr/lib/...`). **Nenhuma** linha com `/opt/homebrew` |
| 23 | No log do app, na subida do whisper | `using embedded metal library` e o nome da sua GPU | |

Se o passo 22 mostrar qualquer `/opt/homebrew`, o binário compilado está
linkando contra bibliotecas da sua máquina e o app vai quebrar na de outra
pessoa — reveja `BUILD_SHARED_LIBS=OFF` em `scripts/build-whisper-mac.mjs`.

## Motor Tempo Real (Gemini)

Opcional — pule se você só usa o motor local. É o mesmo roteiro do Windows
(Preferências → Motor de transcrição → colar a chave), com uma diferença: aqui o
áudio sai da sua máquina, então a assinatura no rodapé das Preferências deve
trocar de `100% LOCAL` para `MODO TEMPO REAL · O ÁUDIO É ENVIADO AO GOOGLE`. Se
ela não trocar, é bug de UI, e é um bug sério: a tela estaria mentindo sobre
para onde o seu áudio está indo.

## Diagnóstico

| Sintoma | Causa provável |
|---|---|
| O atalho não faz nada | Acessibilidade não liberada em Ajustes → Privacidade e Segurança (em `dev` é o **Electron** que precisa aparecer lá) |
| `Fn+Espaço` abre o painel de emojis ou o ditado da Apple | Ajustes → Teclado → "Pressionar a tecla globo para" = **Não Fazer Nada** |
| O popup aparece mas o texto não cola | a colagem usa Apple Events; libere também Automação para o app |
| Transcreve devagar demais | conferir no log se subiu com Metal (passo 23) e se o modelo é o `large-v3-turbo` |
| Nada acontece e nem o popup aparece | ver `~/dita-debug.log` rodando com `DITA_DEBUG=1 npm run dev` |
