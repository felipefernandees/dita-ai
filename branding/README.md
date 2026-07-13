# Branding · Dita Aí

Identidade visual do app de ditado por voz. Ícone escolhido: waveform (equalizador) de 5 barras brancas sobre squircle roxo-escuro (opção 04). Wordmark em grotesk lowercase ("dita aí"). Tudo gerado a partir dos vetores em `src/`, então é reproduzível e escala sem perder nitidez.

## Cor de marca
- Fundo do ícone: gradiente roxo-escuro `#312A4E` → `#1A1626` → `#0E0C16`
- Barras / wordmark: branco `#FFFFFF` (ou preto `#000000` em fundo claro)
- (o azul `#2B44FF` do estudo anterior foi descartado com o conceito D-voz)

## Assets prontos

| Arquivo | O que é | Onde usar |
|---|---|---|
| `dita-ai.icns` | Ícone do app (todos os tamanhos 16→1024) | Ícone do app no macOS (electron-builder `mac.icon`) |
| `app-icon-1024.png` | Ícone com moldura, 1024px | Loja, site, qualquer lugar que peça o ícone com fundo |
| `dita-ai.iconset/` | PNGs individuais por tamanho | Fonte do `.icns` (regenerar com `iconutil`) |
| `equalizador-branco-1024.png` / `-512.png` | Só o equalizador, branco, **transparente**, sem moldura | Dentro da UI do app (fundo escuro), splash, loading |
| `equalizador-preto-1024.png` | Só o equalizador, preto, transparente | Qualquer lugar em fundo claro (docs, site claro) |
| `menubar-Template.png` (44px) e `@2x.png` (88px) | Ícone da barra de menu do macOS, **template** (preto puro + alpha; o sistema inverte sozinho no dark/light) | Tray icon do Electron |
| `lockup-preto.png` (1280px) | Ícone + nome "dita aí", preto, transparente | Assinatura em fundo claro |
| `lockup-branco.png` (1280px) | Ícone + nome, branco, transparente | Assinatura em fundo escuro |

## Fontes (vetores)
`src/*.svg` são a fonte da verdade. Pra regenerar qualquer tamanho:
```
rsvg-convert -w 2048 -h 2048 src/app-icon.svg -o app-icon-2048.png
```

## Notas de uso
- **Menu bar:** o nome do arquivo termina em `Template`, então o Electron/macOS trata como template image (fica branco no modo escuro e preto no claro automaticamente). Não recolorir.
- **`.icns` no Electron:** apontar `build.mac.icon` para `dita-ai.icns` e rebuildar.
- `_preview.html` mostra todos os assets sobre fundos claro/escuro/transparente (arquivo de conferência, não é asset).
- Versões antigas (conceito D-voz, descartado) em `_arquivo-dvoz-2026-07-13/`.
