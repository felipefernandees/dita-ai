# Compila o whisper.cpp com backend Vulkan e instala em
# app/resources/win/whisper/vulkan/.
#
# POR QUE ESTE SCRIPT EXISTE: o whisper.cpp nunca publicou build Vulkan para
# Windows (conferido nos 30 releases anteriores a v1.9.1); os únicos binários
# acelerados por GPU dos releases oficiais são cuBLAS, que só servem em NVIDIA.
# Numa Radeon integrada o Vulkan mede 2x mais rápido que o build BLAS oficial
# (11,4s de áudio: 16,9s no BLAS, 8,3s no Vulkan, transcrição idêntica).
#
# O binário resultante é OPCIONAL. Se esta pasta não existir, o app usa o
# candidato `blas` baixado por `npm run deps:win` e nada quebra — quem clonar o
# repositório não precisa deste toolchain para rodar o projeto.
#
# Requisitos (só para quem quer o build Vulkan):
#   winget install Microsoft.VisualStudio.2022.BuildTools `
#     --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools `
#                 --add Microsoft.VisualStudio.Component.VC.CMake.Project `
#                 --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
#   winget install KhronosGroup.VulkanSDK
#
# O Windows SDK não é opcional: sem ele falta o rc.exe e o link falha com uma
# mensagem que parece "compilador não encontrado".

param(
  [string]$Tag = 'v1.9.1',
  # Caminho CURTO de propósito. O gerador de shaders do Vulkan é um sub-projeto
  # CMake aninhado e, num diretório de trabalho fundo, o caminho do TryCompile
  # passa dos 260 caracteres do MAX_PATH — o erro aparece como "compilador não
  # encontrado" e leva horas para diagnosticar.
  [string]$WorkDir = 'C:\wsrc'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$destino = Join-Path $here '..\resources\win\whisper\vulkan'

$vs = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools'
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ninja = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'

foreach ($p in @($vcvars, $cmake, $ninja)) {
  if (-not (Test-Path $p)) { throw "não encontrado: $p — veja os requisitos no topo deste script" }
}
$sdk = Get-ChildItem 'C:\VulkanSDK' -Directory -ErrorAction SilentlyContinue |
       Sort-Object Name -Descending | Select-Object -First 1
if (-not $sdk) { throw 'Vulkan SDK não encontrado em C:\VulkanSDK' }

if (-not (Test-Path $WorkDir)) {
  Write-Host "clonando whisper.cpp $Tag em $WorkDir"
  git clone --depth 1 --branch $Tag https://github.com/ggml-org/whisper.cpp $WorkDir
  # O clone raso pode deixar o checkout incompleto no Windows; força a escrita
  # de todos os arquivos do índice.
  Push-Location $WorkDir
  git config core.longpaths true
  git checkout-index -a -f
  Pop-Location
}

# O build precisa rodar dentro do ambiente do MSVC (vcvars64), senão o CMake
# não acha o cl.exe. Um .bat temporário é a forma menos frágil de encadear isso.
$bat = Join-Path $env:TEMP 'dita-build-vulkan.bat'
@"
@echo off
call "$vcvars" || exit /b 1
cd /d "$WorkDir" || exit /b 1
"$cmake" -B build -G Ninja -DCMAKE_MAKE_PROGRAM="$ninja" -DCMAKE_BUILD_TYPE=Release ^
  -DGGML_VULKAN=ON -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_TESTS=OFF ^
  -DBUILD_SHARED_LIBS=ON || exit /b 1
"$cmake" --build build --config Release || exit /b 1
"@ | Set-Content -Path $bat -Encoding ascii

& cmd /c $bat
if ($LASTEXITCODE -ne 0) { throw "build falhou (exit $LASTEXITCODE)" }

$bin = Join-Path $WorkDir 'build\bin'
$exe = Join-Path $bin 'whisper-server.exe'
if (-not (Test-Path $exe)) { throw "build terminou mas não produziu $exe" }

New-Item -ItemType Directory -Force $destino | Out-Null
Copy-Item (Join-Path $bin 'whisper-server.exe') $destino -Force
Copy-Item (Join-Path $bin 'whisper.dll') $destino -Force
Copy-Item (Join-Path $bin 'ggml*.dll') $destino -Force

# Sanidade: o binário tem que ENXERGAR um dispositivo. Se sair 0 aqui, ele
# ainda roda — em CPU sem OpenBLAS, mais devagar que o candidato `blas` — e é
# exatamente por isso que o app sonda antes de escolher (ver binaries.js).
$saida = & (Join-Path $destino 'whisper-server.exe') --help 2>&1 | Out-String
if ($saida -match 'Found (\d+) Vulkan devices') {
  Write-Host "instalado em $destino — dispositivos Vulkan vistos: $($Matches[1])"
  if ([int]$Matches[1] -eq 0) {
    Write-Warning 'nenhum dispositivo Vulkan nesta máquina: o app vai descartar este candidato e usar o blas'
  }
} else {
  throw 'o binário não reportou a linha de dispositivos Vulkan — build suspeito'
}
