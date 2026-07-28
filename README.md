# Dita Aí 🎙️

**Você aperta um atalho, fala, e o texto aparece onde o cursor está.** WhatsApp Web, Word, e-mail, qualquer campo. Sem mensalidade.

---

# ⬇️ Baixar

## 🪟 Windows 10 / 11

# **[→ BAIXAR O INSTALADOR](https://github.com/felipefernandees/dita-ai/releases/latest)**

## 🍎 macOS

Ainda não existe instalador pronto para Mac — é preciso compilar. **[Veja como →](macOS/)**

---

> ⚠️ O botão verde **`Code`** lá em cima **não** baixa o aplicativo. Ele baixa o código de programação. Para usar o Dita Aí, use o link acima.

**No Windows, depois de baixar:**

1. Execute o arquivo `.exe`.
2. Vai aparecer **"O Windows protegeu o seu computador"** → clique em **Mais informações** → **Executar assim mesmo**. É esperado: o instalador não tem certificado pago.
3. No primeiro ditado o app baixa o modelo de voz (**1,6 GB**). Uma vez só. Depois funciona sem internet.
4. Aperte **`Ctrl` + `Shift` + `Espaço`**, fale, aperte de novo.

Passo a passo com mais detalhe: **[Windows/](Windows/)** · **[macOS/](macOS/)**

---

<details>
<summary><b>Detalhes técnicos do projeto</b> (para quem vai mexer no código)</summary>

Clone funcional do Wispr Flow, em Electron + whisper.cpp, com transcrição em português rodando **100% local** — nada sobe pra nuvem.

No Windows existe também um **motor remoto opcional** (Gemini Live, com a sua própria chave gratuita): responde em ~440ms em vez de 7 a 10s, mas **envia o seu áudio para o Google**. Vem desligado, o padrão continua sendo o motor local. Detalhes em [docs/windows.md](docs/windows.md#motor-tempo-real-gemini).

Projeto de uso interno aberto pra comunidade. Funciona, mas não é app de loja: o instalador não é assinado e o sistema pede permissão na primeira vez.

</details>

---

## Documentação por plataforma

| Sistema | Atalho | Guia completo |
|---|---|---|
| **macOS** (Apple Silicon) | `Fn+Espaço`, escolhido numa lista fixa | continue lendo abaixo |
| **Windows 10/11** x64 | `Ctrl+Shift+Espaço` por padrão, mas você grava a combinação que quiser | **[docs/windows.md](docs/windows.md)** |

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

Existe ainda um **dicionário de correção** aplicado depois da transcrição (em `polish()`), que é o que conserta jargão de dev — `git hub` → `GitHub`, `deploi` → `deploy`. Ele vale para os dois motores de transcrição, mas **ainda não tem interface**: hoje se edita no SQLite ou na semeadura em `app/src/main/db.js`.

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
Texto volta, passa pelo polimento (pontuação, capitalização e dicionário)
        │
        ▼
Colado no campo onde o cursor está
```

Tudo acontece na sua máquina. O único acesso à internet do projeto é o download do modelo, uma vez — a exceção é o motor remoto opcional do Windows, que é opt-in e está descrito no guia daquela plataforma.

O whisper roda em Metal no macOS. No Windows ele roda em CPU com OpenBLAS por
padrão, porque o whisper.cpp não publica build de GPU para Windows fora de
placas NVIDIA; quem quiser aceleração pode compilar um binário Vulkan com
`npm run whisper:vulkan` (opcional — sem ele nada quebra). Numa Radeon
integrada, com uma amostra de 11,4s, isso mediu 8,3s contra 16,9s do BLAS. É uma
máquina e um áudio só: trate como indicação, não como benchmark.

| Pasta | O que tem |
|---|---|
| `app/` | o Electron: `src/main` (processo principal, whisper, hotkeys, banco) e `src/renderer` (popup e preferências em React) |
| `helper/` | `DitaHotkeys.swift`, o binário que escuta o atalho global no macOS |
| `helper-win/` | `dita-helper.exe`, o equivalente Windows: hook de teclado, colagem e app em foco |
| `branding/` | ícones e identidade visual |
| `docs/` | a spec de design, o plano da Fase 1, o [guia do Windows](docs/windows.md) e os roteiros de verificação manual |

## Estado do projeto

Fase 1 (o núcleo: gravar, transcrever, colar, histórico, preferências) está construída e em uso diário. Fases 2 e 3 (comandos de edição por voz, modos por aplicativo) não começaram.

Testes: `cd app && npm test`.

## Instalador pronto (Windows) e integração contínua

Todo push e todo PR disparam o [CI](.github/workflows/ci.yml), que roda em **duas** máquinas: `windows-latest` e `macos-latest`. Nas duas ele compila o helper nativo, roda `electron-vite build` e executa a suíte. O job do macOS existe porque o port para Windows foi feito inteiramente no Windows — sem ele, uma regressão no lado macOS só apareceria na máquina de um usuário.

O que nenhum dos dois cobre: atalho global com tecla física, microfone e colagem na janela em foco. Isso é verificação humana, com roteiro em [docs/verificacao-windows.md](docs/verificacao-windows.md).

**O instalador do Windows fica em [Releases](https://github.com/felipefernandees/dita-ai/releases/latest)** (link de download no topo deste README). Ele é montado pelo [workflow de release](.github/workflows/release.yml) a partir de uma tag `v*`, no próprio GitHub, e já traz os backends `blas` e `cpu` do whisper.cpp. Não traz o backend Vulkan (opcional, compilado localmente com `npm run whisper:vulkan`) nem o modelo de 1,6GB, que é baixado no primeiro uso.

Para publicar uma versão nova: `git tag vX.Y.Z && git push origin vX.Y.Z`. Mergear um PR **não** gera instalador — o workflow só dispara em tag.

> **O instalador não é assinado.** O SmartScreen vai barrar a primeira execução: **"Mais informações" → "Executar assim mesmo"**. Assinar exigiria um certificado de code signing comprado de uma CA e guardado como secret do repositório — não temos. Se você prefere não rodar binário não assinado, compile pelo código-fonte: [docs/windows.md](docs/windows.md).

Quem prefere compilar em vez de baixar binário pronto: `npm run build:win` na sua máquina, com o passo a passo em [docs/windows.md](docs/windows.md).

## Contribuindo

Pegou o projeto na comunidade Core, melhorou alguma coisa? Abra um PR aqui **e** publique sua atualização no Build in Public da plataforma contando o que mudou. É pra isso que ele está aberto.

---

*Feito por [Felipe Tâmbara](https://instagram.com/felipetambara.ia) com Claude Code. Aberto pra comunidade Core.*
