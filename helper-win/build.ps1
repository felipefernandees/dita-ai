# Compila o helper para helper-win/dist/dita-helper.exe
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root 'dist'

dotnet publish (Join-Path $root 'DitaHelper\DitaHelper.csproj') -c Release -o $out

Write-Host "helper em: $(Join-Path $out 'dita-helper.exe')"
