# Dita Aí 🎙️

**Ditado por voz no computador inteiro, rodando 100% local.** Você segura um atalho, fala, solta, e o texto cai no campo onde o cursor está: WhatsApp Web, Notion, terminal, prompt do Claude, qualquer lugar. Nada sobe pra nuvem, nada tem mensalidade.

É um clone funcional do Wispr Flow, feito em Electron + whisper.cpp, com transcrição em português.

> **Aviso honesto:** este é um projeto de uso interno que abrimos pra comunidade. Ele funciona, mas não é um app de loja: você vai compilar na sua máquina, o app não é assinado, e você precisa liberar permissão no sistema. Se você mexe com terminal, leva 15 minutos. Se nunca abriu um terminal, chame alguém que já abriu.

---

## Escolha sua plataforma

| Sistema | Atalho padrão | Guia |
|---|---|---|
| **macOS** (Apple Silicon) | `Fn+Espaço` | continue lendo abaixo |
| **Windows 10/11** x64 | `Ctrl+Shift+Espaço` | **[docs/windows.md](docs/windows.md)** |

---

## O que você precisa (macOS)

| Item | Por quê |
|---|---|
| **macOS com Apple Silicon** (M1 em diante) | os caminhos do Homebrew são de Apple Silicon (`/opt/homebrew`) e o whisper roda em Metal |
| **16GB de RAM** (recomendado) | o modelo carregado ocupa cerca de 1,6GB |
| **Node.js 20+** | rodar e compilar o app |
| **Homebrew** | instalar o whisper.cpp |
| **~2GB de disco livre** | o modelo de transcrição é baixado no primeiro uso |

## Instalação (macOS)

```bash
# 1. dependências de sistema
# (o ffmpeg não entra aqui: vem do pacote npm ffmpeg-static, nas duas plataformas)
brew install whisper-cpp

# 2. o app
git clone https://github.com/felipefernandees/dita-ai.git
cd dita-ai/app
npm install

# 3. o helper de atalho global (Swift, compila em segundos)
cd ../helper && bash build.sh

# 4. rodar
cd ../app && npm run dev
```

Na primeira execução ele baixa o modelo `ggml-large-v3-turbo` (cerca de 1,6GB) pra `~/Library/Application Support/dita-ai/models/`. Isso demora alguns minutos e acontece **uma vez só**.

Para gerar o `.app` de verdade: `npm run build:mac`.

## As duas permissões que o macOS vai pedir

Sem essas duas o app abre mas não funciona. Vá em **Ajustes do Sistema → Privacidade e Segurança**:

1. **Acessibilidade** → adicione o Dita Aí (é o que permite capturar o `Fn+Espaço` global e colar o texto no app onde você está)
2. **Microfone** → adicione o Dita Aí

> Rodando em modo `dev`, quem precisa da permissão é o **Electron**, não o "Dita Aí". Depois de compilar com `build:mac`, é o app.

## Gatekeeper: "app danificado" ou "de desenvolvedor não identificado"

O app **não é assinado com conta Apple Developer** (assinatura ad-hoc). Se o macOS bloquear, libere assim:

```bash
xattr -cr "/Applications/Dita Aí.app"
```

Se você não confia em rodar binário não assinado (postura correta), compile você mesmo pelo código-fonte deste repo: é exatamente o que os comandos acima fazem.

## Personalize o vocabulário (2 minutos, muda tudo)

O Whisper acerta muito mais quando sabe de antemão que palavras você costuma falar. Abra `app/src/main/whisper.js`, ache a constante `VOCABULARIO` e coloque ali os seus nomes próprios: sua empresa, seus sócios, as ferramentas do seu stack, sua cidade. É o ajuste com melhor retorno do projeto inteiro.

## Como usar

| Ação | Atalho |
|---|---|
| Gravar | segure `Fn+Espaço`, fale, solte |
| Cancelar no meio | `Esc` |
| Preferências | ícone na barra de menus |

O histórico das transcrições fica num SQLite local em `~/Library/Application Support/dita-ai/`.

## Como funciona por dentro

```
Atalho global (helper Swift no macOS, dita-helper.exe no Windows)
        │
        ▼
Electron grava o áudio  →  ffmpeg converte  →  whisper.cpp (servidor local)
        │
        ▼
Texto volta, passa pelo polimento (pontuação e capitalização)
        │
        ▼
Colado no campo onde o cursor está
```

Tudo acontece na sua máquina. O único acesso à internet do projeto é o download do modelo, uma vez.

O whisper roda em Metal no macOS e em CPU (com OpenBLAS) no Windows — o
whisper.cpp não publica build de GPU para Windows fora de placas NVIDIA.

| Pasta | O que tem |
|---|---|
| `app/` | o Electron: `src/main` (processo principal, whisper, hotkeys, banco) e `src/renderer` (popup e preferências em React) |
| `helper/` | `DitaHotkeys.swift`, o binário que escuta o atalho global no macOS |
| `helper-win/` | `dita-helper.exe`, o equivalente Windows: hook de teclado, colagem e app em foco |
| `branding/` | ícones e identidade visual |
| `docs/` | a spec de design, o plano da Fase 1 e o [guia do Windows](docs/windows.md) |

## Estado do projeto

Fase 1 (o núcleo: gravar, transcrever, colar, histórico, preferências) está construída e em uso diário. Fases 2 e 3 (comandos de edição por voz, modos por aplicativo) não começaram.

Testes: `cd app && npm test`.

## Contribuindo

Pegou o projeto na comunidade Core, melhorou alguma coisa? Abra um PR aqui **e** publique sua atualização no Build in Public da plataforma contando o que mudou. É pra isso que ele está aberto.

---

*Feito por [Felipe Tâmbara](https://instagram.com/felipetambara.ia) com Claude Code. Aberto pra comunidade Core.*
