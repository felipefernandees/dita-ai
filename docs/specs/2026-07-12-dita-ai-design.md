# Dita Aí · Design Spec

> Spec aprovada em conversa em 2026-07-12. App de ditado por voz 100% local para macOS que substitui o Wispr Flow (corta assinatura de R$35/mês).

## 1. Objetivo

Clonar a experiência do Wispr Flow no Mac do Felipe (M4, 16GB, macOS 26), com custo zero de operação: atalho global, popup de gravação, transcrição por IA local, polimento do texto e colagem automática no app ativo, mais o hub de gestão (histórico, insights, dicionário, snippets, estilo, transforms).

Critério de sucesso: Felipe cancela o Wispr Flow e não sente diferença no dia a dia.

## 2. Decisões travadas

| Decisão | Escolha |
|---|---|
| Transcrição | 100% local, whisper.cpp com modelo large-v3-turbo quantizado (~1.6GB, download único) |
| Polimento IA | Ollama local (qwen3:4b) com fallback para limpeza por regras se o Ollama estiver off |
| Escopo | Clone completo (ditado + hub), construído em fases |
| Stack | Electron + React (menu bar app + popup flutuante + hub) |
| Nome | Dita Aí (slug `dita-ai`) |
| Idioma padrão | Português (seletor de idiomas no menu bar e nas configurações) |
| Custo | Zero. Nenhuma API paga em nenhum fluxo. |

## 3. Atalhos e comportamento de gravação

- **Fn+Espaço**: toggle. Aperta uma vez, começa a gravar; aperta de novo, para e processa.
- **Cmd direito (segurar)**: push-to-talk. Grava enquanto segura, processa ao soltar.
- **Esc** (ou X no popup): cancela a gravação em andamento.
- Detecção via monitoramento global de eventos (CGEventTap, mesma técnica do Wispr). Exige permissão de Acessibilidade.
- **Risco conhecido**: a tecla Fn é tratada de forma especial pelo macOS. Se o macOS 26 impedir a captura de Fn+Espaço, plano B: atalho alternativo configurável (F5 ou Opt+Espaço) sem bloquear o resto da entrega.

## 4. Fluxo do ditado (pipeline)

1. Atalho dispara → popup flutuante preto com waveform animado (X cancela, check confirma).
2. Áudio capturado do microfone selecionado (auto-detect por padrão, com troca no menu bar).
3. Ao parar: whisper.cpp transcreve (1 a 3s no M4).
4. Polimento: Ollama limpa vícios de fala, aplica Dicionário e Snippets com contexto, ajusta pontuação conforme Estilo do app de destino. Fallback: regras determinísticas (substituições do dicionário + expansão de snippets).
5. **Regra de ouro: o resultado é salvo no histórico (SQLite) ANTES de qualquer tentativa de colagem. Nada se perde nunca.**
6. Colagem no app ativo: salva o clipboard atual → escreve o texto → simula Cmd+V → restaura o clipboard.
7. Se não houver caixa de texto focada ou a colagem falhar: popup persiste com o texto e botão "Copiar Ditado" (réplica do comportamento do Wispr).
8. Registro de métricas: palavras, duração, PPM, app de destino, correções aplicadas.

## 5. Menu bar

- Ícone com estado (idle / gravando).
- **Paste last transcript (⌃⌘V)** com prévia do último ditado.
- Abrir o hub, Shortcuts, Microphone (submenu com dispositivos), Languages (submenu), Quit.

## 6. Hub (janela principal, réplica das telas do Wispr)

- **Início**: boas-vindas + histórico agrupado por dia (Hoje/Ontem/...), busca, copiar, apagar; card lateral com total de palavras, PPM e sequência de dias.
- **Insights**: PPM com gauge, correções feitas, total de palavras ditadas, uso por app/categoria, calendário de sequência (streak) por mês.
- **Dicionário**: termos e substituições (ex: btw → by the way), abas Todos/Pessoal, CRUD completo. Aplicado no polimento.
- **Snippets**: frase falada → texto expandido (ex: "meu email" → felipetambara@gmail.com), CRUD completo.
- **Estilo**: presets Formal / Casual / Muito casual, atribuíveis por contexto (mensagens pessoais, trabalho, e-mail, outro).
- **Transforms**: reescritas pós-ditado via Ollama (Polish, Engenheiro de Prompt, customizados), atalhos Opt+1 / Opt+2, toggle de participação.
- **Configurações**: Geral (atalhos, microfone, idiomas), Sistema (iniciar no login, mostrar no dock, sons de ditado), Experimental.
- Visual: fiel aos prints do Wispr Flow (sidebar bege, cards, serifa nos títulos), sem usar a marca/logo deles.

## 7. Arquitetura técnica

```
projetos/dita-ai/app/
├── main/           # Processo principal Electron
│   ├── shortcuts   # CGEventTap global (Fn+Espaço, Cmd direito, Esc)
│   ├── recorder    # Janela popup + captura de áudio
│   ├── whisper     # Gerência do whisper.cpp (binário + modelo, spawn por ditado ou server)
│   ├── polish      # Cliente Ollama + fallback de regras
│   ├── paster      # Clipboard save/restore + Cmd+V sintético
│   ├── db          # SQLite (better-sqlite3): history, dictionary, snippets, stats, settings
│   └── tray        # Menu bar
├── renderer/       # React
│   ├── popup/      # Waveform + estados (gravando, processando, resultado com Copiar Ditado)
│   └── hub/        # Início, Insights, Dicionário, Snippets, Estilo, Transforms, Configurações
└── resources/      # whisper.cpp binário, ícones
```

- Modelo Whisper baixado no primeiro uso para `~/Library/Application Support/dita-ai/models/`.
- Banco SQLite em `~/Library/Application Support/dita-ai/dita.db`.
- Permissões pedidas com onboarding guiado na primeira execução: Microfone + Acessibilidade.
- App empacotado (electron-builder), instalado em /Applications, iniciar no login opcional.

## 8. Tratamento de erros

- Whisper falha → notificação + áudio bruto preservado em disco para reprocessar.
- Ollama off → fallback silencioso para regras; badge discreto no hub indicando "polimento básico".
- Colagem falha → popup "Copiar Ditado"; texto já está no histórico e no Paste last transcript.
- Gravação órfã (app fechado no meio) → áudio temporário recuperado na próxima abertura.

## 9. Fases de entrega

1. **Fase 1 · Core (libera o cancelamento do Wispr)**: atalhos globais, popup com waveform, whisper local, colagem com preservação de clipboard, histórico persistente, menu bar com Paste last transcript, onboarding de permissões.
2. **Fase 2 · Hub**: todas as telas (Início, Dicionário, Snippets, Configurações) com dados reais.
3. **Fase 3 · Inteligência**: polimento Ollama, Transforms com atalhos, Estilo por contexto, Insights completos.

Cada fase termina com verificação real de ponta a ponta (ditar de verdade e ver o texto colado).

## 10. Fora de escopo (YAGNI)

- Contas, login, nuvem, sync, equipe, mobile, referral.
- Modo Vibe coding (reconhecimento de variáveis em IDE), Command Mode.
- Qualquer telemetria externa.
