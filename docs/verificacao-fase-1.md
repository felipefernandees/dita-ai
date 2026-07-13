# Verificação Fase 1 · 2026-07-12

## Verificado automaticamente (feito por mim, nesta máquina)

- [x] Suíte de testes completa: 15/15 passando (`npm test`, com RUN_WHISPER=1 incluso)
- [x] Pipeline de ponta a ponta com áudio real de voz sintética: gravar → whisper → polir → salvar → colar. Resultado: "Teste do pipeline completo do DITA AI." transcrito e salvo com app de destino, 7 palavras, 100.5 PPM
- [x] Regra de ouro: ditado salvo no SQLite ANTES da colagem (conferido no banco)
- [x] Captura de microfone com waveform no popup (43KB de áudio em 3s, permissão de mic concedida)
- [x] Popup não rouba foco (focusable: false, showInactive)
- [x] Helper Swift compila e roda (reporta no_permission corretamente sem Acessibilidade)
- [x] Máquina de estados dos atalhos: 6 casos testados (toggle, PTT, PTT curto, combo, Esc, conflito)
- [x] whisper-server residente com modelo large-v3-turbo-q5_0 (547MB) local
- [x] App empacotado, instalado em /Applications e rodando com whisper-server ativo
- [x] Login item configurado (app empacotado)
- [x] Ícone na menu bar com Paste last transcript (⌃⌘V), prévia e idiomas

## Pendente do Felipe (exige ação física no teclado/Ajustes)

- [ ] Conceder Acessibilidade: Ajustes > Privacidade e Segurança > Acessibilidade > ativar "Dita Aí", depois fechar e reabrir o app
- [ ] Fn+Espaço liga, falar, Fn+Espaço desliga → texto colado no app ativo
  - Se Fn+Espaço não responder: Ajustes > Teclado > "Pressione a tecla globo para" = "Não Fazer Nada"
- [ ] Cmd direito segurado grava, soltar cola (push-to-talk)
- [ ] Cmd direito + V continua colando normal (combo não dispara gravação)
- [ ] Esc durante gravação cancela sem colar
- [ ] Ditar sem caixa de texto focada: popup persiste com Copiar Ditado
- [ ] ⌃⌘V cola o último ditado
- [ ] Clipboard anterior restaurado depois do paste
- [ ] Trocar idioma pra English e ditar em inglês
- [ ] Reabrir o app: histórico persiste, atalhos voltam
- [ ] App abre sozinho após logout/login

## Notas

- O histórico tem 1 entrada de teste (SmokeTest); pode apagar depois se incomodar.
- App não assinado com Developer ID (uso local, ad-hoc). Se o Gatekeeper reclamar: clicar com botão direito > Abrir.
- Ollama, Transforms, Estilo e o hub visual ficam pra Fase 2/3 (planos próprios).
