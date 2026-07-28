#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# O helper virou DOIS arquivos quando o parser de atalhos saiu de dentro dele
# (ShortcutSpec.swift, espelho do ShortcutSpec.cs do Windows). Em Swift, num
# módulo com mais de um arquivo, só `main.swift` pode ter código de nível
# superior — é por isso que o antigo DitaHotkeys.swift passou a se chamar assim.
swiftc -O -o dita-hotkeys main.swift ShortcutSpec.swift
echo "ok: $(pwd)/dita-hotkeys"
